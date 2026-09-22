import { spawn } from 'child_process'

export type CursorRuntimePreference = 'local' | 'cloud' | 'auto'

export type CursorCreateShape =
  | { kind: 'local'; local: { cwd: string } }
  | {
      kind: 'cloud'
      cloud: {
        repos: Array<{ url: string; startingRef?: string }>
        autoCreatePR?: boolean
      }
    }

/** Decide local vs cloud Cursor Agent runtime (pure / testable). */
export function resolveCursorCreateOptions(params: {
  preference: CursorRuntimePreference
  cwd: string
  repoUrl?: string | null
  startingRef?: string | null
  autoCreatePR?: boolean
}): CursorCreateShape {
  const preferCloud =
    params.preference === 'cloud' ||
    (params.preference === 'auto' && Boolean(params.repoUrl?.trim()))

  if (preferCloud && params.repoUrl?.trim()) {
    return {
      kind: 'cloud',
      cloud: {
        repos: [
          {
            url: params.repoUrl.trim(),
            ...(params.startingRef?.trim()
              ? { startingRef: params.startingRef.trim() }
              : {})
          }
        ],
        autoCreatePR: params.autoCreatePR !== false
      }
    }
  }

  return { kind: 'local', local: { cwd: params.cwd } }
}

function runGitQuick(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, windowsHide: true, env: process.env })
    let stdout = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.on('error', () => resolve(''))
    child.on('close', () => resolve(stdout.trim()))
  })
}

export async function detectGithubRemoteUrl(cwd: string): Promise<string | null> {
  const url = await runGitQuick(['remote', 'get-url', 'origin'], cwd)
  if (!url) return null
  if (/github\.com[:/]/i.test(url)) return url
  return null
}

export async function detectCurrentBranch(cwd: string): Promise<string | null> {
  const name = await runGitQuick(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
  return name && name !== 'HEAD' ? name : null
}

function textFromUnknown(value: unknown): string {
  if (typeof value !== 'object' || value === null) return ''
  const record = value as Record<string, unknown>
  if (record.type !== 'assistant') return ''

  const message = record.message as Record<string, unknown> | undefined
  const content = message?.content
  if (!Array.isArray(content)) return ''

  let text = ''
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const item = block as Record<string, unknown>
    if (item.type === 'text' && typeof item.text === 'string') {
      text += item.text
    }
  }
  return text
}

export type CursorAgentResult = {
  text: string
  status: string
  agentId?: string
  runId?: string
  runtime: 'local' | 'cloud'
}

export type CursorAgentImage = {
  data: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | string
}

function createChatAbortError(): Error {
  const err = new Error('Chat cancelled by user')
  err.name = 'AbortError'
  return err
}

export async function runCursorAgent(options: {
  apiKey: string
  model: string
  cwd: string
  prompt: string
  images?: CursorAgentImage[]
  onDelta: (text: string) => void
  runtime?: CursorRuntimePreference
  autoCreatePR?: boolean
  /** User Cancel / stream abort — wired to Cursor SDK Run.cancel(). */
  signal?: AbortSignal | null
}): Promise<CursorAgentResult> {
  const { throwIfChatAborted } = await import('./chatAbort')
  throwIfChatAborted(options.signal)

  const preference = options.runtime ?? 'auto'
  const repoUrl =
    preference === 'local' ? null : await detectGithubRemoteUrl(options.cwd)
  const branch =
    preference === 'local' ? null : await detectCurrentBranch(options.cwd)
  const shape = resolveCursorCreateOptions({
    preference,
    cwd: options.cwd,
    repoUrl,
    startingRef: branch,
    autoCreatePR: options.autoCreatePR
  })

  if (shape.kind === 'cloud') {
    options.onDelta(
      `☁ Cloud Agent を開始します（repo: ${shape.cloud.repos[0]?.url}${
        options.autoCreatePR !== false ? ' · autoCreatePR' : ''
      }）\n`
    )
  }

  const sdk = (await import('@cursor/sdk')) as {
    Agent: {
      create: (input: Record<string, unknown>) => Promise<{
        agentId?: string
        send: (
          prompt:
            | string
            | {
                text: string
                images?: Array<{ data: string; mimeType: string }>
              }
        ) => Promise<{
          id?: string
          stream: () => AsyncIterable<unknown>
          wait: () => Promise<{ status?: string }>
          cancel?: () => Promise<void>
          supports?: (operation: string) => boolean
        }>
        [Symbol.asyncDispose]?: () => Promise<void>
      }>
    }
  }

  const createInput: Record<string, unknown> = {
    apiKey: options.apiKey,
    model: { id: options.model || 'composer-2.5' }
  }
  if (shape.kind === 'cloud') {
    createInput.cloud = shape.cloud
  } else {
    createInput.local = shape.local
  }

  const agent = await sdk.Agent.create(createInput)
  const images = (options.images ?? [])
    .filter((row) => row.data && row.mimeType)
    .slice(0, 5)
  const promptText =
    options.prompt.trim() ||
    (images.length > 0 ? '添付画像を確認して、必要な修正を提案してください。' : '')

  let removeAbortListener: (() => void) | null = null
  try {
    throwIfChatAborted(options.signal)
    const run = await agent.send(
      images.length > 0
        ? {
            text: promptText,
            images: images.map((row) => ({
              data: row.data,
              mimeType: row.mimeType
            }))
          }
        : promptText
    )

    let cancelRequested = false
    const requestCancel = (): void => {
      cancelRequested = true
      const canCancel =
        typeof run.cancel === 'function' &&
        (typeof run.supports !== 'function' || run.supports('cancel'))
      if (!canCancel) return
      void run.cancel!().catch(() => {
        // Cancel races with natural completion — ignore.
      })
    }
    if (options.signal) {
      if (options.signal.aborted) {
        requestCancel()
      } else {
        options.signal.addEventListener('abort', requestCancel, { once: true })
        removeAbortListener = () => {
          options.signal?.removeEventListener('abort', requestCancel)
        }
      }
    }

    let text = ''
    for await (const event of run.stream()) {
      if (cancelRequested || options.signal?.aborted) {
        throw createChatAbortError()
      }
      throwIfChatAborted(options.signal)
      const chunk = textFromUnknown(event)
      if (chunk !== '') {
        text += chunk
        options.onDelta(chunk)
      }
    }

    if (cancelRequested || options.signal?.aborted) {
      throw createChatAbortError()
    }
    throwIfChatAborted(options.signal)

    const result = await run.wait()
    if (cancelRequested || options.signal?.aborted || result.status === 'cancelled') {
      throw createChatAbortError()
    }
    const status = result.status ?? 'finished'
    if (status === 'error' && text.trim() === '') {
      throw new Error('Cursor Agent の実行に失敗しました')
    }
    return {
      text:
        text.trim() === ''
          ? shape.kind === 'cloud'
            ? 'Cloud Agent が完了しました。Cursor ダッシュボードまたは PR を確認してください。'
            : 'Cursor Agent が完了しました（出力テキストなし）。ワークスペースの変更を確認してください。'
          : text,
      status,
      agentId: agent.agentId,
      runId: run.id,
      runtime: shape.kind
    }
  } finally {
    removeAbortListener?.()
    const dispose = agent[Symbol.asyncDispose]
    if (typeof dispose === 'function') {
      await dispose.call(agent)
    }
  }
}

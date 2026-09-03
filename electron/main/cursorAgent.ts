export type CursorAgentResult = {
  text: string
  status: string
  agentId?: string
  runId?: string
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

export async function runCursorAgent(options: {
  apiKey: string
  model: string
  cwd: string
  prompt: string
  onDelta: (text: string) => void
}): Promise<CursorAgentResult> {
  const sdk = (await import('@cursor/sdk')) as {
    Agent: {
      create: (input: {
        apiKey: string
        model: { id: string }
        local: { cwd: string }
      }) => Promise<{
        agentId?: string
        send: (prompt: string) => Promise<{
          id?: string
          stream: () => AsyncIterable<unknown>
          wait: () => Promise<{ status?: string }>
        }>
        [Symbol.asyncDispose]?: () => Promise<void>
      }>
    }
    CursorAgentError?: new (message: string) => Error
  }

  const agent = await sdk.Agent.create({
    apiKey: options.apiKey,
    model: { id: options.model || 'composer-2.5' },
    local: { cwd: options.cwd }
  })

  try {
    const run = await agent.send(options.prompt)
    let text = ''
    for await (const event of run.stream()) {
      const chunk = textFromUnknown(event)
      if (chunk !== '') {
        text += chunk
        options.onDelta(chunk)
      }
    }
    const result = await run.wait()
    const status = result.status ?? 'finished'
    if (status === 'error' && text.trim() === '') {
      throw new Error('Cursor Agent の実行に失敗しました')
    }
    return {
      text: text.trim() === '' ? 'Cursor Agent が完了しました（出力テキストなし）。ワークスペースの変更を確認してください。' : text,
      status,
      agentId: agent.agentId,
      runId: run.id
    }
  } finally {
    const dispose = agent[Symbol.asyncDispose]
    if (typeof dispose === 'function') {
      await dispose.call(agent)
    }
  }
}

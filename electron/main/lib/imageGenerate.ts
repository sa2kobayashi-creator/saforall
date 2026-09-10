import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type ImageGenResult = {
  content: string
  model: string
  savedPath: string | null
}

function sanitizePromptSlice(prompt: string): string {
  return prompt.replace(/\s+/g, ' ').trim().slice(0, 900)
}

/**
 * OpenAI Images API (gpt-image-1 / dall-e-3 compatible response shape).
 * Saves under workspace/.saforall/generated when workspacePath is set.
 */
export async function generateOpenAiImage(opts: {
  prompt: string
  baseUrl?: string
  workspacePath?: string | null
  model?: string
}): Promise<ImageGenResult> {
  const prompt = sanitizePromptSlice(opts.prompt)
  if (!prompt) throw new Error('画像生成のプロンプトが空です')

  const { requireCredential } = await import('../ai/credentials')
  const credential = requireCredential('openai')
  const base = (opts.baseUrl || credential.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')
  const model = opts.model || 'gpt-image-1'
  const url = `${base}/images/generations`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credential.secret}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      prompt,
      size: '1024x1024',
      n: 1
    })
  })

  const raw = await res.text()
  if (!res.ok) {
    let detail = raw.slice(0, 400)
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: string } }
      if (parsed.error?.message) detail = parsed.error.message
    } catch {
      // keep
    }
    throw new Error(`画像生成に失敗しました: ${detail}`)
  }

  let b64 = ''
  let revised = ''
  try {
    const parsed = JSON.parse(raw) as {
      data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>
    }
    const row = parsed.data?.[0]
    revised = typeof row?.revised_prompt === 'string' ? row.revised_prompt : ''
    if (row?.b64_json) {
      b64 = row.b64_json
    } else if (row?.url) {
      const imgRes = await fetch(row.url)
      if (!imgRes.ok) throw new Error('生成画像 URL の取得に失敗しました')
      const buf = Buffer.from(await imgRes.arrayBuffer())
      b64 = buf.toString('base64')
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('画像')) throw error
    throw new Error('画像生成レスポンスの解析に失敗しました')
  }

  if (!b64) throw new Error('画像データが空でした')

  let savedPath: string | null = null
  const ws = typeof opts.workspacePath === 'string' ? opts.workspacePath.trim() : ''
  if (ws) {
    const dir = join(ws, '.saforall', 'generated')
    await mkdir(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const fileName = `gen-${stamp}.png`
    const abs = join(dir, fileName)
    await writeFile(abs, Buffer.from(b64, 'base64'))
    savedPath = `.saforall/generated/${fileName}`
  }

  const lines = [
    '画像を生成しました。',
    revised ? `調整プロンプト: ${revised}` : `プロンプト: ${prompt}`,
    savedPath
      ? `保存先: \`${savedPath}\`\n\n![generated](${savedPath})`
      : `![generated](data:image/png;base64,${b64})`
  ]
  return { content: lines.join('\n\n'), model, savedPath }
}

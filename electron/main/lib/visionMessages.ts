/** Vision message shaping for Electron main (no DOM). */

export const CHAT_IMAGE_MAX_COUNT = 4

export type ChatImagePayload = {
  name: string
  mime: string
  data_base64: string
}

export function parseContextImages(context: unknown): ChatImagePayload[] {
  if (!context || typeof context !== 'object') return []
  const images = (context as { images?: unknown }).images
  if (!Array.isArray(images)) return []
  const out: ChatImagePayload[] = []
  for (const row of images) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    let mime = typeof item.mime === 'string' ? item.mime.toLowerCase().trim() : ''
    if (mime === 'image/jpg') mime = 'image/jpeg'
    const data = typeof item.data_base64 === 'string' ? item.data_base64.trim() : ''
    if (!mime.startsWith('image/') || !data) continue
    out.push({
      name: typeof item.name === 'string' && item.name ? item.name : 'image.png',
      mime,
      data_base64: data
    })
    if (out.length >= CHAT_IMAGE_MAX_COUNT) break
  }
  return out
}

export function openAiUserContent(
  text: string,
  images: ChatImagePayload[]
): string | Array<Record<string, unknown>> {
  if (images.length === 0) return text
  const parts: Array<Record<string, unknown>> = [
    { type: 'text', text: text || '（画像を確認してください）' }
  ]
  for (const image of images) {
    parts.push({
      type: 'image_url',
      image_url: { url: `data:${image.mime};base64,${image.data_base64}` }
    })
  }
  return parts
}

export function claudeUserContent(
  text: string,
  images: ChatImagePayload[]
): string | Array<Record<string, unknown>> {
  if (images.length === 0) return text
  const parts: Array<Record<string, unknown>> = []
  for (const image of images) {
    parts.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: image.mime,
        data: image.data_base64
      }
    })
  }
  parts.push({ type: 'text', text: text || '（画像を確認してください）' })
  return parts
}

export function geminiUserParts(
  text: string,
  images: ChatImagePayload[]
): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [
    { text: text || '（画像を確認してください）' }
  ]
  for (const image of images) {
    parts.push({
      inline_data: {
        mime_type: image.mime,
        data: image.data_base64
      }
    })
  }
  return parts
}

export function attachImagesToOpenAiMessages(
  messages: Array<{ role: string; content: unknown }>,
  images: ChatImagePayload[]
): Array<{ role: string; content: unknown }> {
  if (!images.length) return messages
  const next = messages.map((row) => ({ ...row }))
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i]?.role !== 'user') continue
    const text = typeof next[i].content === 'string' ? String(next[i].content) : ''
    next[i] = { ...next[i], content: openAiUserContent(text, images) }
    break
  }
  return next
}

export function attachImagesToClaudeMessages(
  messages: Array<{ role: string; content: unknown }>,
  images: ChatImagePayload[]
): Array<{ role: string; content: unknown }> {
  if (!images.length) return messages
  const next = messages.map((row) => ({ ...row }))
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i]?.role !== 'user') continue
    const text = typeof next[i].content === 'string' ? String(next[i].content) : ''
    next[i] = { ...next[i], content: claudeUserContent(text, images) }
    break
  }
  return next
}

/** Shape for Cursor SDK `agent.send({ text, images })`. */
export function toCursorSdkImages(
  images: ChatImagePayload[]
): Array<{ data: string; mimeType: string }> {
  return images.slice(0, CHAT_IMAGE_MAX_COUNT).map((image) => ({
    data: image.data_base64,
    mimeType: image.mime
  }))
}

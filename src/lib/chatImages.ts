/**
 * Chat image attachments for vision models (OpenAI / Claude / Gemini).
 * Images stay in memory for the send; history stores text only.
 */

export const CHAT_IMAGE_MAX_COUNT = 4
export const CHAT_IMAGE_MAX_BYTES = 4 * 1024 * 1024
export const CHAT_IMAGE_MAX_EDGE = 1568
export const CHAT_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'])

export type ChatImageAttachment = {
  id: string
  name: string
  mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  /** Raw base64 without data: prefix */
  dataBase64: string
  /** Object URL for chip preview (revoke on remove) */
  previewUrl: string
  bytes: number
}

export type ChatImagePayload = {
  name: string
  mime: string
  data_base64: string
}

export function normalizeImageMime(mime: string | null | undefined): ChatImageAttachment['mime'] | null {
  const lower = String(mime || '').toLowerCase().trim()
  if (lower === 'image/jpg') return 'image/jpeg'
  if (CHAT_IMAGE_MIME.has(lower)) return lower as ChatImageAttachment['mime']
  return null
}

export function isImageFileName(name: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(name)
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('画像の読み込みに失敗しました'))
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(blob)
  })
}

/** Downscale large screenshots so vision requests stay cheap and under API limits. */
export async function compressImageBlob(
  blob: Blob,
  options?: { maxEdge?: number; maxBytes?: number }
): Promise<{ blob: Blob; mime: ChatImageAttachment['mime'] }> {
  const maxEdge = options?.maxEdge ?? CHAT_IMAGE_MAX_EDGE
  const maxBytes = options?.maxBytes ?? CHAT_IMAGE_MAX_BYTES
  const sourceMime = normalizeImageMime(blob.type) ?? 'image/png'

  if (typeof createImageBitmap !== 'function') {
    if (blob.size > maxBytes) throw new Error('画像が大きすぎます（4MB 以下にしてください）')
    return { blob, mime: sourceMime }
  }

  const bitmap = await createImageBitmap(blob)
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height, 1))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      if (blob.size > maxBytes) throw new Error('画像が大きすぎます（4MB 以下にしてください）')
      return { blob, mime: sourceMime }
    }
    ctx.drawImage(bitmap, 0, 0, width, height)

    const preferJpeg = sourceMime === 'image/jpeg' || sourceMime === 'image/webp' || scale < 1
    const exportMime = preferJpeg ? 'image/jpeg' : sourceMime === 'image/gif' ? 'image/png' : sourceMime
    const quality = exportMime === 'image/jpeg' ? 0.85 : undefined

    const out = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (next) => {
          if (!next) reject(new Error('画像の圧縮に失敗しました'))
          else resolve(next)
        },
        exportMime,
        quality
      )
    })
    if (out.size > maxBytes) {
      throw new Error('画像が大きすぎます（圧縮後も 4MB 超）。解像度を下げてください')
    }
    return { blob: out, mime: exportMime as ChatImageAttachment['mime'] }
  } finally {
    bitmap.close()
  }
}

export async function chatImageFromBlob(
  blob: Blob,
  name = 'paste.png'
): Promise<ChatImageAttachment> {
  const mimeHint = normalizeImageMime(blob.type)
  if (!mimeHint && !isImageFileName(name)) {
    throw new Error('対応形式は PNG / JPEG / WebP / GIF です')
  }
  const compressed = await compressImageBlob(blob)
  const dataBase64 = await blobToBase64(compressed.blob)
  return {
    id: crypto.randomUUID(),
    name: name.replace(/\.(gif)$/i, '.png') || 'image.png',
    mime: compressed.mime,
    dataBase64,
    previewUrl: URL.createObjectURL(compressed.blob),
    bytes: compressed.blob.size
  }
}

/** Clipboard / drop items that are actual image blobs (screenshots). */
export function imageBlobsFromDataTransfer(data: DataTransfer | null | undefined): Array<{
  blob: Blob
  name: string
}> {
  if (!data) return []
  const out: Array<{ blob: Blob; name: string }> = []

  if (data.items) {
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i]
      if (!item || item.kind !== 'file') continue
      const mime = normalizeImageMime(item.type)
      if (!mime) continue
      const file = item.getAsFile()
      if (!file) continue
      out.push({ blob: file, name: file.name || `paste.${mime.split('/')[1]}` })
    }
  }

  if (out.length === 0 && data.files) {
    for (let i = 0; i < data.files.length; i++) {
      const file = data.files.item(i)
      if (!file) continue
      const mime = normalizeImageMime(file.type) || (isImageFileName(file.name) ? 'image/png' : null)
      if (!mime) continue
      out.push({ blob: file, name: file.name || `image.${mime.split('/')[1]}` })
    }
  }

  return out
}

export function toImagePayloads(images: ChatImageAttachment[]): ChatImagePayload[] {
  return images.slice(0, CHAT_IMAGE_MAX_COUNT).map((image) => ({
    name: image.name,
    mime: image.mime,
    data_base64: image.dataBase64
  }))
}

export function revokeImagePreviews(images: ChatImageAttachment[]): void {
  for (const image of images) {
    try {
      URL.revokeObjectURL(image.previewUrl)
    } catch {
      // ignore
    }
  }
}

/** OpenAI Chat Completions multimodal content for the latest user turn. */
export function openAiUserContent(
  text: string,
  images: ChatImagePayload[]
): string | Array<Record<string, unknown>> {
  if (images.length === 0) return text
  const parts: Array<Record<string, unknown>> = [{ type: 'text', text: text || '（画像を確認してください）' }]
  for (const image of images.slice(0, CHAT_IMAGE_MAX_COUNT)) {
    parts.push({
      type: 'image_url',
      image_url: {
        url: `data:${image.mime};base64,${image.data_base64}`
      }
    })
  }
  return parts
}

/** Anthropic Messages API multimodal content. */
export function claudeUserContent(
  text: string,
  images: ChatImagePayload[]
): string | Array<Record<string, unknown>> {
  if (images.length === 0) return text
  const parts: Array<Record<string, unknown>> = []
  for (const image of images.slice(0, CHAT_IMAGE_MAX_COUNT)) {
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

/** Gemini generateContent parts. */
export function geminiUserParts(
  text: string,
  images: ChatImagePayload[]
): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [
    { text: text || '（画像を確認してください）' }
  ]
  for (const image of images.slice(0, CHAT_IMAGE_MAX_COUNT)) {
    parts.push({
      inline_data: {
        mime_type: image.mime,
        data: image.data_base64
      }
    })
  }
  return parts
}

export function attachImagesToMessages(
  messages: Array<{ role: string; content: unknown }>,
  images: ChatImagePayload[],
  engine: 'openai' | 'claude' | 'gemini' | string
): Array<{ role: string; content: unknown }> {
  if (!images.length) return messages
  const next = messages.map((row) => ({ ...row }))
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i]?.role !== 'user') continue
    const text = typeof next[i].content === 'string' ? String(next[i].content) : ''
    if (engine === 'claude') {
      next[i] = { ...next[i], content: claudeUserContent(text, images) }
    } else if (engine === 'gemini') {
      // Gemini clients expect string historically; callers that use geminiUserParts should prefer that.
      next[i] = { ...next[i], content: openAiUserContent(text, images) }
    } else {
      next[i] = { ...next[i], content: openAiUserContent(text, images) }
    }
    break
  }
  return next
}

export function parseContextImages(context: unknown): ChatImagePayload[] {
  if (!context || typeof context !== 'object') return []
  const images = (context as { images?: unknown }).images
  if (!Array.isArray(images)) return []
  const out: ChatImagePayload[] = []
  for (const row of images) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    const mime = normalizeImageMime(typeof item.mime === 'string' ? item.mime : '')
    const data = typeof item.data_base64 === 'string' ? item.data_base64.trim() : ''
    if (!mime || !data) continue
    out.push({
      name: typeof item.name === 'string' && item.name ? item.name : `image.${mime.split('/')[1]}`,
      mime,
      data_base64: data
    })
    if (out.length >= CHAT_IMAGE_MAX_COUNT) break
  }
  return out
}

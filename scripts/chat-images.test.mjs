import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mod = await import(pathToFileURL(join(root, 'src/lib/chatImages.ts')).href)
const {
  CHAT_IMAGE_MAX_COUNT,
  isImageFileName,
  normalizeImageMime,
  openAiUserContent,
  claudeUserContent,
  geminiUserParts,
  parseContextImages,
  toImagePayloads
} = mod

test('normalizeImageMime and isImageFileName', () => {
  assert.equal(normalizeImageMime('image/jpg'), 'image/jpeg')
  assert.equal(normalizeImageMime('image/png'), 'image/png')
  assert.equal(normalizeImageMime('text/plain'), null)
  assert.equal(isImageFileName('shot.PNG'), true)
  assert.equal(isImageFileName('App.tsx'), false)
})

test('provider content builders include multimodal parts', () => {
  const images = [
    { name: 'a.png', mime: 'image/png', data_base64: 'AAAA' },
    { name: 'b.jpg', mime: 'image/jpeg', data_base64: 'BBBB' }
  ]
  const openai = openAiUserContent('見て', images)
  assert.ok(Array.isArray(openai))
  assert.equal(openai[0].type, 'text')
  assert.equal(openai[1].type, 'image_url')
  assert.match(openai[1].image_url.url, /^data:image\/png;base64,AAAA/)

  const claude = claudeUserContent('見て', images)
  assert.ok(Array.isArray(claude))
  assert.equal(claude[0].type, 'image')
  assert.equal(claude[0].source.media_type, 'image/png')
  assert.equal(claude.at(-1).type, 'text')

  const gemini = geminiUserParts('見て', images)
  assert.equal(gemini[0].text, '見て')
  assert.equal(gemini[1].inline_data.mime_type, 'image/png')
  assert.equal(gemini[1].inline_data.data, 'AAAA')
})

test('parseContextImages and toImagePayloads respect max count', () => {
  const payloads = parseContextImages({
    images: [
      { name: 'a.png', mime: 'image/png', data_base64: 'A' },
      { name: 'bad', mime: 'text/plain', data_base64: 'x' },
      ...Array.from({ length: 8 }, (_, i) => ({
        name: `n${i}.png`,
        mime: 'image/png',
        data_base64: `D${i}`
      }))
    ]
  })
  assert.equal(payloads.length, CHAT_IMAGE_MAX_COUNT)
  assert.equal(payloads[0].name, 'a.png')

  const mapped = toImagePayloads(
    Array.from({ length: 6 }, (_, i) => ({
      id: String(i),
      name: `i${i}.png`,
      mime: 'image/png',
      dataBase64: `X${i}`,
      previewUrl: `blob:${i}`,
      bytes: 10
    }))
  )
  assert.equal(mapped.length, CHAT_IMAGE_MAX_COUNT)
  assert.equal(mapped[0].data_base64, 'X0')
})

test('ChatPanel wires vision attach UI and context.images', () => {
  const src = readFileSync(join(root, 'src/components/ChatPanel.tsx'), 'utf8')
  assert.match(src, /from '\.\.\/lib\/chatImages'/)
  assert.match(src, /imageBlobsFromDataTransfer/)
  assert.match(src, /attachedImages/)
  assert.match(src, /images: imagePayloads/)
  assert.match(src, /chat-attach-image-chip/)
  assert.match(src, /readFileBase64/)
})

test('Cursor Agent path accepts SDK images', () => {
  const cursor = readFileSync(join(root, 'electron/main/cursorAgent.ts'), 'utf8')
  assert.match(cursor, /images\?: CursorAgentImage/)
  assert.match(cursor, /agent\.send\(/)
  assert.match(cursor, /mimeType/)

  const vision = readFileSync(join(root, 'electron/main/lib/visionMessages.ts'), 'utf8')
  assert.match(vision, /toCursorSdkImages/)

  const api = readFileSync(join(root, 'electron/main/api.ts'), 'utf8')
  assert.match(api, /toCursorSdkImages/)
  assert.match(api, /images: cursorImages/)

  const direct = readFileSync(join(root, 'electron/main/directLlm.ts'), 'utf8')
  assert.match(direct, /toCursorSdkImages\(parseContextImages/)
})

test('main/PHP vision paths exist', () => {
  const visionTs = readFileSync(join(root, 'electron/main/lib/visionMessages.ts'), 'utf8')
  assert.match(visionTs, /attachImagesToOpenAiMessages/)
  assert.match(visionTs, /attachImagesToClaudeMessages/)

  const direct = readFileSync(join(root, 'electron/main/directLlm.ts'), 'utf8')
  assert.match(direct, /applyVisionToMessages/)

  const router = readFileSync(join(root, 'electron/main/localAiRouter.ts'), 'utf8')
  assert.match(router, /parseContextImages/)

  const php = readFileSync(join(root, 'server/src/VisionContent.php'), 'utf8')
  assert.match(php, /attachForOpenAi/)
  assert.match(php, /attachForClaude/)
  assert.match(php, /geminiParts/)

  const chat = readFileSync(join(root, 'server/src/ChatService.php'), 'utf8')
  assert.match(chat, /VisionContent::parseImages/)
  assert.match(chat, /VisionContent::attachFor/)
})

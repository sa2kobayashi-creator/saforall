import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

test('routerCategories detect + prefer engines', async () => {
  const {
    detectRouterCategory,
    getRouterCategory,
    parseEnabledCategories,
    parseRouterCategory
  } = await import('../src/lib/routerCategories.ts')

  assert.equal(parseRouterCategory('dev_design'), 'dev_design')
  assert.equal(parseRouterCategory('nope'), 'auto')
  assert.equal(detectRouterCategory('アーキテクチャの方針を決めて'), 'dev_design')
  assert.equal(detectRouterCategory('このバグを直して実装して'), 'dev_implement')
  assert.equal(detectRouterCategory('テストを通るようにして'), 'dev_test')
  assert.equal(detectRouterCategory('README を書いて'), 'dev_docs')
  assert.equal(detectRouterCategory('英語に翻訳して'), 'summarize')
  assert.equal(detectRouterCategory('企画書の文章を書いて'), 'writing')
  assert.equal(detectRouterCategory('仕組みを説明して'), 'explain_learn')
  assert.equal(detectRouterCategory('アイデアを出して'), 'brainstorm')
  assert.equal(detectRouterCategory('見て', { hasImages: true }), 'vision')
  assert.equal(detectRouterCategory('青い猫の画像を生成して'), 'image_gen')
  assert.equal(detectRouterCategory('CSVを整形して'), 'data_format')

  const design = getRouterCategory('dev_design')
  assert.equal(design.preferredAsk, 'claude')
  assert.equal(getRouterCategory('dev_implement').preferredAsk, 'openai')
  assert.equal(getRouterCategory('summarize').preferredAsk, 'gemini')
  assert.equal(getRouterCategory('image_gen').taskType, 'image_gen')

  const enabled = parseEnabledCategories(['auto', 'dev_design', 'dev_design', 'nope'])
  assert.deepEqual(enabled, ['auto', 'dev_design'])
})

test('electron routerCategories resolve preference', async () => {
  const { detectRouterCategoryId, resolveCategoryPreference } = await import(
    '../electron/main/lib/routerCategories.ts'
  )

  assert.equal(detectRouterCategoryId('設計レビューして'), 'dev_design')
  assert.deepEqual(resolveCategoryPreference('dev_design', 'ask'), {
    engine: 'claude',
    taskType: 'design',
    systemHint: '用途: 設計・要件定義。トレードオフと方針を明確に述べてください。'
  })
  assert.deepEqual(resolveCategoryPreference('dev_docs', 'agent'), {
    engine: 'openai',
    taskType: 'summarize',
    systemHint: '用途: ドキュメント作成。読者がすぐ使える構成にしてください。'
  })
  assert.deepEqual(resolveCategoryPreference('auto', 'ask'), {
    engine: null,
    taskType: null,
    systemHint: null
  })
  assert.equal(detectRouterCategoryId('青い猫のイラストを生成して'), 'image_gen')
  assert.equal(resolveCategoryPreference('image_gen', 'ask').taskType, 'image_gen')
  assert.equal(resolveCategoryPreference('research', 'ask').engine, 'claude')
})

test('image generate helper + stream wiring', async () => {
  const root = join(import.meta.dirname, '..')
  const img = await readFile(join(root, 'electron/main/lib/imageGenerate.ts'), 'utf8')
  const api = await readFile(join(root, 'electron/main/api.ts'), 'utf8')
  const phpStream = await readFile(join(root, 'server/api/ai_chat_stream.php'), 'utf8')
  const msg = await readFile(join(root, 'src/components/MessageContent.tsx'), 'utf8')
  assert.match(img, /images\/generations/)
  assert.match(api, /task_type === 'image_gen'/)
  assert.match(phpStream, /ImageGenerateClient/)
  assert.match(msg, /message-inline-image/)
})

test('UI + router wire category and guide modal', async () => {
  const root = join(import.meta.dirname, '..')
  const settings = await readFile(join(root, 'src/components/SettingsPanel.tsx'), 'utf8')
  const chat = await readFile(join(root, 'src/components/ChatPanel.tsx'), 'utf8')
  const php = await readFile(join(root, 'server/src/AiRouter.php'), 'utf8')
  const local = await readFile(join(root, 'electron/main/localAiRouter.ts'), 'utf8')
  const svc = await readFile(join(root, 'server/src/ChatService.php'), 'utf8')

  assert.match(settings, /RouterGuideModal/)
  assert.match(settings, /説明・設定例/)
  assert.match(settings, /router\.enabled_categories/)
  assert.match(chat, /router_category/)
  assert.match(chat, /category-select/)
  assert.match(php, /resolveCategory/)
  assert.match(php, /categoryPreference/)
  assert.match(php, /image_gen/)
  assert.match(local, /resolveCategoryPreference/)
  assert.match(local, /body\.router_category/)
  assert.match(svc, /router_category/)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const messages = [{ role: 'user', content: 'hi' }]

/** Mirror of agentMessages.modelOmitsTemperature — keep in sync via source asserts below. */
function modelOmitsTemperature(model) {
  const id = model.trim().toLowerCase()
  return (
    id.startsWith('o1') ||
    id.startsWith('o3') ||
    id.startsWith('o4') ||
    id.startsWith('gpt-5') ||
    id.includes('reason')
  )
}

/** Mirror of openai.buildOpenAiAskBody */
function buildOpenAiAskBody(model, msgs, temperature) {
  const body = { model, messages: msgs }
  if (!modelOmitsTemperature(model)) {
    body.temperature = temperature ?? 0.2
  }
  return body
}

test('Ask body: normal models keep temperature 0.2', () => {
  const body = buildOpenAiAskBody('gpt-4.1', messages)
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'temperature'), true)
  assert.equal(body.temperature, 0.2)
  assert.equal(JSON.parse(JSON.stringify(body)).temperature, 0.2)
})

test('Ask body: reasoning models omit temperature property', () => {
  for (const model of ['gpt-5', 'o3-mini', 'o4-mini']) {
    const body = buildOpenAiAskBody(model, messages)
    assert.equal(Object.prototype.hasOwnProperty.call(body, 'temperature'), false, model)
    assert.equal('temperature' in body, false, model)
    assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(body)), 'temperature'), false, model)
  }
})

test('agentMessages modelOmitsTemperature predicate is the shared source of truth', async () => {
  const src = await readFile(join(root, 'electron/main/ai/agentMessages.ts'), 'utf8')
  assert.match(src, /export function modelOmitsTemperature\(model: string\): boolean/)
  assert.match(src, /id\.startsWith\('o1'\)/)
  assert.match(src, /id\.startsWith\('o3'\)/)
  assert.match(src, /id\.startsWith\('o4'\)/)
  assert.match(src, /id\.startsWith\('gpt-5'\)/)
  assert.match(src, /id\.includes\('reason'\)/)
})

test('Ask openai adapter reuses Agent modelOmitsTemperature (no local copy)', async () => {
  const src = await readFile(join(root, 'electron/main/ai/adapters/openai.ts'), 'utf8')
  assert.match(src, /import\s*\{[^}]*modelOmitsTemperature[^}]*\}\s*from\s*'\.\.\/agentMessages'/)
  assert.match(src, /function\s+buildOpenAiAskBody/)
  assert.match(src, /if\s*\(\s*!modelOmitsTemperature\(model\)\s*\)/)
  assert.match(src, /body\.temperature\s*=\s*temperature\s*\?\?\s*0\.2/)
  assert.match(src, /JSON\.stringify\(buildOpenAiAskBody\(/)
  assert.doesNotMatch(src, /export function modelOmitsTemperature|function modelOmitsTemperature\(/)
  assert.doesNotMatch(
    src,
    /JSON\.stringify\(\s*\{\s*model,\s*messages:\s*request\.messages,\s*temperature:/
  )
})

test('Agent openaiTools temperature handling unchanged', async () => {
  const src = await readFile(join(root, 'electron/main/ai/adapters/openaiTools.ts'), 'utf8')
  assert.match(src, /modelOmitsTemperature/)
  assert.match(src, /includeTemperature/)
  assert.match(src, /body\.temperature = 0\.2/)
})

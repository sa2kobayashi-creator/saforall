import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

async function read(rel) {
  return readFile(join(root, rel), 'utf8')
}

test('A: executeAi uses Resolver without credentialOverride', async () => {
  const router = await read('electron/main/ai/router.ts')
  const types = await read('electron/main/ai/types.ts')
  assert.match(router, /configureFailoverResolve/)
  assert.match(router, /resolveCredential\(/)
  assert.match(router, /executeWithFailover/)
  assert.doesNotMatch(router, /credentialOverride/)
  assert.doesNotMatch(types, /credentialOverride/)
})

test('B/C/D: Resolver priority BYOK → settings → env', async () => {
  const { pickCredentialPriority } = await import('../electron/main/ai/credentialLogic.ts')
  assert.deepEqual(pickCredentialPriority('sk-byok-aaaa', 'sk-settings', 'sk-env'), {
    secret: 'sk-byok-aaaa',
    source: 'byok'
  })
  assert.deepEqual(pickCredentialPriority('', 'sk-settings', 'sk-env'), {
    secret: 'sk-settings',
    source: 'settings'
  })
  assert.deepEqual(pickCredentialPriority('', '', 'sk-env'), {
    secret: 'sk-env',
    source: 'env'
  })
  const creds = await read('electron/main/ai/credentials.ts')
  assert.match(creds, /function loadByokCredential/)
  assert.match(creds, /providerId !== 'cursor'/)
  assert.match(creds, /loadDevelopmentCredential/)
})

test('E: BYOK usage records billingMode from Resolver credential', async () => {
  const router = await read('electron/main/ai/router.ts')
  // Phase 2-C-5 review: onAttempt receives billingMode/credentialId only (no Credential object).
  assert.match(router, /billingMode:\s*billingMode/)
  assert.match(router, /credentialId:\s*credentialId/)
  assert.doesNotMatch(router, /billingMode: 'DEVELOPMENT' as const/)
  assert.doesNotMatch(router, /onAttempt:[\s\S]*?\bcredential\s*:/)
  const usage = await read('electron/main/ai/usage.ts')
  assert.doesNotMatch(usage, /secret/)
  assert.doesNotMatch(usage, /Authorization/)
})

test('F: callers cannot pass credentialOverride', async () => {
  const direct = await read('electron/main/directLlm.ts')
  const api = await read('electron/main/api.ts')
  const types = await read('electron/main/ai/types.ts')
  assert.doesNotMatch(direct, /credentialOverride/)
  assert.doesNotMatch(api, /credentialOverride/)
  assert.doesNotMatch(types, /credentialOverride/)
})

test('G: generateAssistantText does not take apiKey', async () => {
  const direct = await read('electron/main/directLlm.ts')
  const fn = direct.slice(direct.indexOf('export async function generateAssistantText'))
  assert.match(fn, /executeAi\(/)
  assert.doesNotMatch(fn.slice(0, 800), /apiKey/)
  assert.doesNotMatch(direct, /callOpenAiCompatible/)
  assert.doesNotMatch(direct, /async function callClaude/)
  assert.doesNotMatch(direct, /async function callGemini/)
})

test('H: localAiRouter result has no provider.api_key', async () => {
  const local = await read('electron/main/localAiRouter.ts')
  assert.doesNotMatch(local, /api_key/)
  assert.doesNotMatch(local, /cursor_api_key:/)
  assert.doesNotMatch(local, /cred\?\.secret/)
  assert.match(local, /resolveCredential/)
})

test('I: Renderer/IPC still does not return BYOK secret', async () => {
  const preload = await read('electron/preload/index.ts')
  const ipc = await read('electron/main/ai/byokIpc.ts')
  assert.doesNotMatch(preload, /getByokSecret|decryptByok/)
  assert.match(ipc, /assertNoSecretInPayload/)
})

test('J: Agent tool loop still goes through executeAiWithTools', async () => {
  const toolAgent = await read('electron/main/toolAgent.ts')
  const router = await read('electron/main/ai/router.ts')
  assert.match(toolAgent, /executeAiWithTools/)
  assert.match(router, /export async function executeAiWithTools/)
  assert.match(router, /executeWithFailover/)
  assert.match(router, /fallbacksForAgent/)
})

test('K: Cursor path is unchanged as coding agent', async () => {
  const cursor = await read('electron/main/cursorAgent.ts')
  const direct = await read('electron/main/directLlm.ts')
  const creds = await read('electron/main/ai/credentials.ts')
  assert.match(cursor, /@cursor\/sdk/)
  assert.doesNotMatch(cursor, /executeAiWithTools/)
  assert.match(direct, /runCursorAgent/)
  assert.match(creds, /providerId !== 'cursor'/)
})

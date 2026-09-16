import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

async function read(rel) {
  return readFile(join(root, rel), 'utf8')
}

function errorHandler(src) {
  const start = src.indexOf("if (event.type === 'error')")
  assert.ok(start >= 0)
  const cancelled = src.indexOf("if (event.type === 'cancelled')")
  assert.ok(cancelled >= 0 && cancelled < start)
  const end = src.indexOf('streamRequestIdRef.current = requestId', start)
  assert.ok(end > start)
  return src.slice(start, end)
}

function appendStreamError(messages, streamAssistantId, errorLine) {
  const existing = messages.find((message) => message.id === streamAssistantId)
  if (existing) {
    if (existing.content.includes(errorLine)) return messages
    const suffix = existing.content.trim() ? `\n\n${errorLine}` : errorLine
    return messages.map((message) =>
      message.id === streamAssistantId
        ? { ...message, content: `${message.content.trimEnd()}${suffix}` }
        : message
    )
  }
  return [
    ...messages,
    {
      id: streamAssistantId,
      role: 'assistant',
      content: errorLine
    }
  ]
}

test('error keeps streamAssistantId and appends error text', async () => {
  const chat = await read('src/components/ChatPanel.tsx')
  const handler = errorHandler(chat)
  assert.doesNotMatch(handler, /filter\(/)
  assert.doesNotMatch(handler, /withoutStream/)
  assert.doesNotMatch(handler, /crypto\.randomUUID\(\)/)
  assert.match(handler, /streamAssistantId/)
  assert.match(handler, /エラー:/)
  assert.match(handler, /setError\(/)
  assert.match(handler, /message\.id === streamAssistantId/)
  assert.doesNotMatch(handler, /setBusy/)

  const streamId = 'stream-run-a'
  const before = [
    { id: 'user-1', role: 'user', content: '直して' },
    {
      id: streamId,
      role: 'assistant',
      content:
        '📍 **計画** — 計画を開始\n\n🔧 ツール実行: read_file ✓ ok\n\n⏱️ Checkpoint · step 7/56 · phase=edit'
    }
  ]
  const after = appendStreamError(before, streamId, 'エラー: LLM HTTP 500')
  assert.equal(after.length, 2)
  assert.equal(after[1].id, streamId)
  assert.match(after[1].content, /計画を開始/)
  assert.match(after[1].content, /read_file/)
  assert.match(after[1].content, /Checkpoint/)
  assert.match(after[1].content, /エラー: LLM HTTP 500/)
  assert.equal(after.filter((row) => row.role === 'assistant').length, 1)
})

test('error without prior stream still uses streamAssistantId', async () => {
  const after = appendStreamError([], 'stream-run-a', 'エラー: AGENT_UNSUPPORTED')
  assert.equal(after.length, 1)
  assert.equal(after[0].id, 'stream-run-a')
  assert.equal(after[0].content, 'エラー: AGENT_UNSUPPORTED')
})

test('next run stream id does not update previous error message', async () => {
  const chat = await read('src/components/ChatPanel.tsx')
  assert.match(chat, /const streamAssistantId = `stream-\$\{crypto\.randomUUID\(\)\}`/)
  const runA = appendStreamError(
    [{ id: 'stream-a', role: 'assistant', content: '🔧 read_file' }],
    'stream-a',
    'エラー: fail-a'
  )
  const runBStart = [
    ...runA,
    { id: 'stream-b', role: 'assistant', content: '📍 計画を開始' }
  ]
  const runBError = appendStreamError(runBStart, 'stream-b', 'エラー: fail-b')
  assert.equal(runBError[0].id, 'stream-a')
  assert.match(runBError[0].content, /fail-a/)
  assert.doesNotMatch(runBError[0].content, /fail-b/)
  assert.equal(runBError[1].id, 'stream-b')
  assert.match(runBError[1].content, /計画を開始/)
  assert.match(runBError[1].content, /fail-b/)
})

test('cancelled and done handlers are unchanged', async () => {
  const chat = await read('src/components/ChatPanel.tsx')
  const cancelled = chat.slice(
    chat.indexOf("if (event.type === 'cancelled')"),
    chat.indexOf("if (event.type === 'error')")
  )
  assert.match(cancelled, /lastSubmittedTextRef/)
  assert.match(cancelled, /応答を取り消しました/)
  assert.match(cancelled, /message\.id === streamAssistantId/)
  assert.doesNotMatch(cancelled, /filter\(/)

  assert.match(chat, /message\.id === streamAssistantId \? normalized : message/)
  const done = chat.slice(
    chat.indexOf("if (event.type === 'done')"),
    chat.indexOf("if (event.type === 'cancelled')")
  )
  assert.match(done, /assistant_message/)
  assert.match(done, /normalized/)
})

test('error busy is still cleared in finally', async () => {
  const chat = await read('src/components/ChatPanel.tsx')
  const handler = errorHandler(chat)
  assert.doesNotMatch(handler, /setBusy/)
  assert.match(chat, /if \(submitGenerationRef\.current === submitGeneration\) \{\s*setBusy\(null\)/)
})

test('catch does not add a second error bubble after stream append', async () => {
  const chat = await read('src/components/ChatPanel.tsx')
  const includesIdx = chat.indexOf("last.content.includes('\\n\\nエラー:')")
  assert.ok(includesIdx >= 0, 'catch should skip when stream already has appended エラー:')
  const block = chat.slice(includesIdx - 160, includesIdx + 80)
  assert.match(block, /last\.content\.startsWith\('エラー:'\)/)
  assert.match(block, /return prev/)
})

test('Trace / Usage / Failover semantics are untouched', async () => {
  const trace = await read('electron/main/ai/agentRunTrace.ts')
  assert.match(trace, /export type AgentRunStatus = 'running' \| 'done' \| 'error' \| 'cancelled'/)
  assert.doesNotMatch(trace, /outcomeDetail/)

  const usage = await read('electron/main/ai/usage.ts')
  assert.match(usage, /export type UsageEventStatus = 'ok' \| 'error'/)

  const retention = await read('electron/main/ai/usageRetention.ts')
  assert.match(retention, /export const RAW_RETENTION_DAYS\s*=\s*7\b/)
  assert.match(retention, /export const RAW_MAX_EVENTS\s*=\s*10000\b/)

  const failover = await read('electron/main/ai/failover.ts')
  assert.match(failover, /executeWithFailover/)
})

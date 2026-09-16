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

async function loadTrace() {
  return import('../electron/main/ai/agentRunTrace.ts')
}

test('Agent Run Trace: sanitizer is metadata-only', async () => {
  const { toAgentRunTraceEvent } = await loadTrace()
  const toolCall = toAgentRunTraceEvent({
    type: 'tool_call',
    id: 'call_1',
    name: 'run_shell',
    args: { command: 'cat ~/.ssh/id_rsa && echo sk-secret-key' }
  })
  assert.equal(toolCall.kind, 'tool_call')
  assert.equal(toolCall.toolName, 'run_shell')
  const dumped = JSON.stringify(toolCall)
  assert.doesNotMatch(dumped, /cat ~/)
  assert.doesNotMatch(dumped, /sk-secret/)
  assert.doesNotMatch(dumped, /id_rsa/)
  assert.equal('args' in toolCall, false)

  const toolResult = toAgentRunTraceEvent({
    type: 'tool_result',
    id: 'call_1',
    name: 'read_file',
    ok: true,
    summary: 'API_KEY=secret-value\n' + 'x'.repeat(5000)
  })
  assert.equal(toolResult.kind, 'tool_result')
  assert.equal(toolResult.toolOk, true)
  assert.equal(toolResult.toolName, 'read_file')
  assert.doesNotMatch(JSON.stringify(toolResult), /API_KEY/)
  assert.doesNotMatch(JSON.stringify(toolResult), /secret-value/)

  const phase = toAgentRunTraceEvent({
    type: 'agent_phase',
    phase: 'edit',
    note: 'full prompt text should not be stored'
  })
  assert.equal(phase.kind, 'phase')
  assert.equal(phase.phase, 'edit')
  assert.doesNotMatch(JSON.stringify(phase), /full prompt/)

  const checkpoint = toAgentRunTraceEvent({
    type: 'agent_checkpoint',
    step: 7,
    phase: 'verify',
    summary: 'huge checkpoint summary with secrets'
  })
  assert.equal(checkpoint.kind, 'checkpoint')
  assert.equal(checkpoint.checkpointStep, 7)
  assert.doesNotMatch(JSON.stringify(checkpoint), /huge checkpoint/)

  const err = toAgentRunTraceEvent({
    type: 'error',
    code: 'TOOL_AGENT_FAILED',
    message: 'Bearer token abcdef and stack '.repeat(200)
  })
  assert.equal(err.kind, 'run_error')
  assert.equal(err.errorCode, 'TOOL_AGENT_FAILED')
  assert.doesNotMatch(JSON.stringify(err), /Bearer token/)

  assert.equal(toAgentRunTraceEvent({ type: 'delta', text: 'LLM response full text' }), null)
  assert.equal(
    toAgentRunTraceEvent({ type: 'edit_proposal', path: 'a.ts', content: 'secret patch' }),
    null
  )
})

test('Agent Run Trace: one run groups tools / attempts / terminal states', async () => {
  const trace = await loadTrace()
  await trace.resetAgentRunTraceForTests()

  const runId = 'stream-req-111'
  await trace.beginAgentRun({
    runId,
    sessionId: 42,
    engine: 'openai',
    model: 'gpt-4.1-mini',
    provider: 'openai'
  })
  await trace.observeAgentStreamEvent(runId, {
    type: 'agent_phase',
    phase: 'plan'
  })
  await trace.observeAgentStreamEvent(runId, {
    type: 'tool_call',
    id: 'a',
    name: 'read_file',
    args: { path: '/etc/passwd' }
  })
  await trace.observeAgentStreamEvent(runId, {
    type: 'tool_result',
    id: 'a',
    name: 'read_file',
    ok: true,
    summary: 'root:x:0:0'
  })
  await trace.observeAgentStreamEvent(runId, {
    type: 'tool_call',
    id: 'b',
    name: 'edit_file',
    args: { path: 'a.ts', content: 'full file' }
  })
  await trace.observeAgentStreamEvent(runId, {
    type: 'tool_result',
    id: 'b',
    name: 'edit_file',
    ok: true,
    summary: 'queued'
  })
  await trace.observeAgentStreamEvent(runId, {
    type: 'tool_call',
    id: 'c',
    name: 'run_shell',
    args: { command: 'npm test' }
  })
  await trace.observeAgentStreamEvent(runId, {
    type: 'tool_result',
    id: 'c',
    name: 'run_shell',
    ok: false,
    summary: 'exit 1 with secrets'
  })
  await trace.observeAgentStreamEvent(runId, {
    type: 'agent_checkpoint',
    step: 6,
    phase: 'verify',
    summary: 'do not persist this'
  })

  await trace.runInAgentRunContext(runId, async () => {
    await trace.noteAgentRunProviderAttempt({
      usageRequestId: 'usage-attempt-A',
      provider: 'openai',
      model: 'gpt-4.1-mini',
      status: 'error',
      failoverId: 'fail-1'
    })
    await trace.noteAgentRunProviderAttempt({
      usageRequestId: 'usage-attempt-B',
      provider: 'claude',
      model: 'claude-sonnet-5',
      status: 'ok',
      failoverId: 'fail-1'
    })
  })

  await trace.observeAgentStreamEvent(runId, {
    type: 'done',
    model: 'gpt-4.1-mini',
    assistant_message: { content: 'final answer full text' }
  })

  const runs = await trace.listAgentRuns()
  assert.equal(runs.length, 1)
  const run = runs[0]
  assert.equal(run.runId, runId)
  assert.equal(run.mode, 'agent')
  assert.equal(run.status, 'done')
  assert.ok(run.endedAt)
  assert.equal(run.usageRequestIds.join(','), 'usage-attempt-A,usage-attempt-B')
  assert.deepEqual(run.failoverIds, ['fail-1'])
  assert.equal(run.events.filter((e) => e.kind === 'tool_call').length, 3)
  assert.equal(run.events.filter((e) => e.kind === 'provider_attempt').length, 2)
  assert.equal(run.events.filter((e) => e.kind === 'checkpoint').length, 1)
  const dumped = JSON.stringify(run)
  assert.doesNotMatch(dumped, /passwd/)
  assert.doesNotMatch(dumped, /npm test/)
  assert.doesNotMatch(dumped, /final answer/)
  assert.doesNotMatch(dumped, /root:x:0:0/)
  assert.match(dumped, /openai|read_file|fail-1/)

  const fileShape = {
    version: 1,
    retentionPolicy: 'unspecified',
    runs: [run]
  }
  const persisted = JSON.stringify(fileShape)
  assert.match(persisted, /"retentionPolicy":"unspecified"/)
  assert.doesNotMatch(persisted, /RAW_RETENTION/)
  assert.doesNotMatch(persisted, /passwd/)
})

test('Agent Run Trace: error and cancelled keep endedAt', async () => {
  const trace = await loadTrace()
  await trace.resetAgentRunTraceForTests()

  await trace.beginAgentRun({
    runId: 'err-run',
    engine: 'claude',
    model: 'claude-sonnet-5',
    provider: 'claude'
  })
  await trace.observeAgentStreamEvent('err-run', {
    type: 'error',
    code: 'TOOL_AGENT_FAILED',
    message: 'huge body'
  })
  const errRun = (await trace.listAgentRuns()).find((r) => r.runId === 'err-run')
  assert.equal(errRun.status, 'error')
  assert.ok(errRun.endedAt)

  await trace.beginAgentRun({
    runId: 'cancel-run',
    engine: 'openai',
    model: 'gpt-4.1-mini',
    provider: 'openai'
  })
  await trace.observeAgentStreamEvent('cancel-run', { type: 'cancelled', message: 'stop' })
  const cancelRun = (await trace.listAgentRuns()).find((r) => r.runId === 'cancel-run')
  assert.equal(cancelRun.status, 'cancelled')
  assert.ok(cancelRun.endedAt)

  await trace.beginAgentRun({
    runId: 'incomplete-run',
    engine: 'openai',
    model: 'gpt-4.1-mini',
    provider: 'openai'
  })
  await trace.finalizeAgentRunIfOpen('incomplete-run', 'error')
  const incomplete = (await trace.listAgentRuns()).find((r) => r.runId === 'incomplete-run')
  assert.equal(incomplete.status, 'error')
  assert.ok(incomplete.endedAt)
})

test('Agent Run Trace: provider_attempt is a no-op outside ALS (Ask / Cursor)', async () => {
  const trace = await loadTrace()
  await trace.resetAgentRunTraceForTests()
  await trace.noteAgentRunProviderAttempt({
    usageRequestId: 'should-not-attach',
    provider: 'openai',
    model: 'gpt-4.1-mini',
    status: 'ok'
  })
  assert.equal((await trace.listAgentRuns()).length, 0)
})

test('Agent Run Trace: wiring stays inside mode=agent toolAgent', async () => {
  const api = await read('electron/main/api.ts')
  assert.match(api, /streamRequestId/)
  assert.match(api, /startAgentTrace/)
  assert.equal((api.match(/startAgentTrace\(/g) || []).length, 2)
  assert.match(api, /canToolAgent && decided\.provider/)
  assert.match(api, /engine === 'cursor'/)
  const cursorIdx = api.indexOf("if (decided.engine === 'cursor')")
  const firstTraceCallIdx = api.indexOf('await trace?.startAgentTrace')
  assert.ok(cursorIdx >= 0 && firstTraceCallIdx > cursorIdx)

  const index = await read('electron/main/index.ts')
  assert.match(index, /streamChat\(\s*body,[\s\S]*signal,\s*requestId/)

  const chat = await read('src/components/ChatPanel.tsx')
  assert.match(chat, /streamAssistantId/)
  assert.match(chat, /message\.id === streamAssistantId \? normalized : message/)

  const traceSrc = await read('electron/main/ai/agentRunTrace.ts')
  assert.doesNotMatch(traceSrc, /RAW_RETENTION_DAYS/)
  assert.doesNotMatch(traceSrc, /RAW_MAX_EVENTS/)
  assert.match(traceSrc, /agent-runs\.json/)
  assert.match(traceSrc, /retentionPolicy: 'unspecified'/)
  assert.doesNotMatch(traceSrc, /prompt全文|args\.command/)

  const usage = await read('electron/main/ai/usage.ts')
  assert.match(usage, /export type UsageEvent = \{/)
  assert.match(usage, /requestId: string/)
  assert.match(usage, /usage-events\.json/)
  assert.doesNotMatch(usage, /agent-runs\.json/)

  const router = await read('electron/main/ai/router.ts')
  assert.match(router, /await recordUsage\(/)
  assert.match(router, /noteAgentRunProviderAttempt/)
  assert.match(router, /usageEvent\.requestId/)

  const local = await read('electron/main/localApi.ts')
  assert.match(local, /\/ai\/agent-runs/)
  assert.match(local, /listAgentRuns/)

  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /Agent Run Trace/)
  assert.match(panel, /\/ai\/agent-runs/)
})

test('Agent Run Trace: refresh after terminal stream events when panel is open', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /loadAgentRuns/)
  assert.match(panel, /onChatStreamEvent/)
  const subStart = panel.indexOf('window.saforall.onChatStreamEvent')
  assert.ok(subStart >= 0)
  const sub = panel.slice(subStart, subStart + 900)
  assert.match(sub, /'done'/)
  assert.match(sub, /'error'/)
  assert.match(sub, /'cancelled'/)
  assert.match(sub, /refreshed\.has/)
  assert.match(sub, /void loadAgentRuns\(\)/)
  assert.doesNotMatch(panel, /setInterval/)
  const closedGuard = panel.indexOf('if (!open) return')
  const subscribeOpen = panel.indexOf('if (!open) return', closedGuard + 1)
  assert.ok(closedGuard >= 0 && subscribeOpen > closedGuard)

  const preload = await read('electron/preload/index.ts')
  assert.match(preload, /onChatStreamEvent:/)
  assert.match(preload, /api:chatStream:event/)

  const api = await read('electron/main/api.ts')
  const emitStart = api.indexOf('const emit = (event: ChatStreamEvent)')
  assert.ok(emitStart >= 0)
  const emit = api.slice(emitStart, emitStart + 1600)
  const persistIdx = emit.indexOf('await observeAgentStreamEvent')
  const terminalOnEvent = emit.indexOf('onEvent(event)', persistIdx)
  assert.ok(persistIdx >= 0)
  assert.ok(terminalOnEvent > persistIdx)

  const chat = await read('src/components/ChatPanel.tsx')
  assert.match(chat, /message\.id === streamAssistantId \? normalized : message/)
  assert.doesNotMatch(chat, /onChatStreamEvent/)

  const traceSrc = await read('electron/main/ai/agentRunTrace.ts')
  assert.doesNotMatch(traceSrc, /outcomeDetail/)
})

test('Agent Run Trace: Usage / Failover / Checkpoint files not redesigned', async () => {
  const usage = await read('electron/main/ai/usage.ts')
  assert.match(usage, /export type UsageEventStatus = 'ok' \| 'error'/)
  assert.match(usage, /sessionId\?: number \| null/)
  assert.match(usage, /failover\?: UsageFailoverMeta \| null/)

  const retention = await read('electron/main/ai/usageRetention.ts')
  assert.match(retention, /export const RAW_RETENTION_DAYS\s*=\s*7\b/)
  assert.match(retention, /export const RAW_MAX_EVENTS\s*=\s*10000\b/)

  const failover = await read('electron/main/ai/failover.ts')
  assert.match(failover, /executeWithFailover/)

  const toolAgent = await read('electron/main/toolAgent.ts')
  assert.match(toolAgent, /agent-state\.json/)
  assert.match(toolAgent, /type: 'agent_checkpoint'/)
  assert.doesNotMatch(toolAgent, /beginAgentRun/)
})

test('Agent Run Trace: done UI is stream-end, not work success', async () => {
  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /status === 'done'\) return '実行終了'/)
  assert.match(panel, /ストリームが終了しました。作業の成功を保証するものではありません。/)
  assert.match(panel, /run\.status === 'done'/)
  assert.match(panel, /kind === 'tool_result'/)
  assert.match(panel, /toolOk/)
  assert.match(panel, /Tool：成功/)
  assert.match(panel, /hasToolResults/)
  assert.doesNotMatch(panel, /作業成功/)
  assert.doesNotMatch(panel, /完了成功/)
  const statusHelpers = panel.slice(
    panel.indexOf('function summarizeAgentRun'),
    panel.indexOf('export function UsagePanel')
  )
  assert.match(statusHelpers, /実行終了/)
  assert.doesNotMatch(statusHelpers, /'success'/)
  assert.doesNotMatch(statusHelpers, /'failed'/)
  assert.doesNotMatch(statusHelpers, /'partial'/)
  assert.doesNotMatch(statusHelpers, /outcomeDetail/)
  assert.doesNotMatch(statusHelpers, /resultStatus/)
  assert.doesNotMatch(panel, /outcomeDetail/)
  assert.doesNotMatch(panel, /resultStatus/)

  const css = await read('src/components/UsagePanel.css')
  assert.match(css, /usage-agent-run-status--done/)
  assert.match(css, /usage-agent-run-note/)

  const events = [
    { kind: 'phase', phase: 'verify' },
    { kind: 'tool_result', toolOk: true },
    { kind: 'tool_result', toolOk: true },
    { kind: 'tool_result', toolOk: false }
  ]
  let toolOk = 0
  let toolFail = 0
  for (const event of events) {
    if (event.kind === 'tool_result' && typeof event.toolOk === 'boolean') {
      if (event.toolOk) toolOk += 1
      else toolFail += 1
    }
  }
  assert.equal(toolOk, 2)
  assert.equal(toolFail, 1)

  const traceSrc = await read('electron/main/ai/agentRunTrace.ts')
  assert.match(traceSrc, /export type AgentRunStatus = 'running' \| 'done' \| 'error' \| 'cancelled'/)
  assert.match(traceSrc, /event\.kind === 'run_end'/)
  assert.match(traceSrc, /run\.status = 'done'/)
  assert.doesNotMatch(traceSrc, /'success'/)
  assert.doesNotMatch(traceSrc, /'partial'/)
  assert.doesNotMatch(traceSrc, /'incomplete'/)
  assert.doesNotMatch(traceSrc, /outcomeDetail/)
  assert.doesNotMatch(traceSrc, /resultStatus/)

  const usage = await read('electron/main/ai/usage.ts')
  assert.match(usage, /export type UsageEventStatus = 'ok' \| 'error'/)
  assert.doesNotMatch(usage, /AgentRunStatus/)

  const chat = await read('src/components/ChatPanel.tsx')
  assert.match(chat, /message\.id === streamAssistantId \? normalized : message/)
  assert.doesNotMatch(chat, /実行終了/)
  assert.doesNotMatch(chat, /onChatStreamEvent/)
})

function agentRunTraceViewState(loaded, runCount) {
  if (!loaded) return 'loading'
  return runCount > 0 ? 'list' : 'empty'
}

test('UsagePanel: Trace initial fetch is independent of /ai/usage', async () => {
  assert.equal(agentRunTraceViewState(false, 0), 'loading')
  assert.equal(agentRunTraceViewState(false, 7), 'loading')
  assert.equal(agentRunTraceViewState(true, 7), 'list')
  assert.equal(agentRunTraceViewState(true, 0), 'empty')

  const panel = await read('src/components/UsagePanel.tsx')
  assert.match(panel, /export function agentRunTraceViewState/)
  assert.match(panel, /const \[agentRunsLoaded, setAgentRunsLoaded\]/)
  assert.match(panel, /setAgentRunsLoaded\(true\)/)

  const helper = panel.slice(
    panel.indexOf('export function agentRunTraceViewState'),
    panel.indexOf('export function UsagePanel')
  )
  assert.match(helper, /if \(!loaded\) return 'loading'/)
  assert.match(helper, /runCount > 0 \? 'list' : 'empty'/)

  const sectionStart = panel.indexOf('aria-label="Agent Run Trace"')
  assert.ok(sectionStart >= 0)
  const section = panel.slice(sectionStart, sectionStart + 1800)
  assert.match(section, /traceView === 'loading'/)
  assert.match(section, /読み込み中/)
  assert.match(section, /traceView === 'empty'/)
  assert.match(section, /まだ Agent Run はありません。/)
  assert.doesNotMatch(section, /agentRuns\.length === 0 \?/)

  const loadStart = panel.indexOf('const load = useCallback')
  const loadEnd = panel.indexOf('}, [backendConnected, routerMonth])')
  assert.ok(loadStart >= 0 && loadEnd > loadStart)
  const loadFn = panel.slice(loadStart, loadEnd)
  assert.match(loadFn, /\/ai\/usage/)
  assert.doesNotMatch(loadFn, /Promise\.all/)
  assert.doesNotMatch(loadFn, /\/ai\/agent-runs/)
  assert.doesNotMatch(loadFn, /setAgentRuns/)

  const openStart = panel.indexOf('void loadAgentRuns()')
  const openSlice = panel.slice(openStart, openStart + 80)
  assert.match(openSlice, /void loadAgentRuns\(\)/)
  assert.match(openSlice, /void load\(\)/)

  const streamStart = panel.indexOf('window.saforall.onChatStreamEvent')
  const stream = panel.slice(streamStart, streamStart + 900)
  assert.match(stream, /void loadAgentRuns\(\)/)
  assert.match(stream, /'done'/)
  assert.match(stream, /'error'/)
  assert.match(stream, /'cancelled'/)
})

test('Agent Run Trace: registered in run-all-tests', async () => {
  const runAll = await read('scripts/run-all-tests.mjs')
  assert.match(runAll, /agent-run-trace\.test\.mjs/)
})

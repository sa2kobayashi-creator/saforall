import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

test('extractTopPathsFromSearchResult keeps unique paths', async () => {
  const { extractTopPathsFromSearchResult } = await import(
    '../electron/main/lib/feedbackMetrics.ts'
  )
  const paths = extractTopPathsFromSearchResult(
    'src/a.ts:1: foo\nsrc/a.ts:2: bar\nsrc/b.ts:3: baz\n一致なし',
    5
  )
  assert.deepEqual(paths, ['src/a.ts', 'src/b.ts'])
  assert.deepEqual(extractTopPathsFromSearchResult('一致なし'), [])
})

test('pathInTopHits matches basename and relative path', async () => {
  const { pathInTopHits } = await import('../electron/main/lib/feedbackMetrics.ts')
  assert.equal(pathInTopHits('electron/main/toolAgent.ts', ['electron/main/toolAgent.ts']), true)
  assert.equal(pathInTopHits('toolAgent.ts', ['electron/main/toolAgent.ts']), true)
  assert.equal(pathInTopHits('other.ts', ['electron/main/toolAgent.ts']), false)
})

test('summarizeFeedbackEvents aggregates last7d metrics', async () => {
  const { summarizeFeedbackEvents } = await import('../electron/main/lib/feedbackMetrics.ts')
  const now = Date.parse('2026-09-06T12:00:00')
  const summary = summarizeFeedbackEvents(
    [
      {
        id: 1,
        at: '2026-09-05 10:00:00',
        kind: 'search',
        source: 'chat_codebase',
        query: 'AuthService',
        hitCount: 3,
        topPaths: ['src/AuthService.ts'],
        ok: true
      },
      {
        id: 2,
        at: '2026-09-05 10:01:00',
        kind: 'tool',
        source: 'toolAgent',
        tool: 'edit_file',
        path: 'src/AuthService.ts',
        ok: true,
        detail: 'queued',
        topHit: true
      },
      {
        id: 3,
        at: '2026-09-05 10:01:30',
        kind: 'tool',
        source: 'toolAgent',
        tool: 'edit_file',
        path: 'src/AuthService.ts',
        ok: false,
        detail: 'read_required'
      },
      {
        id: 4,
        at: '2026-09-05 10:02:00',
        kind: 'agent_signal',
        source: 'toolAgent',
        detail: 'empty_tool_calls',
        ok: false
      },
      {
        id: 5,
        at: '2026-09-05 10:03:00',
        kind: 'agent_outcome',
        source: 'toolAgent',
        detail: 'verify_pass',
        ok: true,
        topHit: true,
        editedPaths: ['src/AuthService.ts'],
        searchTopPaths: ['src/AuthService.ts']
      }
    ],
    7,
    now
  )
  assert.equal(summary.searches, 1)
  assert.equal(summary.searchWithHits, 1)
  assert.equal(summary.editsQueued, 1)
  assert.equal(summary.editsRejected, 1)
  assert.equal(summary.readRequired, 1)
  assert.equal(summary.emptyToolRetries, 1)
  assert.equal(summary.agentRuns, 1)
  assert.equal(summary.agentTopHit, 1)
  assert.equal(summary.agentTopHitRate, 100)
  assert.ok(summary.verifyPass >= 1)
})

test('toolSearch and UsagePanel wire feedback', async () => {
  const root = join(import.meta.dirname, '..')
  const tools = await readFile(join(root, 'electron/main/workspaceTools.ts'), 'utf8')
  const agent = await readFile(join(root, 'electron/main/toolAgent.ts'), 'utf8')
  const usage = await readFile(join(root, 'src/components/UsagePanel.tsx'), 'utf8')
  const localApi = await readFile(join(root, 'electron/main/localApi.ts'), 'utf8')
  const store = await readFile(join(root, 'electron/main/feedbackStore.ts'), 'utf8')
  assert.match(tools, /recordSearchFeedback/)
  assert.match(agent, /agent_outcome/)
  assert.match(agent, /empty_tool_calls/)
  assert.match(usage, /検索 \/ Agent フィードバック/)
  assert.match(localApi, /getFeedbackSummary/)
  assert.match(localApi, /\/ai\/feedback/)
  assert.match(store, /feedback-events\.json/)
})

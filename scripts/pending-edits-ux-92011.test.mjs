import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * Mirrors App+ChatPanel PendingEdits state after 92011 minimal fix:
 * - Close/dismiss keeps queue
 * - Agent turn start resets queue (no cross-run mix)
 * - streamFailed / cancel resets queue and does not open review
 * - success with editCount>0 opens review
 */

function createPendingState() {
  return {
    applyQueue: [],
    forceDiffDialog: false,
    reviewIndex: 0
  }
}

function reset(state) {
  state.applyQueue = []
  state.reviewIndex = 0
  state.forceDiffDialog = false
}

function enqueue(state, path) {
  state.applyQueue = [
    ...state.applyQueue.filter((p) => p !== path),
    path
  ]
}

function dismiss(state) {
  state.forceDiffDialog = false
}

function skipCurrent(state) {
  if (state.applyQueue.length === 0) return
  const idx = Math.min(Math.max(state.reviewIndex, 0), state.applyQueue.length - 1)
  state.applyQueue = state.applyQueue.filter((_, i) => i !== idx)
  state.reviewIndex = 0
  if (state.applyQueue.length === 0) state.forceDiffDialog = false
}

function applyCurrent(state) {
  skipCurrent(state) // same queue removal; commit omitted in model
}

function onAgentTurnStart(state, mode) {
  if (mode === 'agent') reset(state)
}

function onAgentFinished(state, { editCount, streamFailed, cancelled, mode = 'agent' }) {
  if (cancelled) {
    if (mode === 'agent' && editCount > 0) reset(state)
    return
  }
  if (streamFailed) {
    if (mode === 'agent' && editCount > 0) reset(state)
    return
  }
  if (editCount > 0) {
    state.forceDiffDialog = true
  }
}

test('Case A/B: two candidates open review; Close keeps queue', () => {
  const s = createPendingState()
  onAgentTurnStart(s, 'agent')
  enqueue(s, 'A')
  enqueue(s, 'B')
  onAgentFinished(s, { editCount: 2, streamFailed: false })
  assert.equal(s.forceDiffDialog, true)
  assert.deepEqual(s.applyQueue, ['A', 'B'])
  dismiss(s)
  assert.equal(s.forceDiffDialog, false)
  assert.deepEqual(s.applyQueue, ['A', 'B'])
})

test('Case C: Skip A keeps B', () => {
  const s = createPendingState()
  s.applyQueue = ['A', 'B']
  s.forceDiffDialog = true
  s.reviewIndex = 0
  skipCurrent(s)
  assert.deepEqual(s.applyQueue, ['B'])
  assert.equal(s.forceDiffDialog, true)
})

test('Case D: Apply last clears queue and dialog', () => {
  const s = createPendingState()
  s.applyQueue = ['B']
  s.forceDiffDialog = true
  applyCurrent(s)
  assert.deepEqual(s.applyQueue, [])
  assert.equal(s.forceDiffDialog, false)
})

test('Case E: Run2 does not mix Close-kept Run1 candidates', () => {
  const s = createPendingState()
  onAgentTurnStart(s, 'agent')
  enqueue(s, 'A')
  onAgentFinished(s, { editCount: 1, streamFailed: false })
  dismiss(s)
  assert.deepEqual(s.applyQueue, ['A'])
  onAgentTurnStart(s, 'agent')
  assert.deepEqual(s.applyQueue, [])
  enqueue(s, 'B')
  onAgentFinished(s, { editCount: 1, streamFailed: false })
  assert.deepEqual(s.applyQueue, ['B'])
  assert.equal(s.forceDiffDialog, true)
})

test('Case F: no-edit does not open review', () => {
  const s = createPendingState()
  onAgentTurnStart(s, 'agent')
  onAgentFinished(s, { editCount: 0, streamFailed: false })
  assert.equal(s.forceDiffDialog, false)
  assert.deepEqual(s.applyQueue, [])
})

test('Case G: error clears mid-run candidates and does not open review', () => {
  const s = createPendingState()
  onAgentTurnStart(s, 'agent')
  enqueue(s, 'A')
  onAgentFinished(s, { editCount: 1, streamFailed: true })
  assert.deepEqual(s.applyQueue, [])
  assert.equal(s.forceDiffDialog, false)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildPostVerifySuccessFinal,
  isInvestigationComplete,
  isInvestigationTool,
  isRedundantPostVerifyBatch,
  isVerifyComplete,
  shouldAcceptAgentFinal,
  shouldPreferRequiredTools,
  shouldRetryEmptyToolCalls,
  shouldSkipDuplicateToolCall,
  successfulToolKey
} from '../electron/main/lib/agentRoundPolicy.ts'

test('isVerifyComplete requires edits + verified + shell pass', () => {
  assert.equal(
    isVerifyComplete({ editedCount: 1, pendingUnverifiedCount: 0, shellPassed: true }),
    true
  )
  assert.equal(
    isVerifyComplete({ editedCount: 1, pendingUnverifiedCount: 1, shellPassed: true }),
    false
  )
  assert.equal(
    isVerifyComplete({ editedCount: 0, pendingUnverifiedCount: 0, shellPassed: true }),
    false
  )
  assert.equal(
    isVerifyComplete({ editedCount: 1, pendingUnverifiedCount: 0, shellPassed: false }),
    false
  )
})

test('read-only investigation can finalize without edit/verify', () => {
  assert.equal(isInvestigationTool('read_file'), true)
  assert.equal(isInvestigationTool('search_code'), true)
  assert.equal(isInvestigationTool('edit_file'), false)
  assert.equal(
    isInvestigationComplete({ anyToolCall: true, editedCount: 0, investigated: true }),
    true
  )
  assert.equal(
    shouldAcceptAgentFinal({
      anyToolCall: true,
      editedCount: 0,
      verifyComplete: false,
      investigationComplete: true,
      fakingTools: false
    }),
    true
  )
  assert.equal(
    shouldRetryEmptyToolCalls({
      emptyToolRetries: 0,
      maxEmptyToolRetries: 3,
      verifyComplete: false,
      investigationComplete: true
    }),
    false
  )
})

test('verify success accepts final and skips empty-tool retry', () => {
  assert.equal(
    shouldAcceptAgentFinal({
      anyToolCall: true,
      editedCount: 2,
      verifyComplete: true,
      investigationComplete: false,
      fakingTools: false
    }),
    true
  )
  assert.equal(
    shouldRetryEmptyToolCalls({
      emptyToolRetries: 0,
      maxEmptyToolRetries: 3,
      verifyComplete: true,
      investigationComplete: false
    }),
    false
  )
  assert.equal(
    shouldPreferRequiredTools({
      modelAllowsRequired: true,
      anyToolCall: true,
      editedCount: 2,
      shellPassed: true,
      editRecoveries: 0,
      maxEditRecoveries: 5,
      step: 8,
      verifyComplete: true,
      investigationComplete: false
    }),
    false
  )
})

test('verify failure does not look like success', () => {
  assert.equal(
    isVerifyComplete({ editedCount: 1, pendingUnverifiedCount: 0, shellPassed: false }),
    false
  )
  assert.equal(
    shouldAcceptAgentFinal({
      anyToolCall: true,
      editedCount: 1,
      verifyComplete: false,
      investigationComplete: false,
      fakingTools: false
    }),
    false
  )
})

test('duplicate skip only for same phase+signature success', () => {
  const sig = 'read_file:{"path":"a.ts"}'
  const keys = new Set([successfulToolKey('explore', sig)])
  assert.equal(
    shouldSkipDuplicateToolCall({
      name: 'read_file',
      signature: sig,
      phase: 'explore',
      successfulKeys: keys
    }),
    true
  )
  assert.equal(
    shouldSkipDuplicateToolCall({
      name: 'read_file',
      signature: sig,
      phase: 'verify',
      successfulKeys: keys
    }),
    false
  )
  assert.equal(
    shouldSkipDuplicateToolCall({
      name: 'read_file',
      signature: 'read_file:{"path":"b.ts"}',
      phase: 'explore',
      successfulKeys: keys
    }),
    false
  )
  assert.equal(
    shouldSkipDuplicateToolCall({
      name: 'set_phase',
      signature: 'set_phase:{"phase":"verify"}',
      phase: 'edit',
      successfulKeys: keys
    }),
    false
  )
})

test('post-verify redundant batch detection', () => {
  assert.equal(
    isRedundantPostVerifyBatch({
      verifyComplete: true,
      rows: [
        { name: 'set_phase', skippedDup: false, ok: true },
        { name: 'edit_file', skippedDup: true, ok: true },
        { name: 'get_problems', skippedDup: false, ok: true }
      ]
    }),
    true
  )
  assert.equal(
    isRedundantPostVerifyBatch({
      verifyComplete: true,
      rows: [{ name: 'edit_file', skippedDup: false, ok: true }]
    }),
    false
  )
  assert.equal(
    isRedundantPostVerifyBatch({
      verifyComplete: false,
      rows: [{ name: 'set_phase', skippedDup: false, ok: true }]
    }),
    false
  )
})

test('fake tool prose never accepted as final', () => {
  assert.equal(
    shouldAcceptAgentFinal({
      anyToolCall: true,
      editedCount: 0,
      verifyComplete: false,
      investigationComplete: true,
      fakingTools: true
    }),
    false
  )
})

test('buildPostVerifySuccessFinal mentions 変更候補', () => {
  const text = buildPostVerifySuccessFinal(['src/a.ts', 'src/b.ts'])
  assert.match(text, /run_shell/)
  assert.match(text, /変更候補/)
  assert.match(text, /src\/a\.ts/)
})

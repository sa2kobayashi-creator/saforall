/** Pure helpers: decide when Agent may stop without extra Provider rounds. */

export function isVerifyComplete(input: {
  editedCount: number
  pendingUnverifiedCount: number
  shellPassed: boolean
}): boolean {
  return (
    input.editedCount > 0 &&
    input.pendingUnverifiedCount === 0 &&
    input.shellPassed === true
  )
}

export function isInvestigationTool(name: string): boolean {
  return (
    name === 'read_file' ||
    name === 'search_code' ||
    name === 'list_dir' ||
    name === 'list_mcp_resources' ||
    name === 'read_mcp_resource' ||
    name === 'read_skill'
  )
}

export function isInvestigationComplete(input: {
  anyToolCall: boolean
  editedCount: number
  investigated: boolean
}): boolean {
  return input.anyToolCall && input.editedCount === 0 && input.investigated
}

export function isPostVerifyNoiseTool(name: string): boolean {
  return name === 'set_phase' || name === 'get_problems'
}

export function shouldRetryEmptyToolCalls(input: {
  emptyToolRetries: number
  maxEmptyToolRetries: number
  verifyComplete: boolean
  investigationComplete: boolean
}): boolean {
  if (input.verifyComplete) return false
  if (input.investigationComplete) return false
  return input.emptyToolRetries < input.maxEmptyToolRetries
}

export function shouldAcceptAgentFinal(input: {
  anyToolCall: boolean
  editedCount: number
  verifyComplete: boolean
  investigationComplete: boolean
  fakingTools: boolean
}): boolean {
  if (input.fakingTools) return false
  if (!input.anyToolCall) return false
  if (input.verifyComplete) return true
  if (input.investigationComplete) return true
  if (input.editedCount > 0) return false
  return false
}

export function shouldPreferRequiredTools(input: {
  modelAllowsRequired: boolean
  anyToolCall: boolean
  editedCount: number
  shellPassed: boolean
  editRecoveries: number
  maxEditRecoveries: number
  step: number
  verifyComplete: boolean
  investigationComplete: boolean
}): boolean {
  if (!input.modelAllowsRequired) return false
  if (input.verifyComplete) return false
  if (input.investigationComplete) return false
  if (!input.anyToolCall) return true
  if (input.editedCount === 0 && input.step < 10) return true
  if (
    input.editedCount > 0 &&
    !input.shellPassed &&
    input.editRecoveries < input.maxEditRecoveries &&
    input.step < 40
  ) {
    return true
  }
  return false
}

export function shouldSkipDuplicateToolCall(input: {
  name: string
  signature: string
  phase: string
  successfulKeys: Iterable<string>
}): boolean {
  if (input.name === 'set_phase') return false
  const key = `${input.phase}::${input.signature}`
  return Array.from(input.successfulKeys).includes(key)
}

export function successfulToolKey(phase: string, signature: string): string {
  return `${phase}::${signature}`
}

/**
 * True when a tool batch after verify-success nudge has no meaningful new work.
 * Call only when a prior turn already marked verify success (do not pass the
 * success-producing batch itself).
 */
export function isRedundantPostVerifyBatch(input: {
  verifyComplete: boolean
  rows: Array<{ name: string; skippedDup: boolean; ok: boolean | null }>
}): boolean {
  if (!input.verifyComplete) return false
  if (input.rows.length === 0) return false
  return input.rows.every(
    (row) =>
      row.skippedDup ||
      isPostVerifyNoiseTool(row.name) ||
      (row.ok === true && (row.name === 'read_file' || row.name === 'run_shell'))
  )
}

export function buildPostVerifySuccessFinal(editedPaths: Iterable<string>): string {
  const list = Array.from(editedPaths).slice(0, 12).join(', ')
  return [
    '検証（run_shell）は成功しています。',
    list ? `変更候補: ${list}` : null,
    'エディタ上部の「変更候補」から差分を確認・適用してください。'
  ]
    .filter(Boolean)
    .join('\n')
}

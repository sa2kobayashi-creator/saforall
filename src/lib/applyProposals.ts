export type ProposalLike = {
  targetPath: string
  original: string
  modified: string
  mode: 'create' | 'replace' | 'append' | 'patch'
}

export type ValidateProposalOptions = {
  workspacePath: string | null
  /** default 2_000_000 */
  maxBytes?: number
  /** replace/create: reject when original is long but modified is tiny */
  rejectSuspiciousTruncate?: boolean
}

export type ValidateFailureReason =
  | 'empty_path'
  | 'outside_workspace'
  | 'empty_content'
  | 'too_large'
  | 'suspicious_truncate'

export type ValidateProposalResult =
  | { ok: true }
  | { ok: false; reason: ValidateFailureReason; message: string }

export type AcceptAllItemResult =
  | { path: string; status: 'applied' }
  | { path: string; status: 'rejected'; reason: ValidateFailureReason; message: string }
  | { path: string; status: 'failed'; error: string }

export type AcceptAllResult = {
  ok: boolean
  applied: string[]
  rejected: Array<{ path: string; reason: ValidateFailureReason; message: string }>
  failed: Array<{ path: string; error: string }>
  remaining: ProposalLike[]
  summary: string
}

export type VerifySuggestion = { primary: string; fallbacks: string[] }

export function normalizePathKey(path: string): string {
  const unified = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = unified.split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop()
      else out.push('..')
      continue
    }
    out.push(part)
  }
  // Keep drive letter style: "d:" + rest
  const joined = out.join('/').toLowerCase()
  if (/^[a-z]:$/i.test(out[0] ?? '')) {
    return `${out[0].toLowerCase()}/${out.slice(1).join('/').toLowerCase()}`.replace(/\/$/, '')
  }
  return joined
}

/** True when target is the workspace root or a child path. */
export function isPathInsideWorkspace(workspacePath: string, targetPath: string): boolean {
  const root = normalizePathKey(workspacePath.trim())
  const target = normalizePathKey(targetPath.trim())
  if (!root || !target) return false
  if (target === root) return true
  if (target.startsWith(`${root}/`)) return true
  return false
}

export function validateProposal(
  proposal: ProposalLike,
  options: ValidateProposalOptions
): ValidateProposalResult {
  const path = (proposal.targetPath || '').trim()
  if (!path) {
    return { ok: false, reason: 'empty_path', message: '適用先パスが空です' }
  }

  const workspace = options.workspacePath?.trim() || null
  if (workspace && !isPathInsideWorkspace(workspace, path)) {
    return {
      ok: false,
      reason: 'outside_workspace',
      message: `ワークスペース外への書き込みは拒否しました: ${path}`
    }
  }

  if (proposal.modified.length === 0) {
    return { ok: false, reason: 'empty_content', message: '適用内容が空です' }
  }

  const maxBytes = options.maxBytes ?? 2_000_000
  const bytes = new TextEncoder().encode(proposal.modified).length
  if (bytes > maxBytes) {
    return {
      ok: false,
      reason: 'too_large',
      message: `内容が大きすぎます（${bytes} bytes > ${maxBytes}）`
    }
  }

  const rejectTruncate = options.rejectSuspiciousTruncate !== false
  if (
    rejectTruncate &&
    (proposal.mode === 'replace' || proposal.mode === 'create') &&
    proposal.original.length > 400 &&
    proposal.modified.length < proposal.original.length * 0.35
  ) {
    return {
      ok: false,
      reason: 'suspicious_truncate',
      message: '既存ファイルに対して内容が極端に短いため適用を拒否しました（切り捨て疑い）'
    }
  }

  return { ok: true }
}

export function formatAcceptAllSummary(result: AcceptAllResult): string {
  if (result.ok) {
    return `${result.applied.length} 件を適用しました`
  }
  const parts: string[] = []
  if (result.applied.length > 0) {
    parts.push(`成功 ${result.applied.length}`)
  }
  if (result.rejected.length > 0) {
    parts.push(`検証拒否 ${result.rejected.length}`)
  }
  if (result.failed.length > 0) {
    parts.push(`失敗 ${result.failed.length}`)
  }
  if (result.remaining.length > 0) {
    parts.push(`未適用 ${result.remaining.length}`)
  }
  return `一部のみ完了（全体成功ではありません）: ${parts.join(' · ')}`
}

export async function acceptAllProposalsCollected(
  proposals: ProposalLike[],
  commit: (proposal: ProposalLike) => Promise<void>,
  options: ValidateProposalOptions,
  opts?: { stopOnFirstFailure?: boolean }
): Promise<AcceptAllResult> {
  const stopOnFirstFailure = opts?.stopOnFirstFailure !== false
  const applied: string[] = []
  const rejected: AcceptAllResult['rejected'] = []
  const failed: AcceptAllResult['failed'] = []
  const remaining: ProposalLike[] = []

  for (let i = 0; i < proposals.length; i += 1) {
    const proposal = proposals[i]
    const check = validateProposal(proposal, options)
    if (!check.ok) {
      rejected.push({
        path: proposal.targetPath,
        reason: check.reason,
        message: check.message
      })
      if (stopOnFirstFailure) {
        remaining.push(...proposals.slice(i))
        break
      }
      remaining.push(proposal)
      continue
    }

    try {
      await commit(proposal)
      applied.push(proposal.targetPath)
    } catch (error) {
      failed.push({
        path: proposal.targetPath,
        error: error instanceof Error ? error.message : String(error)
      })
      if (stopOnFirstFailure) {
        remaining.push(...proposals.slice(i))
        break
      }
      remaining.push(proposal)
    }
  }

  // When stopOnFirstFailure broke early, remaining already includes the failed item + rest.
  // Deduplicate remaining paths that were also listed as rejected/failed first item.
  const result: AcceptAllResult = {
    ok: applied.length === proposals.length && proposals.length > 0,
    applied,
    rejected,
    failed,
    remaining,
    summary: ''
  }
  if (proposals.length === 0) {
    result.ok = true
    result.summary = '適用対象がありません'
    return result
  }
  result.summary = formatAcceptAllSummary(result)
  return result
}

/** package.json scripts → post-apply verify suggestion (no I/O). */
export function suggestPostApplyVerifyFromScripts(
  scripts: Record<string, string> | null | undefined
): VerifySuggestion | null {
  if (!scripts || typeof scripts !== 'object') return null
  const fallbacks: string[] = []
  let primary: string | null = null
  if (scripts.typecheck) {
    primary = 'npm run typecheck'
    if (scripts.test) fallbacks.push('npm test')
  } else if (scripts.test) {
    primary = 'npm test'
  } else if (scripts.build) {
    primary = 'npm run build'
  }
  if (!primary) return null
  return { primary, fallbacks }
}

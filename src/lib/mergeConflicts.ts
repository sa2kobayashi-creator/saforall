export type MergeConflictHunk = {
  /** 1-based inclusive line of <<<<<<< */
  startLine: number
  /** 1-based line of ======= */
  midLine: number
  /** 1-based inclusive line of >>>>>>> */
  endLine: number
  current: string
  incoming: string
}

const START = /^<<<<<<<(?: .*)?$/
const MID = /^=======$/
const END = /^>>>>>>>(?: .*)?$/

export function parseMergeConflicts(content: string): MergeConflictHunk[] {
  const lines = content.split(/\r?\n/)
  const hunks: MergeConflictHunk[] = []
  let i = 0
  while (i < lines.length) {
    if (!START.test(lines[i] ?? '')) {
      i += 1
      continue
    }
    const startLine = i + 1
    let mid = -1
    let end = -1
    for (let j = i + 1; j < lines.length; j++) {
      if (mid < 0 && MID.test(lines[j] ?? '')) {
        mid = j
        continue
      }
      if (mid >= 0 && END.test(lines[j] ?? '')) {
        end = j
        break
      }
    }
    if (mid < 0 || end < 0) {
      i += 1
      continue
    }
    hunks.push({
      startLine,
      midLine: mid + 1,
      endLine: end + 1,
      current: lines.slice(i + 1, mid).join('\n'),
      incoming: lines.slice(mid + 1, end).join('\n')
    })
    i = end + 1
  }
  return hunks
}

export type ConflictResolveMode = 'current' | 'incoming' | 'both'

export function resolveMergeConflict(
  content: string,
  hunk: MergeConflictHunk,
  mode: ConflictResolveMode
): string {
  const lines = content.split(/\r?\n/)
  const replacement =
    mode === 'current'
      ? hunk.current
      : mode === 'incoming'
        ? hunk.incoming
        : [hunk.current, hunk.incoming].filter((part) => part.length > 0).join('\n')
  const replacementLines = replacement.length > 0 ? replacement.split('\n') : []
  const next = [
    ...lines.slice(0, hunk.startLine - 1),
    ...replacementLines,
    ...lines.slice(hunk.endLine)
  ]
  return next.join('\n')
}

export function isGitConflictEntry(index: string, worktree: string, status?: string): boolean {
  if (status === '競合') return true
  if (index === 'U' || worktree === 'U') return true
  if (index === 'A' && worktree === 'A') return true
  if (index === 'D' && worktree === 'D') return true
  return false
}

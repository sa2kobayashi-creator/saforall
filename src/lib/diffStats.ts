export type DiffStats = {
  added: number
  removed: number
}

/** Fast line-level stats (not a perfect LCS; good enough for Composer badges). */
export function computeDiffStats(original: string, modified: string): DiffStats {
  const a = original.replace(/\r\n/g, '\n').split('\n')
  const b = modified.replace(/\r\n/g, '\n').split('\n')
  const setA = new Map<string, number>()
  for (const line of a) {
    setA.set(line, (setA.get(line) ?? 0) + 1)
  }
  let removed = 0
  let added = 0
  const setB = new Map<string, number>()
  for (const line of b) {
    setB.set(line, (setB.get(line) ?? 0) + 1)
  }
  for (const [line, count] of Array.from(setA.entries())) {
    const next = setB.get(line) ?? 0
    if (count > next) removed += count - next
  }
  for (const [line, count] of Array.from(setB.entries())) {
    const prev = setA.get(line) ?? 0
    if (count > prev) added += count - prev
  }
  return { added, removed }
}

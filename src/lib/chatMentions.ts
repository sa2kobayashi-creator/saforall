export type MentionKind = 'special' | 'file'

export type MentionSuggestion = {
  id: string
  label: string
  insert: string
  detail?: string
  kind: MentionKind
}

export const SPECIAL_MENTIONS: MentionSuggestion[] = [
  {
    id: 'special:selection',
    label: '@selection',
    insert: '@selection',
    detail: 'エディタの選択範囲',
    kind: 'special'
  },
  {
    id: 'special:problems',
    label: '@problems',
    insert: '@problems',
    detail: 'Problems パネルの診断',
    kind: 'special'
  },
  {
    id: 'special:rules',
    label: '@rules',
    insert: '@rules',
    detail: 'プロジェクトルール',
    kind: 'special'
  },
  {
    id: 'special:codebase',
    label: '@codebase',
    insert: '@codebase',
    detail: 'ワークスペース索引 + 関連コード検索',
    kind: 'special'
  }
]

/** Returns the @query being typed at cursor, or null. */
export function activeMentionQuery(
  value: string,
  cursor: number
): { start: number; query: string } | null {
  const before = value.slice(0, cursor)
  const match = before.match(/(^|[\s([{])@([^\s@]*)$/)
  if (!match) return null
  const atIndex = before.lastIndexOf('@')
  if (atIndex < 0) return null
  return { start: atIndex, query: match[2] ?? '' }
}

export function filterSpecialMentions(query: string): MentionSuggestion[] {
  const q = query.toLowerCase()
  if (!q) return SPECIAL_MENTIONS
  return SPECIAL_MENTIONS.filter(
    (row) =>
      row.label.toLowerCase().includes(q) ||
      (row.detail ?? '').toLowerCase().includes(q)
  )
}

export function fileMentionSuggestion(path: string): MentionSuggestion {
  const name = path.split(/[/\\]/).pop() ?? path
  return {
    id: `file:${path}`,
    label: `@${name}`,
    insert: `@${name}`,
    detail: path,
    kind: 'file'
  }
}

export function parseMentionTokens(input: string): string[] {
  return (input.match(/@([^\s@]+)/g) ?? []).map((token) => token.slice(1))
}

export function hasSpecialMention(tokens: string[], name: string): boolean {
  return tokens.some((token) => token.toLowerCase() === name.toLowerCase())
}

/** Pull searchable keywords from a chat prompt for @codebase hits. */
export function extractCodebaseNeedles(input: string): string[] {
  const cleaned = input.replace(/@[^\s@]+/g, ' ')
  const words =
    cleaned.match(/[A-Za-z_][\w./-]{2,}|[\u3040-\u30ff\u3400-\u9fff]{2,}/g) ?? []
  const stop = new Set([
    'the',
    'and',
    'for',
    'with',
    'this',
    'that',
    'from',
    'into',
    'please',
    'codebase',
    'file',
    'files',
    'fix',
    'make',
    'want',
    'need',
    'して',
    'ください',
    'です',
    'ます',
    'から',
    'について',
    'を',
    'に',
    'は',
    'が'
  ])
  const scored = words
    .map((word) => {
      const key = word.toLowerCase()
      let weight = 1
      if (/[A-Z]/.test(word) && /[a-z]/.test(word)) weight += 5 // CamelCase
      if (word.includes('/') || word.includes('.')) weight += 4 // path-like
      if (word.length >= 8) weight += 1
      if (stop.has(key)) weight = -1
      return { word, key, weight }
    })
    .filter((row) => row.weight > 0)

  scored.sort((a, b) => b.weight - a.weight)
  const out: string[] = []
  for (const row of scored) {
    if (out.some((existing) => existing.toLowerCase() === row.key)) continue
    out.push(row.word)
    if (out.length >= 6) break
  }
  return out
}

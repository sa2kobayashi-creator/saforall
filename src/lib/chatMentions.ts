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
    detail: 'ワークスペース索引サマリ',
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

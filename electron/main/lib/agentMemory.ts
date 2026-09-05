/** Build a short auto memory note after a successful Agent verify. */
export function buildAgentSuccessMemoryNote(input: {
  editedPaths: string[]
  verifyCommand?: string | null
  summary?: string
}): string {
  const files = (input.editedPaths || []).slice(0, 8).join(', ')
  return [
    'Agent 完了（自動）',
    files ? `変更候補: ${files}` : null,
    input.verifyCommand ? `検証: ${input.verifyCommand}` : null,
    input.summary ? String(input.summary).slice(0, 400) : null
  ]
    .filter(Boolean)
    .join('\n')
}

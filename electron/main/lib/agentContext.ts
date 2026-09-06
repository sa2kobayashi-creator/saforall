/** Extract Agent runtime hints from chat request context. */

export function extractAgentRuntimeContext(bodyOrContext: Record<string, unknown>): {
  problems: string[]
  anchors: string[]
} {
  const context =
    typeof bodyOrContext.context === 'object' && bodyOrContext.context !== null
      ? (bodyOrContext.context as Record<string, unknown>)
      : bodyOrContext

  const problemsRaw = context.problems
  const problems = Array.isArray(problemsRaw)
    ? problemsRaw.filter((row): row is string => typeof row === 'string' && row.trim() !== '')
    : []

  const anchors: string[] = []
  const push = (value: unknown) => {
    if (typeof value !== 'string') return
    const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '').trim()
    if (!normalized) return
    if (!anchors.includes(normalized)) anchors.push(normalized)
  }

  push(context.path)
  const selection =
    typeof context.selection === 'object' && context.selection !== null
      ? (context.selection as Record<string, unknown>)
      : null
  if (selection) push(selection.path)

  if (Array.isArray(context.files)) {
    for (const row of context.files.slice(0, 8)) {
      if (row && typeof row === 'object') {
        push((row as Record<string, unknown>).path)
      }
    }
  }

  return { problems, anchors }
}

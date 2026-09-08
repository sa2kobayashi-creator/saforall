/**
 * Kept out of PreviewPane.tsx so callers can ask "is preview available?"
 * without pulling `marked` into the entry chunk.
 */
export function supportsPreview(language: string, path?: string | null): boolean {
  const lower = (language || '').toLowerCase()
  if (lower === 'markdown' || lower === 'html') return true
  const name = (path || '').toLowerCase()
  return (
    name.endsWith('.md') ||
    name.endsWith('.markdown') ||
    name.endsWith('.html') ||
    name.endsWith('.htm')
  )
}

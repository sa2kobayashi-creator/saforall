/** Guards against Agent/Composer wiping files (esp. small entrypoints). */

const ENTRY_BASENAMES = new Set([
  'main.js',
  'main.jsx',
  'main.ts',
  'main.tsx',
  'index.js',
  'index.jsx',
  'index.ts',
  'index.tsx',
  'index.html',
  'app.js',
  'app.jsx',
  'app.ts',
  'app.tsx',
  'package.json',
  'webpack.config.js',
  'vite.config.js',
  'vite.config.ts'
])

export function basenameOfPath(path: string): string {
  const unified = path.replace(/\\/g, '/')
  const base = unified.split('/').pop() ?? unified
  return base.toLowerCase()
}

export function isLikelyEntryPath(path: string): boolean {
  const base = basenameOfPath(path)
  if (ENTRY_BASENAMES.has(base)) return true
  if (base.startsWith('webpack.config.') || base.startsWith('vite.config.')) return true
  return false
}

export type EditShrinkDecision =
  | { ok: true }
  | { ok: false; reason: 'empty_content' | 'whitespace_only' | 'suspicious_truncate' | 'entry_gutted'; message: string }

/**
 * Reject empty / near-empty replacements that wipe working files.
 * Small entry files (e.g. 293B main.js) were previously under the 400-char gate.
 */
export function assessEditContent(params: {
  path: string
  nextContent: string
  previousContent?: string | null
}): EditShrinkDecision {
  const next = params.nextContent ?? ''
  const prev = params.previousContent ?? null
  const trimmed = next.trim()

  if (next.length === 0) {
    return { ok: false, reason: 'empty_content', message: 'content is empty' }
  }
  if (trimmed.length === 0) {
    return {
      ok: false,
      reason: 'whitespace_only',
      message: 'content is whitespace-only; refusing to wipe the file'
    }
  }

  if (prev != null && prev.length > 0) {
    const entry = isLikelyEntryPath(params.path)
    const minKeep = entry ? Math.min(40, Math.floor(prev.length * 0.5)) : 20
    // Any existing file ≥ 80 chars: reject severe shrink (was 400 — missed small entrypoints).
    if (prev.length >= 80 && next.length < Math.max(minKeep, prev.length * 0.35)) {
      return {
        ok: false,
        reason: 'suspicious_truncate',
        message:
          'Proposed content is much shorter than the current file. Resend a complete file (not a fragment or empty stub).'
      }
    }
    // Entry / bootstrap files: never accept near-empty replacements.
    if (entry && prev.trim().length >= 30 && trimmed.length < 30) {
      return {
        ok: false,
        reason: 'entry_gutted',
        message:
          `Refusing to gut entry file ${basenameOfPath(params.path)}. ` +
          'Restore meaningful bootstrap content (e.g. createRoot / <div id="root">), do not blank it.'
      }
    }
  }

  return { ok: true }
}

import type { ExtensionPermission } from '../types/extensions'

/** Block obvious destructive shell without dangerous permission (renderer-side). */
export function assertSafeExtensionRun(
  run: string,
  permissions?: ExtensionPermission[]
): { ok: true } | { ok: false; error: string } {
  const text = run.trim()
  if (!text) return { ok: false, error: 'コマンドが空です' }
  const dangerous = (permissions ?? []).includes('terminal.run.dangerous')
  const blocked =
    /\brm\s+-rf\b/i.test(text) ||
    /\bdel\s+\/s\b/i.test(text) ||
    /\bformat\s+[a-z]:/i.test(text) ||
    /\bshutdown\b/i.test(text) ||
    /\b:(){:|:&};:/i.test(text)
  if (blocked && !dangerous) {
    return {
      ok: false,
      error: '破壊的コマンドには terminal.run.dangerous 権限が必要です'
    }
  }
  return { ok: true }
}

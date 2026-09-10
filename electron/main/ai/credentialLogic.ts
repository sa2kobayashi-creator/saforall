export type DevelopmentSecretSource = 'settings' | 'env' | ''
export type CredentialPrioritySource = 'byok' | 'settings' | 'env' | ''

export function pickDevelopmentSecret(
  settingsSecret: string,
  envSecret: string
): { secret: string; source: DevelopmentSecretSource } {
  const fromSettings = settingsSecret.trim()
  if (fromSettings) return { secret: fromSettings, source: 'settings' }
  const fromEnv = envSecret.trim()
  if (fromEnv) return { secret: fromEnv, source: 'env' }
  return { secret: '', source: '' }
}

/** BYOK → Development settings → Development env. Cursor is not passed in. */
export function pickCredentialPriority(
  byokSecret: string,
  settingsSecret: string,
  envSecret: string
): { secret: string; source: CredentialPrioritySource } {
  const byok = byokSecret.trim()
  if (byok) return { secret: byok, source: 'byok' }
  const development = pickDevelopmentSecret(settingsSecret, envSecret)
  return { secret: development.secret, source: development.source }
}

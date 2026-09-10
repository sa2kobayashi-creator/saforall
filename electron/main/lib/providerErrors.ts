/** Detect provider billing / quota failures that Auto should retry on another engine. */
export function isCreditOrQuotaError(raw: string | null | undefined): boolean {
  const text = (raw ?? '').trim()
  if (!text) return false
  const lower = text.toLowerCase()
  return (
    lower.includes('credit balance') ||
    lower.includes('purchase credits') ||
    lower.includes('plans & billing') ||
    lower.includes('insufficient credit') ||
    lower.includes('insufficient_quota') ||
    lower.includes('insufficient_funds') ||
    lower.includes('payment required') ||
    lower.includes('exceeded your current quota') ||
    lower.includes('billing hard limit') ||
    /\b402\b/.test(text) ||
    text.includes('残高') ||
    text.includes('クレジット') ||
    text.includes('月額上限') ||
    text.includes('BUDGET_EXCEEDED')
  )
}

/** Engines to try after a runtime credit/quota failure (Auto only). */
export function autoRuntimeFallbackEngines(
  failedEngine: string,
  mode: string
): string[] {
  const failed = failedEngine.trim().toLowerCase()
  if (mode === 'agent') {
    return (['openai', 'claude'] as const).filter((engine) => engine !== failed)
  }
  return (['openai', 'gemini', 'claude'] as const).filter((engine) => engine !== failed)
}

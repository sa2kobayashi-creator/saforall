import type { LlmProviderId, ProviderId } from './types'

/** USD per 1M tokens. Isolated from the Router. Not a billing invoice. */
const RATES: Record<string, { in: number; out: number }> = {
  openai: { in: 1.75, out: 14.0 },
  gemini: { in: 0.75, out: 3.75 },
  claude: { in: 2.0, out: 10.0 },
  workers: { in: 0.05, out: 0.15 },
  cursor: { in: 1.25, out: 10.0 }
}

export function estimateCostUsd(
  provider: ProviderId | LlmProviderId | string,
  inputTokens: number,
  outputTokens: number
): number {
  const rates = RATES[provider] ?? RATES.openai
  const usd =
    (Math.max(0, inputTokens) / 1_000_000) * rates.in +
    (Math.max(0, outputTokens) / 1_000_000) * rates.out
  return Math.round(usd * 1_000_000) / 1_000_000
}

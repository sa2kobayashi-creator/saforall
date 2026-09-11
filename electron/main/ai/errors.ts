export type AIErrorCode =
  | 'AUTH_ERROR'
  | 'RATE_LIMIT'
  | 'MODEL_NOT_FOUND'
  | 'INSUFFICIENT_CREDIT'
  | 'TIMEOUT'
  | 'PROVIDER_ERROR'
  | 'NETWORK_ERROR'
  | 'AGENT_UNSUPPORTED'
  | 'UNKNOWN'

export class AIError extends Error {
  readonly code: AIErrorCode
  readonly providerId: string | null
  readonly httpStatus: number | null

  constructor(
    code: AIErrorCode,
    message: string,
    options?: { providerId?: string | null; httpStatus?: number | null }
  ) {
    super(redactLooksLikeSecret(message))
    this.name = 'AIError'
    this.code = code
    this.providerId = options?.providerId ?? null
    this.httpStatus = options?.httpStatus ?? null
  }
}

/** Never put raw secrets in logs or thrown messages. */
export function redactLooksLikeSecret(text: string): string {
  let out = text
  out = out.replace(/\bsk-[A-Za-z0-9_\-]{8,}\b/g, 'sk-***')
  out = out.replace(/\bsk-ant-[A-Za-z0-9_\-]{8,}\b/g, 'sk-ant-***')
  out = out.replace(/\bcursor_[A-Za-z0-9_\-]{8,}\b/g, 'cursor_***')
  out = out.replace(/\bBearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer ***')
  out = out.replace(/\bx-api-key:\s*\S+/gi, 'x-api-key: ***')
  out = out.replace(/\bx-goog-api-key:\s*\S+/gi, 'x-goog-api-key: ***')
  return out
}

export function redactSecrets(text: string, secrets: Array<string | null | undefined>): string {
  let out = redactLooksLikeSecret(text)
  for (const secret of secrets) {
    const value = (secret ?? '').trim()
    if (value.length < 8) continue
    out = out.split(value).join(`${value.slice(0, 4)}***`)
  }
  return out
}

export function classifyProviderError(
  raw: string | null | undefined,
  httpStatus?: number | null
): AIErrorCode {
  const text = (raw ?? '').trim()
  const lower = text.toLowerCase()
  const status = httpStatus ?? extractHttpStatus(text)

  if (status === 401 || status === 403) return 'AUTH_ERROR'
  if (status === 402) return 'INSUFFICIENT_CREDIT'
  if (status === 404) return 'MODEL_NOT_FOUND'
  if (status === 429) return 'RATE_LIMIT'
  if (status === 408) return 'TIMEOUT'

  if (
    lower.includes('credit balance') ||
    lower.includes('purchase credits') ||
    lower.includes('plans & billing') ||
    lower.includes('insufficient credit') ||
    lower.includes('insufficient_quota') ||
    lower.includes('insufficient_funds') ||
    lower.includes('payment required') ||
    lower.includes('exceeded your current quota') ||
    lower.includes('billing hard limit') ||
    text.includes('残高') ||
    text.includes('クレジット') ||
    text.includes('BUDGET_EXCEEDED') ||
    text.includes('月額上限')
  ) {
    return 'INSUFFICIENT_CREDIT'
  }

  if (
    lower.includes('invalid api key') ||
    lower.includes('incorrect api key') ||
    lower.includes('unauthorized') ||
    lower.includes('authentication') ||
    lower.includes('invalid x-api-key') ||
    text.includes('キー未設定') ||
    text.includes('LLM_NOT_CONFIGURED')
  ) {
    return 'AUTH_ERROR'
  }

  if (
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('tokens per min') ||
    text.includes('レート制限')
  ) {
    return 'RATE_LIMIT'
  }

  if (
    lower.includes('model not found') ||
    lower.includes('does not exist') ||
    lower.includes('unknown model')
  ) {
    return 'MODEL_NOT_FOUND'
  }

  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('aborted') ||
    text.includes('タイムアウト')
  ) {
    return 'TIMEOUT'
  }

  if (
    lower.includes('fetch failed') ||
    lower.includes('network') ||
    lower.includes('econnrefused') ||
    lower.includes('enotfound')
  ) {
    return 'NETWORK_ERROR'
  }

  if (status !== null && status >= 500) return 'PROVIDER_ERROR'
  if (status !== null && status >= 400) return 'PROVIDER_ERROR'
  return text ? 'UNKNOWN' : 'UNKNOWN'
}

export function aiErrorFromHttp(
  providerId: string,
  status: number,
  body: string
): AIError {
  const snippet = redactLooksLikeSecret(body).slice(0, 400)
  const code = classifyProviderError(snippet, status)
  return new AIError(code, `${providerId} HTTP ${status}: ${snippet}`, {
    providerId,
    httpStatus: status
  })
}

export function throwAgentUnsupported(providerId: string): never {
  throw new AIError(
    'AGENT_UNSUPPORTED',
    'このエンドポイントはツール Agent 非対応です（Cloudflare Workers AI / Gemini など）。' +
      '設定で OpenAI または Claude を選んで再実行してください。',
    { providerId }
  )
}

/**
 * Legacy code-level check. Prefer isFailoverEligibleError(error) from failover.ts.
 * Phase 2-C-3: INSUFFICIENT_CREDIT is not a Router Failover candidate (api credit layer).
 */
export function isFailoverCandidate(code: AIErrorCode): boolean {
  return (
    code === 'AUTH_ERROR' ||
    code === 'RATE_LIMIT' ||
    code === 'PROVIDER_ERROR' ||
    code === 'NETWORK_ERROR' ||
    code === 'TIMEOUT'
  )
}

/** Alias used by Phase 2-C-1 naming; delegates to AIError.code classification. */
export function isFailoverEligibleErrorCode(code: AIErrorCode): boolean {
  return isFailoverCandidate(code)
}

function extractHttpStatus(text: string): number | null {
  const match = /HTTP\s+(\d{3})/i.exec(text)
  if (!match) return null
  return Number(match[1])
}

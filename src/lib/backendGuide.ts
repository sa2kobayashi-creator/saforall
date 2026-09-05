/** Startup / backend guidance copy helpers (testable). */
export function formatXamppHealthUrl(baseUrl?: string | null): string {
  const base = (baseUrl || 'http://localhost:8081/saforall/api').replace(/\/$/, '')
  return `${base}/health`
}

export function buildBackendOfflineMessage(baseUrl?: string | null): string {
  const health = formatXamppHealthUrl(baseUrl)
  return (
    `バックエンドに接続できません。XAMPP で Apache と MySQL を Start し、` +
    `${health} を確認してください。`
  )
}

/** Startup / backend guidance copy helpers (testable). */
export function formatXamppHealthUrl(baseUrl?: string | null): string {
  const base = (baseUrl || 'http://localhost:8081/saforall/api').replace(/\/$/, '')
  return `${base}/health`
}

export function buildBackendOfflineMessage(baseUrl?: string | null): string {
  const health = formatXamppHealthUrl(baseUrl)
  return (
    `接続を確認できません。配布版では XAMPP 不要です。Settings に API キーを保存するとチャットできます。` +
    `開発用 PHP を使う場合は XAMPP で Apache / MySQL を Start し、${health} を確認してください。`
  )
}

/** Map raw AI / backend errors to Japanese guidance with a next action. */
export function formatAiUserError(raw: string | null | undefined): string {
  const text = (raw ?? '').trim()
  if (!text) {
    return 'AI 応答に失敗しました。しばらく待って再送するか、Settings の API キーを確認してください。'
  }

  const lower = text.toLowerCase()

  if (
    /\b429\b/.test(text) ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    text.includes('レート制限')
  ) {
    return (
      'レート制限（429）です。1〜2 分待って再送するか、Settings で軽いモデルに切り替えてください。'
    )
  }

  if (
    lower.includes('credit balance') ||
    lower.includes('purchase credits') ||
    lower.includes('plans & billing') ||
    lower.includes('billing') ||
    lower.includes('insufficient credit') ||
    lower.includes('insufficient_quota') ||
    lower.includes('payment required') ||
    /\b402\b/.test(text) ||
    text.includes('残高') ||
    text.includes('クレジット')
  ) {
    return (
      'Anthropic（Claude）の API クレジット残高が不足しています。' +
      ' console.anthropic.com の Plans & Billing でチャージするか、' +
      'チャットのエンジンを OpenAI / Gemini に切り替えて再送してください。'
    )
  }

  if (
    lower.includes('session not found') ||
    text.includes('session_id is required') ||
    text.includes('セッション')
  ) {
    return (
      'チャットセッションが見つかりませんでした。' +
      '「新規」で新しいチャットを開くか、もう一度送ってください（自動で作り直します）。'
    )
  }

  if (
    lower.includes('api key') ||
    lower.includes('api_key') ||
    lower.includes('unauthorized') ||
    /\b401\b/.test(text) ||
    text.includes('キー未設定') ||
    text.includes('API キー')
  ) {
    return 'API キーを確認してください。Settings でキーを保存してから再送してください。'
  }

  if (
    lower.includes('budget') ||
    text.includes('BUDGET') ||
    text.includes('予算') ||
    text.includes('月額上限')
  ) {
    return '予算上限に達しています。Settings の月額上限を見直すか、別エンジンを選んでください。'
  }

  if (
    lower.includes('timeout') ||
    lower.includes('etimedout') ||
    text.includes('タイムアウト') ||
    lower.includes('network') ||
    lower.includes('fetch failed')
  ) {
    return '通信がタイムアウトまたは失敗しました。ネット接続を確認し、もう一度送ってください。'
  }

  if (/\b500\b/.test(text) || /\b502\b/.test(text) || /\b503\b/.test(text)) {
    return `${text} — 相手側サーバーの一時障害の可能性があります。しばらく待って再送してください。`
  }

  if (text.includes('LLM_NOT_CONFIGURED') || text.includes('ローカルモード: Settings')) {
    return 'API キーが未設定です。Settings で OpenAI / Claude / Gemini などのキーを保存してください。'
  }

  // Already Japanese guidance — keep as-is
  if (/[ぁ-んァ-ン一-龥]/.test(text) && (text.includes('ください') || text.includes('確認'))) {
    return text
  }

  return `${text} — 再送するか、Settings のキー・モデルを確認してください。`
}

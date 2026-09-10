/** Auto 用途カテゴリ（チャット明示選択 + 設定の有効/無効）。 */

export type RouterCategoryId =
  | 'auto'
  | 'dev_design'
  | 'dev_implement'
  | 'dev_test'
  | 'dev_docs'
  | 'writing'
  | 'summarize'
  | 'vision'
  | 'explain_learn'
  | 'brainstorm'
  | 'data_format'
  | 'research'
  | 'support_copy'
  | 'slides'
  | 'meeting_notes'
  | 'image_gen'
  | 'video_understand'

export type RouterCategoryGroup = 'meta' | 'dev' | 'knowledge' | 'media' | 'work'

export type RouterCategory = {
  id: RouterCategoryId
  group: RouterCategoryGroup
  label: string
  hint: string
  /** Ask 時の希望エンジン（auto は null） */
  preferredAsk: 'openai' | 'gemini' | 'claude' | null
  /** Agent 時の希望（ツール可能なもの） */
  preferredAgent: 'openai' | 'claude' | null
  /** ログ用 task_type */
  taskType: string | null
  /** システムプロンプトに足す用途ヒント */
  systemHint: string | null
}

export const ROUTER_CATEGORY_GROUP_LABELS: Record<RouterCategoryGroup, string> = {
  meta: '自動',
  dev: 'プログラム開発',
  knowledge: '知的生産',
  media: 'メディア',
  work: '業務'
}

export const ROUTER_CATEGORIES: RouterCategory[] = [
  {
    id: 'auto',
    group: 'meta',
    label: '自動判定',
    hint: 'メッセージ内容から振り分け',
    preferredAsk: null,
    preferredAgent: null,
    taskType: null,
    systemHint: null
  },
  {
    id: 'dev_design',
    group: 'dev',
    label: '開発（設計・要件）',
    hint: '方針・設計・レビュー → Claude',
    preferredAsk: 'claude',
    preferredAgent: 'claude',
    taskType: 'design',
    systemHint: '用途: 設計・要件定義。トレードオフと方針を明確に述べてください。'
  },
  {
    id: 'dev_implement',
    group: 'dev',
    label: '開発（実装）',
    hint: 'コード実装・修正 → OpenAI',
    preferredAsk: 'openai',
    preferredAgent: 'openai',
    taskType: 'codegen',
    systemHint: '用途: 実装。具体的なコード変更を優先してください。'
  },
  {
    id: 'dev_test',
    group: 'dev',
    label: '開発（テスト）',
    hint: 'テスト・型・検証 → OpenAI',
    preferredAsk: 'openai',
    preferredAgent: 'openai',
    taskType: 'test_fix',
    systemHint: '用途: テスト・型チェック。失敗原因と検証手順を具体的に。'
  },
  {
    id: 'dev_docs',
    group: 'dev',
    label: '開発（ドキュメント）',
    hint: 'README・コメント → Gemini',
    preferredAsk: 'gemini',
    preferredAgent: 'openai',
    taskType: 'summarize',
    systemHint: '用途: ドキュメント作成。読者がすぐ使える構成にしてください。'
  },
  {
    id: 'writing',
    group: 'knowledge',
    label: '文章作成',
    hint: 'メール・企画・文面 → Gemini',
    preferredAsk: 'gemini',
    preferredAgent: 'openai',
    taskType: 'summarize',
    systemHint: '用途: 文章作成。目的・読者・トーンを意識した完成文を出してください。'
  },
  {
    id: 'summarize',
    group: 'knowledge',
    label: '要約・翻訳',
    hint: '短く・翻訳 → Gemini',
    preferredAsk: 'gemini',
    preferredAgent: 'openai',
    taskType: 'summarize',
    systemHint: '用途: 要約・翻訳。要点を落とさず簡潔に。'
  },
  {
    id: 'explain_learn',
    group: 'knowledge',
    label: '解説・学習',
    hint: '仕組みの説明 → OpenAI',
    preferredAsk: 'openai',
    preferredAgent: 'openai',
    taskType: 'explain',
    systemHint: '用途: 解説・学習。段階的に分かりやすく説明してください。'
  },
  {
    id: 'brainstorm',
    group: 'knowledge',
    label: 'ブレインストーム',
    hint: 'アイデア出し → Claude',
    preferredAsk: 'claude',
    preferredAgent: 'claude',
    taskType: 'design',
    systemHint: '用途: ブレインストーム。複数案と選定基準を出してください。'
  },
  {
    id: 'research',
    group: 'knowledge',
    label: 'リサーチ・比較',
    hint: '調査・比較表 → Claude',
    preferredAsk: 'claude',
    preferredAgent: 'claude',
    taskType: 'design',
    systemHint:
      '用途: リサーチ・比較。観点を揃え、表形式で長所短所を整理してください。不明点は仮説と明示。'
  },
  {
    id: 'data_format',
    group: 'work',
    label: '表計算・データ整形',
    hint: 'CSV/表の整形 → OpenAI',
    preferredAsk: 'openai',
    preferredAgent: 'openai',
    taskType: 'codegen',
    systemHint:
      '用途: データ整形。CSV/TSV/表としてそのまま貼れる結果を優先。変換ルールも短く添える。'
  },
  {
    id: 'support_copy',
    group: 'work',
    label: 'サポート文面',
    hint: '問い合わせ返信 → Gemini',
    preferredAsk: 'gemini',
    preferredAgent: 'openai',
    taskType: 'summarize',
    systemHint:
      '用途: カスタマー／社内サポート文面。丁寧・明確・次アクション付きの完成文を出してください。'
  },
  {
    id: 'slides',
    group: 'work',
    label: 'スライド構成',
    hint: '発表構成 → Claude',
    preferredAsk: 'claude',
    preferredAgent: 'claude',
    taskType: 'design',
    systemHint:
      '用途: スライド構成。枚数・各スライドの見出しと箇条書き（短文）を提案してください。'
  },
  {
    id: 'meeting_notes',
    group: 'work',
    label: '議事録・メモ整理',
    hint: '音声起こし後の整理 → Gemini',
    preferredAsk: 'gemini',
    preferredAgent: 'openai',
    taskType: 'summarize',
    systemHint:
      '用途: 議事録・メモ整理。決定事項・宿題・次回までにを分けて整理してください。'
  },
  {
    id: 'vision',
    group: 'media',
    label: '画像理解',
    hint: 'スクショ・図の読取 → Gemini',
    preferredAsk: 'gemini',
    preferredAgent: 'openai',
    taskType: 'explain',
    systemHint: '用途: 画像理解。添付画像の内容を根拠に答えてください。'
  },
  {
    id: 'image_gen',
    group: 'media',
    label: '画像生成',
    hint: 'イラスト生成 → OpenAI Images',
    preferredAsk: 'openai',
    preferredAgent: 'openai',
    taskType: 'image_gen',
    systemHint: '用途: 画像生成。プロンプトから画像を生成するレーンです。'
  },
  {
    id: 'video_understand',
    group: 'media',
    label: '動画理解',
    hint: 'フレーム／説明で理解 → Gemini',
    preferredAsk: 'gemini',
    preferredAgent: 'openai',
    taskType: 'explain',
    systemHint:
      '用途: 動画理解。添付のフレーム画像やタイムスタンプ付きメモを時系列で解釈し、要約・要点・次アクションを出してください。長尺動画ファイルの直接解析は未対応のため、重要なコマのスクショ添付を推奨します。'
  }
]

export const DEFAULT_ENABLED_CATEGORIES: RouterCategoryId[] = ROUTER_CATEGORIES.map(
  (row) => row.id
)

export function parseRouterCategory(raw: unknown): RouterCategoryId {
  const id = typeof raw === 'string' ? raw.trim() : ''
  if (ROUTER_CATEGORIES.some((row) => row.id === id)) return id as RouterCategoryId
  return 'auto'
}

export function getRouterCategory(id: RouterCategoryId): RouterCategory {
  return ROUTER_CATEGORIES.find((row) => row.id === id) ?? ROUTER_CATEGORIES[0]
}

export function parseEnabledCategories(raw: unknown): RouterCategoryId[] {
  let list: string[] = []
  if (Array.isArray(raw)) list = raw.map(String)
  else if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) list = parsed.map(String)
    } catch {
      list = raw.split(/[,\n]/).map((s) => s.trim())
    }
  }
  const allowed = new Set(ROUTER_CATEGORIES.map((row) => row.id))
  const out: RouterCategoryId[] = []
  for (const item of list) {
    const id = item.trim() as RouterCategoryId
    if (!allowed.has(id) || out.includes(id)) continue
    out.push(id)
  }
  if (!out.includes('auto')) out.unshift('auto')
  return out.length > 0 ? out : [...DEFAULT_ENABLED_CATEGORIES]
}

/** Heuristic detect when chat category is「自動判定」. */
export function detectRouterCategory(
  message: string,
  context?: { hasImages?: boolean } | null
): RouterCategoryId {
  const text = message.toLowerCase()
  if (/画像を生成|イラストを|generate an image|draw me|dall.?e|イメージを作/.test(text)) {
    return 'image_gen'
  }
  if (/動画|video|フレーム|タイムスタンプ/.test(text) && context?.hasImages) {
    return 'video_understand'
  }
  if (context?.hasImages) return 'vision'
  if (/設計|要件|アーキテクチャ|方針|レビュー|architecture|design/.test(text)) {
    return 'dev_design'
  }
  if (/テスト|typecheck|型エラー|pytest|jest|make tests|検証/.test(text)) {
    return 'dev_test'
  }
  if (/ドキュメント|readme|コメントを|docs/.test(text)) return 'dev_docs'
  if (/翻訳|要約|summarize|translate|短く/.test(text)) return 'summarize'
  if (/csv|tsv|表計算|スプレッド|データ整形|列を|整形して/.test(text)) return 'data_format'
  if (/比較表|リサーチ|調査して|pros and cons|メリデメ/.test(text)) return 'research'
  if (/お問い合わせ|サポート|お客様へ|返信文|クレーム対応/.test(text)) return 'support_copy'
  if (/スライド|発表資料|プレゼン|pitch deck/.test(text)) return 'slides'
  if (/議事録|ミーティングメモ|音声起こし|決定事項|アクションアイテム/.test(text)) {
    return 'meeting_notes'
  }
  if (/文章|メール|文面|企画書|ブログ|writing/.test(text)) return 'writing'
  if (/アイデア|ブレスト|ブレイン|案を出|brainstorm/.test(text)) return 'brainstorm'
  if (/説明して|なぜ|どう動|仕組み|explain|教えて/.test(text)) return 'explain_learn'
  if (/実装|直して|修正|バグ|コードを|書いて|implement|fix/.test(text)) {
    return 'dev_implement'
  }
  return 'auto'
}

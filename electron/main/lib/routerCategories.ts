/**
 * Mirror of src/lib/routerCategories.ts for Electron main (no cross-bundle import).
 * Keep IDs / preferred engines / system hints in sync when editing either file.
 */

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

type Cat = {
  id: RouterCategoryId
  preferredAsk: 'openai' | 'gemini' | 'claude' | null
  preferredAgent: 'openai' | 'claude' | null
  taskType: string | null
  systemHint: string | null
}

const CATS: Cat[] = [
  { id: 'auto', preferredAsk: null, preferredAgent: null, taskType: null, systemHint: null },
  {
    id: 'dev_design',
    preferredAsk: 'claude',
    preferredAgent: 'claude',
    taskType: 'design',
    systemHint: '用途: 設計・要件定義。トレードオフと方針を明確に述べてください。'
  },
  {
    id: 'dev_implement',
    preferredAsk: 'openai',
    preferredAgent: 'openai',
    taskType: 'codegen',
    systemHint: '用途: 実装。具体的なコード変更を優先してください。'
  },
  {
    id: 'dev_test',
    preferredAsk: 'openai',
    preferredAgent: 'openai',
    taskType: 'test_fix',
    systemHint: '用途: テスト・型チェック。失敗原因と検証手順を具体的に。'
  },
  {
    id: 'dev_docs',
    preferredAsk: 'gemini',
    preferredAgent: 'openai',
    taskType: 'summarize',
    systemHint: '用途: ドキュメント作成。読者がすぐ使える構成にしてください。'
  },
  {
    id: 'writing',
    preferredAsk: 'gemini',
    preferredAgent: 'openai',
    taskType: 'summarize',
    systemHint: '用途: 文章作成。目的・読者・トーンを意識した完成文を出してください。'
  },
  {
    id: 'summarize',
    preferredAsk: 'gemini',
    preferredAgent: 'openai',
    taskType: 'summarize',
    systemHint: '用途: 要約・翻訳。要点を落とさず簡潔に。'
  },
  {
    id: 'explain_learn',
    preferredAsk: 'openai',
    preferredAgent: 'openai',
    taskType: 'explain',
    systemHint: '用途: 解説・学習。段階的に分かりやすく説明してください。'
  },
  {
    id: 'brainstorm',
    preferredAsk: 'claude',
    preferredAgent: 'claude',
    taskType: 'design',
    systemHint: '用途: ブレインストーム。複数案と選定基準を出してください。'
  },
  {
    id: 'research',
    preferredAsk: 'claude',
    preferredAgent: 'claude',
    taskType: 'design',
    systemHint:
      '用途: リサーチ・比較。観点を揃え、表形式で長所短所を整理してください。不明点は仮説と明示。'
  },
  {
    id: 'data_format',
    preferredAsk: 'openai',
    preferredAgent: 'openai',
    taskType: 'codegen',
    systemHint:
      '用途: データ整形。CSV/TSV/表としてそのまま貼れる結果を優先。変換ルールも短く添える。'
  },
  {
    id: 'support_copy',
    preferredAsk: 'gemini',
    preferredAgent: 'openai',
    taskType: 'summarize',
    systemHint:
      '用途: カスタマー／社内サポート文面。丁寧・明確・次アクション付きの完成文を出してください。'
  },
  {
    id: 'slides',
    preferredAsk: 'claude',
    preferredAgent: 'claude',
    taskType: 'design',
    systemHint:
      '用途: スライド構成。枚数・各スライドの見出しと箇条書き（短文）を提案してください。'
  },
  {
    id: 'meeting_notes',
    preferredAsk: 'gemini',
    preferredAgent: 'openai',
    taskType: 'summarize',
    systemHint:
      '用途: 議事録・メモ整理。決定事項・宿題・次回までにを分けて整理してください。'
  },
  {
    id: 'vision',
    preferredAsk: 'gemini',
    preferredAgent: 'openai',
    taskType: 'explain',
    systemHint: '用途: 画像理解。添付画像の内容を根拠に答えてください。'
  },
  {
    id: 'image_gen',
    preferredAsk: 'openai',
    preferredAgent: 'openai',
    taskType: 'image_gen',
    systemHint: '用途: 画像生成。プロンプトから画像を生成するレーンです。'
  },
  {
    id: 'video_understand',
    preferredAsk: 'gemini',
    preferredAgent: 'openai',
    taskType: 'explain',
    systemHint:
      '用途: 動画理解。添付のフレーム画像やタイムスタンプ付きメモを時系列で解釈し、要約・要点・次アクションを出してください。長尺動画ファイルの直接解析は未対応のため、重要なコマのスクショ添付を推奨します。'
  }
]

export function parseRouterCategoryId(raw: unknown): RouterCategoryId {
  const id = typeof raw === 'string' ? raw.trim() : ''
  return CATS.some((row) => row.id === id) ? (id as RouterCategoryId) : 'auto'
}

export function resolveCategoryPreference(
  categoryId: RouterCategoryId,
  mode: string
): { engine: 'openai' | 'gemini' | 'claude' | null; taskType: string | null; systemHint: string | null } {
  const cat = CATS.find((row) => row.id === categoryId) ?? CATS[0]
  if (cat.id === 'auto') return { engine: null, taskType: null, systemHint: null }
  const engine = mode === 'agent' ? cat.preferredAgent : cat.preferredAsk
  return { engine, taskType: cat.taskType, systemHint: cat.systemHint }
}

export function detectRouterCategoryId(
  message: string,
  hasImages = false
): RouterCategoryId {
  const text = message.toLowerCase()
  if (/画像を生成|イラストを|generate an image|draw me|dall.?e|イメージを作/.test(text)) {
    return 'image_gen'
  }
  if (/動画|video|フレーム|タイムスタンプ/.test(text) && hasImages) {
    return 'video_understand'
  }
  if (hasImages) return 'vision'
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

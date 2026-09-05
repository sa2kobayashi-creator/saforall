export type OpenFile = {
  path: string
  content: string
  language: string
  dirty: boolean
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
}

/** Ask: 都度確認 / Agent: コード・コマンドを自動適用・実行 */
export type ChatMode = 'ask' | 'agent'

export type AiEngine = 'auto' | 'cursor' | 'openai' | 'gemini' | 'workers'

export type ApplyCodeOptions = {
  /** true のとき確認ダイアログやパス入力を出さず自動適用 */
  auto?: boolean
  /**
   * true のとき書き込まず差分レビューキューへ入れる（Agent の複数ファイル向け）。
   * auto と併用する。
   */
  review?: boolean
  /** Agent edit_proposal: prefer full-file replace over patch/append heuristics */
  forceReplace?: boolean
}

export type EditorSelection = {
  path: string
  text: string
  startLine: number
  endLine: number
}

export type ChatContextFile = {
  path: string
  content: string
  language?: string
}

export type BackendStatus = {
  connected: boolean
  checking: boolean
  message: string
  baseUrl: string
}

export type WorkspaceRecord = {
  id: number
  path: string
  display_name: string | null
  last_opened_at: string
  created_at: string
}

export type ChatSessionRecord = {
  id: number
  workspace_id: number | null
  title: string
  created_at: string
  updated_at: string
}

export type ChatMessageRecord = {
  id: number
  session_id: number
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at: string
}

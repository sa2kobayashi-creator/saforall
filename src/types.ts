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

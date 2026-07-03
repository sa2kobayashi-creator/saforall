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

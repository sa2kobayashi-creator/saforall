import { join } from 'path'
import {
  ensureLocalDbReady,
  getLocalDbRoot,
  isoNow,
  nextLocalId,
  readJsonFile,
  writeJsonFile
} from './localDb'

export type LocalSession = {
  id: number
  workspace_id: number | null
  title: string
  created_at: string
  updated_at: string
}

export type LocalMessage = {
  id: number
  session_id: number
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at: string
}

type SessionsFile = { sessions: LocalSession[] }

function sessionsPath(): string {
  return join(getLocalDbRoot(), 'sessions.json')
}

function sessionCounterPath(): string {
  return join(getLocalDbRoot(), 'session-counter.json')
}

function messageCounterPath(): string {
  return join(getLocalDbRoot(), 'message-counter.json')
}

function messagesPath(sessionId: number): string {
  return join(getLocalDbRoot(), 'messages', `${sessionId}.json`)
}

async function loadSessions(): Promise<LocalSession[]> {
  await ensureLocalDbReady()
  const file = await readJsonFile<SessionsFile>(sessionsPath(), { sessions: [] })
  return file.sessions
}

async function saveSessions(sessions: LocalSession[]): Promise<void> {
  await writeJsonFile(sessionsPath(), { sessions })
}

export async function listSessions(options?: {
  workspaceId?: number | null
  limit?: number
}): Promise<LocalSession[]> {
  const limit = options?.limit ?? 40
  let rows = await loadSessions()
  if (options?.workspaceId != null && options.workspaceId > 0) {
    rows = rows.filter((row) => row.workspace_id === options.workspaceId)
  }
  rows = [...rows].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  return rows.slice(0, limit)
}

export async function createSession(params: {
  title?: string
  workspaceId?: number | null
}): Promise<LocalSession> {
  const sessions = await loadSessions()
  const now = isoNow()
  const row: LocalSession = {
    id: await nextLocalId(sessionCounterPath()),
    workspace_id: params.workspaceId && params.workspaceId > 0 ? params.workspaceId : null,
    title: params.title?.trim() || 'New chat',
    created_at: now,
    updated_at: now
  }
  sessions.unshift(row)
  await saveSessions(sessions)
  await writeJsonFile(messagesPath(row.id), { messages: [] as LocalMessage[] })
  return row
}

export async function deleteSession(sessionId: number): Promise<boolean> {
  const sessions = await loadSessions()
  const next = sessions.filter((row) => row.id !== sessionId)
  if (next.length === sessions.length) return false
  await saveSessions(next)
  await writeJsonFile(messagesPath(sessionId), { messages: [] })
  return true
}

export async function getSession(sessionId: number): Promise<LocalSession | null> {
  const sessions = await loadSessions()
  return sessions.find((row) => row.id === sessionId) ?? null
}

export async function listMessages(sessionId: number): Promise<LocalMessage[]> {
  await ensureLocalDbReady()
  const file = await readJsonFile<{ messages: LocalMessage[] }>(messagesPath(sessionId), {
    messages: []
  })
  return file.messages
}

export async function appendMessage(params: {
  sessionId: number
  role: 'user' | 'assistant' | 'system'
  content: string
}): Promise<LocalMessage> {
  const session = await getSession(params.sessionId)
  if (!session) throw new Error('session not found')

  const file = await readJsonFile<{ messages: LocalMessage[] }>(messagesPath(params.sessionId), {
    messages: []
  })
  const now = isoNow()
  const row: LocalMessage = {
    id: await nextLocalId(messageCounterPath()),
    session_id: params.sessionId,
    role: params.role,
    content: params.content,
    created_at: now
  }
  file.messages.push(row)
  await writeJsonFile(messagesPath(params.sessionId), file)

  const sessions = await loadSessions()
  const idx = sessions.findIndex((s) => s.id === params.sessionId)
  if (idx >= 0) {
    sessions[idx].updated_at = now
    if (
      params.role === 'user' &&
      (sessions[idx].title === 'New chat' || sessions[idx].title === '')
    ) {
      sessions[idx].title = params.content.trim().slice(0, 40) || 'New chat'
    }
    await saveSessions(sessions)
  }
  return row
}

/**
 * Cursor-style edit/regenerate pivot:
 * - keepThrough: update optional content and delete messages after messageId
 * - deleteFrom: delete messageId and everything after (caller inserts a fresh user turn)
 */
export async function truncateMessages(params: {
  sessionId: number
  messageId: number
  content?: string
  mode: 'keepThrough' | 'deleteFrom'
}): Promise<{ messages: LocalMessage[]; kept: LocalMessage | null }> {
  const session = await getSession(params.sessionId)
  if (!session) throw new Error('session not found')

  const file = await readJsonFile<{ messages: LocalMessage[] }>(messagesPath(params.sessionId), {
    messages: []
  })
  const index = file.messages.findIndex((row) => row.id === params.messageId)
  if (index < 0) throw new Error('message not found')

  let kept: LocalMessage | null = null

  if (params.mode === 'deleteFrom') {
    file.messages = file.messages.slice(0, index)
  } else {
    const target = file.messages[index]
    if (target.role !== 'user') {
      throw new Error('keepThrough requires a user message')
    }
    const nextContent =
      typeof params.content === 'string' ? params.content.trim() : String(target.content || '')
    if (!nextContent) throw new Error('content is required')
    kept = { ...target, content: nextContent }
    file.messages = [...file.messages.slice(0, index), kept]
  }

  await writeJsonFile(messagesPath(params.sessionId), file)

  const now = isoNow()
  const sessions = await loadSessions()
  const idx = sessions.findIndex((s) => s.id === params.sessionId)
  if (idx >= 0) {
    sessions[idx].updated_at = now
    if (kept && (sessions[idx].title === 'New chat' || sessions[idx].title === '')) {
      sessions[idx].title = kept.content.trim().slice(0, 40) || 'New chat'
    }
    await saveSessions(sessions)
  }

  return { messages: file.messages, kept }
}

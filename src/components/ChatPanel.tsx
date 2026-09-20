import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ConfirmDialog } from './ConfirmDialog'
import { MessageContent } from './MessageContent'
import { isShellLanguage, parseMessageParts } from '../lib/codeBlocks'
import { languageFromPath } from '../lib/language'
import { DEFAULT_COST_LIMITS, USAGE_ENGINE_KEYS, DEFAULT_ENABLED_MODELS, optionsForEngine, parseModelList, type ProviderEngine } from '../lib/llmModels'
import {
  DEFAULT_ENABLED_CATEGORIES,
  ROUTER_CATEGORIES,
  parseEnabledCategories,
  parseRouterCategory,
  type RouterCategoryId
} from '../lib/routerCategories'
import { fetchAppSettings } from '../lib/settingsCache'
import type {
  AiEngine,
  ApplyCodeOptions,
  ChatMessage,
  ChatMessageRecord,
  ChatMode,
  ChatSessionRecord,
  EditorSelection,
  OpenFile
} from '../types'
import type { ProblemItem } from './ProblemsPanel'
import {
  activeMentionQuery,
  extractCodebaseNeedles,
  fileMentionSuggestion,
  filterSpecialMentions,
  hasSpecialMention,
  parseMentionTokens,
  type MentionSuggestion
} from '../lib/chatMentions'
import {
  addAttachedPath,
  attachmentLabel,
  pathsFromDataTransfer,
  removeAttachedPath
} from '../lib/chatAttachments'
import {
  CHAT_IMAGE_MAX_COUNT,
  chatImageFromBlob,
  imageBlobsFromDataTransfer,
  isImageFileName,
  revokeImagePreviews,
  toImagePayloads,
  type ChatImageAttachment
} from '../lib/chatImages'
import { buildBackendOfflineMessage } from '../lib/backendGuide'
import { formatAiUserError } from '../lib/aiErrorGuide'
import { useI18n } from '../i18n'
import type { ModelApiStatus } from '../lib/modelApiStatus'
import './ChatPanel.css'

type Props = {
  file: OpenFile | null
  openFiles: OpenFile[]
  selection: EditorSelection | null
  problems?: ProblemItem[]
  backendConnected: boolean
  backendMode?: 'php' | 'local'
  modelApiStatus?: ModelApiStatus
  /** Bumped when Settings are saved so API key readiness refreshes. */
  settingsRevision?: number
  workspaceId: number | null
  workspacePath: string | null
  width: number
  pendingPrompt?: string | null
  onPendingPromptConsumed?: () => void
  onRecheckBackend?: () => void
  onOpenSettings?: () => void
  onApplyCode: (
    code: string,
    pathHint?: string,
    language?: string,
    options?: ApplyCodeOptions
  ) => void | Promise<void>
  /** Agent finished with Composer proposals that still need accept. */
  onAgentNeedsReview?: (info: { editCount: number; engine: string }) => void
}

const welcomeMessage: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content:
    '仕事に合った AI へ自動で切り替えます。Ask は適用前に確認、Agent は応答後に自動適用します。'
}

function toChatMessage(row: ChatMessageRecord): ChatMessage {
  return {
    id: String(row.id),
    role: row.role,
    content: row.content
  }
}

/** Hidden marker so shell progress updates replace one line instead of spamming the chat. */
const SHELL_PROGRESS_MARKER = '<!--saforall-shell-progress-->'

function upsertShellProgressLine(content: string, body: string): string {
  const line = `\n\n${SHELL_PROGRESS_MARKER}${body}`
  const re = new RegExp(
    `\\n\\n${SHELL_PROGRESS_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?(?=\\n\\n|$)`
  )
  if (re.test(content)) return content.replace(re, line)
  if (content.startsWith(SHELL_PROGRESS_MARKER)) {
    return content.replace(
      new RegExp(
        `^${SHELL_PROGRESS_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?(?=\\n\\n|$)`
      ),
      `${SHELL_PROGRESS_MARKER}${body}`
    )
  }
  return content + line
}

function stripProgressMarkersForDisplay(content: string): string {
  return content.replaceAll(SHELL_PROGRESS_MARKER, '')
}

const AGENT_PHASE_COPY: Record<string, { title: string; blurb: string }> = {
  plan: { title: '方針', blurb: 'これから何をするか整理しています' },
  explore: { title: '調査', blurb: '関連するコードを読んでいます' },
  edit: { title: '編集', blurb: '変更案を作成しています' },
  verify: { title: '確認', blurb: '変更が正しいかチェックしています' }
}

function loadMode(): ChatMode {
  const saved = window.localStorage.getItem('saforall-chat-mode')
  return saved === 'agent' ? 'agent' : 'ask'
}

function loadEngine(): AiEngine {
  const saved = window.localStorage.getItem('saforall-ai-engine')
  if (
    saved === 'cursor' ||
    saved === 'openai' ||
    saved === 'gemini' ||
    saved === 'claude' ||
    saved === 'workers' ||
    saved === 'auto'
  ) {
    return saved
  }
  return 'auto'
}

function loadRouterCategory(): RouterCategoryId {
  return parseRouterCategory(window.localStorage.getItem('saforall-router-category'))
}

function lastSessionStorageKey(workspaceId: number | null): string {
  return `saforall-last-session:${workspaceId ?? 'global'}`
}

function readLastSessionId(workspaceId: number | null): number | null {
  const raw = window.localStorage.getItem(lastSessionStorageKey(workspaceId))
  if (!raw) return null
  const id = Number(raw)
  return Number.isFinite(id) && id > 0 ? id : null
}

function writeLastSessionId(workspaceId: number | null, id: number | null): void {
  const key = lastSessionStorageKey(workspaceId)
  if (id === null) {
    window.localStorage.removeItem(key)
    return
  }
  window.localStorage.setItem(key, String(id))
}

function formatSessionTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) {
    return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })
}

export function ChatPanel({
  file,
  openFiles,
  selection,
  problems = [],
  backendConnected,
  backendMode,
  modelApiStatus = 'checking',
  settingsRevision = 0,
  workspaceId,
  workspacePath,
  width,
  pendingPrompt = null,
  onPendingPromptConsumed,
  onRecheckBackend,
  onOpenSettings,
  onApplyCode,
  onAgentNeedsReview
}: Props) {
  const { t } = useI18n()
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage])
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<{
    phase: 'thinking' | 'streaming' | 'applying'
    detail?: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<ChatMode>(loadMode)
  const [engine, setEngine] = useState<AiEngine>(loadEngine)
  const [routerCategory, setRouterCategory] = useState<RouterCategoryId>(loadRouterCategory)
  const [enabledCategories, setEnabledCategories] = useState<RouterCategoryId[]>([
    ...DEFAULT_ENABLED_CATEGORIES
  ])
  const [modelChoice, setModelChoice] = useState('auto-within-engine')
  const [enabledByEngine, setEnabledByEngine] = useState<Record<ProviderEngine, string[]>>({
    ...DEFAULT_ENABLED_MODELS
  })
  const [localLlmReady, setLocalLlmReady] = useState(false)
  const [routeLabel, setRouteLabel] = useState<string | null>(null)
  const [usageText, setUsageText] = useState<string | null>(null)
  const [cursorRuntime, setCursorRuntime] = useState<'auto' | 'local' | 'cloud'>('auto')
  const [autoAppliedIds, setAutoAppliedIds] = useState<Record<string, boolean>>({})
  const [attachedPaths, setAttachedPaths] = useState<string[]>([])
  const [attachedImages, setAttachedImages] = useState<ChatImageAttachment[]>([])
  const attachedImagesRef = useRef(attachedImages)
  attachedImagesRef.current = attachedImages
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [attachDropActive, setAttachDropActive] = useState(false)
  const [attachPickerOpen, setAttachPickerOpen] = useState(false)
  const [attachQuery, setAttachQuery] = useState('')
  const [attachResults, setAttachResults] = useState<Array<{ path: string; label: string }>>([])
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionItems, setMentionItems] = useState<MentionSuggestion[]>([])
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionRange, setMentionRange] = useState<{ start: number; end: number } | null>(
    null
  )
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [pendingAction, setPendingAction] = useState<{
    code: string
    pathHint?: string
    language?: string
    kind: 'run'
  } | null>(null)
  const [sessions, setSessions] = useState<ChatSessionRecord[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(() => {
    try {
      return window.localStorage.getItem('saforall-chat-banner-dismissed') === '1'
    } catch {
      return false
    }
  })
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)

  const modeRef = useRef(mode)
  modeRef.current = mode
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId
  const prevChatWidthRef = useRef(width)
  const streamRequestIdRef = useRef<string | null>(null)
  const stopRequestedRef = useRef(false)
  const stopForceTimerRef = useRef<number | null>(null)
  /** Guards setBusy(null) so a stuck previous stream cannot unlock/steal a newer turn. */
  const submitGenerationRef = useRef(0)
  const inputRef = useRef(input)
  inputRef.current = input
  const lastSubmittedTextRef = useRef('')

  // 幅を狭めたタイミングだけ履歴を自動で畳む
  useEffect(() => {
    if (width < 340 && prevChatWidthRef.current >= 340) {
      setHistoryOpen(false)
    }
    prevChatWidthRef.current = width
  }, [width])

  useEffect(() => {
    try {
      window.localStorage.setItem(
        'saforall-chat-banner-dismissed',
        bannerDismissed ? '1' : '0'
      )
    } catch {
      // ignore
    }
  }, [bannerDismissed])

  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      if (typeof window.saforall.hasLocalLlm !== 'function') {
        if (!cancelled) setLocalLlmReady(false)
        return
      }
      try {
        const ok = await window.saforall.hasLocalLlm()
        if (!cancelled) setLocalLlmReady(ok)
      } catch {
        if (!cancelled) setLocalLlmReady(false)
      }
    }
    void refresh()
    return () => {
      cancelled = true
    }
  }, [backendConnected, settingsRevision])

  const isLocalMode = backendMode === 'local'
  const needsApiKeySetup = isLocalMode && !localLlmReady
  const chatReady = isLocalMode
    ? localLlmReady
    : backendConnected || localLlmReady

  const activeSession = useMemo(
    () => sessions.find((row) => Number(row.id) === sessionId) ?? null,
    [sessions, sessionId]
  )

  useEffect(() => {
    if (!backendConnected) return

    let cancelled = false
    ;(async () => {
      const [usageResult, settings] = await Promise.all([
        window.saforall.request<{
          month: string
          usage: Record<string, { spent: number; limit: number; remaining: number }>
        }>('GET', '/ai/usage'),
        // Shared with App's locale read so startup issues one /settings request.
        fetchAppSettings()
      ])
      if (cancelled) return

      if (usageResult.ok && usageResult.data?.usage) {
        const parts = USAGE_ENGINE_KEYS.map((key) => {
          const row = usageResult.data!.usage[key]
          const spent = row?.spent ?? 0
          const limit = row?.limit ?? DEFAULT_COST_LIMITS[key]
          return `${key} $${spent.toFixed(2)}/$${limit}`
        })
        setUsageText(parts.join(' · '))
      }

      if (settings) {
        setEnabledByEngine({
          openai: parseModelList(settings['llm.openai.models'], DEFAULT_ENABLED_MODELS.openai),
          gemini: parseModelList(settings['llm.gemini.models'], DEFAULT_ENABLED_MODELS.gemini),
          claude: parseModelList(settings['llm.claude.models'], DEFAULT_ENABLED_MODELS.claude),
          workers: parseModelList(
            settings['llm.workers.models'] ?? settings['llm.simple.models'],
            DEFAULT_ENABLED_MODELS.workers
          ),
          cursor: parseModelList(settings['llm.cursor.models'], DEFAULT_ENABLED_MODELS.cursor)
        })
        setEnabledCategories(
          parseEnabledCategories(settings['router.enabled_categories'] ?? DEFAULT_ENABLED_CATEGORIES)
        )
        {
          const runtime = settings['llm.cursor.runtime']
          if (runtime === 'local' || runtime === 'cloud' || runtime === 'auto') {
            setCursorRuntime(runtime)
          }
        }
      }
    })()

    return () => {
      cancelled = true
    }
    // settingsRevision: Settings 保存後に cursor runtime などを再読込する
  }, [backendConnected, settingsRevision])

  const changeEngine = (next: AiEngine) => {
    setEngine(next)
    window.localStorage.setItem('saforall-ai-engine', next)
    setModelChoice('auto-within-engine')
  }

  const mentionTokens = useMemo(() => parseMentionTokens(input), [input])
  const mentionFlags = useMemo(
    () => ({
      selection: hasSpecialMention(mentionTokens, 'selection'),
      problems: hasSpecialMention(mentionTokens, 'problems'),
      rules: hasSpecialMention(mentionTokens, 'rules'),
      skills: hasSpecialMention(mentionTokens, 'skills'),
      codebase: hasSpecialMention(mentionTokens, 'codebase')
    }),
    [mentionTokens]
  )

  const contextLabel = useMemo(() => {
    const bits: string[] = []
    if (selection?.text) {
      const name = selection.path.split(/[/\\]/).pop() ?? selection.path
      bits.push(
        `選択 ${name}:${selection.startLine}${selection.endLine !== selection.startLine ? `-${selection.endLine}` : ''}`
      )
    } else if (file) {
      bits.push(file.path.split(/[/\\]/).pop() ?? file.path)
    }
    if (attachedImages.length > 0) {
      bits.push(`+${attachedImages.length} 画像`)
    }
    if (attachedPaths.length > 0) {
      bits.push(`+${attachedPaths.length} ファイル`)
    }
    if (mentionFlags.selection) bits.push('@selection')
    if (mentionFlags.problems) bits.push('@problems')
    if (mentionFlags.rules) bits.push('@rules')
    if (mentionFlags.skills) bits.push('@skills')
    if (mentionFlags.codebase) bits.push('@codebase')
    else if (mode === 'ask' || mode === 'agent') bits.push(`${mode === 'agent' ? 'Agent' : 'Ask'}: 自動検索あり`)
    return bits.length > 0 ? bits.join(' · ') : 'コンテキストなし'
  }, [file, selection, attachedImages, attachedPaths, mentionFlags, mode])

  const toggleAttached = useCallback((path: string) => {
    setAttachedPaths((current) =>
      current.includes(path) ? removeAttachedPath(current, path) : addAttachedPath(current, path)
    )
  }, [])

  useEffect(() => {
    return () => revokeImagePreviews(attachedImagesRef.current)
  }, [])

  const addImagesFromBlobs = useCallback(
    async (items: Array<{ blob: Blob; name: string }>) => {
      if (items.length === 0) return
      const next: ChatImageAttachment[] = []
      for (const item of items) {
        try {
          next.push(await chatImageFromBlob(item.blob, item.name))
        } catch (error) {
          setError(error instanceof Error ? error.message : String(error))
        }
      }
      if (next.length === 0) return
      setAttachedImages((current) => {
        const merged = [...current, ...next]
        if (merged.length <= CHAT_IMAGE_MAX_COUNT) return merged
        const keep = merged.slice(-CHAT_IMAGE_MAX_COUNT)
        revokeImagePreviews(merged.slice(0, merged.length - keep.length))
        return keep
      })
    },
    []
  )

  const addImagesFromPaths = useCallback(async (paths: string[]) => {
    const imagePaths = paths.filter((path) => isImageFileName(path))
    if (imagePaths.length === 0) return
    if (typeof window.saforall.readFileBase64 !== 'function') {
      setError('このビルドでは画像ファイルの読み込みに未対応です')
      return
    }
    const next: ChatImageAttachment[] = []
    for (const path of imagePaths) {
      try {
        const row = await window.saforall.readFileBase64(path)
        const binary = atob(row.data_base64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        const blob = new Blob([bytes], { type: row.mime })
        next.push(await chatImageFromBlob(blob, row.name || attachmentLabel(path)))
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error))
      }
    }
    if (next.length === 0) return
    setAttachedImages((current) => {
      const merged = [...current, ...next]
      if (merged.length <= CHAT_IMAGE_MAX_COUNT) return merged
      const keep = merged.slice(-CHAT_IMAGE_MAX_COUNT)
      revokeImagePreviews(merged.slice(0, merged.length - keep.length))
      return keep
    })
  }, [])

  const removeAttachedImage = useCallback((id: string) => {
    setAttachedImages((current) => {
      const target = current.find((row) => row.id === id)
      if (target) revokeImagePreviews([target])
      return current.filter((row) => row.id !== id)
    })
  }, [])

  const attachPaths = useCallback((paths: string[]) => {
    if (paths.length === 0) return
    const files = paths.filter((path) => !isImageFileName(path))
    const images = paths.filter((path) => isImageFileName(path))
    if (files.length > 0) {
      setAttachedPaths((current) => {
        let next = current
        for (const path of files) next = addAttachedPath(next, path)
        return next
      })
    }
    if (images.length > 0) void addImagesFromPaths(images)
  }, [addImagesFromPaths])

  const openAttachPicker = useCallback(() => {
    setAttachPickerOpen(true)
    setAttachQuery('')
    setAttachResults(
      openFiles.slice(0, 12).map((row) => ({
        path: row.path,
        label: attachmentLabel(row.path)
      }))
    )
  }, [openFiles])

  useEffect(() => {
    if (!attachPickerOpen || !workspacePath) return
    const q = attachQuery.trim()
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        if (q.length === 0) {
          if (!cancelled) {
            setAttachResults(
              openFiles.slice(0, 12).map((row) => ({
                path: row.path,
                label: attachmentLabel(row.path)
              }))
            )
          }
          return
        }
        if (typeof window.saforall.searchFiles !== 'function') return
        try {
          const hits = await window.saforall.searchFiles(workspacePath, q)
          if (cancelled) return
          setAttachResults(
            (hits ?? []).slice(0, 12).map((rel) => {
              const abs =
                rel.includes(':') || rel.startsWith('/') || rel.startsWith('\\')
                  ? rel
                  : `${workspacePath.replace(/[/\\]+$/, '')}${
                      workspacePath.includes('\\') ? '\\' : '/'
                    }${String(rel).replace(/^[\\/]+/, '')}`
              return { path: abs, label: attachmentLabel(abs) }
            })
          )
        } catch {
          if (!cancelled) setAttachResults([])
        }
      })()
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [attachPickerOpen, attachQuery, openFiles, workspacePath])

  const buildContextPayload = useCallback(async () => {
    const tokens = parseMentionTokens(input)
    const wantSelection = hasSpecialMention(tokens, 'selection')
    const wantProblems = hasSpecialMention(tokens, 'problems')
    const wantRules = hasSpecialMention(tokens, 'rules')
    const wantSkills = hasSpecialMention(tokens, 'skills')
    const wantCodebase = hasSpecialMention(tokens, 'codebase')
    // Ask: @codebase なしでもキーワードがあれば軽量検索（Agent は search_code があるので省略して TTFT 改善）
    const autoNeedles = extractCodebaseNeedles(input)
    const autoCodebase = !wantCodebase && mode === 'ask' && autoNeedles.length > 0

    let indexSummary: string | null = null
    if (
      (wantCodebase || autoCodebase) &&
      workspacePath &&
      typeof window.saforall.ensureIndex === 'function'
    ) {
      try {
        if (autoCodebase && !wantCodebase) {
          setBusy((prev) =>
            prev ? { ...prev, detail: 'リポジトリを軽量検索中…' } : prev
          )
        } else if (wantCodebase) {
          setBusy((prev) =>
            prev ? { ...prev, detail: 'codebase 索引を準備中…' } : prev
          )
        }
        const summary = await window.saforall.ensureIndex(workspacePath)
        const needles = wantCodebase ? extractCodebaseNeedles(input) : autoNeedles
        const hitBlocks: string[] = []
        const needleLimit = wantCodebase ? 4 : 2
        const lineLimit = wantCodebase ? 12 : 8
        const summaryLimit = wantCodebase ? 6000 : 3500
        if (typeof window.saforall.searchCode === 'function') {
          const anchors: string[] = []
          const root = workspacePath.replace(/\\/g, '/').replace(/\/$/, '')
          const toRel = (abs: string): string | null => {
            const unified = abs.replace(/\\/g, '/')
            if (unified.startsWith(root + '/')) return unified.slice(root.length + 1)
            return null
          }
          // Primary: selection path, then active file, then other open tabs
          if (selection?.path) {
            const rel = toRel(selection.path)
            if (rel) anchors.push(rel)
          }
          if (file?.path) {
            const rel = toRel(file.path)
            if (rel && !anchors.includes(rel)) anchors.push(rel)
          }
          for (const tab of openFiles.slice(0, 8)) {
            const rel = toRel(tab.path)
            if (rel && !anchors.includes(rel)) anchors.push(rel)
          }
          const needleHits = await Promise.all(
            needles.slice(0, needleLimit).map(async (needle) => {
              try {
                const hits = await window.saforall.searchCode(
                  workspacePath,
                  needle,
                  anchors,
                  'chat_codebase'
                )
                if (hits && hits !== '一致なし') {
                  return `## ${needle}\n${hits.split('\n').slice(0, lineLimit).join('\n')}`
                }
              } catch {
                // ignore
              }
              return null
            })
          )
          for (const block of needleHits) {
            if (block) hitBlocks.push(block)
          }
        }
        if (summary.ok) {
          const header = wantCodebase
            ? `codebase index: files=${summary.files ?? 0}, symbols=${summary.symbols ?? 0}`
            : `auto codebase (${mode}): files=${summary.files ?? 0}, symbols=${summary.symbols ?? 0}`
          indexSummary = [
            header,
            hitBlocks.length > 0 ? hitBlocks.join('\n\n').slice(0, summaryLimit) : null
          ]
            .filter(Boolean)
            .join('\n\n')
        }
      } catch {
        indexSummary = null
      }
    }

    const mentioned = new Set<string>()
    for (const token of tokens) {
      const lower = token.toLowerCase()
      if (
        lower === 'selection' ||
        lower === 'problems' ||
        lower === 'rules' ||
        lower === 'skills' ||
        lower === 'codebase'
      )
        continue
      for (const open of openFiles) {
        const base = (open.path.split(/[/\\]/).pop() ?? open.path).toLowerCase()
        if (base === lower || open.path.toLowerCase().endsWith(lower)) {
          mentioned.add(open.path)
        }
      }
      if (workspacePath && typeof window.saforall.searchFiles === 'function') {
        try {
          const found = await window.saforall.searchFiles(workspacePath, token)
          for (const rel of found.slice(0, 5)) {
            const abs =
              rel.includes(':') || rel.startsWith('/') || rel.startsWith('\\')
                ? rel
                : `${workspacePath.replace(/[\\/]+$/, '')}${
                    workspacePath.includes('\\') ? '\\' : '/'
                  }${rel.replace(/^[\\/]+/, '')}`
            mentioned.add(abs)
          }
        } catch {
          // ignore search failures
        }
      }
    }

    const filePaths = new Set<string>([...attachedPaths, ...Array.from(mentioned)])
    if (file?.path) filePaths.delete(file.path)

    // Agent: 開いている他タブを1本だけ自動添付（過多・遅延を避けつつ周辺コンテキストを残す）
    if (mode === 'agent') {
      let softCount = 0
      for (const open of openFiles) {
        if (softCount >= 1) break
        if (file?.path && open.path === file.path) continue
        if (filePaths.has(open.path)) continue
        if (open.content.length > 8_000) continue
        filePaths.add(open.path)
        softCount += 1
      }
    }

    const files: Array<{ path: string; content: string; language?: string }> = []
    for (const open of openFiles) {
      if (!filePaths.has(open.path)) continue
      files.push({
        path: open.path,
        content: open.content,
        language: open.language
      })
      filePaths.delete(open.path)
    }
    for (const path of Array.from(filePaths)) {
      try {
        const content = await window.saforall.readFile(path)
        files.push({
          path,
          content,
          language: languageFromPath(path)
        })
      } catch {
        // skip unreadable
      }
    }

    const selectionPayload =
      selection && selection.text.trim() !== ''
        ? {
            path: selection.path,
            text: selection.text,
            start_line: selection.startLine,
            end_line: selection.endLine
          }
        : null

    // Rules: 明示 @rules のときだけ（Agent は toolAgent 側でも読む）
    let rules: string | null = null
    if (
      wantRules &&
      workspacePath &&
      typeof window.saforall.loadProjectRules === 'function'
    ) {
      try {
        rules = await window.saforall.loadProjectRules(workspacePath)
      } catch {
        rules = null
      }
    }

    // Skills catalog: 明示 @skills（Agent は toolAgent + read_skill）
    let skills: string | null = null
    if (
      wantSkills &&
      workspacePath &&
      typeof window.saforall.skillsCatalog === 'function'
    ) {
      try {
        skills = await window.saforall.skillsCatalog(workspacePath)
      } catch {
        skills = null
      }
    }

    const problemLimit = wantProblems ? 40 : 20
    const activeProblemPaths = [selection?.path, file?.path]
      .filter((row): row is string => typeof row === 'string' && row.trim() !== '')
      .map((row) => row.replace(/\\/g, '/'))
    const rankedProblems = [...problems].sort((a, b) => {
      const score = (row: (typeof problems)[number]) => {
        const path = (row.path || '').replace(/\\/g, '/')
        if (!path) return 0
        for (let i = 0; i < activeProblemPaths.length; i += 1) {
          const pref = activeProblemPaths[i]
          const base = pref.split('/').pop() ?? pref
          if (path === pref || path.endsWith('/' + pref) || path.endsWith('/' + base)) {
            return 100 - i + (row.severity === 'error' ? 5 : 0)
          }
        }
        return row.severity === 'error' ? 1 : 0
      }
      return score(b) - score(a)
    })
    const problemLines = rankedProblems.slice(0, problemLimit).map((row) => {
      const loc = row.path
        ? `${row.path}${row.line ? `:${row.line}` : ''}`
        : 'unknown'
      return `${row.severity}: ${loc} ${row.message}`
    })

    const imagePayloads = toImagePayloads(attachedImages)

    if (
      !file &&
      files.length === 0 &&
      imagePayloads.length === 0 &&
      !selectionPayload &&
      !rules &&
      !skills &&
      problemLines.length === 0 &&
      !wantSelection &&
      !wantProblems &&
      !wantRules &&
      !wantSkills &&
      !wantCodebase &&
      !indexSummary
    ) {
      return null
    }

    return {
      path: file?.path ?? null,
      content: file?.content ?? null,
      language: file?.language ?? null,
      selection: selectionPayload,
      files,
      images: imagePayloads,
      rules,
      skills,
      problems: problemLines,
      mention_flags: {
        selection: wantSelection || (mode === 'agent' && Boolean(selectionPayload)),
        problems: wantProblems || (mode === 'agent' && problemLines.length > 0),
        rules: wantRules,
        skills: wantSkills,
        codebase: wantCodebase || Boolean(indexSummary && autoCodebase)
      },
      index_summary: indexSummary
    }
  }, [
    attachedImages,
    attachedPaths,
    file,
    input,
    mode,
    openFiles,
    problems,
    selection,
    workspacePath
  ])

  const refreshMentionSuggestions = useCallback(
    async (value: string, cursor: number) => {
      const active = activeMentionQuery(value, cursor)
      if (!active) {
        setMentionOpen(false)
        setMentionItems([])
        setMentionRange(null)
        return
      }

      const items: MentionSuggestion[] = [...filterSpecialMentions(active.query)]
      const q = active.query.toLowerCase()
      for (const open of openFiles) {
        const name = (open.path.split(/[/\\]/).pop() ?? open.path).toLowerCase()
        if (!q || name.includes(q) || open.path.toLowerCase().includes(q)) {
          items.push(fileMentionSuggestion(open.path))
        }
      }

      if (workspacePath && typeof window.saforall.searchSymbols === 'function' && q.length >= 1) {
        try {
          const symbols = await window.saforall.searchSymbols(workspacePath, active.query)
          for (const sym of symbols.slice(0, 8)) {
            items.push({
              id: `symbol:${sym.path}:${sym.name}:${sym.line}`,
              label: `@${sym.name}`,
              insert: `@${sym.name}`,
              detail: `${sym.kind} · ${sym.path}:${sym.line}`,
              kind: 'file'
            })
            const abs =
              sym.path.includes(':') || sym.path.startsWith('/') || sym.path.startsWith('\\')
                ? sym.path
                : `${workspacePath.replace(/[\\/]+$/, '')}${
                    workspacePath.includes('\\') ? '\\' : '/'
                  }${sym.path.replace(/^[\\/]+/, '')}`
            if (!items.some((row) => row.id === `file:${abs}`)) {
              items.push(fileMentionSuggestion(abs))
            }
          }
        } catch {
          // ignore
        }
      }

      if (workspacePath && typeof window.saforall.searchFiles === 'function' && q.length >= 1) {
        try {
          const found = await window.saforall.searchFiles(workspacePath, active.query)
          for (const rel of found.slice(0, 8)) {
            const abs =
              rel.includes(':') || rel.startsWith('/') || rel.startsWith('\\')
                ? rel
                : `${workspacePath.replace(/[\\/]+$/, '')}${
                    workspacePath.includes('\\') ? '\\' : '/'
                  }${rel.replace(/^[\\/]+/, '')}`
            if (!items.some((row) => row.id === `file:${abs}`)) {
              items.push(fileMentionSuggestion(abs))
            }
          }
        } catch {
          // ignore
        }
      }

      const unique = items.slice(0, 12)
      setMentionItems(unique)
      setMentionIndex(0)
      setMentionRange({ start: active.start, end: cursor })
      setMentionOpen(unique.length > 0)
    },
    [openFiles, workspacePath]
  )

  const applyMention = useCallback(
    (item: MentionSuggestion) => {
      const el = textareaRef.current
      if (!el || !mentionRange) {
        setMentionOpen(false)
        return
      }
      const before = input.slice(0, mentionRange.start)
      const after = input.slice(mentionRange.end)
      const next = `${before}${item.insert} ${after}`
      setInput(next)
      if (item.kind === 'file' && item.detail) {
        setAttachedPaths((current) =>
          current.includes(item.detail!) ? current : [...current, item.detail!]
        )
      }
      setMentionOpen(false)
      setMentionItems([])
      setMentionRange(null)
      window.setTimeout(() => {
        const pos = before.length + item.insert.length + 1
        el.focus()
        el.setSelectionRange(pos, pos)
      }, 0)
    },
    [input, mentionRange]
  )

  const changeMode = (next: ChatMode) => {
    setMode(next)
    window.localStorage.setItem('saforall-chat-mode', next)
  }

  const runAgentActions = useCallback(
    async (messageId: string, content: string) => {
      if (modeRef.current !== 'agent') return

      const parts = parseMessageParts(content).filter((part) => part.type === 'code')
      if (parts.length === 0) return

      setBusy({
        phase: 'applying',
        detail: `変更候補を準備（0/${parts.length}）`
      })

      let count = 0
      for (const part of parts) {
        count += 1
        const label = isShellLanguage(part.language)
          ? `コマンド実行中（${count}/${parts.length}）`
          : part.pathHint
            ? `候補追加（${count}/${parts.length}）: ${part.pathHint}`
            : `候補追加（${count}/${parts.length}）`
        setBusy({ phase: 'applying', detail: label })
        if (isShellLanguage(part.language)) {
          await onApplyCode(part.code, part.pathHint, part.language, { auto: true })
        } else {
          await onApplyCode(part.code, part.pathHint, part.language, {
            auto: true,
            review: true
          })
        }
        await new Promise((resolve) => window.setTimeout(resolve, 200))
      }

      setAutoAppliedIds((current) => ({ ...current, [messageId]: true }))
      setBusy({
        phase: 'applying',
        detail: `変更候補をキューに追加（${parts.length}件）。差分を確認して適用してください。`
      })
    },
    [onApplyCode]
  )

  const requestApply = useCallback(
    (code: string, pathHint?: string, language?: string) => {
      if (isShellLanguage(language)) {
        if (modeRef.current === 'agent') {
          void onApplyCode(code, pathHint, language, { auto: true })
          return
        }
        setPendingAction({
          code,
          pathHint,
          language,
          kind: 'run'
        })
        return
      }

      // コード適用は差分ダイアログで確認（Ask / 手動適用）
      if (modeRef.current === 'agent') {
        void onApplyCode(code, pathHint, language, { auto: true, review: true })
        return
      }
      void onApplyCode(code, pathHint, language)
    },
    [onApplyCode]
  )

  const sessionsQuery = useCallback(() => {
    return workspaceId
      ? `/chat/sessions?workspace_id=${workspaceId}&limit=40`
      : '/chat/sessions?limit=40'
  }, [workspaceId])

  const refreshSessions = useCallback(async (): Promise<ChatSessionRecord[]> => {
    if (!backendConnected) {
      setSessions([])
      return []
    }
    const list = await window.saforall.request<{ sessions: ChatSessionRecord[] }>(
      'GET',
      sessionsQuery()
    )
    if (!list.ok || !list.data?.sessions) {
      return []
    }
    setSessions(list.data.sessions)
    return list.data.sessions
  }, [backendConnected, sessionsQuery])

  const loadMessagesForSession = useCallback(async (id: number) => {
    const history = await window.saforall.request<{ messages: ChatMessageRecord[] }>(
      'GET',
      `/chat/sessions/${id}/messages`
    )
    if (history.ok && history.data?.messages && history.data.messages.length > 0) {
      setMessages(history.data.messages.map(toChatMessage))
    } else {
      setMessages([welcomeMessage])
    }
    setAutoAppliedIds({})
  }, [])

  const selectSession = useCallback(
    async (id: number) => {
      if (busy) return
      setLoading(true)
      setError(null)
      try {
        setSessionId(id)
        writeLastSessionId(workspaceId, id)
        await loadMessagesForSession(id)
      } catch (err) {
        setError(String(err))
      } finally {
        setLoading(false)
      }
    },
    [busy, loadMessagesForSession, workspaceId]
  )

  const createSession = useCallback(async (): Promise<number | null> => {
    const created = await window.saforall.request<{ session: ChatSessionRecord }>(
      'POST',
      '/chat/sessions',
      {
        title: 'New chat',
        workspace_id: workspaceId
      }
    )
    if (!created.ok || !created.data?.session) {
      setError(created.error?.message ?? 'セッション作成に失敗しました')
      return null
    }
    const id = Number(created.data.session.id)
    setSessions((current) => [created.data!.session, ...current.filter((row) => Number(row.id) !== id)])
    return id
  }, [workspaceId])

  const startNewChat = useCallback(async () => {
    if (!backendConnected || busy) return
    setLoading(true)
    setError(null)
    try {
      const id = await createSession()
      if (id === null) return
      setSessionId(id)
      writeLastSessionId(workspaceId, id)
      setMessages([welcomeMessage])
      setAutoAppliedIds({})
      setInput('')
    } finally {
      setLoading(false)
    }
  }, [backendConnected, busy, createSession, workspaceId])

  const deleteSession = useCallback(
    async (id: number) => {
      if (!backendConnected || busy) return
      setPendingDeleteId(null)
      setLoading(true)
      setError(null)
      try {
        const result = await window.saforall.request('DELETE', `/chat/sessions/${id}`)
        if (!result.ok) {
          setError(result.error?.message ?? 'チャットの削除に失敗しました')
          return
        }

        const remaining = sessions.filter((row) => Number(row.id) !== id)
        setSessions(remaining)

        if (sessionIdRef.current === id) {
          if (remaining[0]) {
            const nextId = Number(remaining[0].id)
            setSessionId(nextId)
            writeLastSessionId(workspaceId, nextId)
            await loadMessagesForSession(nextId)
          } else {
            const createdId = await createSession()
            if (createdId === null) {
              setSessionId(null)
              writeLastSessionId(workspaceId, null)
              setMessages([welcomeMessage])
              return
            }
            setSessionId(createdId)
            writeLastSessionId(workspaceId, createdId)
            setMessages([welcomeMessage])
            setAutoAppliedIds({})
          }
        }
      } catch (err) {
        setError(String(err))
      } finally {
        setLoading(false)
      }
    },
    [backendConnected, busy, createSession, loadMessagesForSession, sessions, workspaceId]
  )

  const ensureSession = useCallback(async (): Promise<number | null> => {
    if (!backendConnected) return null
    if (sessionId !== null) {
      const known = sessions.some((row) => Number(row.id) === sessionId)
      if (known) return sessionId
      // Stale id (deleted / PHP↔local switch) — probe then recreate.
      try {
        const probe = await window.saforall.request<{ messages: ChatMessageRecord[] }>(
          'GET',
          `/chat/sessions/${sessionId}/messages`
        )
        if (probe.ok) return sessionId
      } catch {
        // recreate below
      }
    }

    const id = await createSession()
    if (id === null) return null
    setSessionId(id)
    writeLastSessionId(workspaceId, id)
    return id
  }, [backendConnected, createSession, sessionId, sessions, workspaceId])

  useEffect(() => {
    if (!backendConnected) {
      setSessionId(null)
      setSessions([])
      setMessages([welcomeMessage])
      setError(null)
      return
    }

    let cancelled = false

    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const list = await window.saforall.request<{ sessions: ChatSessionRecord[] }>(
          'GET',
          sessionsQuery()
        )
        if (cancelled) return

        let rows = list.ok && list.data?.sessions ? list.data.sessions : []
        setSessions(rows)

        const remembered = readLastSessionId(workspaceId)
        let activeSessionId =
          remembered !== null && rows.some((row) => Number(row.id) === remembered)
            ? remembered
            : rows[0]
              ? Number(rows[0].id)
              : null

        if (activeSessionId === null) {
          const created = await window.saforall.request<{ session: ChatSessionRecord }>(
            'POST',
            '/chat/sessions',
            {
              title: 'New chat',
              workspace_id: workspaceId
            }
          )
          if (cancelled) return
          if (created.ok && created.data?.session) {
            activeSessionId = Number(created.data.session.id)
            rows = [created.data.session]
            setSessions(rows)
          }
        }

        if (activeSessionId === null) {
          setError('セッションを準備できませんでした')
          return
        }

        setSessionId(activeSessionId)
        writeLastSessionId(workspaceId, activeSessionId)
        await loadMessagesForSession(activeSessionId)
      } catch (err) {
        if (!cancelled) setError(String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [backendConnected, loadMessagesForSession, sessionsQuery, workspaceId])

  useEffect(() => {
    if (!pendingPrompt) return
    const text = pendingPrompt
    onPendingPromptConsumed?.()
    if (/Bugbot|Background Agent/.test(text)) {
      changeMode('agent')
    }
    setInput(text)
  }, [pendingPrompt, onPendingPromptConsumed])

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    await submitChat({
      text: input.trim(),
      hasImages: attachedImages.length > 0
    })
  }

  const submitChat = async (options: {
    text: string
    hasImages?: boolean
    /** Reuse a persisted user row (edit / regenerate). */
    userMessageId?: number
    /** Local bubble id to keep instead of creating a new optimistic user row. */
    reuseLocalId?: string
    clearComposer?: boolean
  }) => {
    const text = options.text.trim()
    const hasImages = Boolean(options.hasImages)
    const reuseLocalId = options.reuseLocalId
    const userMessageId =
      typeof options.userMessageId === 'number' && options.userMessageId > 0
        ? options.userMessageId
        : undefined
    if ((!text && !hasImages) || busy || loading) return

    if (!backendConnected && !localLlmReady) {
      setError(buildBackendOfflineMessage())
      return
    }

    setBusy({ phase: 'thinking', detail: backendConnected ? 'AI に問い合わせ中…' : 'Model API に問い合わせ中…' })
    setError(null)
    const submitGeneration = ++submitGenerationRef.current
    lastSubmittedTextRef.current = text
    if (options.clearComposer !== false && !reuseLocalId) {
      setInput('')
    }
    setAttachPickerOpen(false)
    setEditingMessageId(null)
    setEditDraft('')
    stopRequestedRef.current = false
    if (stopForceTimerRef.current != null) {
      window.clearTimeout(stopForceTimerRef.current)
      stopForceTimerRef.current = null
    }

    const streamRequestId = crypto.randomUUID()
    streamRequestIdRef.current = streamRequestId
    if (typeof window.saforall.beginChatStream === 'function') {
      void window.saforall.beginChatStream(streamRequestId)
    }

    const localUser: ChatMessage = {
      id: reuseLocalId || crypto.randomUUID(),
      role: 'user',
      content: text || (hasImages ? `（画像 ${attachedImages.length} 枚）` : '')
    }
    if (!reuseLocalId) {
      setMessages((prev) => [...prev.filter((m) => m.id !== 'welcome'), localUser])
    } else {
      setMessages((prev) =>
        prev.map((message) =>
          message.id === reuseLocalId ? { ...message, content: localUser.content } : message
        )
      )
    }

    try {
      const ensureAssistantNote = (content: string): void => {
        const body = content.trim() || '（応答を取得できませんでした）'
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          if (
            last?.role === 'assistant' &&
            (last.content === body ||
              last.content.includes(body) ||
              (/^（/.test(last.content) && /^（/.test(body)) ||
              (last.content.startsWith('エラー:') && body.startsWith('エラー:')))
          ) {
            return prev
          }
          return [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: body
            }
          ]
        })
      }

      if (stopRequestedRef.current) {
        ensureAssistantNote('（応答を取り消しました）')
        return
      }

      let id: number | null = null
      if (backendConnected) {
        id = await ensureSession()
        if (id === null) {
          ensureAssistantNote(
            `エラー: ${'セッションを準備できませんでした。履歴の再読み込み後に再送してください。'}`
          )
          return
        }
      } else {
        id = -1
      }

      if (stopRequestedRef.current) {
        ensureAssistantNote('（応答を取り消しました）')
        return
      }

      const payload: Record<string, unknown> = {
        session_id: id,
        message: text || (hasImages ? '添付画像を確認して、必要な修正を提案してください。' : ''),
        engine,
        mode,
        model:
          engine === 'auto' || modelChoice === 'auto-within-engine'
            ? undefined
            : modelChoice,
        workspace_path: workspacePath,
        workspace_id: workspaceId,
        cursor_runtime: cursorRuntime,
        context: await buildContextPayload()
      }
      if (engine === 'auto') {
        payload.router_category = routerCategory
      }
      if (userMessageId) {
        payload.user_message_id = userMessageId
      }
      // Clear after the payload snapshot so a failed ensureSession keeps the chips.
      if (!reuseLocalId) {
        setAttachedPaths([])
        revokeImagePreviews(attachedImages)
        setAttachedImages([])
      }

      if (stopRequestedRef.current) {
        ensureAssistantNote('（応答を取り消しました）')
        return
      }

      if (typeof window.saforall.chatStream !== 'function') {
        const result = await window.saforall.request<{
          user_message: ChatMessageRecord
          assistant_message: ChatMessageRecord
        }>('POST', '/ai/chat', payload, { timeoutMs: 120_000 })

        if (!result.ok || !result.data) {
          const message = formatAiUserError(result.error?.message ?? 'AI 応答に失敗しました')
          setError(message)
          ensureAssistantNote(`エラー: ${message}`)
          return
        }

        const assistant = toChatMessage(result.data.assistant_message)
        const assistantContent =
          typeof assistant.content === 'string' && assistant.content.trim()
            ? assistant.content
            : '（応答本文が空でした。もう一度送信するか、エンジンを切り替えてください。）'
        const normalizedAssistant = { ...assistant, content: assistantContent }
        setMessages((prev) => {
          const withoutLocalUser = prev.filter((message) => message.id !== localUser.id)
          return [
            ...withoutLocalUser,
            toChatMessage(result.data!.user_message),
            normalizedAssistant
          ]
        })
        if (engine !== 'cursor') {
          await runAgentActions(normalizedAssistant.id, normalizedAssistant.content)
        }
        void refreshSessions()
        return
      }

      const streamAssistantId = `stream-${crypto.randomUUID()}`
      let sawAssistant = false
      let finalAssistantId: string | null = null
      let finalAssistantContent: string | null = null
      let usedEngine: string = engine
      let usedTools = false
      let editProposalCount = 0
      let streamFailed: string | null = null
      let streamCancelled = false
      let turnClosed = false

      const { requestId, done } = window.saforall.chatStream(
        payload,
        {
        onEvent: (event) => {
          if (event.type === 'user_message') {
            setBusy({ phase: 'thinking', detail: '応答生成を待機中…' })
            const savedUser = toChatMessage(event.message as unknown as ChatMessageRecord)
            setMessages((prev) =>
              prev.map((message) =>
                message.id === localUser.id ? savedUser : message
              )
            )
            return
          }

          if (event.type === 'route') {
            usedEngine = event.engine
            if (typeof event.session_id === 'number' && event.session_id > 0) {
              setSessionId(event.session_id)
              writeLastSessionId(workspaceId, event.session_id)
            }
            const reason = event.fallback_reason ? `（${event.fallback_reason}）` : ''
            const warn = event.budget_warning ? ` ⚠${event.budget_warning}` : ''
            const est =
              typeof event.estimated_usd === 'number' && event.estimated_usd > 0
                ? ` · est $${event.estimated_usd.toFixed(4)}`
                : ''
            const profile = event.policy_profile ? ` · ${event.policy_profile}` : ''
            const modeTag = event.mode ? ` · ${event.mode}` : ''
            setRouteLabel(
              `${event.engine} · ${event.model} / ${event.task_type}${modeTag}${profile}${est}${reason}${warn}`
            )
            if (event.usage) {
              const parts = USAGE_ENGINE_KEYS.map((key) => {
                const row = event.usage?.[key]
                const spent = row?.spent ?? 0
                const limit = row?.limit ?? DEFAULT_COST_LIMITS[key]
                return `${key} $${spent.toFixed(2)}/$${limit}`
              })
              setUsageText(parts.join(' · '))
            }
            setBusy({
              phase: 'thinking',
              detail: `${event.engine} · ${event.model} で応答中…`
            })
            return
          }

          if (event.type === 'agent_phase') {
            const copy = AGENT_PHASE_COPY[event.phase] ?? {
              title: event.phase,
              blurb: ''
            }
            const isProgress = event.kind === 'progress'
            const detail = event.note
              ? event.note
              : copy.blurb
                ? `Agent ${copy.title}: ${copy.blurb}`
                : `Agent: ${copy.title}`
            setBusy({
              phase: 'thinking',
              detail
            })
            if (isProgress) {
              const body = event.note?.trim() || copy.blurb || '確認中…'
              const visible = `🧪 ${body}`
              if (!sawAssistant) {
                sawAssistant = true
                setMessages((prev) => [
                  ...prev,
                  {
                    id: streamAssistantId,
                    role: 'assistant',
                    content: `${SHELL_PROGRESS_MARKER}${visible}`
                  }
                ])
              } else {
                setMessages((prev) =>
                  prev.map((message) =>
                    message.id === streamAssistantId
                      ? {
                          ...message,
                          content: upsertShellProgressLine(message.content, visible)
                        }
                      : message
                  )
                )
              }
              return
            }
            const line = `\n\n📍 **${copy.title}** — ${event.note?.trim() || copy.blurb || '作業中'}`
            if (!sawAssistant) {
              sawAssistant = true
              setMessages((prev) => [
                ...prev,
                { id: streamAssistantId, role: 'assistant', content: line.trim() }
              ])
            } else {
              setMessages((prev) =>
                prev.map((message) =>
                  message.id === streamAssistantId
                    ? { ...message, content: message.content + line }
                    : message
                )
              )
            }
            return
          }

          if (event.type === 'agent_checkpoint') {
            setBusy({
              phase: 'thinking',
              detail: `Checkpoint: ${event.summary}`
            })
            const line = `\n\n⏱️ Checkpoint · ${event.summary}`
            if (!sawAssistant) {
              sawAssistant = true
              setMessages((prev) => [
                ...prev,
                { id: streamAssistantId, role: 'assistant', content: line.trim() }
              ])
            } else {
              setMessages((prev) =>
                prev.map((message) =>
                  message.id === streamAssistantId
                    ? { ...message, content: message.content + line }
                    : message
                )
              )
            }
            return
          }

          if (event.type === 'tool_call') {
            const command =
              typeof event.args?.command === 'string' ? event.args.command.trim() : ''
            const label = command
              ? `確認コマンド実行: ${command.length > 72 ? `${command.slice(0, 72)}…` : command}`
              : event.name === 'read_file'
                ? 'ファイルを読んでいます…'
                : event.name === 'edit_file'
                  ? '変更案を作成しています…'
                  : event.name === 'search_code'
                    ? 'コードを検索しています…'
                    : `ツール実行: ${event.name}`
            setBusy({ phase: 'thinking', detail: label })
            const line = command
              ? `\n\n🧪 確認のためターミナル実行: \`${command.length > 100 ? `${command.slice(0, 100)}…` : command}\``
              : `\n\n🔧 ${label}`
            if (!sawAssistant) {
              sawAssistant = true
              setMessages((prev) => [
                ...prev,
                { id: streamAssistantId, role: 'assistant', content: line.trim() }
              ])
            } else {
              setMessages((prev) =>
                prev.map((message) =>
                  message.id === streamAssistantId
                    ? { ...message, content: message.content + line }
                    : message
                )
              )
            }
            return
          }

          if (event.type === 'tool_result') {
            setBusy({
              phase: 'thinking',
              detail: event.ok ? `完了: ${event.summary}` : `失敗: ${event.summary}`
            })
            const mark = event.ok ? '✓' : '✗'
            const resultBody = `${mark} ${event.summary}`
            setMessages((prev) =>
              prev.map((message) => {
                if (message.id !== streamAssistantId) return message
                if (event.name === 'run_shell' && message.content.includes(SHELL_PROGRESS_MARKER)) {
                  return {
                    ...message,
                    content: upsertShellProgressLine(message.content, `🧪 ${resultBody}`)
                  }
                }
                return { ...message, content: message.content + ` ${resultBody}` }
              })
            )
            return
          }

          if (event.type === 'edit_proposal') {
            editProposalCount += 1
            setBusy({ phase: 'applying', detail: `変更候補: ${event.path}` })
            void onApplyCode(event.content, event.path, languageFromPath(event.path), {
              auto: true,
              review: true,
              forceReplace: true
            })
            return
          }

          if (event.type === 'delta') {
            if (!event.text) return
            setBusy({ phase: 'streaming', detail: '応答を受信中…' })
            if (!sawAssistant) {
              sawAssistant = true
              setMessages((prev) => [
                ...prev,
                {
                  id: streamAssistantId,
                  role: 'assistant',
                  content: event.text
                }
              ])
              return
            }

            setMessages((prev) =>
              prev.map((message) =>
                message.id === streamAssistantId
                  ? { ...message, content: message.content + event.text }
                  : message
              )
            )
            return
          }

          if (event.type === 'done') {
            turnClosed = true
            if (event.engine) {
              usedEngine = event.engine
            }
            if (event.used_tools) {
              usedTools = true
            }
            if (event.usage) {
              const parts = USAGE_ENGINE_KEYS.map((key) => {
                const row = event.usage?.[key]
                const spent = row?.spent ?? 0
                const limit = row?.limit ?? DEFAULT_COST_LIMITS[key]
                return `${key} $${spent.toFixed(2)}/$${limit}`
              })
              setUsageText(parts.join(' · '))
            }
            const savedAssistant = toChatMessage(
              event.assistant_message as unknown as ChatMessageRecord
            )
            const content =
              typeof savedAssistant.content === 'string' && savedAssistant.content.trim()
                ? savedAssistant.content
                : '（応答本文が空でした。もう一度送信するか、エンジンを切り替えてください。）'
            const normalized = { ...savedAssistant, content }
            finalAssistantId = normalized.id
            finalAssistantContent = content
            sawAssistant = true
            setMessages((prev) => {
              const hasStream = prev.some((message) => message.id === streamAssistantId)
              if (hasStream) {
                return prev.map((message) =>
                  message.id === streamAssistantId ? normalized : message
                )
              }
              return [...prev, normalized]
            })
            return
          }

          if (event.type === 'cancelled') {
            turnClosed = true
            streamCancelled = true
            stopRequestedRef.current = false
            if (stopForceTimerRef.current != null) {
              window.clearTimeout(stopForceTimerRef.current)
              stopForceTimerRef.current = null
            }
            // Unlock send immediately — do not wait for await done (can hang on run_shell).
            if (submitGenerationRef.current === submitGeneration) {
              setBusy(null)
              if (!inputRef.current.trim() && lastSubmittedTextRef.current) {
                setInput(lastSubmittedTextRef.current)
              }
            }
            setError(null)
            const note = event.message?.trim() || '応答を取り消しました'
            setMessages((prev) => {
              const existing = prev.find((message) => message.id === streamAssistantId)
              if (existing) {
                const suffix = existing.content.trim() ? `\n\n（${note}）` : `（${note}）`
                return prev.map((message) =>
                  message.id === streamAssistantId
                    ? { ...message, content: `${message.content.trimEnd()}${suffix}` }
                    : message
                )
              }
              return [
                ...prev,
                {
                  id: streamAssistantId,
                  role: 'assistant',
                  content: `（${note}）`
                }
              ]
            })
            return
          }

          if (event.type === 'error') {
            turnClosed = true
            streamFailed = event.message
            const errorLine = `エラー: ${formatAiUserError(event.message)}`
            setError(formatAiUserError(event.message))
            setMessages((prev) => {
              const existing = prev.find((message) => message.id === streamAssistantId)
              if (existing) {
                if (existing.content.includes(errorLine)) return prev
                const suffix = existing.content.trim() ? `\n\n${errorLine}` : errorLine
                return prev.map((message) =>
                  message.id === streamAssistantId
                    ? { ...message, content: `${message.content.trimEnd()}${suffix}` }
                    : message
                )
              }
              return [
                ...prev,
                {
                  id: streamAssistantId,
                  role: 'assistant',
                  content: errorLine
                }
              ]
            })
            return
          }
        }
      },
        { requestId: streamRequestId }
      )
      streamRequestIdRef.current = requestId
      try {
        await done
      } finally {
        if (streamRequestIdRef.current === requestId) {
          streamRequestIdRef.current = null
        }
      }

      if (!turnClosed && !streamCancelled && !streamFailed) {
        const fallback =
          'エラー: 応答が完了しませんでした。もう一度送信してください。'
        setError(fallback.replace(/^エラー: /, ''))
        ensureAssistantNote(fallback)
        streamFailed = fallback
      }

      if (streamCancelled) {
        void refreshSessions()
        return
      }

      if (finalAssistantId && finalAssistantContent && usedEngine !== 'cursor' && !usedTools) {
        await runAgentActions(finalAssistantId, finalAssistantContent)
      }
      if (editProposalCount > 0) {
        onAgentNeedsReview?.({ editCount: editProposalCount, engine: usedEngine })
      } else if (usedEngine === 'cursor' && modeRef.current === 'agent') {
        onAgentNeedsReview?.({ editCount: 0, engine: usedEngine })
      }
      void refreshSessions()

      const jobMatch = text.match(/【Background Agent · (job-[a-z0-9-]+)】/i)
      if (jobMatch && typeof window.saforall.completeJob === 'function') {
        void window.saforall.completeJob({
          id: jobMatch[1],
          ok: !streamFailed,
          summary: streamFailed
            ? undefined
            : usedTools
              ? `Agent 完了（ツール実行あり · 変更候補 ${editProposalCount}）`
              : editProposalCount > 0
                ? `完了（変更候補 ${editProposalCount}）`
                : 'チャット応答完了',
          error: streamFailed ?? undefined
        })
      }
    } catch (error) {
      const message = formatAiUserError(
        error instanceof Error ? error.message : String(error)
      )
      setError(message)
      setMessages((prev) => {
        const last = prev[prev.length - 1]
        if (
          last?.role === 'assistant' &&
          (last.content.startsWith('エラー:') || last.content.includes('\n\nエラー:'))
        ) {
          return prev
        }
        return [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `エラー: ${message}`
          }
        ]
      })
    } finally {
      if (stopForceTimerRef.current != null) {
        window.clearTimeout(stopForceTimerRef.current)
        stopForceTimerRef.current = null
      }
      stopRequestedRef.current = false
      // Only the latest submit may clear busy (avoid racing a newer turn).
      if (submitGenerationRef.current === submitGeneration) {
        setBusy(null)
        if (streamRequestIdRef.current === streamRequestId) {
          streamRequestIdRef.current = null
        }
      }
    }
  }

  const releaseStuckChatUi = useCallback((restoreInput = true) => {
    stopRequestedRef.current = false
    streamRequestIdRef.current = null
    setBusy(null)
    if (restoreInput && !inputRef.current.trim() && lastSubmittedTextRef.current) {
      setInput(lastSubmittedTextRef.current)
    }
  }, [])

  const stopChat = useCallback(() => {
    const id = streamRequestIdRef.current
    stopRequestedRef.current = true
    // No active stream — unlock immediately (e.g. after a hung cancel already cleared the id).
    if (!id) {
      releaseStuckChatUi(true)
      return
    }

    setBusy({ phase: 'thinking', detail: '停止中…' })
    if (typeof window.saforall.cancelChatStream === 'function') {
      void window.saforall.cancelChatStream(id)
    }
    if (stopForceTimerRef.current != null) {
      window.clearTimeout(stopForceTimerRef.current)
    }
    // Always force-unlock UI even if main never emits cancelled (stuck run_shell).
    stopForceTimerRef.current = window.setTimeout(() => {
      stopForceTimerRef.current = null
      // Bump generation so a late finally from the hung submit cannot re-lock send.
      submitGenerationRef.current += 1
      setMessages((prev) => {
        const last = prev[prev.length - 1]
        if (
          last?.role === 'assistant' &&
          (/取り消|停止しました|エラー:/.test(last.content) || last.content.startsWith('（'))
        ) {
          return prev
        }
        return [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content:
              '（応答を停止しました。内容が途中の場合は再送信してください。）'
          }
        ]
      })
      releaseStuckChatUi(true)
    }, 1500)
  }, [releaseStuckChatUi])

  const isPersistedMessageId = (id: string) => /^\d+$/.test(id)

  const beginEditMessage = (message: ChatMessage) => {
    if (busy || loading || message.role !== 'user' || message.id === 'welcome') return
    setEditingMessageId(message.id)
    setEditDraft(message.content)
  }

  const cancelEditMessage = () => {
    setEditingMessageId(null)
    setEditDraft('')
  }

  const confirmEditAndResubmit = async () => {
    const text = editDraft.trim()
    const messageId = editingMessageId
    if (!text || !messageId || busy || loading) return

    const idx = messages.findIndex((row) => row.id === messageId)
    if (idx < 0) return

    setMessages((prev) => {
      const at = prev.findIndex((row) => row.id === messageId)
      if (at < 0) return prev
      return [...prev.slice(0, at), { ...prev[at], content: text }]
    })
    setEditingMessageId(null)
    setEditDraft('')

    const sid = sessionIdRef.current
    const persisted = isPersistedMessageId(messageId)
    if (backendConnected && sid && sid > 0 && persisted) {
      const truncated = await window.saforall.request<{
        messages: ChatMessageRecord[]
        kept: ChatMessageRecord | null
      }>('POST', `/chat/sessions/${sid}/messages/truncate`, {
        message_id: Number(messageId),
        mode: 'keepThrough',
        content: text
      })
      if (!truncated.ok) {
        setError(truncated.error?.message ?? '履歴の切り詰めに失敗しました')
        return
      }
      if (truncated.data?.messages) {
        setMessages(truncated.data.messages.map(toChatMessage))
      }
      await submitChat({
        text,
        userMessageId: Number(messageId),
        reuseLocalId: messageId,
        clearComposer: false
      })
      return
    }

    // Unpersisted / offline-only: drop this turn and after, then send as a new message.
    setMessages((prev) => prev.slice(0, idx))
    await submitChat({ text, clearComposer: false })
  }

  const regenerateAssistant = async (assistantId: string) => {
    if (busy || loading || assistantId === 'welcome') return
    const idx = messages.findIndex((row) => row.id === assistantId)
    if (idx <= 0) return
    let userIdx = -1
    for (let i = idx - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === 'user') {
        userIdx = i
        break
      }
    }
    if (userIdx < 0) return
    const user = messages[userIdx]
    const text = user.content.trim()
    if (!text) return

    setMessages((prev) => prev.slice(0, userIdx + 1))
    setEditingMessageId(null)
    setEditDraft('')

    const sid = sessionIdRef.current
    const persisted = isPersistedMessageId(user.id)
    if (backendConnected && sid && sid > 0 && persisted) {
      const truncated = await window.saforall.request<{
        messages: ChatMessageRecord[]
      }>('POST', `/chat/sessions/${sid}/messages/truncate`, {
        message_id: Number(user.id),
        mode: 'keepThrough',
        content: text
      })
      if (!truncated.ok) {
        setError(truncated.error?.message ?? '履歴の切り詰めに失敗しました')
        return
      }
      if (truncated.data?.messages) {
        setMessages(truncated.data.messages.map(toChatMessage))
      }
      await submitChat({
        text,
        userMessageId: Number(user.id),
        reuseLocalId: user.id,
        clearComposer: false
      })
      return
    }

    await submitChat({ text, reuseLocalId: user.id, clearComposer: false })
  }

  const busyLabel =
    busy?.detail ??
    (busy?.phase === 'applying'
      ? 'コード適用・コマンド実行中…'
      : busy?.phase === 'streaming'
        ? '応答を受信中…'
        : busy
          ? 'AI 応答待ち…'
          : null)

  return (
    <aside className="chat-panel" aria-label="AI チャット" style={{ width }}>
      <div className="chat-layout">
        <div className="chat-main">
          <div className="chat-header chat-header--compact">
            <div className="chat-header-row">
              <button
                type="button"
                className={`chat-history-toggle${historyOpen ? ' is-active' : ''}`}
                onClick={() => setHistoryOpen((open) => !open)}
                title={historyOpen ? '履歴を隠す' : '履歴を表示'}
              >
                履歴
              </button>
              <strong className="chat-session-title">{activeSession?.title || 'AI'}</strong>
              <button
                type="button"
                className="chat-new-btn"
                disabled={!backendConnected || busy !== null || loading}
                onClick={() => void startNewChat()}
                title="新しいチャット"
              >
                新規
              </button>
              <span className="chat-header-spacer" />
              <label className="engine-select">
                <span className="sr-only">AI</span>
                <select
                  value={engine}
                  disabled={!backendConnected}
                  title="AI エンジン"
                  onChange={(event) => changeEngine(event.target.value as AiEngine)}
                >
                  <option value="auto">自動</option>
                  <option value="openai">OpenAI</option>
                  <option value="gemini">Gemini</option>
                  <option value="claude">Claude</option>
                  <option value="cursor">Cursor</option>
                  <option value="workers">Workers</option>
                </select>
              </label>
              {engine === 'auto' && (
                <label className="category-select">
                  <span className="sr-only">用途</span>
                  <select
                    value={
                      enabledCategories.includes(routerCategory) ? routerCategory : 'auto'
                    }
                    disabled={!backendConnected}
                    title="Auto 用途カテゴリ"
                    onChange={(event) => {
                      const next = parseRouterCategory(event.target.value)
                      setRouterCategory(next)
                      window.localStorage.setItem('saforall-router-category', next)
                    }}
                  >
                    {ROUTER_CATEGORIES.filter(
                      (row) => row.id === 'auto' || enabledCategories.includes(row.id)
                    ).map((row) => (
                      <option key={row.id} value={row.id} title={row.hint}>
                        {row.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {engine !== 'auto' && (
                <label className="model-select">
                  <span className="sr-only">Model</span>
                  <select
                    value={modelChoice}
                    disabled={!backendConnected}
                    title="このエンジン内のモデル"
                    onChange={(event) => setModelChoice(event.target.value)}
                  >
                    <option value="auto-within-engine">モデル自動</option>
                    {enabledByEngine[engine].map((id) => {
                      const meta = optionsForEngine(engine, enabledByEngine[engine]).find(
                        (row) => row.id === id
                      )
                      return (
                        <option key={id} value={id}>
                          {meta?.label ?? id}
                        </option>
                      )
                    })}
                  </select>
                </label>
              )}
              <div className="mode-switch mode-switch--compact" role="group" aria-label="チャットモード">
                <button
                  type="button"
                  className={mode === 'ask' ? 'active' : ''}
                  onClick={() => changeMode('ask')}
                  title="説明中心。コード適用は確認してから"
                >
                  Ask
                </button>
                <button
                  type="button"
                  className={mode === 'agent' ? 'active' : ''}
                  onClick={() => changeMode('agent')}
                  title="edit_file / run_shell などのツールで調査・修正・検証"
                >
                  Agent
                </button>
              </div>
              <span
                className={`chat-backend ${
                  modelApiStatus === 'offline' ? 'ng' : 'ok'
                }`}
              >
                {modelApiStatus === 'checking'
                  ? t('status.checking')
                  : modelApiStatus === 'online'
                    ? t('status.modelApiOnline')
                    : t('status.modelApiOffline')}
              </span>
            </div>
            <div className="chat-context-line">{contextLabel}</div>
          </div>

          {!bannerDismissed && (
            <div className={`mode-banner mode-banner--compact ${mode}`}>
              <div className="mode-banner-main">
                {mode === 'ask' ? (
                  <>
                    <strong>Ask</strong>
                    <span>説明・提案。差分は確認してから適用</span>
                  </>
                ) : (
                  <>
                    <strong>Agent</strong>
                    <span>ツール必須 → 変更候補に載せる</span>
                  </>
                )}
              </div>
              <span className="mode-banner-sub">
                {engine === 'auto'
                  ? '自動切替'
                  : engine === 'cursor'
                    ? 'Cursor'
                    : engine === 'gemini'
                      ? 'Gemini（ツール Agent 可）'
                      : engine === 'claude'
                        ? 'Claude（ツール Agent 可）'
                        : engine === 'workers'
                          ? 'Workers（ツール不可）'
                          : 'OpenAI'}
                {routeLabel ? ` · ${routeLabel}` : ''}
              </span>
              <button
                type="button"
                className="mode-banner-dismiss"
                title="バナーを閉じる（メッセージ領域を広げる）"
                onClick={() => setBannerDismissed(true)}
              >
                ×
              </button>
            </div>
          )}
          {bannerDismissed && (
            <button
              type="button"
              className="mode-banner-restore"
              onClick={() => setBannerDismissed(false)}
              title="モード説明を再表示"
            >
              {mode === 'agent' ? 'Agent' : 'Ask'} 説明
            </button>
          )}
          {usageText && <div className="usage-bar">今月 {usageText}</div>}

          {needsApiKeySetup && (
            <div className="chat-offline-banner chat-setup-banner" role="status">
              <div className="chat-offline-banner-main">
                <strong>API キー未設定</strong>
                <span>
                  Settings で API キーを保存すると Model API に接続できます（XAMPP 不要）。
                </span>
              </div>
              {onOpenSettings && (
                <button type="button" className="chat-offline-recheck" onClick={onOpenSettings}>
                  設定を開く
                </button>
              )}
            </div>
          )}

          {!backendConnected && (
            <div className="chat-offline-banner" role="status">
              <div className="chat-offline-banner-main">
                <strong>{localLlmReady ? 'ローカル LLM モード' : '編集専用モード'}</strong>
                <span>
                  {localLlmReady
                    ? '接続はありません。保存済み API キーで直接 LLM に問い合わせます。'
                    : buildBackendOfflineMessage()}
                </span>
              </div>
              {onRecheckBackend && (
                <button type="button" className="chat-offline-recheck" onClick={onRecheckBackend}>
                  再チェック
                </button>
              )}
            </div>
          )}

          {isLocalMode && localLlmReady && (
            <div className="chat-local-hint" role="status">
              履歴はアプリ内に保存されます。チャットは Model API へ接続します（XAMPP 不要）
            </div>
          )}

          {error && <div className="chat-error">{error}</div>}

          <div className="chat-messages">
            {chatReady &&
              workspacePath &&
              messages.length === 1 &&
              messages[0]?.id === 'welcome' && (
                <div className="chat-examples" role="group" aria-label="例プロンプト">
                  <p className="chat-examples-label">例プロンプト</p>
                  <div className="chat-examples-list">
                    <button
                      type="button"
                      onClick={() => {
                        changeMode('ask')
                        setInput('このプロジェクトの構成と主な技術スタックを説明して')
                      }}
                    >
                      Ask: 構成を説明
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        changeMode('ask')
                        setInput('最近の変更点を要約して。改善できそうなところも教えて')
                      }}
                    >
                      Ask: 改善点を聞く
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        changeMode('agent')
                        setInput('README を現状の構成に合わせて更新して')
                      }}
                    >
                      Agent: README 更新
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        changeMode('agent')
                        setInput('型エラーや lint を確認して、直せるところを直して')
                      }}
                    >
                      Agent: エラー修正
                    </button>
                  </div>
                </div>
              )}
            {messages.map((message, messageIndex) => (
              <div key={message.id} className={`chat-bubble ${message.role}`}>
                <div className="chat-role-row">
                  <div className="chat-role">{message.role === 'user' ? 'You' : 'AI'}</div>
                  {!busy && !loading && message.id !== 'welcome' && (
                    <div className="chat-bubble-actions">
                      {message.role === 'user' && editingMessageId !== message.id && (
                        <button
                          type="button"
                          className="chat-bubble-action"
                          title="編集して再送信"
                          onClick={() => beginEditMessage(message)}
                        >
                          編集
                        </button>
                      )}
                      {message.role === 'assistant' && (
                        <button
                          type="button"
                          className="chat-bubble-action"
                          title="この応答を再生成"
                          onClick={() => void regenerateAssistant(message.id)}
                        >
                          再生成
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {message.role === 'assistant' ? (
                  <MessageContent
                    content={stripProgressMarkersForDisplay(message.content)}
                    showApply={message.id !== 'welcome'}
                    mode={mode}
                    autoApplied={autoAppliedIds[message.id] === true}
                    onApplyCode={requestApply}
                  />
                ) : editingMessageId === message.id ? (
                  <div className="chat-edit-box">
                    <textarea
                      className="chat-edit-textarea"
                      value={editDraft}
                      rows={Math.min(12, Math.max(3, editDraft.split('\n').length + 1))}
                      autoFocus
                      onChange={(event) => setEditDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          cancelEditMessage()
                        }
                        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                          event.preventDefault()
                          void confirmEditAndResubmit()
                        }
                      }}
                    />
                    <div className="chat-edit-actions">
                      <button type="button" onClick={cancelEditMessage}>
                        キャンセル
                      </button>
                      <button
                        type="button"
                        className="is-primary"
                        disabled={editDraft.trim() === ''}
                        onClick={() => void confirmEditAndResubmit()}
                      >
                        再送信
                      </button>
                    </div>
                    <p className="chat-edit-hint">
                      これ以降の応答は破棄されます · Ctrl+Enter で再送信
                      {messageIndex < messages.length - 1 ? '（後続あり）' : ''}
                    </p>
                  </div>
                ) : (
                  <div className="chat-content">{message.content}</div>
                )}
              </div>
            ))}
            {busy && busy.phase !== 'streaming' && (
              <div className="chat-bubble assistant busy">
                <div className="chat-role">AI</div>
                <div className="chat-content chat-busy-inline">
                  <span className="chat-busy-spinner" aria-hidden />
                  {busyLabel}
                </div>
              </div>
            )}
          </div>

          {busy && (
            <div
              className={`chat-busy-bar phase-${busy.phase}`}
              role="status"
              aria-live="polite"
            >
              <span className="chat-busy-spinner" aria-hidden />
              <span className="chat-busy-label">{busyLabel}</span>
              <button
                type="button"
                className="chat-stop-btn"
                onClick={stopChat}
                title="応答を停止"
              >
                停止
              </button>
            </div>
          )}

          <div
            className={`chat-attach-zone${attachDropActive ? ' is-drop' : ''}`}
            onDragEnter={(event) => {
              event.preventDefault()
              setAttachDropActive(true)
            }}
            onDragOver={(event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node)) return
              setAttachDropActive(false)
            }}
            onDrop={(event) => {
              event.preventDefault()
              setAttachDropActive(false)
              const imageBlobs = imageBlobsFromDataTransfer(event.dataTransfer)
              const paths = pathsFromDataTransfer(event.dataTransfer, { workspacePath })
              if (imageBlobs.length > 0) {
                void addImagesFromBlobs(imageBlobs)
                // Avoid double-adding the same PNG via path + blob.
                attachPaths(paths.filter((path) => !isImageFileName(path)))
              } else {
                attachPaths(paths)
              }
            }}
          >
            <div className="chat-attach-bar" aria-label="添付ファイル">
              <button
                type="button"
                className="chat-attach-add"
                title="画像・ファイルを添付"
                disabled={!chatReady || busy !== null}
                onClick={() => {
                  if (attachPickerOpen) setAttachPickerOpen(false)
                  else openAttachPicker()
                }}
              >
                +
              </button>
              {attachedImages.map((image) => (
                <button
                  key={image.id}
                  type="button"
                  className="chat-context-chip is-attached chat-attach-chip chat-attach-image-chip"
                  title={`${image.name}\nクリックで外す`}
                  onClick={() => removeAttachedImage(image.id)}
                >
                  <img
                    className="chat-attach-thumb"
                    src={image.previewUrl}
                    alt=""
                    draggable={false}
                  />
                  <span className="chat-attach-chip-name">{image.name}</span>
                  <span className="chat-attach-chip-x" aria-hidden>
                    ×
                  </span>
                </button>
              ))}
              {attachedPaths.map((path) => (
                <button
                  key={path}
                  type="button"
                  className="chat-context-chip is-attached chat-attach-chip"
                  title={`${path}\nクリックで外す`}
                  onClick={() =>
                    setAttachedPaths((current) => removeAttachedPath(current, path))
                  }
                >
                  <span className="chat-attach-chip-name">{attachmentLabel(path)}</span>
                  <span className="chat-attach-chip-x" aria-hidden>
                    ×
                  </span>
                </button>
              ))}
              {selection?.text ? (
                <span className="chat-context-chip is-selection" title={selection.path}>
                  選択 L{selection.startLine}
                  {selection.endLine !== selection.startLine ? `-${selection.endLine}` : ''}
                </span>
              ) : null}
              {mentionFlags.selection && (
                <span className="chat-context-chip is-mention">@selection</span>
              )}
              {mentionFlags.problems && (
                <span className="chat-context-chip is-mention">@problems</span>
              )}
              {mentionFlags.rules && (
                <span className="chat-context-chip is-mention">@rules</span>
              )}
              {mentionFlags.skills && (
                <span className="chat-context-chip is-mention">@skills</span>
              )}
              {mentionFlags.codebase ? (
                <span className="chat-context-chip is-mention">@codebase</span>
              ) : mode === 'ask' || mode === 'agent' ? (
                <span className="chat-context-chip is-auto" title="関連コードを自動で軽量検索">
                  自動検索
                </span>
              ) : null}
              {attachedPaths.length === 0 && attachedImages.length === 0 && (
                <span className="chat-context-hint">
                  画像ペースト可 · + / ドロップ · @ でも追加
                </span>
              )}
            </div>
            {attachPickerOpen && (
              <div className="chat-attach-picker" role="dialog" aria-label="ファイルを添付">
                <input
                  type="search"
                  className="chat-attach-search"
                  value={attachQuery}
                  placeholder="ファイル名で検索…"
                  autoFocus
                  onChange={(event) => setAttachQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setAttachPickerOpen(false)
                    }
                  }}
                />
                <ul className="chat-attach-results">
                  {attachResults.length === 0 ? (
                    <li className="chat-attach-empty">候補がありません</li>
                  ) : (
                    attachResults.map((row) => {
                      const attached = attachedPaths.some(
                        (path) => path.toLowerCase() === row.path.toLowerCase()
                      )
                      return (
                        <li key={row.path}>
                          <button
                            type="button"
                            className={attached ? 'is-attached' : undefined}
                            onClick={() => {
                              toggleAttached(row.path)
                              setAttachPickerOpen(false)
                              textareaRef.current?.focus()
                            }}
                          >
                            <strong>{row.label}</strong>
                            <span>{row.path}</span>
                          </button>
                        </li>
                      )
                    })
                  )}
                </ul>
                <div className="chat-attach-picker-foot">
                  <button type="button" onClick={() => setAttachPickerOpen(false)}>
                    閉じる
                  </button>
                </div>
              </div>
            )}
            <div className="chat-context-bar chat-context-bar-tabs">
              {openFiles.map((open) => {
                const name = attachmentLabel(open.path)
                const active = open.path === file?.path
                const attached = attachedPaths.includes(open.path)
                return (
                  <button
                    key={open.path}
                    type="button"
                    className={`chat-context-chip${active ? ' is-active' : ''}${attached ? ' is-attached' : ''}`}
                    title={
                      active
                        ? 'アクティブファイル（常に送信）'
                        : attached
                          ? '添付を外す'
                          : 'クリックで添付'
                    }
                    disabled={active}
                    onClick={() => toggleAttached(open.path)}
                  >
                    {active ? '● ' : attached ? '📎 ' : '+ '}
                    {name}
                  </button>
                )
              })}
            </div>
          </div>
          <form className="chat-input" onSubmit={(event) => void onSubmit(event)}>
            <div className="chat-input-wrap">
              {mentionOpen && mentionItems.length > 0 && (
                <ul className="chat-mention-list" role="listbox" aria-label="@ 候補">
                  {mentionItems.map((item, index) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={index === mentionIndex ? 'is-active' : ''}
                        onMouseDown={(event) => {
                          event.preventDefault()
                          applyMention(item)
                        }}
                      >
                        <strong>{item.label}</strong>
                        {item.detail && <span>{item.detail}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(event) => {
                  const value = event.target.value
                  const cursor = event.target.selectionStart ?? value.length
                  setInput(value)
                  void refreshMentionSuggestions(value, cursor)
                }}
                onPaste={(event) => {
                  const imageBlobs = imageBlobsFromDataTransfer(event.clipboardData)
                  if (imageBlobs.length > 0) {
                    event.preventDefault()
                    void addImagesFromBlobs(imageBlobs)
                    return
                  }
                  const paths = pathsFromDataTransfer(event.clipboardData, { workspacePath })
                  // Absolute path pastes (Explorer copy) become attachments.
                  // Normal clipboard text keeps the browser default paste.
                  if (paths.length === 0) return
                  event.preventDefault()
                  attachPaths(paths)
                }}
                placeholder={
                  needsApiKeySetup
                    ? 'Settings で API キーを保存するとチャットできます（XAMPP 不要）'
                    : !backendConnected && !localLlmReady
                      ? 'バックエンド未接続 — 編集は可能。Settings に API キーを保存するとローカル LLM が使えます'
                      : isLocalMode && localLlmReady
                        ? '質問する…（スクショ貼付可 · 履歴はアプリ内）'
                        : !backendConnected && localLlmReady
                          ? '質問する…（スクショ貼付可）'
                          : busy
                            ? busyLabel ?? '実行中…'
                            : loading
                              ? '履歴読み込み中…'
                              : mode === 'agent'
                                ? 'Agent: 修正を依頼…（スクショ貼付可。関連コード自動検索。edit → verify）'
                                : 'Ask: 質問する…（スクショ貼付可。適用前に確認。@ で追加）'
                }
                rows={3}
                disabled={!chatReady || busy !== null || loading}
                onKeyDown={(event) => {
                  if (mentionOpen && mentionItems.length > 0) {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      setMentionIndex((i) => (i + 1) % mentionItems.length)
                      return
                    }
                    if (event.key === 'ArrowUp') {
                      event.preventDefault()
                      setMentionIndex(
                        (i) => (i - 1 + mentionItems.length) % mentionItems.length
                      )
                      return
                    }
                    if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
                      event.preventDefault()
                      applyMention(mentionItems[mentionIndex] ?? mentionItems[0])
                      return
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setMentionOpen(false)
                      return
                    }
                  }
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    event.currentTarget.form?.requestSubmit()
                  }
                }}
              />
            </div>
            <button
              type={busy ? 'button' : 'submit'}
              className={busy ? 'chat-stop-submit' : undefined}
              disabled={
                busy
                  ? false
                  : !chatReady ||
                    loading ||
                    (input.trim() === '' && attachedImages.length === 0)
              }
              onClick={busy ? stopChat : undefined}
              title={busy ? '応答を停止' : undefined}
            >
              {busy?.detail === '停止中…'
                ? '停止中…'
                : busy
                  ? '停止'
                  : needsApiKeySetup
                    ? 'キー未設定'
                    : !chatReady
                      ? '未接続'
                      : '送信'}
            </button>
          </form>        </div>

        <div className={`chat-history${historyOpen ? ' is-open' : ''}`} aria-label="チャット履歴">
          <div className="chat-history-head">
            <strong>履歴</strong>
            <button
              type="button"
              className="chat-history-new"
              disabled={!backendConnected || busy !== null || loading}
              onClick={() => void startNewChat()}
              title="新しいチャット"
            >
              ＋ 新規
            </button>
          </div>
          <div className="chat-history-list">
            {sessions.length === 0 ? (
              <p className="chat-history-empty">まだ履歴がありません</p>
            ) : (
              sessions.map((row) => {
                const id = Number(row.id)
                const active = id === sessionId
                return (
                  <div
                    key={id}
                    className={`chat-history-item${active ? ' is-active' : ''}`}
                  >
                    <button
                      type="button"
                      className="chat-history-open"
                      disabled={busy !== null || loading}
                      onClick={() => void selectSession(id)}
                      title={row.title}
                    >
                      <span className="chat-history-title">{row.title || 'New chat'}</span>
                      <span className="chat-history-time">
                        {formatSessionTime(row.updated_at || row.created_at)}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="chat-history-delete"
                      disabled={busy !== null || loading}
                      title="削除"
                      onClick={() => setPendingDeleteId(id)}
                    >
                      ×
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={pendingAction !== null}
        title="コマンドを実行しますか？"
        message={
          pendingAction
            ? `次のコマンドをターミナルで実行します。\n\n${pendingAction.code}`
            : ''
        }
        confirmLabel="実行する"
        onCancel={() => setPendingAction(null)}
        onConfirm={() => {
          if (!pendingAction) return
          const action = pendingAction
          setPendingAction(null)
          void onApplyCode(action.code, action.pathHint, action.language)
        }}
      />

      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="チャットを削除しますか？"
        message="このチャットの履歴は削除され、元に戻せません。"
        confirmLabel="削除する"
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (pendingDeleteId === null) return
          void deleteSession(pendingDeleteId)
        }}
      />
    </aside>
  )
}

export type UsageLayoutMode = 'hidden' | 'right' | 'overlay'

export type LayoutPrefs = {
  chatOpen: boolean
  chatWidth: number
  usageMode: UsageLayoutMode
  usageWidth: number
  sidebarWidth: number
  terminalOpen: boolean
  terminalHeight: number
  historyOpen?: boolean
}

const STORAGE_KEY = 'saforall-layout-prefs'

export const DEFAULT_LAYOUT_PREFS: LayoutPrefs = {
  chatOpen: true,
  chatWidth: 360,
  usageMode: 'hidden',
  usageWidth: 320,
  sidebarWidth: 260,
  terminalOpen: false,
  terminalHeight: 220
}

export const CHAT_WIDTH_MIN = 260

/** エディタ側に最低限残す幅（アクティビティバー等は呼び出し側で差し引く） */
export const EDITOR_WIDTH_MIN = 200

/** ウィンドウ幅に応じたチャット最大幅（画面の約 80% まで広げられる） */
export function chatWidthMax(reservedLeft = 320): number {
  if (typeof window === 'undefined') return 1200
  const available = window.innerWidth - reservedLeft - EDITOR_WIDTH_MIN
  return Math.max(CHAT_WIDTH_MIN, Math.min(Math.floor(window.innerWidth * 0.85), available))
}


export function loadLayoutPrefs(): LayoutPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_LAYOUT_PREFS }
    const parsed = JSON.parse(raw) as Partial<LayoutPrefs>
    const usageMode =
      parsed.usageMode === 'right' || parsed.usageMode === 'overlay' || parsed.usageMode === 'hidden'
        ? parsed.usageMode
        : DEFAULT_LAYOUT_PREFS.usageMode
    return {
      chatOpen: parsed.chatOpen ?? DEFAULT_LAYOUT_PREFS.chatOpen,
      chatWidth: clamp(
        parsed.chatWidth ?? DEFAULT_LAYOUT_PREFS.chatWidth,
        CHAT_WIDTH_MIN,
        chatWidthMax()
      ),
      usageMode,
      usageWidth: clamp(parsed.usageWidth ?? DEFAULT_LAYOUT_PREFS.usageWidth, 240, 520),
      sidebarWidth: clamp(parsed.sidebarWidth ?? DEFAULT_LAYOUT_PREFS.sidebarWidth, 180, 480),
      terminalOpen: parsed.terminalOpen ?? DEFAULT_LAYOUT_PREFS.terminalOpen,
      terminalHeight: clamp(
        parsed.terminalHeight ?? DEFAULT_LAYOUT_PREFS.terminalHeight,
        120,
        800
      )
    }
  } catch {
    return { ...DEFAULT_LAYOUT_PREFS }
  }
}

export function saveLayoutPrefs(prefs: LayoutPrefs): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

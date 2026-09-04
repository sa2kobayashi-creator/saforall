export type AiEngine = 'auto' | 'cursor' | 'openai' | 'gemini' | 'workers'
export type ProviderEngine = Exclude<AiEngine, 'auto'>
export type ModelTier = 'cheap' | 'standard' | 'strong'

export type ModelOption = {
  id: string
  label: string
  tier: ModelTier
  /** 小さいほど安い */
  costRank: number
}

export const OPENAI_MODEL_CATALOG: ModelOption[] = [
  { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini（安価・推奨）', tier: 'cheap', costRank: 1 },
  { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini（安価）', tier: 'cheap', costRank: 2 },
  { id: 'gpt-4o-mini', label: 'gpt-4o-mini（安価・旧）', tier: 'cheap', costRank: 3 },
  { id: 'gpt-4.1', label: 'gpt-4.1（標準）', tier: 'standard', costRank: 4 },
  { id: 'gpt-4o', label: 'gpt-4o（標準・旧）', tier: 'standard', costRank: 5 },
  { id: 'gpt-5.4', label: 'gpt-5.4（標準）', tier: 'standard', costRank: 6 },
  { id: 'o4-mini', label: 'o4-mini（強）', tier: 'strong', costRank: 7 },
  { id: 'o3-mini', label: 'o3-mini（強）', tier: 'strong', costRank: 8 }
]

export const GEMINI_MODEL_CATALOG: ModelOption[] = [
  { id: 'gemini-flash-latest', label: 'gemini-flash-latest（推奨・追従）', tier: 'cheap', costRank: 1 },
  { id: 'gemini-3.5-flash-lite', label: 'gemini-3.5-flash-lite（安価）', tier: 'cheap', costRank: 2 },
  { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash（標準）', tier: 'standard', costRank: 3 },
  { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro（強）', tier: 'strong', costRank: 4 }
]

export const WORKERS_MODEL_CATALOG: ModelOption[] = [
  {
    id: '@cf/meta/llama-3.1-8b-instruct-fp8',
    label: 'Llama 3.1 8B FP8（安価・推奨）',
    tier: 'cheap',
    costRank: 1
  },
  {
    id: '@cf/meta/llama-3.1-8b-instruct-fast',
    label: 'Llama 3.1 8B Fast（安価）',
    tier: 'cheap',
    costRank: 2
  },
  {
    id: '@cf/qwen/qwen2.5-coder-32b-instruct',
    label: 'Qwen2.5 Coder 32B（標準）',
    tier: 'standard',
    costRank: 3
  },
  {
    id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    label: 'Llama 3.3 70B Fast（強）',
    tier: 'strong',
    costRank: 4
  }
]

export const CURSOR_MODEL_CATALOG: ModelOption[] = [
  { id: 'auto', label: 'Auto（サーバ側選択）', tier: 'cheap', costRank: 1 },
  { id: 'auto-smart', label: 'Cursor Router auto-smart', tier: 'cheap', costRank: 2 },
  { id: 'composer-2.5', label: 'Composer 2.5（標準・高速）', tier: 'standard', costRank: 3 },
  { id: 'grok-4.5', label: 'Cursor Grok 4.5', tier: 'standard', costRank: 4 },
  { id: 'grok-4.6', label: 'Cursor Grok 4.6', tier: 'standard', costRank: 5 },
  { id: 'claude-4.5-sonnet', label: 'Claude Sonnet 4.5', tier: 'standard', costRank: 6 },
  { id: 'claude-4.6-sonnet', label: 'Claude Sonnet 4.6', tier: 'standard', costRank: 7 },
  { id: 'claude-opus-5', label: 'Claude Opus 5', tier: 'strong', costRank: 8 }
]

/** Chat / Settings の表示用。カタログに無い選択済み ID も選択肢に残す */
export function optionsForEngine(engine: ProviderEngine, enabled: string[]): ModelOption[] {
  const catalog = catalogFor(engine)
  const known = new Set(catalog.map((m) => m.id))
  const extras = enabled
    .filter((id) => !known.has(id))
    .map(
      (id): ModelOption => ({
        id,
        label: id,
        tier: 'standard',
        costRank: 50
      })
    )
  return [...catalog, ...extras]
}

export const DEFAULT_LLM_MODEL = 'gpt-4.1-mini'
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest'
export const DEFAULT_CURSOR_MODEL = 'grok-4.6'
export const DEFAULT_WORKERS_MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8'

/** @deprecated use catalogs */
export const LLM_MODEL_OPTIONS = OPENAI_MODEL_CATALOG.map((m) => m.id)
/** @deprecated */
export const GEMINI_MODEL_OPTIONS = GEMINI_MODEL_CATALOG.map((m) => m.id)
/** @deprecated */
export const WORKERS_AI_MODEL_OPTIONS = WORKERS_MODEL_CATALOG.map((m) => m.id)

export const ENGINE_MODEL_CATALOG: Record<ProviderEngine, ModelOption[]> = {
  openai: OPENAI_MODEL_CATALOG,
  gemini: GEMINI_MODEL_CATALOG,
  workers: WORKERS_MODEL_CATALOG,
  cursor: CURSOR_MODEL_CATALOG
}

export const DEFAULT_ENABLED_MODELS: Record<ProviderEngine, string[]> = {
  openai: ['gpt-4.1-mini', 'gpt-4.1'],
  gemini: ['gemini-flash-latest', 'gemini-2.5-flash'],
  workers: ['@cf/meta/llama-3.1-8b-instruct-fp8', '@cf/qwen/qwen2.5-coder-32b-instruct'],
  cursor: [
    'auto',
    'grok-4.6',
    'grok-4.5',
    'claude-4.6-sonnet',
    'claude-4.5-sonnet',
    'claude-opus-5',
    'composer-2.5'
  ]
}

export function catalogFor(engine: ProviderEngine): ModelOption[] {
  return ENGINE_MODEL_CATALOG[engine]
}

export function parseModelList(raw: unknown, fallback: string[]): string[] {
  if (Array.isArray(raw)) {
    return raw.map(String).map((s) => s.trim()).filter(Boolean)
  }
  if (typeof raw !== 'string' || raw.trim() === '') return [...fallback]
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      const list = parsed.map(String).map((s) => s.trim()).filter(Boolean)
      return list.length > 0 ? list : [...fallback]
    }
  } catch {
    // comma-separated fallback
  }
  const split = raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
  return split.length > 0 ? split : [...fallback]
}

export function pickModelForTask(
  enabled: string[],
  catalog: ModelOption[],
  taskType: string
): string {
  const pool = catalog.filter((m) => enabled.includes(m.id))
  const list = pool.length > 0 ? pool : catalog
  const byCost = [...list].sort((a, b) => a.costRank - b.costRank)

  const wantTier: ModelTier[] =
    taskType === 'design' || taskType === 'long_dev' || taskType === 'test_fix'
      ? ['strong', 'standard', 'cheap']
      : taskType === 'explain' ||
          taskType === 'codegen' ||
          taskType === 'patch_multi' ||
          taskType === 'repo_analysis'
        ? ['standard', 'cheap', 'strong']
        : ['cheap', 'standard', 'strong']

  for (const tier of wantTier) {
    const hit = byCost.find((m) => m.tier === tier)
    if (hit) return hit.id
  }
  return byCost[0]?.id ?? catalog[0]?.id ?? ''
}

export function isKnownLlmModel(model: string): boolean {
  return OPENAI_MODEL_CATALOG.some((m) => m.id === model)
}

export function isKnownGeminiModel(model: string): boolean {
  return GEMINI_MODEL_CATALOG.some((m) => m.id === model)
}

export function isKnownWorkersAiModel(model: string): boolean {
  return WORKERS_MODEL_CATALOG.some((m) => m.id === model)
}

export const DEFAULT_COST_LIMITS = {
  cursor: 70,
  openai: 20,
  gemini: 10,
  workers: 5
} as const

export const USAGE_ENGINE_KEYS = ['cursor', 'openai', 'gemini', 'workers'] as const

export const ENGINE_LABELS: Record<(typeof USAGE_ENGINE_KEYS)[number], string> = {
  cursor: 'Cursor',
  openai: 'OpenAI',
  gemini: 'Gemini',
  workers: 'Workers AI'
}

/** Auto パイプライン既定（すべて有効） */
export const DEFAULT_ROUTER_ENGINES: Array<(typeof USAGE_ENGINE_KEYS)[number]> = [
  'workers',
  'gemini',
  'openai',
  'cursor'
]

export type RouterProfile = 'balanced' | 'cheapest' | 'quality'

export type RouterAutoPolicy = {
  ask_avoid_cursor: boolean
  cursor_requires_agent: boolean
  cursor_strong_signals_only: boolean
  prefer_cheap_models: boolean
  gemini_for_mid_tasks: boolean
  workers_max_chars: number
  fix_words_to_cursor: boolean
}

export const ROUTER_PROFILE_LABELS: Record<RouterProfile, string> = {
  balanced: 'バランス（おすすめ・標準）',
  cheapest: '最安優先',
  quality: '品質優先'
}

export const DEFAULT_ROUTER_PROFILE: RouterProfile = 'balanced'

export function routerPolicyPreset(profile: RouterProfile): RouterAutoPolicy {
  if (profile === 'cheapest') {
    return {
      ask_avoid_cursor: true,
      cursor_requires_agent: true,
      cursor_strong_signals_only: true,
      prefer_cheap_models: true,
      gemini_for_mid_tasks: true,
      workers_max_chars: 400,
      fix_words_to_cursor: false
    }
  }
  if (profile === 'quality') {
    return {
      ask_avoid_cursor: false,
      cursor_requires_agent: false,
      cursor_strong_signals_only: false,
      prefer_cheap_models: false,
      gemini_for_mid_tasks: false,
      workers_max_chars: 80,
      fix_words_to_cursor: true
    }
  }
  return {
    ask_avoid_cursor: true,
    cursor_requires_agent: true,
    cursor_strong_signals_only: true,
    prefer_cheap_models: true,
    gemini_for_mid_tasks: true,
    workers_max_chars: 200,
    fix_words_to_cursor: false
  }
}

export function parseRouterProfile(raw: unknown): RouterProfile {
  if (raw === 'cheapest' || raw === 'quality' || raw === 'balanced') return raw
  return DEFAULT_ROUTER_PROFILE
}

export function parseRouterAutoPolicy(
  raw: unknown,
  profile: RouterProfile = DEFAULT_ROUTER_PROFILE
): RouterAutoPolicy {
  const base = routerPolicyPreset(profile)
  if (typeof raw !== 'string' || raw.trim() === '') return base
  try {
    const parsed = JSON.parse(raw) as Partial<RouterAutoPolicy>
    return {
      ask_avoid_cursor: parsed.ask_avoid_cursor ?? base.ask_avoid_cursor,
      cursor_requires_agent: parsed.cursor_requires_agent ?? base.cursor_requires_agent,
      cursor_strong_signals_only:
        parsed.cursor_strong_signals_only ?? base.cursor_strong_signals_only,
      prefer_cheap_models: parsed.prefer_cheap_models ?? base.prefer_cheap_models,
      gemini_for_mid_tasks: parsed.gemini_for_mid_tasks ?? base.gemini_for_mid_tasks,
      workers_max_chars: Math.max(
        40,
        Math.min(800, Number(parsed.workers_max_chars ?? base.workers_max_chars) || base.workers_max_chars)
      ),
      fix_words_to_cursor: parsed.fix_words_to_cursor ?? base.fix_words_to_cursor
    }
  } catch {
    return base
  }
}

export function parseEngineList(
  raw: unknown,
  fallback: readonly (typeof USAGE_ENGINE_KEYS)[number][] = DEFAULT_ROUTER_ENGINES
): Array<(typeof USAGE_ENGINE_KEYS)[number]> {
  const allowed = new Set<string>(USAGE_ENGINE_KEYS)
  let list: string[] = []
  if (Array.isArray(raw)) {
    list = raw.map(String)
  } else if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) list = parsed.map(String)
      else list = raw.split(/[,\n]/).map((s) => s.trim())
    } catch {
      list = raw.split(/[,\n]/).map((s) => s.trim())
    }
  }
  const unique: Array<(typeof USAGE_ENGINE_KEYS)[number]> = []
  for (const item of list) {
    const id = item.trim().toLowerCase()
    if (!allowed.has(id)) continue
    const engine = id as (typeof USAGE_ENGINE_KEYS)[number]
    if (!unique.includes(engine)) unique.push(engine)
  }
  return unique.length > 0 ? unique : [...fallback]
}

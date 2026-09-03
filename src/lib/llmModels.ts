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
  { id: 'gpt-4o-mini', label: 'gpt-4o-mini（安価）', tier: 'cheap', costRank: 1 },
  { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini（安価）', tier: 'cheap', costRank: 2 },
  { id: 'gpt-4o', label: 'gpt-4o（標準）', tier: 'standard', costRank: 3 },
  { id: 'gpt-4.1', label: 'gpt-4.1（標準）', tier: 'standard', costRank: 4 },
  { id: 'o4-mini', label: 'o4-mini（強）', tier: 'strong', costRank: 5 },
  { id: 'o3-mini', label: 'o3-mini（強）', tier: 'strong', costRank: 6 }
]

export const GEMINI_MODEL_CATALOG: ModelOption[] = [
  { id: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite（安価）', tier: 'cheap', costRank: 1 },
  { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash（標準）', tier: 'standard', costRank: 2 },
  { id: 'gemini-3.5-flash', label: 'gemini-3.5-flash（標準）', tier: 'standard', costRank: 3 },
  { id: 'gemini-3.1-pro-preview', label: 'gemini-3.1-pro-preview（強）', tier: 'strong', costRank: 4 }
]

export const WORKERS_MODEL_CATALOG: ModelOption[] = [
  {
    id: '@cf/meta/llama-3.1-8b-instruct',
    label: 'Llama 3.1 8B（安価）',
    tier: 'cheap',
    costRank: 1
  },
  {
    id: '@cf/qwen/qwen2.5-coder-32b-instruct',
    label: 'Qwen2.5 Coder 32B（標準）',
    tier: 'standard',
    costRank: 2
  },
  {
    id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    label: 'Llama 3.3 70B（強）',
    tier: 'strong',
    costRank: 3
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

export const DEFAULT_LLM_MODEL = 'gpt-4o-mini'
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'
export const DEFAULT_CURSOR_MODEL = 'grok-4.6'
export const DEFAULT_WORKERS_MODEL = '@cf/meta/llama-3.1-8b-instruct'

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
  openai: ['gpt-4o-mini', 'gpt-4o'],
  gemini: ['gemini-2.5-flash-lite', 'gemini-2.5-flash'],
  workers: ['@cf/meta/llama-3.1-8b-instruct', '@cf/qwen/qwen2.5-coder-32b-instruct'],
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

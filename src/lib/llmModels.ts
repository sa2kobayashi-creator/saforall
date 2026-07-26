export const DEFAULT_LLM_MODEL = 'gpt-4o-mini'

/** よく使うモデル候補（自由入力も可） */
export const LLM_MODEL_OPTIONS = [
  'gpt-4o-mini',
  'gpt-4o',
  'gpt-4.1-mini',
  'gpt-4.1',
  'o4-mini',
  'o3-mini'
] as const

export function isKnownLlmModel(model: string): boolean {
  return (LLM_MODEL_OPTIONS as readonly string[]).includes(model)
}

import { join } from 'path'
import {
  ensureLocalDbReady,
  getLocalDbRoot,
  readJsonFile,
  writeJsonFile
} from './localDb'
import { getLocalSetting } from './settingsStore'

export type UsageBucket = { spent: number; limit: number; remaining: number }
export type MonthUsage = Record<string, UsageBucket>

type UsageFile = {
  month: string
  byEngine: Record<string, number>
}

const ENGINES = ['cursor', 'openai', 'gemini', 'claude', 'workers'] as const

function usagePath(): string {
  return join(getLocalDbRoot(), 'usage.json')
}

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function limitFor(engine: string): number {
  const key = `cost.${engine}.monthly_usd`
  const raw = getLocalSetting(key, '')
  const n = Number(raw)
  if (Number.isFinite(n) && n >= 0) return n
  const defaults: Record<string, number> = {
    cursor: 60,
    openai: 30,
    gemini: 20,
    claude: 30,
    workers: 10
  }
  return defaults[engine] ?? 30
}

async function loadUsage(): Promise<UsageFile> {
  await ensureLocalDbReady()
  const month = currentMonth()
  const file = await readJsonFile<UsageFile>(usagePath(), { month, byEngine: {} })
  if (file.month !== month) {
    return { month, byEngine: {} }
  }
  return file
}

export async function recordLocalUsage(params: {
  engine: string
  estimatedUsd?: number
}): Promise<MonthUsage> {
  const file = await loadUsage()
  const engine = ENGINES.includes(params.engine as (typeof ENGINES)[number])
    ? params.engine
    : 'openai'
  const add = Math.max(0, Number(params.estimatedUsd) || 0.002)
  file.byEngine[engine] = (file.byEngine[engine] ?? 0) + add
  await writeJsonFile(usagePath(), file)
  return summarizeUsage(file)
}

export async function getLocalUsageSummary(): Promise<{ month: string; usage: MonthUsage }> {
  const file = await loadUsage()
  return { month: file.month, usage: summarizeUsage(file) }
}

function summarizeUsage(file: UsageFile): MonthUsage {
  const usage: MonthUsage = {}
  for (const engine of ENGINES) {
    const spent = file.byEngine[engine] ?? 0
    const limit = limitFor(engine)
    usage[engine] = {
      spent,
      limit,
      remaining: Math.max(0, limit - spent)
    }
  }
  return usage
}

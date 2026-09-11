import { useEffect, useState, type FormEvent } from 'react'
import { ModelMultiSelect } from './ModelMultiSelect'
import {
  DEFAULT_COST_LIMITS,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CURSOR_MODEL,
  DEFAULT_ENABLED_MODELS,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_LLM_MODEL,
  DEFAULT_ROUTER_ENGINES,
  DEFAULT_ROUTER_PROFILE,
  DEFAULT_USER_PLAN,
  DEFAULT_WORKERS_MODEL,
  ENGINE_LABELS,
  ROUTER_PROFILE_LABELS,
  USAGE_ENGINE_KEYS,
  USER_PLAN_LABELS,
  parseEngineList,
  parseModelList,
  parseRouterAutoPolicy,
  parseRouterProfile,
  parseUserPlan,
  routerPolicyPreset,
  type ProviderEngine,
  type RouterAutoPolicy,
  type RouterProfile,
  type UserPlan
} from '../lib/llmModels'
import { parseLocale, useI18n } from '../i18n'
import {
  loadAutoSaveDelayMs,
  loadAutoSaveEnabled,
  saveAutoSaveDelayMs,
  saveAutoSaveEnabled
} from '../lib/autoSave'
import { KeybindingsEditor } from './KeybindingsEditor'
import { RouterGuideModal } from './RouterGuideModal'
import {
  DEFAULT_ENABLED_CATEGORIES,
  ROUTER_CATEGORIES,
  ROUTER_CATEGORY_GROUP_LABELS,
  parseEnabledCategories,
  type RouterCategoryId
} from '../lib/routerCategories'
import './SettingsPanel.css'

type Props = {
  open: boolean
  backendConnected: boolean
  backendMode?: 'php' | 'local'
  workspacePath?: string | null
  onClose: () => void
  onOpenUsage?: () => void
  onStatusMessage?: (message: string) => void
  onSaved?: () => void
}

type SettingsMap = Record<string, string | boolean>

type ByokProviderId = 'openai' | 'claude' | 'gemini' | 'workers'
type ByokPublicStatus = {
  providerId: ByokProviderId
  credentialId: string | null
  billingMode: 'BYOK' | null
  configured: boolean
  fingerprint: string
  createdAt: string | null
  lastVerifiedAt: string | null
  lastTestOk: boolean | null
  status: 'not_configured' | 'saved' | 'connected' | 'failed'
}

const BYOK_PROVIDERS: Array<{ id: ByokProviderId; label: string }> = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'claude', label: 'Claude' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'workers', label: 'Workers AI' }
]

function emptyByokStatus(id: ByokProviderId): ByokPublicStatus {
  return {
    providerId: id,
    credentialId: null,
    billingMode: null,
    configured: false,
    fingerprint: '',
    createdAt: null,
    lastVerifiedAt: null,
    lastTestOk: null,
    status: 'not_configured'
  }
}

/** Phase 2-C-3: unset / unknown → OFF. Mirrors parseFailoverEnabled in failover.ts. */
function parseFailoverEnabledSetting(raw: string | boolean | null | undefined): boolean {
  if (raw === true) return true
  const value = String(raw ?? '').trim().toLowerCase()
  return value === 'true' || value === '1' || value === 'yes' || value === 'on'
}

/** Phase 2-C-4: unset / invalid → 1; Ask UI max 3. */
function parseFailoverMaxAttemptsSetting(
  raw: string | number | boolean | null | undefined
): number {
  if (raw === null || raw === undefined || raw === '') return 1
  const n = typeof raw === 'number' ? raw : typeof raw === 'boolean' ? Number(raw) : Number(String(raw).trim())
  if (!Number.isFinite(n)) return 1
  const floored = Math.floor(n)
  if (floored < 1) return 1
  return Math.min(floored, 3)
}

function byokStatusLabel(status: ByokPublicStatus['status']): string {
  if (status === 'connected') return 'Connected'
  if (status === 'failed') return 'Failed'
  if (status === 'saved') return 'Saved'
  return 'Not configured'
}

function rowsFromByokList(credentials: ByokPublicStatus[]): ByokPublicStatus[] {
  return BYOK_PROVIDERS.map(
    (row) => credentials.find((item) => item.providerId === row.id) ?? emptyByokStatus(row.id)
  )
}

export function SettingsPanel({
  open,
  backendConnected,
  backendMode,
  workspacePath = null,
  onClose,
  onOpenUsage,
  onStatusMessage,
  onSaved
}: Props) {
  const { t, locale, setLocale, locales, localeLabels } = useI18n()
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState('https://api.openai.com/v1')
  const [openaiKey, setOpenaiKey] = useState('')
  const [openaiKeySet, setOpenaiKeySet] = useState(false)
  const [openaiModels, setOpenaiModels] = useState<string[]>([...DEFAULT_ENABLED_MODELS.openai])

  const [geminiKey, setGeminiKey] = useState('')
  const [geminiKeySet, setGeminiKeySet] = useState(false)
  const [geminiModels, setGeminiModels] = useState<string[]>([...DEFAULT_ENABLED_MODELS.gemini])

  const [claudeKey, setClaudeKey] = useState('')
  const [claudeKeySet, setClaudeKeySet] = useState(false)
  const [claudeModels, setClaudeModels] = useState<string[]>([...DEFAULT_ENABLED_MODELS.claude])

  const [cursorKey, setCursorKey] = useState('')
  const [cursorKeySet, setCursorKeySet] = useState(false)
  const [cursorModels, setCursorModels] = useState<string[]>([...DEFAULT_ENABLED_MODELS.cursor])
  const [cursorRuntime, setCursorRuntime] = useState<'auto' | 'local' | 'cloud'>('auto')

  const [workersAccountId, setWorkersAccountId] = useState('')
  const [workersGatewayId, setWorkersGatewayId] = useState('default')
  const [workersToken, setWorkersToken] = useState('')
  const [workersTokenSet, setWorkersTokenSet] = useState(false)
  const [workersModels, setWorkersModels] = useState<string[]>([...DEFAULT_ENABLED_MODELS.workers])

  const [limitCursor, setLimitCursor] = useState(String(DEFAULT_COST_LIMITS.cursor))
  const [limitOpenai, setLimitOpenai] = useState(String(DEFAULT_COST_LIMITS.openai))
  const [limitGemini, setLimitGemini] = useState(String(DEFAULT_COST_LIMITS.gemini))
  const [limitClaude, setLimitClaude] = useState(String(DEFAULT_COST_LIMITS.claude))
  const [limitWorkers, setLimitWorkers] = useState(String(DEFAULT_COST_LIMITS.workers))
  const [claudePrepaid, setClaudePrepaid] = useState('')
  const [claudePrepaidWarn, setClaudePrepaidWarn] = useState('1')
  const [userPlan, setUserPlan] = useState<UserPlan>(DEFAULT_USER_PLAN)
  const [routerEngines, setRouterEngines] = useState<Array<(typeof USAGE_ENGINE_KEYS)[number]>>([
    ...DEFAULT_ROUTER_ENGINES
  ])
  const [routerProfile, setRouterProfile] = useState<RouterProfile>(DEFAULT_ROUTER_PROFILE)
  const [routerPolicy, setRouterPolicy] = useState<RouterAutoPolicy>(() =>
    routerPolicyPreset(DEFAULT_ROUTER_PROFILE)
  )
  const [enabledCategories, setEnabledCategories] = useState<RouterCategoryId[]>([
    ...DEFAULT_ENABLED_CATEGORIES
  ])
  const [routerGuideOpen, setRouterGuideOpen] = useState(false)

  const [usageRows, setUsageRows] = useState<
    Array<{ engine: string; spent: string; limit: string }>
  >([])
  const [status, setStatus] = useState<string | null>(null)
  const [testStatus, setTestStatus] = useState<
    Partial<Record<ProviderEngine, { ok: boolean; text: string }>>
  >({})
  const [saving, setSaving] = useState(false)
  const [testingEngine, setTestingEngine] = useState<ProviderEngine | null>(null)
  const [autoSave, setAutoSave] = useState(true)
  const [autoSaveDelay, setAutoSaveDelay] = useState(1500)
  const [settingsTab, setSettingsTab] = useState<'keys' | 'auto' | 'budget' | 'advanced'>('keys')
  const [failoverEnabled, setFailoverEnabled] = useState(false)
  const [failoverMaxAttempts, setFailoverMaxAttempts] = useState(1)
  const [byokRows, setByokRows] = useState<ByokPublicStatus[]>(
    BYOK_PROVIDERS.map((row) => emptyByokStatus(row.id))
  )
  const [byokInput, setByokInput] = useState<Record<ByokProviderId, string>>({
    openai: '',
    claude: '',
    gemini: '',
    workers: ''
  })
  const [byokBusy, setByokBusy] = useState<ByokProviderId | null>(null)
  const [byokMessage, setByokMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setAutoSave(loadAutoSaveEnabled())
    setAutoSaveDelay(loadAutoSaveDelayMs())
  }, [open])

  useEffect(() => {
    if (!open) return

    let cancelled = false
    ;(async () => {
      const applySettings = (settings: SettingsMap) => {
        const base =
          (typeof settings['llm.openai.base_url'] === 'string' && settings['llm.openai.base_url']) ||
          (typeof settings['llm.base_url'] === 'string' ? settings['llm.base_url'] : '')
        if (base) setOpenaiBaseUrl(base)

        setOpenaiModels(
          parseModelList(settings['llm.openai.models'], DEFAULT_ENABLED_MODELS.openai)
        )
        setGeminiModels(
          parseModelList(settings['llm.gemini.models'], DEFAULT_ENABLED_MODELS.gemini)
        )
        setClaudeModels(
          parseModelList(settings['llm.claude.models'], DEFAULT_ENABLED_MODELS.claude)
        )
        setCursorModels(
          parseModelList(settings['llm.cursor.models'], DEFAULT_ENABLED_MODELS.cursor)
        )
        setWorkersModels(
          parseModelList(
            settings['llm.workers.models'] ?? settings['llm.simple.models'],
            DEFAULT_ENABLED_MODELS.workers
          )
        )

        const account =
          (typeof settings['llm.workers.account_id'] === 'string' &&
            settings['llm.workers.account_id']) ||
          (typeof settings['llm.simple.account_id'] === 'string'
            ? settings['llm.simple.account_id']
            : '')
        if (account) setWorkersAccountId(account)

        const gateway =
          (typeof settings['llm.workers.gateway_id'] === 'string' &&
            settings['llm.workers.gateway_id']) ||
          (typeof settings['llm.simple.gateway_id'] === 'string'
            ? settings['llm.simple.gateway_id']
            : '')
        if (gateway) setWorkersGatewayId(gateway || 'default')

        setOpenaiKeySet(
          settings['llm.openai.api_key_set'] === true || settings['llm.api_key_set'] === true
        )
        setGeminiKeySet(settings['llm.gemini.api_key_set'] === true)
        setClaudeKeySet(settings['llm.claude.api_key_set'] === true)
        setCursorKeySet(settings['llm.cursor.api_key_set'] === true)
        {
          const runtime = settings['llm.cursor.runtime']
          if (runtime === 'local' || runtime === 'cloud' || runtime === 'auto') {
            setCursorRuntime(runtime)
          }
        }
        setWorkersTokenSet(
          settings['llm.workers.api_token_set'] === true ||
            settings['llm.simple.api_token_set'] === true
        )
        setOpenaiKey('')
        setGeminiKey('')
        setClaudeKey('')
        setCursorKey('')
        setWorkersToken('')

        if (typeof settings['cost.cursor.monthly_usd'] === 'string') {
          setLimitCursor(settings['cost.cursor.monthly_usd'])
        }
        if (typeof settings['cost.openai.monthly_usd'] === 'string') {
          setLimitOpenai(settings['cost.openai.monthly_usd'])
        }
        if (typeof settings['cost.gemini.monthly_usd'] === 'string') {
          setLimitGemini(settings['cost.gemini.monthly_usd'])
        }
        if (typeof settings['cost.claude.monthly_usd'] === 'string') {
          setLimitClaude(settings['cost.claude.monthly_usd'])
        }
        if (typeof settings['cost.workers.monthly_usd'] === 'string') {
          setLimitWorkers(settings['cost.workers.monthly_usd'])
        }
        if (typeof settings['llm.claude.prepaid_remaining_usd'] === 'string') {
          setClaudePrepaid(settings['llm.claude.prepaid_remaining_usd'])
        }
        if (typeof settings['llm.claude.prepaid_warn_usd'] === 'string') {
          setClaudePrepaidWarn(settings['llm.claude.prepaid_warn_usd'] || '1')
        }
        setUserPlan(parseUserPlan(settings['billing.user_plan']))
        setRouterEngines(parseEngineList(settings['router.enabled_engines'], DEFAULT_ROUTER_ENGINES))
        setEnabledCategories(
          parseEnabledCategories(settings['router.enabled_categories'] ?? DEFAULT_ENABLED_CATEGORIES)
        )
        // Phase 2-C-3: unset → OFF
        setFailoverEnabled(parseFailoverEnabledSetting(settings['failover.enabled']))
        // Phase 2-C-4: unset → 1
        setFailoverMaxAttempts(parseFailoverMaxAttemptsSetting(settings['failover.max_attempts']))
        if (typeof settings['app.locale'] === 'string') {
          setLocale(parseLocale(settings['app.locale']))
        }
        const profile = parseRouterProfile(settings['router.profile'])
        setRouterProfile(profile)
        setRouterPolicy(parseRouterAutoPolicy(settings['router.auto_policy'], profile))
      }

      if (typeof window.saforall.listByokCredentials === 'function') {
        const listed = await window.saforall.listByokCredentials()
        if (!cancelled && listed.ok && listed.credentials) {
          setByokRows(rowsFromByokList(listed.credentials))
        }
      }

      if (!backendConnected) {
        if (typeof window.saforall.getLocalSettings === 'function') {
          const local = await window.saforall.getLocalSettings()
          if (!cancelled && local) applySettings(local)
          if (!cancelled) {
            setStatus(t('settings.loadingLocal'))
            setUsageRows([])
          }
        }
        return
      }

      const [settingsResult, usageResult] = await Promise.all([
        window.saforall.request<{ settings: SettingsMap }>('GET', '/settings'),
        window.saforall.request<{
          usage: Record<string, { spent: number; limit: number; remaining: number }>
        }>('GET', '/ai/usage')
      ])
      if (cancelled) return

      if (settingsResult.ok && settingsResult.data?.settings) {
        applySettings(settingsResult.data.settings)
      }

      if (usageResult.ok && usageResult.data?.usage) {
        setUsageRows(
          USAGE_ENGINE_KEYS.map((key) => {
            const row = usageResult.data!.usage[key]
            return {
              engine: key,
              spent: (row?.spent ?? 0).toFixed(2),
              limit: String(row?.limit ?? DEFAULT_COST_LIMITS[key])
            }
          })
        )
      } else {
        setUsageRows([])
      }
      setStatus(null)
      setTestStatus({})
    })()

    return () => {
      cancelled = true
    }
  }, [open, backendConnected, setLocale, t])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const preferred = (_engine: ProviderEngine, list: string[], fallback: string) =>
    list[0] ?? fallback

  const renderTestResult = (engine: ProviderEngine) => {
    const row = testStatus[engine]
    if (!row) return null
    return (
      <p className={`settings-test-result${row.ok ? ' is-ok' : ' is-error'}`}>{row.text}</p>
    )
  }

  const setEngineTestStatus = (engine: ProviderEngine, ok: boolean, text: string) => {
    setTestStatus((prev) => ({ ...prev, [engine]: { ok, text } }))
  }

  const testEngine = async (engine: ProviderEngine) => {
    if (!backendConnected) {
      setEngineTestStatus(engine, false, t('settings.testUnavailable'))
      return
    }

    const pendingKey =
      engine === 'openai'
        ? openaiKey.trim() !== ''
        : engine === 'gemini'
          ? geminiKey.trim() !== ''
          : engine === 'claude'
            ? claudeKey.trim() !== ''
            : engine === 'cursor'
              ? cursorKey.trim() !== ''
              : workersToken.trim() !== ''

    if (pendingKey) {
      setEngineTestStatus(
        engine,
        false,
        'キーを入力した直後は、先に「保存」してから接続テストしてください'
      )
      return
    }

    const configured =
      engine === 'openai'
        ? openaiKeySet
        : engine === 'gemini'
          ? geminiKeySet
          : engine === 'claude'
            ? claudeKeySet
            : engine === 'cursor'
              ? cursorKeySet
              : workersTokenSet && workersAccountId.trim() !== ''

    if (!configured) {
      setEngineTestStatus(engine, false, '設定が不足しています（キー等を保存してください）')
      return
    }

    const model =
      engine === 'openai'
        ? preferred('openai', openaiModels, DEFAULT_LLM_MODEL)
        : engine === 'gemini'
          ? preferred('gemini', geminiModels, DEFAULT_GEMINI_MODEL)
          : engine === 'claude'
            ? preferred('claude', claudeModels, DEFAULT_CLAUDE_MODEL)
            : engine === 'cursor'
              ? preferred('cursor', cursorModels, DEFAULT_CURSOR_MODEL)
              : preferred('workers', workersModels, DEFAULT_WORKERS_MODEL)

    setTestingEngine(engine)
    setTestStatus((prev) => {
      const next = { ...prev }
      delete next[engine]
      return next
    })
    const result = await window.saforall.request<{
      ok: boolean
      model: string
      base_url: string
      sample: string
      note?: string
    }>('POST', '/ai/test', { engine, model })
    setTestingEngine(null)

    if (!result.ok) {
      setEngineTestStatus(engine, false, result.error?.message ?? '接続テストに失敗しました')
      return
    }

    setEngineTestStatus(
      engine,
      true,
      `接続OK（${result.data?.model}）: ${result.data?.sample ?? ''}`
    )
  }

  const patchByokRow = (status: ByokPublicStatus): void => {
    setByokRows((prev) => prev.map((row) => (row.providerId === status.providerId ? status : row)))
  }

  const saveByok = async (providerId: ByokProviderId): Promise<void> => {
    const secret = byokInput[providerId].trim()
    if (!secret) {
      setByokMessage('新しい API Key を入力してから保存してください')
      return
    }
    setByokBusy(providerId)
    setByokMessage(null)
    const result = await window.saforall.saveByokCredential({ providerId, secret })
    setByokBusy(null)
    if (!result.ok || !result.status) {
      setByokMessage(result.error?.message ?? 'BYOK の保存に失敗しました')
      return
    }
    patchByokRow(result.status)
    setByokInput((prev) => ({ ...prev, [providerId]: '' }))
    setByokMessage(`${BYOK_PROVIDERS.find((row) => row.id === providerId)?.label} を保存しました`)
  }

  const testByok = async (providerId: ByokProviderId): Promise<void> => {
    setByokBusy(providerId)
    setByokMessage(null)
    const result = await window.saforall.testByokCredential(providerId)
    setByokBusy(null)
    if (result.status) patchByokRow(result.status)
    setByokMessage(result.ok ? `接続OK: ${result.message ?? ''}` : result.error?.message ?? result.message ?? '接続テストに失敗しました')
  }

  const deleteByok = async (providerId: ByokProviderId): Promise<void> => {
    setByokBusy(providerId)
    setByokMessage(null)
    const result = await window.saforall.deleteByokCredential(providerId)
    setByokBusy(null)
    if (!result.ok || !result.status) {
      setByokMessage(result.error?.message ?? 'BYOK の削除に失敗しました')
      return
    }
    patchByokRow(result.status)
    setByokMessage(`${BYOK_PROVIDERS.find((row) => row.id === providerId)?.label} の BYOK を削除しました（Development へフォールバックします）`)
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()

    if (routerEngines.length === 0) {
      setStatus('Auto パイプラインは 1 つ以上の AI を有効にしてください')
      return
    }

    setSaving(true)
    setStatus(null)

    const settings: Record<string, string> = {
      'app.locale': locale,
      'router.enabled_engines': JSON.stringify(routerEngines),
      'router.enabled_categories': JSON.stringify(enabledCategories),
      'router.profile': routerProfile,
      'router.auto_policy': JSON.stringify(routerPolicy),
      'failover.enabled': failoverEnabled ? 'true' : 'false',
      'failover.max_attempts': String(parseFailoverMaxAttemptsSetting(failoverMaxAttempts)),
      'llm.openai.base_url': openaiBaseUrl.trim(),
      'llm.openai.models': JSON.stringify(openaiModels),
      'llm.openai.model': preferred('openai', openaiModels, DEFAULT_LLM_MODEL),
      'llm.model': preferred('openai', openaiModels, DEFAULT_LLM_MODEL),
      'llm.gemini.models': JSON.stringify(geminiModels),
      'llm.gemini.model': preferred('gemini', geminiModels, DEFAULT_GEMINI_MODEL),
      'llm.claude.models': JSON.stringify(claudeModels),
      'llm.claude.model': preferred('claude', claudeModels, DEFAULT_CLAUDE_MODEL),
      'llm.cursor.models': JSON.stringify(cursorModels),
      'llm.cursor.model': preferred('cursor', cursorModels, DEFAULT_CURSOR_MODEL),
      'llm.cursor.runtime': cursorRuntime,
      'llm.workers.account_id': workersAccountId.trim(),
      'llm.workers.gateway_id': workersGatewayId.trim() || 'default',
      'llm.workers.models': JSON.stringify(workersModels),
      'llm.workers.model': preferred('workers', workersModels, DEFAULT_WORKERS_MODEL),
      'llm.simple.account_id': workersAccountId.trim(),
      'llm.simple.gateway_id': workersGatewayId.trim() || 'default',
      'llm.simple.models': JSON.stringify(workersModels),
      'llm.simple.model': preferred('workers', workersModels, DEFAULT_WORKERS_MODEL),
      'cost.cursor.monthly_usd': limitCursor.trim() || String(DEFAULT_COST_LIMITS.cursor),
      'cost.openai.monthly_usd': limitOpenai.trim() || String(DEFAULT_COST_LIMITS.openai),
      'cost.gemini.monthly_usd': limitGemini.trim() || String(DEFAULT_COST_LIMITS.gemini),
      'cost.claude.monthly_usd': limitClaude.trim() || String(DEFAULT_COST_LIMITS.claude),
      'cost.workers.monthly_usd': limitWorkers.trim() || String(DEFAULT_COST_LIMITS.workers),
      'llm.claude.prepaid_remaining_usd': claudePrepaid.trim(),
      'llm.claude.prepaid_warn_usd': claudePrepaidWarn.trim() || '1',
      'billing.user_plan': userPlan
    }
    if (openaiKey.trim() !== '') {
      settings['llm.openai.api_key'] = openaiKey.trim()
      settings['llm.api_key'] = openaiKey.trim()
    }
    if (geminiKey.trim() !== '') {
      settings['llm.gemini.api_key'] = geminiKey.trim()
    }
    if (claudeKey.trim() !== '') {
      settings['llm.claude.api_key'] = claudeKey.trim()
    }
    if (cursorKey.trim() !== '') {
      settings['llm.cursor.api_key'] = cursorKey.trim()
    }
    if (workersToken.trim() !== '') {
      settings['llm.workers.api_token'] = workersToken.trim()
      settings['llm.simple.api_token'] = workersToken.trim()
    }

    if (!backendConnected) {
      if (typeof window.saforall.putLocalSettings !== 'function') {
        setSaving(false)
        setStatus(t('settings.offlineSave'))
        return
      }
      const local = await window.saforall.putLocalSettings(settings)
      setSaving(false)
      if (!local.ok) {
        setStatus(t('settings.saveFailed'))
        return
      }
      if (openaiKey.trim() !== '') {
        setOpenaiKeySet(true)
        setOpenaiKey('')
      }
      if (geminiKey.trim() !== '') {
        setGeminiKeySet(true)
        setGeminiKey('')
      }
      if (claudeKey.trim() !== '') {
        setClaudeKeySet(true)
        setClaudeKey('')
      }
      if (cursorKey.trim() !== '') {
        setCursorKeySet(true)
        setCursorKey('')
      }
      if (workersToken.trim() !== '') {
        setWorkersTokenSet(true)
        setWorkersToken('')
      }
      setStatus(t('settings.savedLocal'))
      onStatusMessage?.(t('settings.savedLocal'))
      onSaved?.()
      return
    }

    const result = await window.saforall.request('PUT', '/settings', { settings })
    setSaving(false)

    if (!result.ok) {
      setStatus(result.error?.message ?? t('settings.saveFailed'))
      return
    }

    if (openaiKey.trim() !== '') {
      setOpenaiKeySet(true)
      setOpenaiKey('')
    }
    if (geminiKey.trim() !== '') {
      setGeminiKeySet(true)
      setGeminiKey('')
    }
    if (claudeKey.trim() !== '') {
      setClaudeKeySet(true)
      setClaudeKey('')
    }
    if (cursorKey.trim() !== '') {
      setCursorKeySet(true)
      setCursorKey('')
    }
    if (workersToken.trim() !== '') {
      setWorkersTokenSet(true)
      setWorkersToken('')
    }
    setStatus(t('settings.saved'))
    onSaved?.()
  }

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label={t('settings.aria')}>
      <div className="settings-panel">
        <div className="settings-header">
          <h2>{t('settings.title')}</h2>
        </div>

        {backendConnected && backendMode === 'local' && (
          <p className="settings-info">{t('settings.localModeHint')}</p>
        )}
        {!backendConnected && (
          <p className="settings-warning">{t('settings.backendWarning')}</p>
        )}

        <form className="settings-form" onSubmit={(event) => void onSubmit(event)}>
          <div className="settings-tabs" role="tablist" aria-label="設定カテゴリ">
            {(
              [
                ['keys', 'API キー'],
                ['auto', 'Auto'],
                ['budget', '予算'],
                ['advanced', '詳細']
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={settingsTab === id}
                className={settingsTab === id ? 'is-active' : undefined}
                onClick={() => setSettingsTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <div hidden={settingsTab !== 'advanced'}>
          <h3 className="settings-section-title">{t('settings.localeSection')}</h3>
          <p className="settings-hint">{t('settings.localeHint')}</p>
          <label>
            {t('settings.localeSection')}
            <select
              value={locale}
              onChange={(event) => setLocale(parseLocale(event.target.value))}
            >
              {locales.map((code) => (
                <option key={code} value={code}>
                  {localeLabels[code]}
                </option>
              ))}
            </select>
          </label>

          <div className="settings-backup">
            <h3 className="settings-section-title">バックアップ</h3>
            <p className="settings-hint">
              API キーを含む設定を JSON で書き出し／読み込みできます。ファイルの取り扱いに注意してください。
            </p>
            <div className="settings-backup-actions">
              <button
                type="button"
                className="settings-close"
                onClick={() => {
                  void (async () => {
                    if (typeof window.saforall.exportSettingsFile !== 'function') {
                      setStatus('エクスポート機能がありません')
                      return
                    }
                    const result = await window.saforall.exportSettingsFile()
                    if (!result.ok) {
                      setStatus(result.message ?? 'エクスポートをキャンセルしました')
                      return
                    }
                    setStatus(`エクスポートしました: ${result.path}`)
                    onStatusMessage?.(`設定をエクスポート: ${result.path}`)
                  })()
                }}
              >
                エクスポート…
              </button>
              <button
                type="button"
                className="settings-close"
                onClick={() => {
                  void (async () => {
                    if (typeof window.saforall.importSettingsFile !== 'function') {
                      setStatus('インポート機能がありません')
                      return
                    }
                    const result = await window.saforall.importSettingsFile()
                    if (!result.ok) {
                      setStatus(result.message ?? 'インポートをキャンセルしました')
                      return
                    }
                    setStatus(`インポートしました: ${result.path}`)
                    onStatusMessage?.(`設定をインポート: ${result.path}`)
                    onSaved?.()
                  })()
                }}
              >
                インポート…
              </button>
            </div>
          </div>
          </div>

          <div hidden={settingsTab !== 'auto'}>
          <div className="settings-section-head">
            <h3 className="settings-section-title">Auto パイプライン</h3>
            <button
              type="button"
              className="settings-link-btn"
              onClick={() => setRouterGuideOpen(true)}
            >
              説明・設定例
            </button>
          </div>
          <p className="settings-hint">
            チャットで「自動」を選んだときの振り分け方針です。標準は「バランス（おすすめ）」＝安価分散の改善版です。
          </p>

          <label className="router-engine-item">
            <span>Failover（Provider 障害時に切替）</span>
            <input
              type="checkbox"
              checked={failoverEnabled}
              onChange={() => setFailoverEnabled((current) => !current)}
            />
          </label>
          <label>
            最大 Failover 回数（切替回数）
            <input
              type="number"
              min={1}
              max={3}
              value={failoverMaxAttempts}
              disabled={!failoverEnabled}
              onChange={(event) => {
                setFailoverMaxAttempts(parseFailoverMaxAttemptsSetting(event.target.value))
              }}
            />
          </label>
          <p className="settings-hint">
            未設定時は Failover OFF・回数 1 です。Ask は最大 3 回、Agent は候補が OpenAI/Claude
            のみのため最大 1 回です。クレジット不足の切替は従来の Credit fallback が担当します。
          </p>

          <label>
            Auto プロファイル
            <select
              value={routerProfile}
              disabled={!backendConnected}
              onChange={(event) => {
                const next = parseRouterProfile(event.target.value)
                setRouterProfile(next)
                setRouterPolicy(routerPolicyPreset(next))
              }}
            >
              {(Object.keys(ROUTER_PROFILE_LABELS) as RouterProfile[]).map((key) => (
                <option key={key} value={key}>
                  {ROUTER_PROFILE_LABELS[key]}
                </option>
              ))}
            </select>
          </label>

          <div className="router-policy" role="group" aria-label="Auto 詳細オプション">
            {(
              [
                ['ask_avoid_cursor', 'Ask では Cursor を使わない'],
                ['cursor_requires_agent', 'Cursor は Agent モードのときだけ'],
                ['cursor_strong_signals_only', 'Cursor は強い修正シグナル時のみ'],
                ['prefer_cheap_models', 'モデルは安い候補を優先'],
                ['gemini_for_mid_tasks', '説明・要約は Gemini を優先'],
                ['fix_words_to_cursor', '「直して」等で即 Cursor（非推奨）']
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="router-engine-item">
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={Boolean(routerPolicy[key])}
                  disabled={!backendConnected}
                  onChange={() => {
                    setRouterPolicy((current) => ({
                      ...current,
                      [key]: !current[key]
                    }))
                  }}
                />
              </label>
            ))}
            <label>
              Workers 短文判定の文字数上限
              <input
                type="number"
                min={40}
                max={800}
                value={routerPolicy.workers_max_chars}
                disabled={!backendConnected}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setRouterPolicy((current) => ({
                    ...current,
                    workers_max_chars: Number.isFinite(value)
                      ? Math.max(40, Math.min(800, value))
                      : current.workers_max_chars
                  }))
                }}
              />
            </label>
          </div>

          <p className="settings-hint">
            有効エンジン: オフにした AI は Auto では選ばれません（固定選択は可能）。
          </p>
          <div className="router-engines" role="group" aria-label="Auto 有効エンジン">
            {USAGE_ENGINE_KEYS.map((key) => (
              <label key={key} className="router-engine-item">
                <span>{ENGINE_LABELS[key]}</span>
                <input
                  type="checkbox"
                  checked={routerEngines.includes(key)}
                  onChange={() => {
                    setRouterEngines((current) => {
                      if (current.includes(key)) {
                        if (current.length <= 1) return current
                        return current.filter((item) => item !== key)
                      }
                      return [...current, key]
                    })
                  }}
                />
              </label>
            ))}
          </div>

          <p className="settings-hint">
            用途カテゴリ: チャットの「自動」時に選べるカテゴリです。オフにすると選択・自動検出から外れます。
          </p>
          <div className="router-engines" role="group" aria-label="Auto 用途カテゴリ">
            {(['dev', 'knowledge', 'work', 'media'] as const).map((group) => (
              <div key={group} className="router-category-group">
                <div className="router-category-group-title">{ROUTER_CATEGORY_GROUP_LABELS[group]}</div>
                {ROUTER_CATEGORIES.filter((row) => row.group === group).map((row) => (
                  <label key={row.id} className="router-engine-item" title={row.hint}>
                    <span>
                      {row.label}
                      <span className="router-category-hint"> — {row.hint}</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={enabledCategories.includes(row.id)}
                      disabled={!backendConnected}
                      onChange={() => {
                        setEnabledCategories((current) => {
                          if (current.includes(row.id)) {
                            return current.filter((id) => id !== row.id)
                          }
                          return [...current, row.id]
                        })
                      }}
                    />
                  </label>
                ))}
              </div>
            ))}
          </div>

          <RouterGuideModal open={routerGuideOpen} onClose={() => setRouterGuideOpen(false)} />

          </div>

          <div className="settings-tab-panel" hidden={settingsTab !== 'budget'}>
            <h3 className="settings-section-title">月額上限</h3>
            <p className="settings-hint">
              Provider 上限（開発者側の API 予算）と、ユーザープラン上限（販売時の利用者枠）を分けて管理します。
              Auto は推定コストが残予算を超える Provider を避けます。
            </p>

            <label className="settings-field">
              <span className="settings-field-label">ユーザープラン</span>
              <select
                value={userPlan}
                disabled={!backendConnected}
                onChange={(event) => setUserPlan(parseUserPlan(event.target.value))}
              >
                {(Object.keys(USER_PLAN_LABELS) as UserPlan[]).map((plan) => (
                  <option key={plan} value={plan}>
                    {USER_PLAN_LABELS[plan]}
                  </option>
                ))}
              </select>
            </label>
            <p className="settings-hint">
              ローカル開発は Unlimited 推奨。販売時は Free / Light / Standard で利用者ごとの月枠を制限します。
            </p>

            {usageRows.length > 0 && (
              <div className="settings-budget-usage" aria-label="今月の概算">
                <div className="settings-budget-usage-title">今月の概算</div>
                <ul>
                  {usageRows.map((row) => (
                    <li key={row.engine}>
                      <span className="settings-budget-engine">{row.engine}</span>
                      <span className="settings-budget-spent">
                        ${row.spent} / ${row.limit}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {onOpenUsage && (
              <button
                type="button"
                className="settings-secondary"
                onClick={() => {
                  onClose()
                  onOpenUsage()
                }}
              >
                使用量の詳細を見る
              </button>
            )}

            <h3 className="settings-section-title">Anthropic（Claude）チャージ残</h3>
            <p className="settings-hint">
              Anthropic は残高 API を公開していないため、console で確認した残りをここに手入力します。
              Claude 利用のたびにアプリ概算で減算し、0 になると Auto は Claude を避けます。$5
              購入直後なら「5」と入れてください。
            </p>
            <div className="settings-budget-grid" role="group" aria-label="Anthropic チャージ残">
              <label className="settings-budget-item">
                <span>残り USD</span>
                <input
                  inputMode="decimal"
                  placeholder="例: 5"
                  value={claudePrepaid}
                  onChange={(event) => setClaudePrepaid(event.target.value)}
                />
              </label>
              <label className="settings-budget-item">
                <span>警告しきい値</span>
                <input
                  inputMode="decimal"
                  value={claudePrepaidWarn}
                  onChange={(event) => setClaudePrepaidWarn(event.target.value)}
                />
              </label>
            </div>
            <p className="settings-hint">
              空欄 = 追跡しない（従来どおり）。Anthropic 側で切れた場合も、エラー後に 0
              へ自動更新します。
            </p>

            <h3 className="settings-section-title">Provider 月上限（USD）</h3>
            <div className="settings-budget-grid" role="group" aria-label="Provider 月上限">
              <label className="settings-budget-item">
                <span>Cursor</span>
                <input
                  inputMode="decimal"
                  value={limitCursor}
                  onChange={(event) => setLimitCursor(event.target.value)}
                />
              </label>
              <label className="settings-budget-item">
                <span>OpenAI</span>
                <input
                  inputMode="decimal"
                  value={limitOpenai}
                  onChange={(event) => setLimitOpenai(event.target.value)}
                />
              </label>
              <label className="settings-budget-item">
                <span>Gemini</span>
                <input
                  inputMode="decimal"
                  value={limitGemini}
                  onChange={(event) => setLimitGemini(event.target.value)}
                />
              </label>
              <label className="settings-budget-item">
                <span>Claude</span>
                <input
                  inputMode="decimal"
                  value={limitClaude}
                  onChange={(event) => setLimitClaude(event.target.value)}
                />
              </label>
              <label className="settings-budget-item">
                <span>Workers AI</span>
                <input
                  inputMode="decimal"
                  value={limitWorkers}
                  onChange={(event) => setLimitWorkers(event.target.value)}
                />
              </label>
            </div>
          </div>

          <div hidden={settingsTab !== 'keys'}>
          <div className="settings-section-head">
            <h3 className="settings-section-title">自分の API Key（BYOK）</h3>
          </div>
          <p className="settings-hint">
            ユーザー自身のキーを OS 保護つきで暗号化保存します。優先順位は BYOK → 開発 settings → 開発
            env です。保存済みキーは再表示しません。Cursor は対象外です。Workers AI の Account ID /
            Gateway は下の開発設定を使います。
          </p>
          {byokMessage ? <p className="settings-hint">{byokMessage}</p> : null}
          {BYOK_PROVIDERS.map((row) => {
            const current = byokRows.find((item) => item.providerId === row.id) ?? emptyByokStatus(row.id)
            const mask = current.configured
              ? `******** …${current.fingerprint || '****'}`
              : '未保存'
            return (
              <div className="settings-byok-row" key={row.id}>
                <div className="settings-byok-head">
                  <strong>{row.label}</strong>
                  <span className={`settings-byok-status is-${current.status}`}>
                    {byokStatusLabel(current.status)}
                  </span>
                </div>
                <p className="settings-byok-mask">{mask}</p>
                {current.lastVerifiedAt ? (
                  <p className="settings-hint">最終確認: {current.lastVerifiedAt}</p>
                ) : null}
                <label>
                  新しい API Key
                  <input
                    type="password"
                    value={byokInput[row.id]}
                    onChange={(event) =>
                      setByokInput((prev) => ({ ...prev, [row.id]: event.target.value }))
                    }
                    autoComplete="off"
                    placeholder={current.configured ? '変更する場合のみ入力' : ''}
                  />
                </label>
                <div className="settings-byok-actions">
                  <button
                    type="button"
                    className="settings-test-btn"
                    disabled={byokBusy !== null || byokInput[row.id].trim() === ''}
                    onClick={() => void saveByok(row.id)}
                  >
                    {byokBusy === row.id ? '処理中…' : '保存'}
                  </button>
                  <button
                    type="button"
                    className="settings-test-btn"
                    disabled={byokBusy !== null || !current.configured}
                    onClick={() => void testByok(row.id)}
                  >
                    接続テスト
                  </button>
                  <button
                    type="button"
                    className="settings-test-btn"
                    disabled={byokBusy !== null || !current.configured}
                    onClick={() => void deleteByok(row.id)}
                  >
                    削除
                  </button>
                </div>
              </div>
            )
          })}

          <div className="settings-section-head">
            <h3 className="settings-section-title">開発 Credential</h3>
          </div>
          <p className="settings-hint">
            開発用の settings / 環境変数です。BYOK が無い Provider だけ使います。Cursor は従来どおり
            Development / @cursor/sdk です。
          </p>
          <ul className="settings-hint">
            <li>OpenAI: {openaiKeySet || openaiKey.trim() ? 'Connected' : 'Not configured'} · Development</li>
            <li>Gemini: {geminiKeySet || geminiKey.trim() ? 'Connected' : 'Not configured'} · Development</li>
            <li>Claude: {claudeKeySet || claudeKey.trim() ? 'Connected' : 'Not configured'} · Development</li>
            <li>
              Workers AI: {workersTokenSet || workersToken.trim() ? 'Connected' : 'Not configured'} ·
              Development
            </li>
            <li>Cursor: {cursorKeySet || cursorKey.trim() ? 'Connected' : 'Not configured'} · Coding Agent</li>
          </ul>

          <div className="settings-section-head">
            <h3 className="settings-section-title">Workers AI モデル（複数選択）</h3>
            <button
              type="button"
              className="settings-test-btn"
              disabled={
                !backendConnected ||
                (!workersTokenSet && workersToken.trim() === '') ||
                testingEngine !== null
              }
              onClick={() => void testEngine('workers')}
            >
              {testingEngine === 'workers' ? 'テスト中…' : '接続テスト'}
            </button>
          </div>
          {renderTestResult('workers')}
          <ModelMultiSelect
            engine="workers"
            enabled={workersModels}
            onChange={setWorkersModels}
            disabled={!backendConnected}
            canFetchLatest={backendConnected && (workersTokenSet || workersToken.trim() !== '')}
          />
          <label>
            Account ID
            <input
              value={workersAccountId}
              onChange={(event) => setWorkersAccountId(event.target.value)}
              autoComplete="off"
            />
          </label>
          <label>
            AI Gateway ID
            <input
              value={workersGatewayId}
              onChange={(event) => setWorkersGatewayId(event.target.value)}
            />
          </label>
          <label>
            API Token {workersTokenSet ? '（設定済み）' : '（未設定）'}
            <input
              type="password"
              value={workersToken}
              onChange={(event) => setWorkersToken(event.target.value)}
              autoComplete="off"
            />
          </label>

          <div className="settings-section-head">
            <h3 className="settings-section-title">OpenAI モデル（複数選択）</h3>
            <button
              type="button"
              className="settings-test-btn"
              disabled={
                !backendConnected ||
                (!openaiKeySet && openaiKey.trim() === '') ||
                testingEngine !== null
              }
              onClick={() => void testEngine('openai')}
            >
              {testingEngine === 'openai' ? 'テスト中…' : '接続テスト'}
            </button>
          </div>
          {renderTestResult('openai')}
          <p className="settings-hint">
            いまの Base URL が Groq（api.groq.com）のときは gpt-* は使えません。OpenAI
            公式を使う場合は下の「OpenAI 公式に戻す」を押してキーを保存してください。
          </p>
          <ModelMultiSelect
            engine="openai"
            enabled={openaiModels}
            onChange={setOpenaiModels}
            disabled={!backendConnected}
            canFetchLatest={backendConnected && (openaiKeySet || openaiKey.trim() !== '')}
          />
          <label>
            Base URL
            <div className="settings-inline-row">
              <input
                value={openaiBaseUrl}
                onChange={(event) => setOpenaiBaseUrl(event.target.value)}
                placeholder="https://api.openai.com/v1"
              />
              <button
                type="button"
                className="settings-test-btn"
                onClick={() => setOpenaiBaseUrl('https://api.openai.com/v1')}
              >
                OpenAI 公式に戻す
              </button>
            </div>
          </label>
          {/groq\.com/i.test(openaiBaseUrl) && (
            <p className="settings-warning">
              Base URL が Groq になっています。gpt-4.1-mini などは 404 になります。OpenAI
              を使うなら「OpenAI 公式に戻す」→ OpenAI の API キーを保存してください。
            </p>
          )}
          <label>
            API Key {openaiKeySet ? '（設定済み）' : '（未設定）'}
            <input
              type="password"
              value={openaiKey}
              onChange={(event) => setOpenaiKey(event.target.value)}
              autoComplete="off"
            />
          </label>

          <div className="settings-section-head">
            <h3 className="settings-section-title">Cursor モデル（複数選択）</h3>
            <button
              type="button"
              className="settings-test-btn"
              disabled={
                !backendConnected ||
                (!cursorKeySet && cursorKey.trim() === '') ||
                testingEngine !== null
              }
              onClick={() => void testEngine('cursor')}
            >
              {testingEngine === 'cursor' ? 'テスト中…' : '接続テスト'}
            </button>
          </div>
          {renderTestResult('cursor')}
          <p className="settings-hint">
            Grok 4.5/4.6・Claude Sonnet 4.5/4.6・Opus 5 などを候補にできます。アカウントで使える ID
            は Cursor 側の一覧に依存します。無い ID は下のカスタム追加で入れてください。
          </p>
          <ModelMultiSelect
            engine="cursor"
            enabled={cursorModels}
            onChange={setCursorModels}
            disabled={!backendConnected}
            canFetchLatest={backendConnected}
          />
          <label>
            API Key {cursorKeySet ? '（設定済み）' : '（未設定）'}
            <input
              type="password"
              value={cursorKey}
              onChange={(event) => setCursorKey(event.target.value)}
              autoComplete="off"
            />
          </label>
          <label>
            Cursor Agent 実行場所
            <select
              value={cursorRuntime}
              onChange={(event) =>
                setCursorRuntime(event.target.value as 'auto' | 'local' | 'cloud')
              }
              disabled={!backendConnected}
            >
              <option value="auto">自動（GitHub リモートがあれば Cloud）</option>
              <option value="local">常に Local（この PC のフォルダ）</option>
              <option value="cloud">常に Cloud（別 VM · PR 可）</option>
            </select>
          </label>
          <p className="settings-hint">
            変更後は下の「保存」を押してください。保存しないとチャットは以前の実行場所のままです。
            SCM / GitHub 権限エラーが出る場合は Local を選んで保存してください。Cloud は origin が
            GitHub のとき有効で、Cursor 側の GitHub 連携も必要です。
          </p>

          <div className="settings-section-head">
            <h3 className="settings-section-title">Gemini モデル（複数選択）</h3>
            <button
              type="button"
              className="settings-test-btn"
              disabled={
                !backendConnected ||
                (!geminiKeySet && geminiKey.trim() === '') ||
                testingEngine !== null
              }
              onClick={() => void testEngine('gemini')}
            >
              {testingEngine === 'gemini' ? 'テスト中…' : '接続テスト'}
            </button>
          </div>
          {renderTestResult('gemini')}
          <ModelMultiSelect
            engine="gemini"
            enabled={geminiModels}
            onChange={setGeminiModels}
            disabled={!backendConnected}
            canFetchLatest={backendConnected && (geminiKeySet || geminiKey.trim() !== '')}
          />
          <label>
            API Key {geminiKeySet ? '（設定済み）' : '（未設定）'}
            <input
              type="password"
              value={geminiKey}
              onChange={(event) => setGeminiKey(event.target.value)}
              autoComplete="off"
            />
          </label>

          <div className="settings-section-head">
            <h3 className="settings-section-title">Claude モデル（複数選択）</h3>
            <button
              type="button"
              className="settings-test-btn"
              disabled={
                !backendConnected ||
                (!claudeKeySet && claudeKey.trim() === '') ||
                testingEngine !== null
              }
              onClick={() => void testEngine('claude')}
            >
              {testingEngine === 'claude' ? 'テスト中…' : '接続テスト'}
            </button>
          </div>
          {renderTestResult('claude')}
          <p className="settings-hint">
            設計・レビュー・難しい修正向け。Agent モードでは Anthropic tool_use で編集ツールを実行できます。
          </p>
          <ModelMultiSelect
            engine="claude"
            enabled={claudeModels}
            onChange={setClaudeModels}
            disabled={!backendConnected}
            canFetchLatest={backendConnected && (claudeKeySet || claudeKey.trim() !== '')}
          />
          <label>
            API Key {claudeKeySet ? '（設定済み）' : '（未設定）'}
            <input
              type="password"
              value={claudeKey}
              onChange={(event) => setClaudeKey(event.target.value)}
              autoComplete="off"
            />
          </label>

          {status && <p className="settings-status">{status}</p>}

          </div>

          <div hidden={settingsTab !== 'advanced'}>
          <div className="settings-section">
            <h3>エディタ</h3>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={autoSave}
                onChange={(event) => {
                  const next = event.target.checked
                  setAutoSave(next)
                  saveAutoSaveEnabled(next)
                  onStatusMessage?.(next ? 'Auto-save を有効にしました' : 'Auto-save を無効にしました')
                }}
              />
              Auto-save（編集後に自動保存）
            </label>
            <label>
              Auto-save 遅延 (ms)
              <input
                type="number"
                min={400}
                max={10000}
                step={100}
                value={autoSaveDelay}
                disabled={!autoSave}
                onChange={(event) => {
                  const next = Number(event.target.value)
                  setAutoSaveDelay(next)
                  saveAutoSaveDelayMs(next)
                }}
              />
            </label>
            <KeybindingsEditor workspacePath={workspacePath} onStatusMessage={onStatusMessage} />
          </div>

          </div>

          <div className="settings-actions">
            <button type="button" className="settings-close" onClick={onClose}>
              閉じる
            </button>
            <button type="submit" className="settings-save" disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

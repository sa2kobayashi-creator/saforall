import { useEffect, useState, type FormEvent } from 'react'
import { ModelMultiSelect } from './ModelMultiSelect'
import {
  DEFAULT_COST_LIMITS,
  DEFAULT_CURSOR_MODEL,
  DEFAULT_ENABLED_MODELS,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_LLM_MODEL,
  DEFAULT_ROUTER_ENGINES,
  DEFAULT_ROUTER_PROFILE,
  DEFAULT_WORKERS_MODEL,
  ENGINE_LABELS,
  ROUTER_PROFILE_LABELS,
  USAGE_ENGINE_KEYS,
  parseEngineList,
  parseModelList,
  parseRouterAutoPolicy,
  parseRouterProfile,
  routerPolicyPreset,
  type ProviderEngine,
  type RouterAutoPolicy,
  type RouterProfile
} from '../lib/llmModels'
import './SettingsPanel.css'

type Props = {
  open: boolean
  backendConnected: boolean
  onClose: () => void
  onOpenUsage?: () => void
}

type SettingsMap = Record<string, string | boolean>

export function SettingsPanel({ open, backendConnected, onClose, onOpenUsage }: Props) {
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState('https://api.openai.com/v1')
  const [openaiKey, setOpenaiKey] = useState('')
  const [openaiKeySet, setOpenaiKeySet] = useState(false)
  const [openaiModels, setOpenaiModels] = useState<string[]>([...DEFAULT_ENABLED_MODELS.openai])

  const [geminiKey, setGeminiKey] = useState('')
  const [geminiKeySet, setGeminiKeySet] = useState(false)
  const [geminiModels, setGeminiModels] = useState<string[]>([...DEFAULT_ENABLED_MODELS.gemini])

  const [cursorKey, setCursorKey] = useState('')
  const [cursorKeySet, setCursorKeySet] = useState(false)
  const [cursorModels, setCursorModels] = useState<string[]>([...DEFAULT_ENABLED_MODELS.cursor])

  const [workersAccountId, setWorkersAccountId] = useState('')
  const [workersGatewayId, setWorkersGatewayId] = useState('default')
  const [workersToken, setWorkersToken] = useState('')
  const [workersTokenSet, setWorkersTokenSet] = useState(false)
  const [workersModels, setWorkersModels] = useState<string[]>([...DEFAULT_ENABLED_MODELS.workers])

  const [limitCursor, setLimitCursor] = useState(String(DEFAULT_COST_LIMITS.cursor))
  const [limitOpenai, setLimitOpenai] = useState(String(DEFAULT_COST_LIMITS.openai))
  const [limitGemini, setLimitGemini] = useState(String(DEFAULT_COST_LIMITS.gemini))
  const [limitWorkers, setLimitWorkers] = useState(String(DEFAULT_COST_LIMITS.workers))
  const [routerEngines, setRouterEngines] = useState<Array<(typeof USAGE_ENGINE_KEYS)[number]>>([
    ...DEFAULT_ROUTER_ENGINES
  ])
  const [routerProfile, setRouterProfile] = useState<RouterProfile>(DEFAULT_ROUTER_PROFILE)
  const [routerPolicy, setRouterPolicy] = useState<RouterAutoPolicy>(() =>
    routerPolicyPreset(DEFAULT_ROUTER_PROFILE)
  )

  const [usageText, setUsageText] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [testStatus, setTestStatus] = useState<
    Partial<Record<ProviderEngine, { ok: boolean; text: string }>>
  >({})
  const [saving, setSaving] = useState(false)
  const [testingEngine, setTestingEngine] = useState<ProviderEngine | null>(null)

  useEffect(() => {
    if (!open || !backendConnected) return

    let cancelled = false
    ;(async () => {
      const [settingsResult, usageResult] = await Promise.all([
        window.saforall.request<{ settings: SettingsMap }>('GET', '/settings'),
        window.saforall.request<{
          usage: Record<string, { spent: number; limit: number; remaining: number }>
        }>('GET', '/ai/usage')
      ])
      if (cancelled) return

      if (settingsResult.ok && settingsResult.data?.settings) {
        const settings = settingsResult.data.settings
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
        setCursorKeySet(settings['llm.cursor.api_key_set'] === true)
        setWorkersTokenSet(
          settings['llm.workers.api_token_set'] === true ||
            settings['llm.simple.api_token_set'] === true
        )
        setOpenaiKey('')
        setGeminiKey('')
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
        if (typeof settings['cost.workers.monthly_usd'] === 'string') {
          setLimitWorkers(settings['cost.workers.monthly_usd'])
        }
        setRouterEngines(parseEngineList(settings['router.enabled_engines'], DEFAULT_ROUTER_ENGINES))
        const profile = parseRouterProfile(settings['router.profile'])
        setRouterProfile(profile)
        setRouterPolicy(parseRouterAutoPolicy(settings['router.auto_policy'], profile))
      }

      if (usageResult.ok && usageResult.data?.usage) {
        const parts = USAGE_ENGINE_KEYS.map((key) => {
          const row = usageResult.data!.usage[key]
          return `${key} $${(row?.spent ?? 0).toFixed(2)} / $${row?.limit ?? DEFAULT_COST_LIMITS[key]}`
        })
        setUsageText(parts.join(' · '))
      }
      setStatus(null)
      setTestStatus({})
    })()

    return () => {
      cancelled = true
    }
  }, [open, backendConnected])

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
      setEngineTestStatus(engine, false, 'バックエンド未接続のためテストできません')
      return
    }

    const pendingKey =
      engine === 'openai'
        ? openaiKey.trim() !== ''
        : engine === 'gemini'
          ? geminiKey.trim() !== ''
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

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!backendConnected) {
      setStatus('バックエンド未接続のため保存できません')
      return
    }

    if (routerEngines.length === 0) {
      setStatus('Auto パイプラインは 1 つ以上の AI を有効にしてください')
      return
    }

    setSaving(true)
    setStatus(null)

    const settings: Record<string, string> = {
      'router.enabled_engines': JSON.stringify(routerEngines),
      'router.profile': routerProfile,
      'router.auto_policy': JSON.stringify(routerPolicy),
      'llm.openai.base_url': openaiBaseUrl.trim(),
      'llm.openai.models': JSON.stringify(openaiModels),
      'llm.openai.model': preferred('openai', openaiModels, DEFAULT_LLM_MODEL),
      'llm.model': preferred('openai', openaiModels, DEFAULT_LLM_MODEL),
      'llm.gemini.models': JSON.stringify(geminiModels),
      'llm.gemini.model': preferred('gemini', geminiModels, DEFAULT_GEMINI_MODEL),
      'llm.cursor.models': JSON.stringify(cursorModels),
      'llm.cursor.model': preferred('cursor', cursorModels, DEFAULT_CURSOR_MODEL),
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
      'cost.workers.monthly_usd': limitWorkers.trim() || String(DEFAULT_COST_LIMITS.workers)
    }
    if (openaiKey.trim() !== '') {
      settings['llm.openai.api_key'] = openaiKey.trim()
      settings['llm.api_key'] = openaiKey.trim()
    }
    if (geminiKey.trim() !== '') {
      settings['llm.gemini.api_key'] = geminiKey.trim()
    }
    if (cursorKey.trim() !== '') {
      settings['llm.cursor.api_key'] = cursorKey.trim()
    }
    if (workersToken.trim() !== '') {
      settings['llm.workers.api_token'] = workersToken.trim()
      settings['llm.simple.api_token'] = workersToken.trim()
    }

    const result = await window.saforall.request('PUT', '/settings', { settings })
    setSaving(false)

    if (!result.ok) {
      setStatus(result.error?.message ?? '保存に失敗しました')
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
    if (cursorKey.trim() !== '') {
      setCursorKeySet(true)
      setCursorKey('')
    }
    if (workersToken.trim() !== '') {
      setWorkersTokenSet(true)
      setWorkersToken('')
    }
    setStatus('設定を保存しました')
  }

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="設定">
      <div className="settings-panel">
        <div className="settings-header">
          <h2>設定</h2>
        </div>

        {!backendConnected && (
          <p className="settings-warning">
            バックエンド未接続です。XAMPP の Apache / MySQL を起動してください。
          </p>
        )}

        <form className="settings-form" onSubmit={(event) => void onSubmit(event)}>
          <h3 className="settings-section-title">Auto パイプライン</h3>
          <p className="settings-hint">
            チャットで「自動」を選んだときの振り分け方針です。標準は「バランス（おすすめ）」＝安価分散の改善版です。
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

          <h3 className="settings-section-title">月額上限</h3>
          <p className="settings-hint">
            Auto は選んだモデル候補の中から、安いもの／作業に合うものを自動で使います。
          </p>
          {usageText && <p className="settings-hint">今月の概算: {usageText}</p>}
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

          <label>
            Cursor 月上限 USD
            <input value={limitCursor} onChange={(event) => setLimitCursor(event.target.value)} />
          </label>
          <label>
            OpenAI 月上限 USD
            <input value={limitOpenai} onChange={(event) => setLimitOpenai(event.target.value)} />
          </label>
          <label>
            Gemini 月上限 USD
            <input value={limitGemini} onChange={(event) => setLimitGemini(event.target.value)} />
          </label>
          <label>
            Workers AI 月上限 USD
            <input value={limitWorkers} onChange={(event) => setLimitWorkers(event.target.value)} />
          </label>

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

          {status && <p className="settings-status">{status}</p>}

          <div className="settings-actions">
            <button type="button" className="settings-close" onClick={onClose}>
              閉じる
            </button>
            <button type="submit" className="settings-save" disabled={saving || !backendConnected}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

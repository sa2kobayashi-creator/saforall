import { useEffect, useState, type FormEvent } from 'react'
import { ModelMultiSelect } from './ModelMultiSelect'
import {
  DEFAULT_COST_LIMITS,
  DEFAULT_CURSOR_MODEL,
  DEFAULT_ENABLED_MODELS,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_LLM_MODEL,
  DEFAULT_WORKERS_MODEL,
  USAGE_ENGINE_KEYS,
  parseModelList,
  type ProviderEngine
} from '../lib/llmModels'
import './SettingsPanel.css'

type Props = {
  open: boolean
  backendConnected: boolean
  onClose: () => void
}

type SettingsMap = Record<string, string | boolean>

export function SettingsPanel({ open, backendConnected, onClose }: Props) {
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

  const [usageText, setUsageText] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

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
          (typeof settings['llm.workers.account_id'] === 'string' && settings['llm.workers.account_id']) ||
          (typeof settings['llm.simple.account_id'] === 'string' ? settings['llm.simple.account_id'] : '')
        if (account) setWorkersAccountId(account)

        const gateway =
          (typeof settings['llm.workers.gateway_id'] === 'string' && settings['llm.workers.gateway_id']) ||
          (typeof settings['llm.simple.gateway_id'] === 'string' ? settings['llm.simple.gateway_id'] : '')
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
      }

      if (usageResult.ok && usageResult.data?.usage) {
        const parts = USAGE_ENGINE_KEYS.map((key) => {
          const row = usageResult.data!.usage[key]
          return `${key} $${(row?.spent ?? 0).toFixed(2)} / $${row?.limit ?? DEFAULT_COST_LIMITS[key]}`
        })
        setUsageText(parts.join(' · '))
      }
      setStatus(null)
    })()

    return () => {
      cancelled = true
    }
  }, [open, backendConnected])

  if (!open) return null

  const preferred = (engine: ProviderEngine, list: string[], fallback: string) =>
    list[0] ?? fallback

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!backendConnected) {
      setStatus('バックエンド未接続のため保存できません')
      return
    }

    setSaving(true)
    setStatus(null)

    const settings: Record<string, string> = {
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
    <div className="settings-overlay" role="dialog" aria-label="設定">
      <div className="settings-panel">
        <div className="settings-header">
          <h2>設定</h2>
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </div>

        {!backendConnected && (
          <p className="settings-warning">
            バックエンド未接続です。XAMPP の Apache / MySQL を起動してください。
          </p>
        )}

        <form className="settings-form" onSubmit={(event) => void onSubmit(event)}>
          <h3 className="settings-section-title">月額上限</h3>
          <p className="settings-hint">
            Auto は選んだモデル候補の中から、安いもの／作業に合うものを自動で使います。
          </p>
          {usageText && <p className="settings-hint">今月の概算: {usageText}</p>}

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

          <h3 className="settings-section-title">Workers AI モデル（複数選択）</h3>
          <ModelMultiSelect
            engine="workers"
            enabled={workersModels}
            onChange={setWorkersModels}
            disabled={!backendConnected}
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

          <h3 className="settings-section-title">OpenAI モデル（複数選択）</h3>
          <ModelMultiSelect
            engine="openai"
            enabled={openaiModels}
            onChange={setOpenaiModels}
            disabled={!backendConnected}
          />
          <label>
            Base URL
            <input
              value={openaiBaseUrl}
              onChange={(event) => setOpenaiBaseUrl(event.target.value)}
            />
          </label>
          <label>
            API Key {openaiKeySet ? '（設定済み）' : '（未設定）'}
            <input
              type="password"
              value={openaiKey}
              onChange={(event) => setOpenaiKey(event.target.value)}
              autoComplete="off"
            />
          </label>

  <h3 className="settings-section-title">Cursor モデル（複数選択）</h3>
          <p className="settings-hint">
            Grok 4.5/4.6・Claude Sonnet 4.5/4.6・Opus 5 などを候補にできます。アカウントで使える ID は Cursor 側の一覧に依存します。無い ID は下のカスタム追加で入れてください。
          </p>
          <ModelMultiSelect
            engine="cursor"
            enabled={cursorModels}
            onChange={setCursorModels}
            disabled={!backendConnected}
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

          <h3 className="settings-section-title">Gemini モデル（複数選択）</h3>
          <ModelMultiSelect
            engine="gemini"
            enabled={geminiModels}
            onChange={setGeminiModels}
            disabled={!backendConnected}
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
            <button type="submit" disabled={saving || !backendConnected}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

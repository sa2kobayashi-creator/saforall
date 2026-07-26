import { useEffect, useState, type FormEvent } from 'react'
import {
  DEFAULT_LLM_MODEL,
  LLM_MODEL_OPTIONS,
  isKnownLlmModel
} from '../lib/llmModels'
import './SettingsPanel.css'

type Props = {
  open: boolean
  backendConnected: boolean
  onClose: () => void
}

type SettingsMap = Record<string, string | boolean>

const CUSTOM_VALUE = '__custom__'

export function SettingsPanel({ open, backendConnected, onClose }: Props) {
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1')
  const [model, setModel] = useState(DEFAULT_LLM_MODEL)
  const [useCustomModel, setUseCustomModel] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [apiKeySet, setApiKeySet] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const modelSelectValue = useCustomModel ? CUSTOM_VALUE : model

  useEffect(() => {
    if (!open || !backendConnected) return

    let cancelled = false
    ;(async () => {
      const result = await window.saforall.request<{ settings: SettingsMap }>(
        'GET',
        '/settings'
      )
      if (cancelled || !result.ok || !result.data?.settings) return

      const settings = result.data.settings
      if (typeof settings['llm.base_url'] === 'string') {
        setBaseUrl(settings['llm.base_url'])
      }
      if (typeof settings['llm.model'] === 'string' && settings['llm.model'].trim() !== '') {
        const saved = settings['llm.model'].trim()
        setModel(saved)
        setUseCustomModel(!isKnownLlmModel(saved))
      }
      setApiKeySet(settings['llm.api_key_set'] === true)
      setApiKey('')
      setStatus(null)
    })()

    return () => {
      cancelled = true
    }
  }, [open, backendConnected])

  if (!open) return null

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!backendConnected) {
      setStatus('バックエンド未接続のため保存できません')
      return
    }

    const resolvedModel = model.trim()
    if (resolvedModel === '') {
      setStatus('Model を入力してください')
      return
    }

    setSaving(true)
    setStatus(null)

    const settings: Record<string, string> = {
      'llm.base_url': baseUrl.trim(),
      'llm.model': resolvedModel
    }
    if (apiKey.trim() !== '') {
      settings['llm.api_key'] = apiKey.trim()
    }

    const result = await window.saforall.request('PUT', '/settings', { settings })
    setSaving(false)

    if (!result.ok) {
      setStatus(result.error?.message ?? '保存に失敗しました')
      return
    }

    setUseCustomModel(!isKnownLlmModel(resolvedModel))
    if (apiKey.trim() !== '') {
      setApiKeySet(true)
      setApiKey('')
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
          <label>
            LLM Base URL
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </label>

          <label>
            Model
            <select
              value={modelSelectValue}
              onChange={(event) => {
                const next = event.target.value
                if (next === CUSTOM_VALUE) {
                  setUseCustomModel(true)
                  if (isKnownLlmModel(model)) {
                    setModel('')
                  }
                  return
                }
                setUseCustomModel(false)
                setModel(next)
              }}
            >
              {LLM_MODEL_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              <option value={CUSTOM_VALUE}>カスタム…</option>
            </select>
          </label>

          {useCustomModel && (
            <label>
              カスタム Model ID
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="例: gpt-4o-mini"
              />
            </label>
          )}

          <label>
            API Key {apiKeySet ? '（設定済み・変更時のみ入力）' : '（未設定）'}
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={apiKeySet ? '••••••••' : 'sk-...'}
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

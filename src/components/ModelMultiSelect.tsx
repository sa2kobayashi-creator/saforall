import { useState } from 'react'
import type { ModelOption, ProviderEngine } from '../lib/llmModels'
import { catalogFor } from '../lib/llmModels'

type Props = {
  engine: ProviderEngine
  enabled: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  /** 最新モデル一覧を API から取得できるとき true */
  canFetchLatest?: boolean
}

export function ModelMultiSelect({
  engine,
  enabled,
  onChange,
  disabled,
  canFetchLatest = true
}: Props) {
  const builtin = catalogFor(engine)
  const [options, setOptions] = useState<ModelOption[]>(builtin)
  const [customId, setCustomId] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchMessage, setFetchMessage] = useState<string | null>(null)

  const knownIds = new Set(options.map((m) => m.id))
  const extras = enabled.filter((id) => !knownIds.has(id))

  const toggle = (id: string) => {
    if (enabled.includes(id)) {
      if (enabled.length <= 1) return
      onChange(enabled.filter((item) => item !== id))
      return
    }
    onChange([...enabled, id])
  }

  const addCustom = () => {
    const id = customId.trim()
    if (id === '') return
    if (!enabled.includes(id)) {
      onChange([...enabled, id])
    }
    setCustomId('')
  }

  const fetchLatest = async () => {
    setFetching(true)
    setFetchMessage(null)
    try {
      const result = await window.saforall.request<{
        models: Array<{ id: string; label?: string; tier?: string }>
      }>('GET', `/ai/models?engine=${encodeURIComponent(engine)}`)

      if (!result.ok || !result.data?.models) {
        setFetchMessage(result.error?.message ?? '最新モデルの取得に失敗しました')
        return
      }

      const next: ModelOption[] = result.data.models.map((row, index) => ({
        id: row.id,
        label: row.label && row.label !== row.id ? `${row.label}（${row.id}）` : row.id,
        tier: (row.tier as ModelOption['tier']) || 'standard',
        costRank: index + 1
      }))

      if (next.length === 0) {
        setFetchMessage('取得結果が空でした（キーや権限を確認してください）')
        return
      }

      // 組み込みカタログの表示名を優先してマージ
      const byId = new Map(next.map((item) => [item.id, item]))
      for (const item of builtin) {
        const hit = byId.get(item.id)
        if (hit) {
          byId.set(item.id, { ...hit, label: item.label, tier: item.tier })
        } else {
          byId.set(item.id, item)
        }
      }

      setOptions(Array.from(byId.values()))
      setFetchMessage(`${byId.size} 件のモデルを取得しました`)
    } catch (error) {
      setFetchMessage(String(error))
    } finally {
      setFetching(false)
    }
  }

  return (
    <div className="model-multi" role="group" aria-label={`${engine} models`}>
      <div className="model-multi-toolbar">
        <button
          type="button"
          className="model-multi-fetch"
          disabled={disabled || !canFetchLatest || fetching}
          onClick={() => void fetchLatest()}
        >
          {fetching ? '取得中…' : '最新を取得'}
        </button>
        {fetchMessage && <span className="model-multi-fetch-msg">{fetchMessage}</span>}
      </div>

      {options.map((option: ModelOption) => (
        <label key={option.id} className="model-multi-item">
          <span className="model-multi-label">
            {option.label}
            <small> · {option.tier}</small>
          </span>
          <input
            type="checkbox"
            checked={enabled.includes(option.id)}
            disabled={disabled}
            onChange={() => toggle(option.id)}
          />
        </label>
      ))}
      {extras.map((id) => (
        <label key={id} className="model-multi-item">
          <span className="model-multi-label">
            {id}
            <small> · カスタム</small>
          </span>
          <input
            type="checkbox"
            checked={enabled.includes(id)}
            disabled={disabled}
            onChange={() => toggle(id)}
          />
        </label>
      ))}
      <div className="model-multi-custom">
        <input
          value={customId}
          disabled={disabled}
          placeholder="カスタム Model ID を追加"
          onChange={(event) => setCustomId(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              addCustom()
            }
          }}
        />
        <button type="button" disabled={disabled || customId.trim() === ''} onClick={addCustom}>
          追加
        </button>
      </div>
    </div>
  )
}

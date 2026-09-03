import { useState } from 'react'
import type { ModelOption, ProviderEngine } from '../lib/llmModels'
import { catalogFor } from '../lib/llmModels'

type Props = {
  engine: ProviderEngine
  enabled: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
}

export function ModelMultiSelect({ engine, enabled, onChange, disabled }: Props) {
  const catalog = catalogFor(engine)
  const [customId, setCustomId] = useState('')

  const knownIds = new Set(catalog.map((m) => m.id))
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

  return (
    <div className="model-multi" role="group" aria-label={`${engine} models`}>
      {catalog.map((option: ModelOption) => (
        <label key={option.id} className="model-multi-item">
          <input
            type="checkbox"
            checked={enabled.includes(option.id)}
            disabled={disabled}
            onChange={() => toggle(option.id)}
          />
          <span>
            {option.label}
            <small> · {option.tier}</small>
          </span>
        </label>
      ))}
      {extras.map((id) => (
        <label key={id} className="model-multi-item">
          <input
            type="checkbox"
            checked={enabled.includes(id)}
            disabled={disabled}
            onChange={() => toggle(id)}
          />
          <span>
            {id}
            <small> · カスタム</small>
          </span>
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

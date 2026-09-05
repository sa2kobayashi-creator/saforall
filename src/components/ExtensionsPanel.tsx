import { useMemo, useState } from 'react'
import type { ExtensionCommand, ExtensionPermission, WorkspaceExtension } from '../types/extensions'
import {
  hasGrantedPermissions,
  inferRequiredPermissions,
  normalizePermissions,
  permissionsLabel
} from '../lib/extensionPermissions'
import { localizeMcpTool, useI18n } from '../i18n'
import './ExtensionsPanel.css'

type Props = {
  extensions: WorkspaceExtension[]
  activeFilePath: string | null
  workspacePath?: string | null
  grants: Record<string, ExtensionPermission[]>
  onGrant: (extensionId: string, permissions: ExtensionPermission[]) => void
  onRevoke: (extensionId: string) => void
  onRun: (command: string) => void
  onRefresh: () => void
}

export function ExtensionsPanel({
  extensions,
  activeFilePath,
  workspacePath = null,
  grants,
  onGrant,
  onRevoke,
  onRun,
  onRefresh
}: Props) {
  const { t, locale } = useI18n()
  const [pending, setPending] = useState<{
    extension: WorkspaceExtension
    command: ExtensionCommand
    required: ExtensionPermission[]
    run: string
  } | null>(null)
  const [marketQuery, setMarketQuery] = useState('')
  const [marketItems, setMarketItems] = useState<
    Array<{ id: string; name: string; description: string; url: string; downloads?: number }>
  >([])
  const [marketBusy, setMarketBusy] = useState(false)
  const [marketError, setMarketError] = useState<string | null>(null)
  const [mcpTools, setMcpTools] = useState<
    Array<{ name: string; description?: string; serverId: string }>
  >([])
  const [mcpServers, setMcpServers] = useState<
    Array<{ id: string; command?: string; url?: string }>
  >([])
  const [mcpStatuses, setMcpStatuses] = useState<
    Array<{ serverId: string; ok: boolean; toolCount: number; error?: string }>
  >([])
  const [mcpSummary, setMcpSummary] = useState<string | null>(null)
  const [mcpBusy, setMcpBusy] = useState(false)
  const [mcpError, setMcpError] = useState<string | null>(null)

  const refreshMcp = async () => {
    if (!workspacePath || typeof window.saforall.listMcp !== 'function') return
    setMcpBusy(true)
    setMcpError(null)
    setMcpSummary(null)
    try {
      const result = await window.saforall.listMcp(workspacePath)
      setMcpServers(
        result.servers.map((row) => ({
          id: row.id,
          command: row.command,
          url: 'url' in row ? (row as { url?: string }).url : undefined
        }))
      )
      setMcpTools(result.tools)
      setMcpStatuses(result.statuses ?? [])
      const fails = (result.statuses ?? []).filter((row) => !row.ok).length
      const oks = (result.statuses ?? []).filter((row) => row.ok).length
      const summary =
        fails > 0
          ? t('ext.mcp.summaryPartial', {
              ok: oks,
              fail: fails,
              tools: result.tools.length
            })
          : t('ext.mcp.summary', {
              servers: result.servers.length,
              tools: result.tools.length
            })
      setMcpSummary(summary)
      if (result.servers.length === 0) {
        setMcpError(t('ext.mcp.noServers'))
      } else if (result.tools.length === 0) {
        const failLines = (result.statuses ?? [])
          .filter((row) => !row.ok)
          .map((row) => `${row.serverId}: ${row.error ?? '起動失敗'}`)
        setMcpError(
          failLines.length > 0
            ? `${t('ext.mcp.foundNoTools')}\n${failLines.join('\n')}`
            : t('ext.mcp.zeroTools')
        )
      }
    } catch (error) {
      setMcpSummary(null)
      setMcpError(error instanceof Error ? error.message : String(error))
    } finally {
      setMcpBusy(false)
    }
  }

  const resolveRun = (command: ExtensionCommand) =>
    command.run.replaceAll(
      '{file}',
      activeFilePath ? `"${activeFilePath.replace(/"/g, '\\"')}"` : '.'
    )

  const requestRun = (extension: WorkspaceExtension, command: ExtensionCommand) => {
    const run = resolveRun(command)
    const declared = normalizePermissions(
      command.permissions ?? extension.permissions ?? ['terminal.run']
    )
    const inferred = inferRequiredPermissions(run)
    const required = Array.from(new Set([...declared, ...inferred]))
    if (hasGrantedPermissions(grants[extension.id], required)) {
      onRun(run)
      return
    }
    setPending({ extension, command, required, run })
  }

  const pendingLabel = useMemo(
    () => (pending ? permissionsLabel(pending.required) : ''),
    [pending]
  )

  return (
    <div className="extensions-panel" aria-label={t('ext.title')}>
      <div className="extensions-head">
        <strong>{t('ext.title')}</strong>
        <button type="button" onClick={onRefresh} title={t('ext.refresh')}>
          {t('ext.refresh')}
        </button>
      </div>
      <p className="extensions-lead">{t('ext.lead')}</p>

      <div className="extensions-market">
        <strong>{t('ext.mcp.title')}</strong>
        <p>{t('ext.mcp.lead')}</p>
        <button type="button" disabled={!workspacePath || mcpBusy} onClick={() => void refreshMcp()}>
          {mcpBusy ? t('ext.mcp.loading') : t('ext.mcp.load')}
        </button>
        {mcpBusy && <p className="extensions-perms">{t('ext.mcp.connecting')}</p>}
        {mcpSummary && !mcpBusy && (
          <p className={`extensions-status ${mcpTools.length > 0 ? 'ok' : 'warn'}`}>{mcpSummary}</p>
        )}
        {mcpError && <p className="extensions-error">{mcpError}</p>}
        {mcpStatuses.length > 0 && (
          <ul className="extensions-status-list">
            {mcpStatuses.map((row) => (
              <li key={row.serverId} className={row.ok ? 'ok' : 'fail'}>
                {row.ok
                  ? t('ext.mcp.serverOk', { id: row.serverId, count: row.toolCount })
                  : t('ext.mcp.serverFail', {
                      id: row.serverId,
                      error: row.error ?? '失敗'
                    })}
              </li>
            ))}
          </ul>
        )}
        {mcpServers.length > 0 && (
          <p className="extensions-perms">
            servers:{' '}
            {mcpServers
              .map((row) => (row.url ? `${row.id} (http)` : `${row.id} (stdio)`))
              .join(', ')}
          </p>
        )}
        {mcpTools.length > 0 && (
          <ul className="extensions-list">
            {mcpTools.slice(0, 40).map((tool) => {
              const localized = localizeMcpTool(locale, tool.name, tool.description)
              return (
                <li key={`${tool.serverId}:${tool.name}`} className="extensions-card">
                  <div className="extensions-card-title">
                    {localized.title}{' '}
                    <span className="extensions-perms">@{tool.serverId}</span>
                  </div>
                  {localized.description && <p>{localized.description}</p>}
                </li>
              )
            })}
          </ul>
        )}
        {!mcpBusy && mcpSummary && mcpTools.length === 0 && !mcpError && (
          <p className="extensions-empty">{t('ext.mcp.emptyTools')}</p>
        )}
      </div>

      <div className="extensions-market">
        <strong>{t('ext.market.title')}</strong>
        <p>{t('ext.market.lead')}</p>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void (async () => {
              setMarketBusy(true)
              setMarketError(null)
              try {
                const result = await window.saforall.searchMarketplace(marketQuery)
                if (!result.ok) {
                  setMarketError(result.error ?? '検索失敗')
                  setMarketItems([])
                } else {
                  setMarketItems(result.items)
                }
              } catch (error) {
                setMarketError(error instanceof Error ? error.message : String(error))
              } finally {
                setMarketBusy(false)
              }
            })()
          }}
        >
          <input
            value={marketQuery}
            onChange={(event) => setMarketQuery(event.target.value)}
            placeholder={t('ext.market.placeholder')}
          />
          <button type="submit" disabled={marketBusy || !marketQuery.trim()}>
            {marketBusy ? '…' : t('ext.market.search')}
          </button>
        </form>
        {marketError && <p className="extensions-empty">{marketError}</p>}
        <ul className="extensions-list">
          {marketItems.map((item) => (
            <li key={item.id} className="extensions-card">
              <div className="extensions-card-title">{item.name}</div>
              <p>{item.description || item.id}</p>
              <a href={item.url} target="_blank" rel="noreferrer">
                {t('ext.market.open')}
              </a>
            </li>
          ))}
        </ul>
      </div>

      {extensions.length === 0 ? (
        <p className="extensions-empty">{t('ext.empty')}</p>
      ) : (
        <ul className="extensions-list">
          {extensions.map((ext) => {
            const granted = grants[ext.id] ?? []
            return (
              <li key={ext.id} className="extensions-card">
                <div className="extensions-card-title">{ext.name}</div>
                {ext.description && <p>{ext.description}</p>}
                <p className="extensions-perms">
                  {t('ext.perms')}: {(ext.permissions ?? ['terminal.run']).join(', ')}
                  {granted.length > 0
                    ? ` · ${t('ext.granted')}: ${granted.join(', ')}`
                    : ` · ${t('ext.ungranted')}`}
                </p>
                <div className="extensions-commands">
                  {ext.commands.map((cmd) => (
                    <button
                      key={cmd.id}
                      type="button"
                      onClick={() => requestRun(ext, cmd)}
                      title={cmd.run}
                    >
                      {cmd.title}
                    </button>
                  ))}
                  {granted.length > 0 && (
                    <button
                      type="button"
                      className="danger"
                      onClick={() => onRevoke(ext.id)}
                      title={t('ext.revoke')}
                    >
                      {t('ext.revoke')}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {pending && (
        <div className="extensions-grant" role="dialog" aria-label={t('ext.grantTitle')}>
          <h3>{t('ext.grantTitle')}</h3>
          <p>
            {t('ext.grantBody', {
              name: pending.extension.name,
              command: pending.command.title
            })}
          </p>
          <p className="extensions-grant-perms">{pendingLabel}</p>
          <pre>{pending.run}</pre>
          <div className="extensions-grant-actions">
            <button type="button" onClick={() => setPending(null)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => {
                onGrant(pending.extension.id, pending.required)
                onRun(pending.run)
                setPending(null)
              }}
            >
              {t('ext.grantConfirm')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

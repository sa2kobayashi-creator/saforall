export type Locale = 'ja' | 'en'

export const LOCALES: Locale[] = ['ja', 'en']

export const LOCALE_LABELS: Record<Locale, string> = {
  ja: '日本語',
  en: 'English'
}

const ja = {
  'common.close': '閉じる',
  'common.refresh': '更新',
  'common.openFolder': 'フォルダを開く',
  'common.search': '検索',
  'common.loading': '読込中…',
  'common.save': '保存',
  'common.saving': '保存中…',
  'common.cancel': 'キャンセル',

  'activity.explorer': 'エクスプローラー',
  'activity.scm': 'ソース管理',
  'activity.extensions': '拡張機能',
  'activity.openFolder': 'フォルダを開く',
  'activity.runFile': '現在のファイルを実行 (F5)',
  'activity.chat': 'AI チャット',
  'activity.usage': 'AI 使用量',
  'activity.terminal': 'ターミナル',
  'activity.settings': '設定',
  'activity.aria': 'アクティビティバー',

  'sidebar.explorer': 'エクスプローラー',
  'sidebar.noWorkspace': 'ワークスペースが未選択です',
  'sidebar.openFolder': 'フォルダを開く',

  'scm.title': 'ソース管理',
  'scm.aria': 'ソース管理',
  'scm.empty': 'フォルダを開くか、リポジトリをクローンしてください。',
  'scm.clone': 'クローン…',
  'scm.pull': 'Pull',
  'scm.push': 'Push',
  'scm.refresh': '更新',

  'bottom.terminal': 'ターミナル',
  'bottom.problems': '問題',
  'bottom.debug': 'デバッグ',
  'bottom.cwd': 'カレントディレクトリ',
  'bottom.aria': '下部パネル',

  'status.checking': '確認中…',
  'status.connected': 'API 接続済み',
  'status.disconnected': 'API 未接続',
  'status.disconnectedHint': 'API 未接続 — Apache/MySQL',
  'status.dirty': '未保存',
  'status.clean': '保存済み',
  'status.recheck': 'クリックで再確認',
  'status.locale': '表示言語',

  'settings.title': '設定',
  'settings.aria': '設定',
  'settings.localeSection': '表示言語',
  'settings.localeHint':
    'メニュー・サイドバー・拡張パネルなどの表示言語を切り替えます。すぐに反映され、設定保存時にサーバーにも記録されます。',
  'settings.localeOption.ja': '日本語',
  'settings.localeOption.en': 'English',
  'settings.backendWarning':
    'バックエンド未接続です。XAMPP の Apache / MySQL を起動してください。',
  'settings.saved': '設定を保存しました',
  'settings.saveFailed': '保存に失敗しました',
  'settings.offlineSave': 'バックエンド未接続のため保存できません',

  'ext.title': '拡張機能',
  'ext.refresh': '更新',
  'ext.lead':
    '`.saforall/extensions/*.json` を読み込みます。実行には権限承認が必要です（`{file}` = アクティブファイル）。',
  'ext.mcp.title': 'MCP',
  'ext.mcp.lead':
    '`.saforall/mcp.json`（例: `.saforall/mcp.json.example`）。Agent から `call_mcp_tool` でも利用できます。',
  'ext.mcp.load': 'MCP ツールを読み込む',
  'ext.mcp.loading': '読込中…',
  'ext.mcp.connecting': 'MCP サーバーに接続しています…',
  'ext.mcp.emptyTools': 'ツール一覧は空です',
  'ext.mcp.noServers': 'mcp.json にサーバーがありません',
  'ext.mcp.foundNoTools': 'サーバーは見つかったがツールを取得できませんでした。',
  'ext.mcp.zeroTools': 'サーバーはありますが、公開ツールが 0 件です',
  'ext.mcp.summary': '読込完了: サーバー {servers} / ツール {tools} 件',
  'ext.mcp.summaryPartial':
    '読込完了（一部失敗）: 成功 {ok}・失敗 {fail}・ツール {tools} 件',
  'ext.mcp.serverOk': '✓ {id} · ツール {count} 件',
  'ext.mcp.serverFail': '✗ {id} · {error}',
  'ext.market.title': 'Marketplace (Open VSX)',
  'ext.market.lead': '検索のみ（VSIX 実行ランタイムは未対応）。',
  'ext.market.placeholder': '例: python, prettier',
  'ext.market.search': '検索',
  'ext.market.open': 'Open VSX で見る',
  'ext.empty': '拡張はまだありません',
  'ext.perms': '権限',
  'ext.granted': '承認済み',
  'ext.ungranted': '未承認',
  'ext.revoke': '権限を取り消す',
  'ext.grantTitle': '権限の承認',
  'ext.grantBody': '{name} の「{command}」を実行するには次の権限が必要です。',
  'ext.grantConfirm': '承認して実行'
} as const

export type MessageKey = keyof typeof ja

const en: Record<MessageKey, string> = {
  'common.close': 'Close',
  'common.refresh': 'Refresh',
  'common.openFolder': 'Open Folder',
  'common.search': 'Search',
  'common.loading': 'Loading…',
  'common.save': 'Save',
  'common.saving': 'Saving…',
  'common.cancel': 'Cancel',

  'activity.explorer': 'Explorer',
  'activity.scm': 'Source Control',
  'activity.extensions': 'Extensions',
  'activity.openFolder': 'Open Folder',
  'activity.runFile': 'Run Current File (F5)',
  'activity.chat': 'AI Chat',
  'activity.usage': 'AI Usage',
  'activity.terminal': 'Terminal',
  'activity.settings': 'Settings',
  'activity.aria': 'Activity Bar',

  'sidebar.explorer': 'EXPLORER',
  'sidebar.noWorkspace': 'No folder opened',
  'sidebar.openFolder': 'Open Folder',

  'scm.title': 'SOURCE CONTROL',
  'scm.aria': 'Source Control',
  'scm.empty': 'Open a folder or clone a repository.',
  'scm.clone': 'Clone…',
  'scm.pull': 'Pull',
  'scm.push': 'Push',
  'scm.refresh': 'Refresh',

  'bottom.terminal': 'TERMINAL',
  'bottom.problems': 'PROBLEMS',
  'bottom.debug': 'DEBUG',
  'bottom.cwd': 'Current directory',
  'bottom.aria': 'Bottom panel',

  'status.checking': 'Checking…',
  'status.connected': 'API connected',
  'status.disconnected': 'API offline',
  'status.disconnectedHint': 'API offline — start Apache/MySQL',
  'status.dirty': 'Unsaved',
  'status.clean': 'Saved',
  'status.recheck': 'Click to recheck',
  'status.locale': 'Language',

  'settings.title': 'Settings',
  'settings.aria': 'Settings',
  'settings.localeSection': 'Display language',
  'settings.localeHint':
    'Switches language for menus, sidebar, and extensions. Applies immediately and is stored when you save settings.',
  'settings.localeOption.ja': '日本語',
  'settings.localeOption.en': 'English',
  'settings.backendWarning':
    'Backend offline. Start XAMPP Apache / MySQL.',
  'settings.saved': 'Settings saved',
  'settings.saveFailed': 'Failed to save settings',
  'settings.offlineSave': 'Cannot save while backend is offline',

  'ext.title': 'Extensions',
  'ext.refresh': 'Refresh',
  'ext.lead':
    'Loads `.saforall/extensions/*.json`. Running commands requires permission (`{file}` = active file).',
  'ext.mcp.title': 'MCP',
  'ext.mcp.lead':
    '`.saforall/mcp.json` (see `.saforall/mcp.json.example`). Agents can call tools via `call_mcp_tool`.',
  'ext.mcp.load': 'Load MCP tools',
  'ext.mcp.loading': 'Loading…',
  'ext.mcp.connecting': 'Connecting to MCP servers…',
  'ext.mcp.emptyTools': 'No tools listed',
  'ext.mcp.noServers': 'No servers in mcp.json',
  'ext.mcp.foundNoTools': 'Servers found but tools could not be loaded.',
  'ext.mcp.zeroTools': 'Servers exist but expose 0 tools',
  'ext.mcp.summary': 'Loaded: {servers} server(s) / {tools} tool(s)',
  'ext.mcp.summaryPartial':
    'Loaded (partial failure): ok {ok} · failed {fail} · tools {tools}',
  'ext.mcp.serverOk': '✓ {id} · {count} tool(s)',
  'ext.mcp.serverFail': '✗ {id} · {error}',
  'ext.market.title': 'Marketplace (Open VSX)',
  'ext.market.lead': 'Search only (VSIX runtime not supported yet).',
  'ext.market.placeholder': 'e.g. python, prettier',
  'ext.market.search': 'Search',
  'ext.market.open': 'Open on Open VSX',
  'ext.empty': 'No extensions yet',
  'ext.perms': 'Permissions',
  'ext.granted': 'granted',
  'ext.ungranted': 'not granted',
  'ext.revoke': 'Revoke permissions',
  'ext.grantTitle': 'Grant permission',
  'ext.grantBody': '“{command}” from {name} requires these permissions.',
  'ext.grantConfirm': 'Allow and run'
}

export const messages: Record<Locale, Record<MessageKey, string>> = {
  ja,
  en
}

export function translate(
  locale: Locale,
  key: MessageKey,
  vars?: Record<string, string | number>
): string {
  let text = messages[locale][key] ?? messages.ja[key] ?? key
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}

export function parseLocale(value: unknown): Locale {
  return value === 'en' ? 'en' : 'ja'
}

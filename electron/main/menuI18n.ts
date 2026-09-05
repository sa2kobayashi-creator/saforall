export type MenuLocale = 'ja' | 'en'

type MenuLabels = {
  file: string
  openFolder: string
  closeFolder: string
  save: string
  edit: string
  inlineEdit: string
  bugbot: string
  backgroundAgent: string
  view: string
  explorer: string
  search: string
  scm: string
  toggleTerminal: string
  problems: string
  toggleChat: string
  aiUsage: string
  usageLayout: string
  dockRight: string
  overlay: string
  hide: string
  settings: string
  extensions: string
  run: string
  runFile: string
  startDebug: string
  continue: string
  stepOver: string
  stopDebug: string
  showDebug: string
  terminal: string
  newTerminal: string
  git: string
  clone: string
  refreshGit: string
  pull: string
  push: string
  showScm: string
  help: string
  welcome: string
  docs: string
  shortcuts: string
  extensionsTips: string
  report: string
  license: string
  about: string
}

const ja: MenuLabels = {
  file: 'ファイル',
  openFolder: 'フォルダを開く…',
  closeFolder: 'フォルダを閉じる',
  save: '保存',
  edit: '編集',
  inlineEdit: '選択範囲をインライン編集',
  bugbot: '差分で Bugbot を実行',
  backgroundAgent: 'Background Agent…',
  view: '表示',
  explorer: 'エクスプローラー',
  search: '検索',
  scm: 'ソース管理',
  toggleTerminal: 'ターミナルの表示切替',
  problems: 'Problems',
  toggleChat: 'AI チャットの表示切替',
  aiUsage: 'AI 使用量',
  usageLayout: '使用量パネルの配置',
  dockRight: '右に固定',
  overlay: 'オーバーレイ',
  hide: '隠す',
  settings: '設定',
  extensions: '拡張機能',
  run: '実行',
  runFile: '現在のファイルを実行',
  startDebug: 'デバッグ開始',
  continue: '続行',
  stepOver: 'ステップオーバー',
  stopDebug: 'デバッグ停止',
  showDebug: 'デバッグパネルを表示',
  terminal: 'ターミナル',
  newTerminal: '新しいターミナル',
  git: 'Git',
  clone: 'リポジトリをクローン…',
  refreshGit: '状態を更新',
  pull: 'Pull',
  push: 'Push',
  showScm: 'ソース管理を表示',
  help: 'ヘルプ',
  welcome: 'ようこそ',
  docs: 'ドキュメント',
  shortcuts: 'キーボードショートカット',
  extensionsTips: '拡張フォルダのヒント',
  report: '問題を報告…',
  license: 'ライセンスを表示',
  about: 'saforall について'
}

const en: MenuLabels = {
  file: 'File',
  openFolder: 'Open Folder…',
  closeFolder: 'Close Folder',
  save: 'Save',
  edit: 'Edit',
  inlineEdit: 'Inline Edit Selection',
  bugbot: 'Run Bugbot on Diff',
  backgroundAgent: 'Background Agent…',
  view: 'View',
  explorer: 'Explorer',
  search: 'Search',
  scm: 'Source Control',
  toggleTerminal: 'Toggle Terminal',
  problems: 'Problems',
  toggleChat: 'Toggle AI Chat',
  aiUsage: 'AI Usage',
  usageLayout: 'Usage Layout',
  dockRight: 'Dock Right',
  overlay: 'Overlay',
  hide: 'Hide',
  settings: 'Settings',
  extensions: 'Extensions',
  run: 'Run',
  runFile: 'Run Current File',
  startDebug: 'Start Debugging',
  continue: 'Continue',
  stepOver: 'Step Over',
  stopDebug: 'Stop Debugging',
  showDebug: 'Show Debug Panel',
  terminal: 'Terminal',
  newTerminal: 'New Terminal',
  git: 'Git',
  clone: 'Clone Repository…',
  refreshGit: 'Refresh Status',
  pull: 'Pull',
  push: 'Push',
  showScm: 'Show Source Control',
  help: 'Help',
  welcome: 'Welcome',
  docs: 'Documentation',
  shortcuts: 'Keyboard Shortcuts Reference',
  extensionsTips: 'Extensions Folder Tips',
  report: 'Report Issue…',
  license: 'View License',
  about: 'About saforall'
}

export function menuLabels(locale: MenuLocale): MenuLabels {
  return locale === 'en' ? en : ja
}

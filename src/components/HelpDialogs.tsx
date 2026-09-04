import { useEffect, useMemo, type ReactNode } from 'react'
import './HelpDialogs.css'

type DialogShellProps = {
  open: boolean
  title: string
  ariaLabel: string
  wide?: boolean
  onClose: () => void
  children: ReactNode
}

function HelpDialogShell({ open, title, ariaLabel, wide, onClose, children }: DialogShellProps) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="help-overlay" role="dialog" aria-modal="true" aria-label={ariaLabel}>
      <div className={`help-dialog${wide ? ' help-dialog--wide' : ''}`}>
        <div className="help-dialog-header">
          <h2>{title}</h2>
          <button type="button" onClick={onClose} title="閉じる">
            ×
          </button>
        </div>
        {children}
        <div className="help-dialog-actions">
          <button type="button" className="primary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}

type SimpleProps = {
  open: boolean
  onClose: () => void
}

const SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: 'Ctrl/Cmd + O', action: 'フォルダを開く' },
  { keys: 'Ctrl/Cmd + S', action: 'ファイルを保存' },
  { keys: 'F5', action: '現在のファイルを実行' },
  { keys: 'Shift + F5', action: 'ブレークポイント付きデバッグ開始' },
  { keys: 'F8', action: 'デバッグ Continue' },
  { keys: 'F10', action: 'デバッグ Step Over' },
  { keys: 'Shift + F8', action: 'デバッグ停止' },
  { keys: 'Ctrl/Cmd + Shift + X', action: '拡張機能パネル' },
  { keys: 'Tab', action: 'AI Tab 補完を確定（候補表示中）' },
  { keys: 'Ctrl/Cmd + ,', action: '設定を開く' },
  { keys: 'Ctrl/Cmd + P', action: 'ファイルを名前検索して開く' },
  { keys: 'Ctrl/Cmd + K', action: '選択範囲を AI インライン編集' },
  { keys: 'Ctrl/Cmd + L', action: 'AI チャットの表示切替' },
  { keys: 'Ctrl/Cmd + Shift + E', action: 'Explorer を表示' },
  { keys: 'Ctrl/Cmd + Shift + G', action: 'Source Control を表示' },
  { keys: 'Ctrl/Cmd + Shift + M', action: 'Problems を表示' },
  { keys: 'Ctrl/Cmd + Shift + U', action: 'AI 使用量を表示' },
  { keys: 'Ctrl + `', action: 'ターミナルの表示切替' },
  { keys: 'Ctrl + Shift + `', action: '新しいターミナル' },
  { keys: 'F1', action: 'キーボードショートカット一覧' },
  { keys: '@codebase / @symbol', action: '索引サマリ・シンボルをチャット文脈に追加' },
  { keys: '.saforall/keybindings.json', action: 'ワークスペース独自キーバインド' },
  { keys: '.saforall/mcp.json', action: 'MCP サーバー設定（tools/list）' },
  { keys: 'Enter', action: 'チャット送信（Shift+Enter で改行）' },
  { keys: 'Esc', action: '設定などのダイアログを閉じる' }
]

const MIT_LICENSE = `MIT License

Copyright (c) 2026 saforall contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`

export function DocumentationDialog({ open, onClose }: SimpleProps) {
  return (
    <HelpDialogShell
      open={open}
      title="ドキュメント"
      ariaLabel="ドキュメント"
      wide
      onClose={onClose}
    >
      <div className="help-prose">
        <p>saforall は Cursor 風の AI コードエディタです。主な使い方は次のとおりです。</p>
        <ol>
          <li>
            <strong>フォルダを開く</strong> — File → Open Folder、または Welcome 画面からワークスペースを選びます。
          </li>
          <li>
            <strong>設定</strong> — Ctrl/Cmd + , で API キーや Auto ルーティング、モデル一覧を設定します。XAMPP 上の PHP
            バックエンドが起動している必要があります。
          </li>
          <li>
            <strong>AI チャット</strong> — Ctrl/Cmd + L で右側のチャットを開き、Ask / Agent モードで質問や編集を依頼します。
            <code>@</code> でファイルや <code>@selection</code> / <code>@problems</code> / <code>@rules</code> を添付できます。
          </li>
          <li>
            <strong>インライン編集</strong> — コードを選択して Ctrl/Cmd + K で指示付きのその場編集ができます。
          </li>
          <li>
            <strong>デバッグ</strong> — js/ts は CDP、Python は debugpy（要 pip install debugpy）。
          </li>
          <li>
            <strong>Bugbot / Background Agent</strong> — Edit メニューから差分レビューや裏方 Agent
            をチャット経由で起動できます。
          </li>
          <li>
            <strong>LSP</strong> — `typescript-language-server` / `pylsp` が PATH にあれば外部診断を取り込みます。
          </li>
          <li>
            <strong>ターミナル / Git</strong> — Ctrl + ` でターミナル、Activity Bar の Source Control で Git 操作ができます。
          </li>
        </ol>
        <p>
          ショートカット一覧は Help → Keyboard Shortcuts Reference から確認できます。詳細な運用はアプリ管理者の手順に従ってください。
        </p>
      </div>
    </HelpDialogShell>
  )
}

export function ReportIssueDialog({ open, onClose }: SimpleProps) {
  return (
    <HelpDialogShell open={open} title="問題の報告" ariaLabel="問題の報告" onClose={onClose}>
      <div className="help-prose">
        <p>不具合や改善要望がある場合は、アプリ管理者に直接ご連絡ください。</p>
        <p>報告時は次の情報があると調査しやすくなります。</p>
        <ul>
          <li>再現手順（できるだけ具体的に）</li>
          <li>期待した動作と実際の結果</li>
          <li>About に表示されるバージョン番号</li>
          <li>可能であれば画面の状態やエラーメッセージ</li>
        </ul>
      </div>
    </HelpDialogShell>
  )
}

export function LicenseDialog({ open, onClose }: SimpleProps) {
  return (
    <HelpDialogShell open={open} title="ライセンス" ariaLabel="ライセンス" wide onClose={onClose}>
      <pre className="help-license">{MIT_LICENSE}</pre>
    </HelpDialogShell>
  )
}

export function KeyboardShortcutsDialog({ open, onClose }: SimpleProps) {
  return (
    <HelpDialogShell
      open={open}
      title="キーボードショートカット"
      ariaLabel="キーボードショートカット"
      wide
      onClose={onClose}
    >
      <p className="help-dialog-lead">saforall でよく使うショートカットです。</p>
      <table className="help-shortcuts-table">
        <thead>
          <tr>
            <th>キー</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {SHORTCUTS.map((row) => (
            <tr key={row.keys}>
              <td>
                <kbd>{row.keys}</kbd>
              </td>
              <td>{row.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </HelpDialogShell>
  )
}

export function AboutDialog({ open, onClose }: SimpleProps) {
  const info = useMemo(() => {
    if (typeof window.saforall?.getRuntimeInfo !== 'function') {
      return { appVersion: '0.1.0' as string, electron: undefined, chrome: undefined, node: undefined }
    }
    return window.saforall.getRuntimeInfo()
  }, [])

  return (
    <HelpDialogShell open={open} title="saforall について" ariaLabel="saforall について" onClose={onClose}>
      <div className="help-about-body">
        <p className="help-about-brand">saforall</p>
        <p className="help-about-version">Version {info.appVersion}</p>
        <p>
          Cursor にインスパイアされた AI コードエディタです。Auto パイプラインで Cursor / OpenAI / Gemini /
          Workers AI を振り分けます。
        </p>
        <p className="help-about-license">License: MIT</p>
        <ul className="help-about-meta">
          {info.electron && <li>Electron {info.electron}</li>}
          {info.chrome && <li>Chromium {info.chrome}</li>}
          {info.node && <li>Node.js {info.node}</li>}
        </ul>
      </div>
    </HelpDialogShell>
  )
}

# saforall アーキテクチャ

## 概要

saforall は Cursor 系の AI エディタを目指す Electron アプリです。  
メインプロセスで OS / ファイルシステムを扱い、レンダラでエディタ UI と AI チャットを動かします。

```
┌─────────────────────────────────────────────────────────┐
│ Renderer (React)                                        │
│  ActivityBar │ Sidebar │ Monaco Editor │ AI Chat Panel  │
└───────────────┬─────────────────────────────┬───────────┘
                │ preload (contextBridge)     │
┌───────────────▼─────────────────────────────▼───────────┐
│ Main Process (Electron)                                 │
│  ウィンドウ管理 / ダイアログ / fs 読み書き               │
└─────────────────────────────────────────────────────────┘
```

## ディレクトリ構成

```
saforall/
├── electron/
│   ├── main/          # Electron メインプロセス
│   └── preload/       # 安全な IPC ブリッジ
├── src/
│   ├── components/    # UI コンポーネント
│   ├── styles/        # グローバルスタイル
│   ├── App.tsx        # レイアウトと状態の中心
│   └── types.ts       # 共有型
├── docs/              # 設計ドキュメント
└── package.json
```

## プロセス境界

| 層 | 責務 |
| --- | --- |
| `electron/main` | ウィンドウ、フォルダ選択、ファイル I/O |
| `electron/preload` | `window.saforall` として限定 API を公開 |
| `src/*` | UI、編集状態、チャット UI |

レンダラから Node API を直接呼ばず、必ず preload 経由にします。

## 今後のモジュール案

| モジュール | 役割 |
| --- | --- |
| `ai/provider` | OpenAI / Anthropic など LLM プロバイダ抽象化 |
| `ai/context` | 開いているファイル・選択範囲・関連ファイルの収集 |
| `ai/tools` | ファイル編集・検索などのエージェントツール |
| `workspace` | 再帰ツリー、gitignore、ウォッチ |
| `terminal` | 統合ターミナル（node-pty 等） |

## UI レイアウト

Cursor / VS Code に近い 4 ペイン構成です。

1. **Activity Bar** — 機能切替
2. **Sidebar** — エクスプローラ
3. **Editor** — Monaco
4. **Chat** — AI 対話

## セキュリティ方針

- `contextIsolation: true`
- `nodeIntegration: false`
- API キーはメインプロセス側で保持し、レンダラに生値を渡さない（実装時）
- `.env` は `.gitignore` 済み

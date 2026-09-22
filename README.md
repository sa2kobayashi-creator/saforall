# saforall

AI 支援付きのローカルコードエディタ（Electron + React + Monaco）。Cursor 風の編集体験と、複数 LLM プロバイダを切り替える AI Router を備えます。

## 概要

- ワークスペース上のファイル編集・検索・SCM・ターミナル
- チャット / Agent / Tab 補完 / インライン編集（Ctrl+K）
- 配布版は **XAMPP なし**で動作（設定・会話・usage は Electron `userData` の JSON）
- 開発時は任意で XAMPP（PHP/MySQL）互換バックエンドも利用可能

## 開発

```bash
npm install
npm run dev
```

その他の npm scripts（`package.json`）:

| コマンド | 内容 |
| --- | --- |
| `npm run build` | `out/` へビルド |
| `npm run typecheck` | TypeScript チェック |
| `npm test` | typecheck + `scripts/run-all-tests.mjs` |
| `npm run pack` | ディレクトリパッケージ（electron-builder） |
| `npm run dist` | Windows NSIS インストーラ |

## AI / API キー

アプリ内 **Settings** で OpenAI / Gemini / Claude / Cursor 等のキーを保存します。

- 生の secret は Renderer へ渡しません（Main 側の `settings-cache.json` / Vault）
- Tab 補完・Ctrl+K は OpenAI / Gemini / Claude 系のキーが必要です（Cursor キーのみでは未対応）

## XAMPP / PHP / MySQL

- **配布版では必須ではありません**
- 開発時の互換 API・永続化として利用できます（手順は [`server/README.md`](./server/README.md)）
- インストール版で PHP を使う場合は環境変数 `SAFORALL_API_BASE_URL` を設定（[`docs/PACKAGING.md`](./docs/PACKAGING.md)）

## 配布

```bash
npm run dist
```

詳細・未署名ビルドと SmartScreen の注意は [`docs/PACKAGING.md`](./docs/PACKAGING.md)。

現在の公開版は **v0.1.2**（Portable ZIP: `saForAll-0.1.2-win-x64.zip`）です。Cursor Agent の Cancel 時に Cloud 実行も停止します。

### Known Issues（v0.1.2）

- **Provider Ask Cancel race（OpenAI / Gemini / Claude）**  
  Ask モードで Cancel 後に UI 上は止まっても、まれにストリームが `done` として完了扱いに見えることがあります。Cursor Agent Cancel は修正済みです。次期で改善予定です。

## ドキュメント

| 文書 | 内容 |
| --- | --- |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | 現行アーキテクチャ概要（配布正本の要約） |
| [`docs/SPECIFICATION.md`](./docs/SPECIFICATION.md) | 機能・非機能要件 |
| [`docs/DESIGN.md`](./docs/DESIGN.md) | 設計書 |
| [`docs/PIPELINE.md`](./docs/PIPELINE.md) | AI Router / Provider |
| [`docs/IDE_SHELL.md`](./docs/IDE_SHELL.md) | IDE シェル |
| [`docs/PACKAGING.md`](./docs/PACKAGING.md) | インストーラ |
| [`server/README.md`](./server/README.md) | XAMPP セットアップ |

## ライセンス

MIT（`package.json` 参照）

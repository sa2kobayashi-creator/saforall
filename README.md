# saforall

Cursor のような AI コードエディタを目指すデスクトップアプリです。

- **ランタイム**: Electron
- **UI**: React + TypeScript
- **エディタ**: Monaco Editor（VS Code と同じエンジン）
- **ビルド**: electron-vite

リポジトリ: [sa2kobayashi-creator/saforall](https://github.com/sa2kobayashi-creator/saforall)

## いまできること

- フォルダをワークスペースとして開く
- ファイル一覧の表示（直下）
- Monaco での編集・保存（Ctrl/Cmd + S）
- AI チャットパネルの UI（回答はプレースホルダ）

## セットアップ

前提: Node.js 20+（推奨 LTS）

```bash
npm install
npm run dev
```

## スクリプト

| コマンド | 説明 |
| --- | --- |
| `npm run dev` | 開発モードで起動 |
| `npm run build` | 本番ビルド |
| `npm run preview` | ビルド結果のプレビュー |
| `npm run typecheck` | TypeScript 型チェック |

## 環境変数

`.env.example` をコピーして `.env` を作成します（API キーはコミットしないでください）。

```bash
copy .env.example .env
```

## アーキテクチャ

詳細は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を参照してください。

## ロードマップ（初期）

1. ファイルツリーの再帰表示・タブ複数化
2. LLM API 接続（チャット / インライン編集）
3. ワークスペース全体のコンテキスト収集
4. ターミナル統合
5. 拡張機能・設定 UI

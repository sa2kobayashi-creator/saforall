# saforall

Cursor のような AI コードエディタを目指すデスクトップアプリです。

- **クライアント**: Electron + React + TypeScript + Monaco Editor
- **バックエンド**: XAMPP（Apache + PHP + MySQL）
- **ビルド**: electron-vite

リポジトリ: [sa2kobayashi-creator/saforall](https://github.com/sa2kobayashi-creator/saforall)

## いまできること

- フォルダをワークスペースとして開く
- ファイル一覧の表示（直下）
- Monaco での編集・保存（Ctrl/Cmd + S）
- AI チャットパネルの UI（回答はプレースホルダ）
- PHP API のヘルスチェック（`/api/health`）と MySQL スキーマ

## セットアップ

### クライアント

前提: Node.js 20+（推奨 LTS）

```bash
npm install
npm run dev
```

### バックエンド（XAMPP）

1. XAMPP で **Apache** と **MySQL** を起動
2. `server/sql/schema.sql` を phpMyAdmin などで実行
3. Apache に `server/public` を公開（手順は [server/README.md](server/README.md)）
4. ブラウザで確認: http://localhost/saforall/api/health

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

## ドキュメント

| 文書 | 内容 |
| --- | --- |
| [仕様書](docs/SPECIFICATION.md) | 機能要件・非機能要件・受け入れ基準 |
| [設計書](docs/DESIGN.md) | システム構成・IPC・AI・シーケンス |
| [アーキテクチャ概要](docs/ARCHITECTURE.md) | 構成の短い要約 |
| [サーバーセットアップ](server/README.md) | XAMPP（Apache / MySQL）手順 |

## ロードマップ（初期）

1. ファイルツリーの再帰表示・タブ複数化
2. LLM API 接続（チャット / インライン編集）
3. ワークスペース全体のコンテキスト収集
4. ターミナル統合
5. 拡張機能・設定 UI

詳細なフェーズ定義は [仕様書 §9](docs/SPECIFICATION.md#9-リリースフェーズ) を参照してください。

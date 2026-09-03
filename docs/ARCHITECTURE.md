# saforall アーキテクチャ概要

詳細は次を参照してください。

| 文書 | 内容 |
| --- | --- |
| [仕様書](./SPECIFICATION.md) | 機能要件・非機能要件・フェーズ |
| [設計書](./DESIGN.md) | システム構成・IPC・AI・シーケンス |
| [AI パイプライン](./PIPELINE.md) | AI Router（OpenAI / Cursor / Gemini） |
| [サーバーセットアップ](../server/README.md) | XAMPP（Apache / MySQL）手順 |

---

## 一言でいうと

Electron がローカルファイルを編集し、XAMPP の Apache（PHP）+ MySQL が設定・会話などの永続化と（将来）LLM プロキシを担う。

```
Electron (UI + ローカル fs + Cursor SDK)
        │ HTTP (localhost)
        ▼
Apache / PHP  AI Router  ──► MySQL（会話・usage）
        │
        ├─► OpenAI   （説明・設計・単発生成）
        ├─► Gemini   （要約・軽い質問）
        └─► Cursor   （コード開発 Agent。実行は Electron メイン）
```

## 役割分担

| 層 | 技術 | 役割 |
| --- | --- | --- |
| クライアント | Electron + React + Monaco | 編集 UI、ソースファイルの読み書き |
| API | Apache + PHP（XAMPP） | REST、設定・会話の CRUD、AI プロキシ |
| DB | MySQL（XAMPP） | メタデータ・会話・設定 |

ソースコード本体は **MySQL に保存しない**（常にローカルディスク）。

## ディレクトリ（現行）

```
saforall/
├── electron/            # デスクトップ本体
├── src/                 # React UI
├── server/              # XAMPP 向け PHP API
│   ├── public/          # Apache DocumentRoot
│   ├── api/
│   ├── sql/schema.sql
│   └── config/
└── docs/
```

## セキュリティの要点

- Electron: `contextIsolation: true` / `nodeIntegration: false`
- API キーは PHP / MySQL 側に置き、レンダラへ生値を渡さない
- `server/config/database.php` と `.env` はコミットしない
- バックエンドは当面 localhost 専用

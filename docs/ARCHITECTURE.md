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

Electron パッケージアプリが本体。設定・会話・usage は **userData のローカル JSON** に永続化し、XAMPP なしでも完結できる。開発時は任意で XAMPP（PHP/MySQL）にも接続できる。

```
Electron（UI + ローカル fs + LLM 直呼び / Cursor SDK）
        │
        ├─► userData/local-db（sessions / messages / usage）
        ├─► userData/settings-cache.json（API キー含む・Main のみ）
        │
        └─（任意）XAMPP PHP/MySQL ── 開発用の互換バックエンド
```

## 役割分担

| 層 | 技術 | 役割 |
| --- | --- | --- |
| クライアント | Electron + React + Monaco | 編集 UI、ソース読み書き、ローカル永続化、LLM 呼び出し |
| API（任意） | Apache + PHP（XAMPP） | 開発時の互換 REST |
| 永続化（配布） | userData JSON | 設定・会話・usage |

ソースコード本体は **DB に保存しない**（常にローカルディスク）。

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
- バックエンドは当面 localhost 専用（配布時は Electron 内ローカル永続化が正本）

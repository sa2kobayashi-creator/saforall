# saforall バックエンド（XAMPP）

Apache（PHP）+ MySQL で動くローカル API です。

## 前提

- [XAMPP](https://www.apachefriends.org/) がインストール済み
- Apache と MySQL を起動できること

## セットアップ手順

### 1. 設定ファイル

```powershell
copy server\config\database.example.php server\config\database.php
```

XAMPP 既定では MySQL の `root` パスワードは空です。変更している場合は `database.php` を編集してください。

### 2. データベース作成

1. XAMPP で MySQL を起動
2. http://localhost/phpmyadmin を開く
3. 「インポート」から `server/sql/schema.sql` を実行  
   または SQL タブに内容を貼り付けて実行

### 3. Apache で公開

#### 方法 A: Alias（推奨）

1. `server/apache/saforall.conf.example` を参考に、パスを自分の環境に合わせる
2. 例: `C:\xampp\apache\conf\extra\httpd-saforall.conf` に保存
3. `C:\xampp\apache\conf\httpd.conf` の末尾に追加:

```apache
Include conf/extra/httpd-saforall.conf
```

4. Apache を再起動

#### 方法 B: ジャンクション

管理者 PowerShell:

```powershell
New-Item -ItemType Junction -Path "C:\xampp\htdocs\saforall" -Target "D:\Development\saforall\server\public"
```

### 4. 動作確認

ブラウザまたは curl:

```
http://localhost/saforall/api/health
```

成功例:

```json
{
  "ok": true,
  "data": {
    "service": "saforall-api",
    "status": "ok",
    "database": "connected"
  }
}
```

## エンドポイント（現状）

| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/` または `/api` | サービス情報 |
| GET | `/api/health` | 生存確認 + DB 接続確認 |
| GET / PUT | `/api/settings` | 設定の取得・更新（API キー生値は返さない） |
| GET / POST | `/api/workspaces` | 最近のワークスペース一覧・登録 |
| GET / POST | `/api/chat/sessions` | 会話セッション一覧・作成 |
| GET / POST | `/api/chat/sessions/{id}/messages` | メッセージ取得・追加 |
| POST | `/api/ai/chat` | LLM プロキシ（一括応答） |
| POST | `/api/ai/chat/stream` | LLM プロキシ（SSE ストリーミング） |

### LLM 設定

1. アプリの設定（⚙）または `PUT /api/settings` で次を保存する
   - `llm.base_url`（例: `https://api.openai.com/v1`）
   - `llm.model`（例: `gpt-4o-mini`）
   - `llm.api_key`
2. チャットから質問すると `POST /api/ai/chat/stream` が外部 LLM をストリーミング呼び出し、結果を MySQL に保存する

OpenAI 互換 API（ローカル LLM の OpenAI 互換エンドポイントなど）も `base_url` を変えれば利用できます。

### SSL 証明書エラーが出る場合

XAMPP では次のエラーになることがあります。

```text
SSL certificate problem: unable to get local issuer certificate
```

`server/certs/cacert.pem` を同梱済みです。PHP はこれを自動参照します。  
Apache を再起動したうえで、もう一度チャットしてください。

## ディレクトリ

| パス | 内容 |
| --- | --- |
| `public/` | Apache の公開ディレクトリ |
| `api/` | エンドポイント実装 |
| `src/` | 共通ライブラリ |
| `config/` | DB 接続設定 |
| `sql/` | スキーマ |

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

## ディレクトリ

| パス | 内容 |
| --- | --- |
| `public/` | Apache の公開ディレクトリ |
| `api/` | エンドポイント実装 |
| `src/` | 共通ライブラリ |
| `config/` | DB 接続設定 |
| `sql/` | スキーマ |

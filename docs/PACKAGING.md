# Packaging / installer

Windows 向けインストーラは **electron-builder** で生成します。

## 前提

```bash
npm install
npm run build
```

`electron-vite build` が `out/` に main / preload / renderer を出力します。

## インストーラ作成

```bash
npm run dist
```

成果物は `release/` に出力されます（例: `saforall-0.1.0-Setup.exe`）。

開発中のパッケージ確認のみなら:

```bash
npm run pack
```

## 署名と SmartScreen（現状）

- `electron-builder.yml` では **`signAndEditExecutable: false`**（未署名ビルド）です。
- 未署名の `.exe` を初めて開くと、Windows Defender SmartScreen が警告することがあります。  
  **「詳細情報」→「実行」** で続行できます（開発・社内配布向け）。
- 本番の信頼を上げるには Authenticode コード署名証明書が必要です。  
  環境変数例: `CSC_LINK`（.pfx パス）、`CSC_KEY_PASSWORD`。揃ったら `signAndEditExecutable` を有効化してください。
- **自動更新（electron-updater）は未導入**です。配信ホストと署名の準備後に別途追加します。

## 注意

- エンドユーザー向け配布では **XAMPP は不要**です。設定に API キーを入れればローカルモードで Chat / Tab / Agent が動きます。
- インストール版は既定で PHP（`localhost:8081`）を探しません。開発用 XAMPP を使いたい場合は環境変数 `SAFORALL_API_BASE_URL=http://localhost:8081/saforall/api` を設定してください。
- 開発時のみ任意で `server/` を XAMPP DocumentRoot に置けます。
- `node-pty` / `@cursor/sdk` は native・実行ファイルのため `asarUnpack` 対象です。
- **バージョンを上げてから `dist` する**と、古い Setup.exe と区別できます（例: `0.1.1`）。

## トラブル: インストール版だけチャットが遅い／動かない

よくある原因:

1. **古い Setup** — `npm run dev` は最新ソース、Setup は以前のビルド。`npm run dist` で作り直す。
2. **API キー未設定** — インストール版の Settings は別途キー保存が必要（userData）。
3. **Cursor 実行場所が Cloud** — GitHub SCM 権限エラーになる。Settings で Local にして**保存**。

## トラブル: app.asar が削除できない

```
remove ...\release\win-unpacked\resources\app.asar:
The process cannot access the file because it is being used by another process
```

**原因:** 前回の `pack` / インストール済み／起動中の saforall が `app.asar` を掴んでいる。

**対処:**

1. タスクマネージャーで **saforall.exe** / 関連 Electron を終了  
2. `release\win-unpacked` を開いているエクスプローラーを閉じる  
3. まだダメなら `release\win-unpacked` フォルダごと削除（または PC 再起動）  
4. 再度 `npm run pack` / `npm run dist`

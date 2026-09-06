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
- 開発時のみ任意で `server/` を XAMPP DocumentRoot に置けます。
- `node-pty` は native モジュールのため、ビルド環境の Electron 向け rebuild が必要な場合があります（実行中の Electron を止めてから pack）。

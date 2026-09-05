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

## 注意

- バックエンド（XAMPP / PHP API）はインストーラに含みません。別途 `server/` を DocumentRoot に配置してください。
- `node-pty` は native モジュールのため、ビルド環境の Electron 向け rebuild が必要な場合があります。

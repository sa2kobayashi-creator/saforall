# saforall IDE シェル（Cursor 風）ロードマップ

Explorer / Terminal / メニュー / Activity / Git / Search を Cursor 風に揃える。

## 目標構成

```
メニュー: File / Edit / View / Terminal / Git / Help
ActivityBar: Explorer | Search | Source Control | Extensions
Sidebar: 選択中ビュー
Main: Editor（分割可）+ 下部パネル（Terminal / Problems / Debug / References / Jobs / Timeline）
Right: AI Chat
```

## フェーズ

| Phase | 内容 | 状態 |
| --- | --- | --- |
| **1** | Electron メニュー（File/View/Terminal/Git） | 完了 |
| **1** | ActivityBar をビュー切替（Explorer / SCM） | 完了 |
| **1** | Git status 表示・clone（GitHub/Bitbucket URL） | 完了 |
| **2** | stage / commit / push / pull UI | 完了 |
| **2** | 下部パネルタブ（Terminal / Problems） | 完了 |
| **3** | Search サイドバー（コード内 / ファイル名） | 完了 |
| **3** | 最近のワークスペース | 完了（Welcome） |
| **3** | GitHub PR 作成（`gh`）+ auth 表示 | 完了 |
| **3** | Bitbucket PR / 認証 | **軽量版で完了**（下記） |
| **4** | Explorer 右クリック・コマンドパレット・Quick Fix・Ctrl+K 差分レビュー・複数ターミナル | 完了 |
| **4** | Go to Symbol / Peek / エディタ分割 / `.gitignore` Explorer | 完了 |
| **5** | Signature Help・マージコンフリクト UI | 完了（本バッチ） |

## Bitbucket（Phase 3 の扱い）

GitHub の `gh` 一体型ほど深くはしない方針。現状で足りる範囲:

- Bitbucket remote 検出
- **BB** ボタンで PR 作成ページをブラウザで開く
- `bitbucket:probeAuth` による疎通確認 + SSH ガイド

アプリ内での PR 本文投稿や Bitbucket API ログインマネージャは **対象外**（必要なら別トラック）。

## Git 方針

- 実行はローカルの `git` CLI（Electron メイン）
- クローン先はユーザーが選ぶフォルダ
- GitHub / Bitbucket は HTTPS URL を同じ `git clone` で扱う
- 認証は OS / git credential helper に任せる（キーを saforall に直書きしない）
- マージコンフリクトは SCM 一覧 + エディタの Accept Current / Incoming / Both

## 既存との関係

- Explorer: `Sidebar`（右クリック新規/削除/リネーム、`.gitignore` 準拠）
- Search: Activity 🔎 / `Ctrl+Shift+F`
- Terminal（複数タブ）/ Problems / Debug / References / Jobs / Timeline: `BottomPanel`
- AI Chat: 右ペイン。コマンドパレット・メニューからも
- Git SCM: staged / changes / conflicts、commit、pull/push、GitHub PR、Bitbucket BB

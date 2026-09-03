# saforall IDE シェル（Cursor 風）ロードマップ

「次の段階は Cursor のようなメニュー」を正とする。Explorer / Terminal は既にあるので、**メニュー・Activity ビュー・Git** で揃える。

## 目標構成

```
メニュー: File / Edit / View / Terminal / Git / Help
ActivityBar: Explorer | Source Control | (将来 Search)
Sidebar: 選択中ビュー
Main: Editor + 下部パネル（Terminal タブ）
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
| **3** | Search サイドバー、最近のワークスペース | 未着手 |
| **3** | PR 作成・認証マネージャ（gh / Bitbucket） | 未着手 |

## Git 方針

- 実行はローカルの `git` CLI（Electron メイン）
- クローン先はユーザーが選ぶフォルダ
- GitHub / Bitbucket は HTTPS URL を同じ `git clone` で扱う
- 認証は OS / git credential helper に任せる（キーを saforall に直書きしない）

## 既存との関係

- Explorer: `Sidebar` を維持し、Activity の Explorer ビューで表示
- Terminal / Problems: `BottomPanel` のタブ。メニュー View と Activity から開閉
- AI Chat: 右ペインのまま。メニュー View からも切替
- Git SCM: staged / changes 分離、commit、pull/push（ahead/behind 表示）

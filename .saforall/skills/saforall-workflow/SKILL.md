---
name: saforall-workflow
description: saforall での Agent 作業の基本フロー（調査→編集→検証）。小さな修正やリファクタで使う。
---

# saforall Agent ワークフロー

## いつ使うか

- コード修正・リファクタ・バグ修正を Agent モードで進めるとき
- 「適用して」「反映して」と差分適用を求められたとき

## 手順

1. **plan**: 変更方針を短く立てる（必要なら軽く search / list）
2. **explore**: `read_file` / `search_code` で関連ファイルを読む。未読のまま `edit_file` しない
3. **edit**: `edit_file` で Composer に載せ、完全なファイル内容を送る
4. **verify**: `run_shell`（typecheck 優先）と `get_problems` で確認。失敗したら edit に戻る

## ルール

- 文章だけの修正説明で終わらない。必ずツールで編集する
- 破壊的コマンドは使わない
- 最終回答は日本語で、変更ファイルと検証結果を短くまとめる

# saforall AI パイプライン仕様（AI Router）

実装の正本。

関連: [設計書 §7](./DESIGN.md#7-ai-サブシステム設計目標) / [仕様書](./SPECIFICATION.md)

---

## 1. 目的

「ユーザーが AI を選ばなくても、性能・料金・残予算で最適な Provider を自動選択する AI エディタ」

```
                 ユーザー
                    │
                    ▼
                 saforall
                    │
                    ▼
                AI Router
           ①タスク判定 ②予算 ③選択 ④実行 ⑤記録
                    │
       ┌────────────┼────────────┐
       ▼            ▼            ▼
    OpenAI       Gemini       Claude
    (Codex系)     API          API
```

**分類の前提**

| 層 | 例 | saforall での扱い |
| --- | --- | --- |
| AI エディタ | Cursor / Windsurf | **開発環境**（製品 Router の API 先にしない） |
| AI Agent | Claude Code / Codex CLI | 将来の拡張候補 |
| AI モデル API | OpenAI / Gemini / Claude | **製品 Router の Provider** |

Cursor Pro+ 契約は開発者向け。ユーザー向け API 費用として分配しない。

---

## 2. 初期運用の月額上限（変更可）

設定画面の `cost.*.monthly_usd` で後から変更する。

| エンジン | 月上限 | 主用途 |
| --- | --- | --- |
| OpenAI | **$20** | メイン Coding |
| Gemini | **$10** | 安価な質問・要約 |
| Claude | **$10** | 設計・レビュー・難しい修正 |
| Cursor | **$70** | 明示選択時のみ（開発者オプトイン） |
| Workers AI | **$5** | 明示選択 / Auto オプトイン |
| 製品合計目安 | **$40** | OpenAI+Gemini+Claude |

**外側の安全装置**: 各 Provider コンソールでも同額帯の spend limit を設定する。  
手順は [PROVIDER_SPEND_LIMITS.md](./PROVIDER_SPEND_LIMITS.md)。

### 予算しきい値

| 使用率 | 動作 |
| --- | --- |
| 0–70% | 通常 |
| 70–85% | 警告（`budget_warning`） |
| 85–95% | Auto では原則スキップ → 他 Provider 優先（逼迫時のみ許可） |
| 95–100% | Auto では停止扱い |
| 100% | その Provider 停止 / 固定選択は 429 |

### 推定コスト事前判定

実行前に `UsageService::estimateRequestUsd` で概算し、

- Provider 残予算
- ユーザープラン残予算

の両方と比較する。足りなければ Auto は別 Provider へフォールバック、固定選択は `BUDGET_EXCEEDED` / `USER_BUDGET_EXCEEDED`。

### ユーザープラン（販売時）

| プラン | 月枠 | 設定値 |
| --- | --- | --- |
| Free | $0.50 | `billing.user_plan=free` |
| Light | $2 | `light` |
| Standard | $5 | `standard` |
| Unlimited | 実質無制限 | `unlimited`（ローカル開発既定） |

任意で `billing.user.monthly_usd` に数値を入れるとプラン既定を上書き。

Provider 予算とユーザープランは別管理。

---

## 3. エンジン

| エンジン | 用途 | 接続 |
| --- | --- | --- |
| **OpenAI** | コード生成・通常の修正・Agent（tools） | PHP `LlmClient` |
| **Gemini** | 簡単な質問・要約・別視点 | PHP `GeminiClient` |
| **Claude** | 設計・大規模解析・レビュー | PHP `ClaudeClient`（Anthropic Messages） |
| **Cursor** | 開発 Agent（明示選択） | Electron `@cursor/sdk` |
| **Workers AI** | 極安補助（オプトイン） | PHP `LlmClient` + Cloudflare |

UI（固定選択）:

```
AI
● 自動（おすすめ）
○ OpenAI
○ Gemini
○ Claude
○ Cursor
○ Workers AI
```

Auto 既定の有効リスト: `["openai","gemini","claude"]`  
（`router.enabled_engines` で変更。Cursor / Workers はオプトイン）

## 3.5 モデル複数選択と Auto

各エンジンで **利用してよいモデルを複数チェック** できる（設定画面）。

| モード | モデルの決まり方 |
| --- | --- |
| **AI = 自動** | Router がエンジンを選び、そのエンジンの候補から作業種別でモデルを選ぶ |
| **AI = 固定** | チャットのリストで「モデル自動」または特定モデルを選択 |

---

## 4. 振り分け（自動・エンジン）

| 種別 | 希望エンジン（有効時） |
| --- | --- |
| 簡単な質問 / 要約 | Gemini |
| 説明（中程度） | Gemini（ポリシー）または OpenAI |
| コード生成 | OpenAI |
| 設計 / 複数ファイル修正 / リポジトリ解析 / テスト直し | Claude |
| Agent（ツール実行） | **OpenAI または Claude**（Gemini / Workers 不可） |

希望エンジンが無効・未設定・予算しきい値超過 → 有効な別エンジンへフォールバック。

---

## 5. Claude 設定キー

| キー | 意味 |
| --- | --- |
| `llm.claude.api_key` | Anthropic API Key（サーバーのみ。ブラウザへ返さない） |
| `llm.claude.model` / `llm.claude.models` | 既定・候補 |
| `llm.claude.base_url` | 既定 `https://api.anthropic.com` |
| `cost.claude.monthly_usd` | 月上限（既定 10） |

マイグレーション: `server/sql/migration_claude_router.sql`

---

## 6. 秘密情報

API キーは `settings` に保存し、GET `/settings` では `_set` フラグのみ返す。  
Electron メインプロセスのみ `X-Saforall-Client: electron-main` で route 時に provider 秘密を受け取る。

---

## 7. 使用量記録

`ai_usage` に engine / model / tokens / estimated_usd を記録。  
`ai_route_log` に Router 判定（engine / task / fallback / 推定コスト）を記録。  
Usage 画面でエンジン別・タスク別集計と **振り分けヒント** を表示する。  
バーは 70% warn / 85%+ danger。ユーザープラン枠も表示。

---

## 8. 本格化ロードマップ

| 段階 | 内容 | 状態 |
| --- | --- | --- |
| A | Claude でも Agent ツール実行（Anthropic `tool_use`） | **実装中〜完了** |
| B | OpenAI Codex 系モデルを Coding 優先候補に | **実装中〜完了** |
| C | ルート／Agent の運用ログで振り分け改善 | **Usage 画面に集計・ヒント実装** |
| D | マルチユーザー認証・販売課金 | 後続 |
| E | Claude Code / Codex CLI 級の外部長時間 Agent 連携 | V2 |

---

## 9. V2 以降（外部 Agent）

- Claude Code / Codex CLI を saforall から起動する「外部 Agent」連携
- マルチユーザー認証とユーザ単位の `user_ai_usage` テーブル分離
- 毎日使いの品質は Usage / Agent ログを見て Router ルールを調整する

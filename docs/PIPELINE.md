# saforall AI パイプライン仕様（AI Router）

実装の正本。

関連: [設計書 §7](./DESIGN.md#7-ai-サブシステム設計目標) / [仕様書](./SPECIFICATION.md)

---

## 1. 目的

「AI を固定するのではなく、その仕事に合った AI へ自動で切り替える AI エディタ」

```
                 saforall
                    │
             ┌──────┴──────┐
             │ AI Router   │
             └──────┬──────┘
                    │
     ┌──────────┬───┴───┬──────────┐
     ↓          ↓       ↓          ↓
 OpenAI     Cursor   Gemini   Workers AI
 説明・設計   コード開発  補助     簡単な作業
```

Cursor はチャット補完ではなく **開発 Agent**（SDK + `CURSOR_API_KEY`）。

---

## 2. 初期運用の月額上限（変更可）

設定画面の `cost.*.monthly_usd` で後から変更する。

| エンジン | 月上限 |
| --- | --- |
| Cursor | **$70** |
| OpenAI | **$20** |
| Gemini | **$10** |
| Workers AI | **$5** |
| 合計目安 | **$105** |

上限を超えたエンジンは自動では使わない。

---

## 3. エンジン

| エンジン | 用途 | 接続 |
| --- | --- | --- |
| **Workers AI** | 簡単な質問・短い文章・ドキュメント | PHP `LlmClient` + Cloudflare OpenAI 互換 API |
| **Gemini** | 要約・翻訳・補助（Workers 不通時の安価フォールバック） | PHP `LlmClient` |
| **OpenAI** | 説明・設計・単発のコード生成 | PHP `LlmClient` |
| **Cursor** | 修正・複数ファイル・テストして直す | Electron `@cursor/sdk` |

UI:

```
AI
● 自動（おすすめ）
○ Cursor
○ OpenAI
○ Gemini
○ Workers AI
```

## 3.5 モデル複数選択と Auto

各エンジンで **利用してよいモデルを複数チェック** できる（設定画面）。

| モード | モデルの決まり方 |
| --- | --- |
| **AI = 自動** | Router がエンジンを選び、そのエンジンの候補から作業種別でモデルを選ぶ（安い／標準／強） |
| **AI = 固定** | チャットのリストで「モデル自動」または特定モデルを選択 |

作業とティア:

- 簡単な質問・要約 → `cheap`
- 説明・コード生成・修正 → `standard`（なければ cheap）
- 設計・長時間・テスト直し → `strong`（なければ standard）

設定キー: `llm.openai.models` など JSON 配列。

---

## 4. 振り分け（自動・エンジン）

設定 `router.enabled_engines`（JSON 配列）で **Auto に使う AI を限定**できる。  
例: `["cursor","gemini","workers"]` なら OpenAI は Auto では使わない。

| 種別 | 希望エンジン（有効時） |
| --- | --- |
| 簡単な質問 | Workers AI |
| 要約・翻訳・短いドキュメント | Workers AI |
| コード説明 | OpenAI |
| コード生成（提案） | OpenAI |
| 難しい設計 | OpenAI |
| 小規模〜複数ファイル修正 / リポジトリ解析 / テストして直す | Cursor |

希望エンジンが無効・未設定・上限超過 → 有効な別エンジンへフォールバック。  
判定不能の希望は OpenAI（無効なら次の有効エンジン）。

固定選択（OpenAI など）は Auto の有効リストと独立。

---

## 5. Workers AI 設定キー

| キー | 意味 |
| --- | --- |
| `llm.workers.account_id` | Cloudflare Account ID |
| `llm.workers.api_token` | API Token（Workers AI 実行権限） |
| `llm.workers.gateway_id` | AI Gateway ID（既定 `default`） |
| `llm.workers.model` | 例: `@cf/meta/llama-3.1-8b-instruct` |
| `cost.workers.monthly_usd` | 月上限（既定 5） |

互換のため `llm.simple.*` も読み書きする。

---

## 6. 秘密情報

```
CURSOR_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=
CLOUDFLARE_API_TOKEN=
```

ソース直書き禁止。レンダラへ生値を返さない。

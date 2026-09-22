# saforall Pipeline 製品仕様（骨格・正本）

> **本ドキュメントは製品の最重要仕様である。**  
> saforall の最大の売りは **Pipeline** である。この原則は曲げない。  
> 実装 Phase（92049 以降）は、本仕様を骨格としてアプリを改善する。

| 項目 | 値 |
| --- | --- |
| Phase | 92048（製品仕様サーベイ） |
| Status | **GO** — Architecture 設計へ進める |
| Baseline | Public Release v0.1.2 / DeepSeek 以降 |
| Code change in 92048 | なし（本ファイルの追加・既存 Router 文書の位置付け明確化のみ） |
| Related | [PIPELINE.md](./PIPELINE.md) = **AI Router**（旧称「AI パイプライン」）。製品 Pipeline ではない |

---

## 0. 用語の正式定義（絶対）

| 用語 | 正式な意味 | 誤用 |
| --- | --- | --- |
| **Pipeline** | 1 つの仕事を複数 Step に分解し、順序・条件・データ連携に従って実行し、最終成果物まで到達させる仕組み | Provider 自動選択のこと |
| **Router** | Step 内で Provider / Model / Budget / Failover を決める内部機能 | Pipeline そのもの |
| **Provider** | AI 推論の実行主体（OpenAI / Claude / Gemini / Grok / DeepSeek 等） | 仕事の流れの制御 |
| **Agent** | Tool を使って自律作業する実行モード。Pipeline の **Step 種別の一つ**として載せる | Pipeline そのもの |
| **Failover** | Router 内の Provider 切替。Pipeline の Step を増やすものではない | 追加 Step |
| **Jobs** | 単一タスクのバックグラウンド実行キュー。Pipeline 実行のホストになり得るが Pipeline ではない | Pipeline |

旧 UI 表記「Auto パイプライン」は **AI Router 設定**である。製品文書・今後の UI では **Auto / Router** と呼び、**Pipeline** と混同しない。

---

## 1. 最重要の製品原則

### Pipeline とは

> 1 つの仕事を複数の Step に分解し、Step を定義された順序・条件・データ連携に従って実行し、最終成果物まで到達させる仕組み

- Pipeline は「AI を選ぶ機能」ではない。
- Pipeline は **仕事の流れそのものを制御する機能** である。
- saforall を使う第一の理由は、この Pipeline である。

### 基本構造（骨格）

```text
Pipeline
   │
   ├─ Step 1 ──► Router ──► Provider ──► AI / Agent / Tool
   ├─ Step 2 ──► Router ──► Provider ──► …
   └─ Step N ──► Router ──► Provider ──► …
         │
         └─ Step 間データ（output → next input）
```

---

## 2. 責任境界表（92048 重要成果物）

| 項目 | Pipeline | Router | Provider | Agent | Failover | Jobs |
| --- | --- | --- | --- | --- | --- | --- |
| Step 定義・順序・実行 | YES | NO | NO | NO | NO | NO |
| Step 間データ連携 | YES | NO | NO | NO | NO | NO |
| 条件分岐 / Loop | YES | NO | NO | NO | NO | NO |
| Pipeline 状態 / 保存 / 編集 | YES | NO | NO | NO | NO | NO |
| Pipeline Cancel / Resume | YES | NO | NO | NO | NO | ホスト可 |
| Provider / Model 選択 | NO | YES | NO | NO | NO | NO |
| Auto routing / Budget | NO | YES | NO | NO | NO | NO |
| Provider Failover | NO | YES（内部） | NO | NO | YES | NO |
| AI 推論 | NO | NO | YES | 利用 | NO | NO |
| Tool 実行 | Step/Agent 側 | NO | NO | YES | NO | NO |
| 単発 BG キュー | NO | NO | NO | 実行可 | NO | YES |

**一文:** Pipeline が仕事の流れを支配し、Router は各 Step の「どの AI でどう実行するか」だけを担当する。

---

## 3. 既存実装との接続方針（変更せず再利用）

調査時点の接続点（読み取り専用確認）:

```text
[将来] Pipeline Engine
          │
          ├─ Ask 系 Step  → executeAi / generateAssistantText
          ├─ Agent Step   → runToolAgent → executeAiWithTools
          ├─ 経路決定     → prepareLocalRoute（任意）
          ├─ Failover     → ai/failover.ts（Router 内）
          ├─ Usage        → UsageEvent（将来 pipelineId / stepId 拡張）
          ├─ Cancel       → chatAbort / AbortSignal を Pipeline Cancel から伝播
          └─ 長時間実行   → BackgroundJob をホストとして利用可能（kind 拡張）
```

| 層 | 既存 | Pipeline 側の扱い |
| --- | --- | --- |
| Router | `electron/main/ai/router.ts`, `localAiRouter.ts` | Step 実行時に呼ぶ。Pipeline に吸収しない |
| Provider | OpenAI / Claude / Gemini / Grok / DeepSeek adapters | Step の routing 設定で指定。定義に Secret を書かない |
| Agent | `toolAgent.ts`（phase: plan/explore/edit/verify） | **Agent Step** として呼ぶ。Pipeline ≠ Agent |
| Tool | Agent TOOLS / MCP | Agent Step 経由。MVP では独立 Tool Step は後回し可 |
| Failover | Ask: 複数 LLM / Agent: openai↔claude | Step 内に閉じる。UI で「追加 Step」に見せない |
| Usage | attempt = 1 UsageEvent | Pipeline / Step 集計はメタ付与で後続 |
| Jobs | `backgroundJobs.ts` agent\|bugbot | Pipeline Run の BG ホスト候補 |
| Vault | credentials-vault / settings-cache | 実行時 resolve。Pipeline JSON に API Key を入れない |
| 変数 | 汎用 `{{step.output}}` エンジンは **未実装** | Pipeline Engine で新設が必要 |

---

## 4. Step 候補

### MVP（最初に実装）

| Step | 役割 | 実行 |
| --- | --- | --- |
| **AI Step** | 分析・仕様・レビュー等の文章生成 | Router → Provider（Ask / `executeAi`） |
| **Agent Step** | 実装・修正・Verify（Tool 使用） | Router → Provider → `runToolAgent` |
| **Output Step** | 最終成果物の確定・要約・パス一覧 | 変換 / まとめ（AI 任意） |

### 将来（MVP 後）

- Tool Step（単一 Tool 直接実行）
- Transform Step
- Condition Step
- Loop Step
- Human Review Step

### Agent の載せ方（92048 決定）

**Agent は独立した Step 種別（Agent Step）とする。**  
AI Step の「モード」に埋め込まない。理由:

1. Pipeline ≠ Agent を UI・モデルで明確に保てる
2. 既存 `runToolAgent` の境界（phase / tools / cancel）を Step 単位で再利用しやすい
3. Ask のみの Step と混在させても責任が分離できる

---

## 5. Step 間データモデル（候補・未凍結）

### 原則

```text
Pipeline Input
    ↓
Step 1 → output
    ↓  （参照: {{input.*}} / {{steps.<id>.output}}）
Step 2 → output
    ↓
…
    ↓
Pipeline Output
```

### 値の種類（候補）

| 種類 | 例 |
| --- | --- |
| text | レポート本文、仕様文 |
| json | 構造化分析結果 |
| file / path | 変更ファイル一覧、成果物パス |
| directory | 対象リポジトリ / 作業ディレクトリ |
| metadata | provider, model, tokens, cost, duration |
| error | Step 失敗時の構造化エラー（次 Step には通常渡さない） |

### 参照記法（候補）

```text
{{input.task}}
{{steps.spec.output}}
{{steps.impl.files}}
```

※ DSL・スキーマ最終版は 92049+ で決定。92048 では「Step 出力が次 Step 入力になる」ことだけを必須とする。

### Pipeline Input / Output（境界）

**Input 例:** repository / task description / target directory / reference files  
**Output 例:** report / modified files / test result / final response

---

## 6. 最初の実用 Pipeline 候補比較

| 観点 | A Research→Analysis→Report | **B Spec→Impl→Verify** | C Code Review | D Multi-Provider Review |
| --- | --- | --- | --- | --- |
| 実用性 | 中（調査物） | **高（実装成果物）** | 高 | 中〜高 |
| saforall 適合 | Ask 連鎖中心 | **Agent + Router 本命** | bugbot と重複しやすい | Provider 差別化は強いが作業制御が薄い |
| Agent 相性 | 低〜中 | **最高**（phase と同型） | 高 | 低 |
| 複数 AI 価値 | 任意 | Step ごとに Fixed/Auto 可 | 可 | **必須級** |
| Router 価値 | 中 | **高** | 中 | 高 |
| Step 間データ | text | **仕様→実装→検証** | diff/report | text 連鎖 |
| UI 複雑性 | 低 | 中 | 中 | 低 |
| 実装難易度 | 低 | 中 | 中 | 低 |
| Cancel / Cost | 容易 | Agent abort 伝播が要点 | 同左 | 容易 |

### 選定: **Candidate B — Specification → Implementation → Verify**

これが **最初に実装する本命 Pipeline（MVP 旗艦）** である。

```text
Pipeline: Spec → Implement → Verify

[Input: task + workspace]
        ↓
Step 1  Specification     (AI Step)
        Fixed or Auto Router → Provider（例: Claude / 強いモデル）
        output: 仕様・受け入れ条件・変更方針
        ↓
Step 2  Implementation    (Agent Step)
        Router → Agent 対応 Provider（例: OpenAI / Claude）
        tools: read / edit / shell …
        input: {{steps.spec.output}} + workspace
        output: 変更ファイル・作業要約
        ↓
Step 3  Verify            (Agent Step または AI Step + shell)
        Router → Provider
        input: {{steps.impl.output}}
        output: 検証結果・残課題
        ↓
[Output Step]
        最終レポート + 変更一覧 + Usage 集計
```

**選定理由（製品）:**

1. 「仕事の流れを制御する」ことがユーザーに一目で分かる  
2. 複数 Step・複数 AI・Agent・Router・Step 間データ・成果物・再利用・Cost・Cancel の **選定条件 10 項目を満たしうる**  
3. 既存 Agent phase（plan/explore/edit/verify）と対応し、再利用コストが最小  
4. Candidate D は第二弾テンプレートとして温存（Ask 連鎖で早期デモも可能だが、本命の「売り」は B）

---

## 7. Router 利用方式（Step 設定）

各 Step は次のいずれかを持てる:

| 方式 | 意味 |
| --- | --- |
| Fixed Provider | 例: Step 1 = Claude |
| Auto Router | Step 実行時に Router が最適 Provider を選択 |
| Router + Failover | Primary 失敗時、Router 内 Failover（**同一 Step の継続**） |

Pipeline は Step を定義し、**Step の AI 実行方法として Router を利用する**。

---

## 8. 保存・実行・エラー・Cancel（MVP 方針）

### 保存（MVP に含める）

Create / Save / Rename / Duplicate / Delete / List / Reuse  
（Version・Export/Import は後続）

### 実行（MVP）

Run / Cancel / 完了状態の表示  
（Pause / Resume / Run from Step は後続。Resume は設計上の穴として記録し、MVP では「失敗後に再 Run」で代替可）

### Error Model

```text
Pipeline Error
  └─ Step Error
       └─ Router Error
            └─ Provider Error  →（Failover 成功なら Pipeline Error にしない）
```

### Cancel 伝播

```text
Pipeline Cancel
  → 現在 Step Cancel
    → Provider / Agent Abort（既存 AbortSignal / chatAbort）
    → 後続 Step は開始しない
```

### Usage / Cost（MVP）

- 既存 UsageEvent を継続利用  
- 将来: `pipelineId` / `stepId` / `runId` を付与し、Pipeline 合計を集計  
- UI: Step 別 Provider・tokens・cost（最低限ログまたは Usage 画面連携）

---

## 9. Jobs との境界

| | Jobs | Pipeline |
| --- | --- | --- |
| 単位 | 単一タスク | 複数 Step の流れ |
| 現状 | agent / bugbot | 未実装 |

将来構造（候補）:

```text
Pipeline Run
    ↓
Background Job（ホスト）
    ↓
Pipeline Engine が Step を逐次実行
```

Jobs を Pipeline に置き換えない。Pipeline が Jobs を使ってもよい。

---

## 10. UI 方針（MVP）

- **Hybrid:** Step List + 詳細設定パネル（Visual Builder は後続）  
- Step の順番と内容が一目で分かること  
- Failover / Auto を「見えない追加 Step」として表示しない  
- Router 設定と Pipeline 設計を別パネル／別概念で見せる  
- 実行中は「どの Step か」「成功/失敗/取消」を常に表示  
- Step 間データは少なくとも「前 Step 出力のプレビュー」を見せる

### UX で避けること（再掲）

- Pipeline と Router の混同  
- Provider 設定と Pipeline 設計の混同  
- Failover を Pipeline Step として表示  
- Auto Router を Pipeline そのものとして表示  
- Agent と Pipeline を同じ概念として扱う  
- Step 間データが見えない  
- 実行状態が分からない

---

## 11. セキュリティ

| 項目 | 方針 |
| --- | --- |
| API Key | Pipeline 定義に保存しない。実行時 Vault/Settings |
| Step output | Secret をログ・output に載せない |
| Tool / Shell | 既存 Agent workspace 境界を継承 |
| Import | 後続。信頼できない Pipeline 定義の検証が必要 |

---

## 12. MVP Scope

### 含める

1. Pipeline データモデル（id, name, steps, input/output, error policy の最小）  
2. 永続化（userData JSON）  
3. UI: 一覧・作成・編集（Step List）・実行・Cancel・結果  
4. Step: **AI / Agent / Output**  
5. Step 間 text（＋簡易 metadata）受け渡しと `{{…}}` 最小参照  
6. Step ごとの Fixed / Auto Router（既存 Router 再利用）  
7. Failover は Router 内のまま（UI で Step 化しない）  
8. 旗艦テンプレート: **Spec → Implement → Verify**  
9. Usage との最低限の紐付け（run 単位が分かること）  
10. Cancel → 現在 Step / Agent への abort 伝播

### 含めない（明示）

- Condition / Loop / Human Review / 独立 Tool Step  
- Visual Builder  
- Resume / Run from Step / Pause  
- Pipeline Marketplace / 共有 / SaaS 課金  
- 完全 DSL・最終 DB schema・最終 IPC  
- Failover を Pipeline Step に見せる変更  
- Provider 新規追加（本 Phase 範囲外）

---

## 13. Architecture Direction（次 Phase へ）

```text
Renderer: PipelinePanel（一覧・編集・Run UI）
    ↓ IPC
Main: PipelineEngine
    ├─ load/save pipelines.json
    ├─ run(runId): for each step
    │     ├─ resolve templates (input / prior outputs)
    │     ├─ if AI Step    → executeAi (+ Router)
    │     ├─ if Agent Step → runToolAgent (+ Router / tools)
    │     ├─ if Output     → assemble Pipeline Output
    │     ├─ record step result + usage meta
    │     └─ on cancel: abort current
    └─ optional: wrap run in BackgroundJob
```

92049 予定: 本骨格に基づく **Pipeline アーキテクチャ設計**（IPC・永続スキーマ草案・UI IA）。  
実装コードの本格着手はその後。

---

## 14. Risks（最大 5）

1. **用語汚染:** 「Auto パイプライン」表記が残ると、ユーザーが Router を Pipeline だと誤解し続ける  
2. **Cancel 伝播漏れ:** Pipeline Cancel しても Agent/Tool が残ると信頼を損なう  
3. **Agent Step の境界:** 1 Agent セッションを 1 Step にするか、phase を複数 Step に割るかで設計がぶれる → MVP は **1 Agent Step = 1 runToolAgent 実行**  
4. **変数・巨大 output:** 仕様文が長く次 Step context を圧迫 → Output 要約・ファイル参照が必要  
5. **Jobs との二重管理:** BG Job と Pipeline Run 状態が分裂する → Run の正本を PipelineEngine に置き、Job はホストに限定

---

## 15. 92048 最終判定

### GO

Pipeline 製品定義と最初の MVP 方向（**Spec → Implement → Verify**）が明確。  
**Pipeline アーキテクチャ設計 Phase に進めてよい。**

### 成功条件チェック

| 問い | 答え |
| --- | --- |
| Pipeline とは何か | 仕事の流れを制御するマルチ Step 実行系 |
| Step とは何か | Pipeline 内の 1 作業単位（AI / Agent / Output 等） |
| Router はどこか | **各 Step の内側** |
| Provider はどこか | Router の先 |
| Agent はどこか | **Agent Step**（Pipeline ではない） |
| Step 間で何を渡すか | output → 次 input（`{{steps.*.output}}` 候補） |
| 最初に何を作るか | **Spec → Implement → Verify** 旗艦 Pipeline + AI/Agent/Output Step |

---

## 16. 不変の一文（製品コミットメント）

> saforall の最大の売りは Pipeline である。  
> Router / Provider / Agent / Failover / Jobs はすべて、その Pipeline を成立させるための部品である。  
> 「Auto で Provider を選ぶこと」を Pipeline と呼んではならない。

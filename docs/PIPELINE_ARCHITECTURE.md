# saforall Pipeline Architecture Design（92049）

> **Product Pipeline ≠ AI Router**  
> 製品 Pipeline の正本: [PIPELINE_PRODUCT.md](./PIPELINE_PRODUCT.md)  
> AI Router の正本: [PIPELINE.md](./PIPELINE.md)  
> 本ドキュメントは Flagship **Spec → Implement → Verify** を実行可能にするための内部構造設計である。

| 項目 | 値 |
| --- | --- |
| Phase | **92049** Pipeline Architecture Design |
| Baseline | v0.1.2 公開版 |
| Flagship | Spec → Implement → Verify（+ Output） |
| Implementation in this phase | **HOLD（実装しない）** |
| Architecture Design 判定 | **GO** |
| Code change | **なし**（本設計書の追加と Architecture index 追記のみ） |
| Commit | **なし**（本 Phase ではコミットしない） |

---

## 0. 固定原則（GO 条件の骨格）

```text
Pipeline
  ↓
Pipeline Run
  ↓
Step Run
  ↓
Router          ← Step 内。Step を増やさない
  ↓
Provider
```

```text
Step N Output  →  Pipeline Run Context  →  Step N+1 Input
```

- **Pipeline** = 仕事全体の流れ  
- **Step** = 仕事の単位（AI / AGENT / OUTPUT）  
- **Router** = Provider / Model / Budget / Fixed|Auto / Failover  
- **Provider** = AI 推論  
- **Agent** = Agent Step として既存 `runToolAgent` を再利用（新規 Agent を作らない）  
- **Failover** で Pipeline Step 数が増えてはならない  
- **Job ≠ Pipeline**（Job は Run のホスト候補）

---

## A. 現在コードとの対応表

調査優先パス（実在）: `electron/main/ai/`, `electron/main/toolAgent.ts`, `electron/main/localAiRouter.ts`, `electron/main/backgroundJobs.ts`, `electron/main/chatAbort.ts`, `electron/main/api.ts`, `electron/main/index.ts`, `electron/main/localDb.ts`

| Pipeline 概念 | 現在の実装 | 再利用 | 新規必要 | 備考 |
| --- | --- | --- | --- | --- |
| Pipeline Definition | **なし** | — | **YES** | 定義ストア（JSON）が必要 |
| Pipeline Run | **なし** | — | **YES** | 実行インスタンス。Job と同一視しない |
| Step Definition | **なし** | — | **YES** | AI / AGENT / OUTPUT |
| Step Run | **なし** | — | **YES** | Run 内の 1 Step 実行記録 |
| Step Input / Output | **なし** | — | **YES** | MVP は text + 参照メタ最小 |
| Step 間 Data Passing | **なし**（テンプレートエンジンなし） | — | **YES** | `previous.output` / 固定キー参照のみ |
| Router | `executeAi` / `executeAiWithTools`（`ai/router.ts`）, `prepareLocalRoute`（`localAiRouter.ts`） | **YES** | NO（仕様変更禁止） | Fixed=`manual`/指定 provider、Auto=`auto` |
| Failover | `ai/failover.ts`（Router 内） | **YES** | NO | Ask: 複数 LLM / Agent: openai↔claude。Step 数は増えない |
| Provider | `ai/adapters/*` + `registry.ts`（openai/claude/gemini/grok/deepseek/workers） | **YES** | NO | Secret は Vault。定義に Key を書かない |
| Agent Step | `runToolAgent`（`toolAgent.ts`）← `api.ts` stream | **YES** | 薄いアダプタのみ | phase: plan/explore/edit/verify。新規 Agent 禁止 |
| Jobs | `backgroundJobs.ts`（kind: agent\|bugbot） | **部分** | kind 拡張は Phase1+ | cancel は status のみ。chatAbort **非連動**（Gap） |
| Cancel | `chatAbort.ts` + `api:chatStream:cancel` + `AbortSignal` → toolAgent/adapters | **YES** | Pipeline Cancel → requestId/signal 伝播の配線 | Job.cancel 単体では不足 |
| Usage | `ai/usage.ts` `UsageEvent` / `recordUsage`（router onAttempt） | **YES** | optional 相関 ID 拡張 | 現状 `pipelineId`/`stepId` **なし** |
| Cost | `estimatedCost` on UsageEvent + UI Usage | **YES** | Run/Step 集計ビュー | 新 Billing 禁止 |
| Persistence | `userData` JSON（`localDb`, settings-cache, credentials-vault, background-jobs.json） | **YES** | pipelines.json / pipeline-runs.json | 新 DB/SQLite 追加禁止 |
| IPC | `api:chatStream*` / `jobs:*` パターン | **YES** | `pipeline:*` チャネル新設 | 実行ロジックは Main のみ |
| PendingEdits | Agent `edit_proposal` → Renderer `applyQueue` / PendingEditsBar | **YES** | Pipeline は再実装しない | Implement→Verify はディスク or proposal 契約を明示 |
| Error | `AIError`（`ai/errors.ts`） | **YES** | Step/Pipeline 層のラップ | Provider Error ≠ 即 Pipeline Failed（Failover 後） |
| Settings / Vault | settings-cache + credentials-vault | **YES** | — | 実行時 resolve |

### 再利用の結論

既存の **Router / Provider / Agent / Failover / Usage / Cancel(signal) / JSON 永続化** で Flagship の実行核は足りる。  
不足はすべて **Pipeline Domain（Definition / Run / StepRun / Context / Engine / IPC）** 側。

---

## B. Domain Model

### 関係

```text
Pipeline (Definition)
  └─ steps: PipelineStep[]     // 順序付き定義

PipelineRun (Execution instance)
  ├─ pipelineId → Pipeline
  ├─ input: PipelineInput
  ├─ context: RunContext       // Step 出力の蓄積（巨大自由 Context は禁止）
  ├─ stepRuns: StepRun[]
  └─ status / error / usageSummary

StepRun
  ├─ stepId → PipelineStep
  ├─ input: StepInput
  ├─ output: StepOutput | null
  ├─ status / error
  └─ routerAttempts[]          // Failover 試行（Step ではない）
```

### Pipeline（Definition）— 概念スキーマ

```text
Pipeline
  id: string
  name: string
  description?: string
  version: number              // 定義版。Run は作成時スナップショット可
  steps: PipelineStep[]
  createdAt: string (ISO)
  updatedAt: string (ISO)
```

### PipelineStep（Definition）

```text
PipelineStep
  id: string                   // 安定 ID（例: "spec", "implement", "verify"）
  type: "AI" | "AGENT" | "OUTPUT"
  name: string
  order: number                // 0..n-1 連番。MVP は厳密シーケンシャル
  promptTemplate?: string      // AI/AGENT。{{pipeline.input.task}} / {{steps.spec.output.text}}
  routing:
    mode: "fixed" | "auto"     // ↔ 既存 routingMode manual|auto
    provider?: ProviderId      // fixed 時
    model?: string
  agentHints?:                 // AGENT のみ
    preferredPhase?: "plan"|"explore"|"edit"|"verify"
    workspaceRequired: true
```

### Flagship 定義例（概念）

| order | id | type | name | routing 例 |
| --- | --- | --- | --- | --- |
| 0 | spec | AI | Spec | auto または fixed/claude |
| 1 | implement | AGENT | Implement | fixed/openai または claude |
| 2 | verify | AGENT | Verify | fixed/claude または auto |
| 3 | output | OUTPUT | Output | （集約のみ。Router 任意） |

### PipelineRun

```text
PipelineRun
  id: string
  pipelineId: string
  pipelineVersion: number
  workspacePath: string
  status: PipelineRunStatus
  currentStepId: string | null
  input: PipelineInput
  context: RunContext
  stepRuns: StepRun[]
  jobId?: string | null        // ホスト Job（任意）
  chatRequestId?: string | null // 現行 Step の abort キー
  startedAt / completedAt?: string
  error?: PipelineError | null
```

**PipelineRunStatus（候補・既存 Job とは別 enum）**

```text
queued | running | cancelling | cancelled | completed | failed
```

既存 `BackgroundJobStatus`（queued/running/done/error/cancelled）と語彙は近いが、**別型**とする（Job=ホスト、Run=Pipeline 正本）。

### StepRun

```text
StepRun
  id: string
  pipelineRunId: string
  stepId: string
  type: "AI" | "AGENT" | "OUTPUT"
  status: queued | running | cancelling | cancelled | completed | failed | skipped
  input: StepInput
  output: StepOutput | null
  startedAt / completedAt?: string
  error?: StepError | null
  usageRefs?: string[]         // UsageEvent.requestId 群
  routerAttempts?: {
    provider: string
    model?: string
    status: ok | error
    errorCode?: string
  }[]
```

### PipelineInput / StepInput / StepOutput（MVP Contract）

**汎用化しすぎない。** Flagship 向け最小契約:

```text
PipelineInput
  task: string                 // 必須: ユーザー仕事内容
  workspacePath: string        // 必須（AGENT のため）
  targetPaths?: string[]       // 任意
  notes?: string

StepInput
  text: string                 // 実行に渡す主テキスト（解決済みテンプレート）
  artifacts?: ArtifactRef[]    // パス参照のみ（中身はファイルシステム）
  fromStepId?: string

StepOutput
  text: string                 // 次 Step が読む主成果（仕様文・要約・検証結果）
  artifacts?: ArtifactRef[]    // 例: 変更ファイルパス
  structured?: {               // 最小・任意
    changedFiles?: string[]
    acceptedEditCount?: number
    verifySummary?: string
  }
  provider?: string
  model?: string

ArtifactRef
  kind: "file" | "dir"
  path: string                 // workspace 相対推奨
```

**禁止（MVP）:** Condition / Loop / 任意スクリプト / 巨大 blob の Context への直格納 / 並列 Step。

### RunContext（Data Passing の器）

```text
RunContext
  pipelineInput: PipelineInput
  steps: {
    [stepId: string]: {
      output: StepOutput
    }
  }
```

解決規則（MVP）:

1. Step 開始時に `promptTemplate` を解決して `StepInput.text` を作る  
2. 解決キー（最小）:
   - `{{pipeline.input.task}}`
   - `{{steps.<stepId>.output.text}}`
   - （任意）`{{steps.<stepId>.output.structured.changedFiles}}` → 文字列化
3. テンプレート未指定の AGENT/AI は「直前 Step の `output.text` + pipeline.input.task」を連結（デフォルト）

これで:

```text
Spec.output.text → Implement.input.text → Implement.output → Verify.input
```

が成立する。

---

## C. Execution Flow

```text
Renderer: pipeline:run(pipelineId, input)
    ↓ IPC
Main: PipelineService.startRun()
    ↓
PipelineEngine.run(runId)
    for step in ordered steps:
        if cancelled → stop
        create StepRun (running)
        resolve StepInput from RunContext
        switch step.type:
          AI:
            → build AIRequest (routing.mode / provider / model)
            → executeAi(...)           // 既存 Router
          AGENT:
            → ensure workspace
            → beginChatAbort(requestId) / signal
            → runToolAgent({ messages: [system+input], engine, model, signal, onEvent, ... })
               // 内部で executeAiWithTools + Failover
            → collect text + artifact paths (+ edit_proposal は既存 UI 経路)
          OUTPUT:
            → assemble final text from context (no Provider required)
        write StepOutput → RunContext.steps[stepId]
        StepRun = completed | failed
        on failed (no recovery) → PipelineRun = failed; break
    PipelineRun = completed
```

### Router 呼び出し位置（確定）

```text
PipelineEngine
  → StepExecutor
      → Router (executeAi / executeAiWithTools via runToolAgent)
          → Provider Adapter
```

- Pipeline / Engine は Provider を直接呼ばない。  
- Failover は Router 内 attempt。StepRun.routerAttempts に記録可。Step 数は不変。

### Flagship シーケンス（既存関数接続）

```text
Pipeline Run
 │
 ├─ Spec (AI)
 │    prepareLocalRoute?（任意） / executeAi
 │    → StepOutput.text = 仕様
 │
 ├─ Implement (AGENT)
 │    runToolAgent(messages include Spec output, signal)
 │    → edit_proposal → 既存 PendingEdits UI（再実装しない）
 │    → StepOutput.text = 実装要約
 │    → StepOutput.structured.changedFiles = 提案/変更パス
 │
 ├─ Verify (AGENT)
 │    runToolAgent(messages include Spec + Implement outputs)
 │    → 検証・修正・shell（既存 tools）
 │    → StepOutput.text = 検証結果
 │
 └─ Output (OUTPUT)
      連結レポート + changedFiles + run usage summary
      → Pipeline completed
```

---

## D. Data Flow（最重要）

```text
PipelineInput
      ↓
StepRun[spec].input
      ↓ executeAi
StepRun[spec].output ──┐
      ↓                 │
RunContext.steps.spec   │
      ↓                 │
StepRun[implement].input ← resolve(template, context)
      ↓ runToolAgent
StepRun[implement].output
      ↓
RunContext.steps.implement
      ↓
StepRun[verify].input
      ↓ runToolAgent
StepRun[verify].output
      ↓
StepRun[output].output = Pipeline 成果物
```

**MVP で作らないもの:** Condition / Loop / Dynamic expression DSL / parallel / Human gate。

**PendingEdits 互換:**

- Implement のディスク未適用 proposal は既存 Renderer フローに載せる。  
- Verify がファイル内容を読む場合の契約（Phase1 実装時にどちらかを選ぶ）:
  - **A（推奨 MVP）:** Verify 開始前にユーザー Accept、または Agent の一時 materialize（既存 `withMaterializedEdits`）を Step 内で利用  
  - **B:** Verify は「提案一覧 + Spec」を text として渡し、実ファイル Verify は Accept 後の再 Run  
- Pipeline は PendingEdits ストアを新設しない。

---

## E. Agent Integration

```text
Agent Step
  → 既存 runToolAgent(ToolAgentParams)
      → executeAiWithTools (Router)
          → Provider (openai/claude 等)
```

| 項目 | 方針 |
| --- | --- |
| 新規 Agent | **作らない** |
| Cancel | `signal: AbortSignal` を Pipeline Cancel から渡す |
| Events | `onEvent` を Pipeline IPC イベントにブリッジ（edit_proposal 含む） |
| Phase | 1 Agent Step = 1 `runToolAgent` 呼び出し（内部 phase は Agent 内）。Step を phase で分割しない（MVP） |
| Workers | tools 非対応 → Agent Step の routing から除外（既存どおり） |

---

## F. Cancel Flow

```text
UI: pipeline:cancel(runId)
  → PipelineRun.status = cancelling
  → current StepRun.status = cancelling
  → cancelChatAbort(chatRequestId)     // 既存
  → AbortSignal → runToolAgent / executeAi fetch abort
  → 後続 Step は開始しない
  → PipelineRun.status = cancelled
```

| 層 | 既存 | Pipeline 側 |
| --- | --- | --- |
| Signal | `chatAbort.ts` | Run に `chatRequestId` を保持して cancel |
| Job.cancel | status のみ、abort **非連動** | Job ホスト時も **必ず** chatAbort/PipelineEngine.cancel を呼ぶ |
| Cursor Agent | 別経路 | MVP Flagship は LLM toolAgent 経路を主とする |

---

## G. Usage / Cost

```text
PipelineRun
  ├─ StepRun spec      → UsageEvent(s) via executeAi onAttempt
  ├─ StepRun implement → UsageEvent(s) via executeAiWithTools
  └─ StepRun verify    → UsageEvent(s)
```

**方針:**

- 新 Billing は作らない。既存 `recordUsage` を継続。  
- Phase1 実装時の最小拡張案（設計のみ）:
  - `UsageEvent` に optional `pipelineRunId?` / `stepRunId?` を追加、**または**
  - StepRun.usageRefs に `requestId` を積む（スキーマ変更を遅延可能）
- Pipeline 合計 = 配下 UsageEvent の tokens/cost 集計。Failover attempt も既存どおり 1 event。

---

## H. Jobs Relationship

```text
BackgroundJob (optional host)
  kind: "pipeline"   // 将来拡張。MVP 初期は Engine 直接実行でも可
  └─ payload.runId → PipelineRun（正本）
```

| | Jobs | Pipeline Run |
| --- | --- | --- |
| 責任 | キュー表示・BG ライフサイクル | Step 順序・Context・成果・Cancel 正本 |
| 現状 | agent / bugbot 単発 | 未実装 |
| 禁止 | `Job = Pipeline` とみなすこと | Job status だけを Pipeline 状態の正本にすること |

**MVP 推奨:** Phase1 前半は Main 内 `PipelineEngine` 直接実行 + 専用 IPC。安定後に `kind: 'pipeline'` でホスト化。

---

## I. Persistence

既存パターン踏襲（`userData` JSON、`localDb.writeJsonFile`）。

| データ | 保存案 | 備考 |
| --- | --- | --- |
| Pipeline Definition | `{userData}/pipelines.json` | 定義一覧 |
| Pipeline Run + StepRuns | `{userData}/pipeline-runs/{runId}.json` または単一 index | 巨大 output は text 上限 / artifact は path のみ |
| Secrets | 既存 vault | Definition に書かない |
| Usage | 既存 usage-events.json | 相関 ID は任意拡張 |

**追加しない:** SQLite / 新規サーバー DB / Marketplace 同期。

---

## J. IPC Boundary

```text
Renderer (Pipeline UI — 後続 Phase)
    ↓ invoke / on
Main PipelineService / PipelineEngine
    ↓
StepExecutor → Router → Provider / runToolAgent
```

**チャネル案（実装は次 Phase）:**

| Channel | 方向 | 役割 |
| --- | --- | --- |
| `pipeline:list` / `pipeline:get` / `pipeline:save` / `pipeline:delete` | invoke | Definition CRUD |
| `pipeline:run` | invoke | Run 開始 → runId |
| `pipeline:cancel` | invoke | Cancel |
| `pipeline:getRun` | invoke | 状態取得 |
| `pipeline:event` | main→renderer | step_start / step_done / delta / edit_proposal / run_done / error |

- Renderer に Step 実行ロジックを置かない。  
- `edit_proposal` は既存 Chat と同様に Renderer の PendingEdits へ渡す。

---

## K. Error Model

```text
Provider / Network / Auth  →  AIError
        ↓
Router Failover（eligible なら別 Provider、Step 継続）
        ↓ 仍失敗
StepError (code, message, cause)
        ↓
PipelineError (failed stepId, message)
        ↓
PipelineRun.status = failed
```

| 種別 | 扱い |
| --- | --- |
| Provider Error（Failover 成功） | Step 成功しうる。routerAttempts に記録 |
| Provider Error（枯渇） | Step failed → Pipeline failed |
| Tool / Agent failure | Step failed |
| Cancel | cancelling → cancelled（failed と区別） |
| Input 解決失敗（欠落参照） | Step failed（Pipeline Error） |

既存 `AIError` / `AIErrorCode` を cause として保持。新 Billing/Error 体系は作らない。

---

## L. Implementation Gap（Phase 1 で新設するもの）

| 新規要素 | 内容 |
| --- | --- |
| Domain types | Pipeline / PipelineStep / PipelineRun / StepRun / Input/Output / RunContext |
| Persistence | pipelines.json + pipeline-runs |
| PipelineEngine | 逐次 Step 実行・Context 更新・Cancel |
| StepExecutor | AI → `executeAi` / AGENT → `runToolAgent` / OUTPUT → assemble |
| Template resolve | MVP 最小キーのみ |
| IPC `pipeline:*` | list/save/run/cancel/events |
| Flagship seed | Spec→Implement→Verify→Output 定義テンプレート |
| Usage 相関 | usageRefs または optional IDs |
| Job 連携 | 任意・後回し可。cancel 配線は必須 |

| 触らない（明示） | |
| --- | --- |
| Router 仕様変更 / Provider 追加 / Catalog | |
| 新規 Agent 実装 | |
| PendingEdits 再実装 | |
| Condition / Loop / Visual Builder / Resume / Marketplace | |
| Billing 刷新 | |

### Phase 1 最小実装範囲（92049 確定）

```text
Pipeline Definition (CRUD + seed Flagship)
  ↓
Pipeline Run
  ↓
Sequential Step Executor
  ↓
Step Input/Output + RunContext（previous output）
  ↓
AI Step → executeAi
Agent Step → runToolAgent
Output Step → assemble
  ↓
Router（既存 Fixed/Auto + Failover）
  ↓
Provider（既存 adapters）
  ↓
Cancel → chatAbort
  ↓
Usage 記録（既存）+ Run 相関最小
```

**まだやらない:** Condition / Loop / Human Review / Visual Builder / Resume / Run from Step / Marketplace。

---

## Product Spec 整合チェック（PIPELINE_PRODUCT.md）

| 原則 | 本 Architecture |
| --- | --- |
| Pipeline = 仕事の流れ | Engine が順序・Run・Context を管理 |
| Router = Step 内 | executeAi / executeAiWithTools のみ。Step を生成しない |
| Agent = Agent Step | runToolAgent 再利用 |
| Failover ≠ 追加 Step | routerAttempts |
| Jobs ≠ Pipeline | ホスト任意、正本は PipelineRun |
| Flagship Spec→Impl→Verify | seed + AI/AGENT/OUTPUT |
| MVP データ連携 | previous output / 最小 template |
| 用語混同禁止 | Product Pipeline ≠ docs/PIPELINE.md Router |

**矛盾なし。**

---

## Risks（設計上の注意）

1. **Jobs.cancel と Abort の断絶** — Pipeline は独自に chatAbort 必須  
2. **PendingEdits と Verify のタイミング** — Accept / materialize 契約を Phase1 で固定  
3. **巨大 Spec テキスト** — output.text 上限または要約 Step（将来）  
4. **Usage スキーマ拡張の互換** — まずは StepRun.usageRefs で回避可能  
5. **用語回帰** — UI で「Auto パイプライン」を製品 Pipeline と呼ばない

---

## Architecture Design 判定

### **GO**

以下が明確であるため、次 Phase（最小実装）に進めてよい。

```text
Pipeline → Pipeline Run → Step Run → Router → Provider
Step Output → Next Step Input（RunContext）
Agent Step → runToolAgent
Cancel → chatAbort / AbortSignal
Jobs = ホスト（正本は Run）
Usage/Cost = 既存 recordUsage + 相関
Persistence = userData JSON
IPC = Main PipelineService
Error = AIError ⊂ StepError ⊂ PipelineError
PendingEdits = 既存流用
```

### 本 Phase の実装判断

```text
Implementation: HOLD
Code change: なし（設計ドキュメントのみ）
Commit: なし
```

---

## 次 Phase（実装開始時の入口）

92049 GO 後の Phase 1 候補タイトル例:

> Pipeline MVP Skeleton — Definition / Run / Sequential Executor / AI+Agent+Output / Flagship Seed

入口実装順:

1. Domain types + persistence  
2. Engine（AI Step only でも可）→ Data Passing 実証  
3. Agent Step 接続 + Cancel  
4. Flagship seed + Usage 相関  
5. 最小 UI（一覧・Run・進捗）※ Visual Builder は後続

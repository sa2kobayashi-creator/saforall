/** Pipeline Phase 1 domain types (92050). Product Pipeline ≠ AI Router. */

export type PipelineStepType = 'AI' | 'AGENT' | 'OUTPUT'
export type PipelineRoutingMode = 'fixed' | 'auto'

export type PipelineStepRouting = {
  mode: PipelineRoutingMode
  provider?: string
  model?: string
}

export type PipelineStepDefinition = {
  id: string
  type: PipelineStepType
  name: string
  order: number
  /** {{pipeline.input.task}} / {{steps.<id>.output.text}} */
  promptTemplate?: string
  routing?: PipelineStepRouting
}

export type PipelineDefinition = {
  id: string
  name: string
  description?: string
  version: number
  steps: PipelineStepDefinition[]
  createdAt: string
  updatedAt: string
}

export type PipelineInput = {
  task: string
  workspacePath: string
  targetPaths?: string[]
  notes?: string
}

export type ArtifactRef = {
  kind: 'file' | 'dir'
  path: string
}

export type StepOutput = {
  text: string
  artifacts?: ArtifactRef[]
  structured?: {
    changedFiles?: string[]
    acceptedEditCount?: number
    verifySummary?: string
  }
  provider?: string
  model?: string
}

export type StepInput = {
  text: string
  artifacts?: ArtifactRef[]
  fromStepId?: string
}

export type RunContext = {
  pipelineInput: PipelineInput
  steps: Record<string, { output: StepOutput }>
}

export type PipelineRunStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'cancelled'
  | 'completed'
  | 'failed'

export type StepRunStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'cancelled'
  | 'completed'
  | 'failed'
  | 'skipped'

export type PipelineError = {
  code: string
  message: string
  stepId?: string
}

export type StepError = {
  code: string
  message: string
}

export type RouterAttempt = {
  provider: string
  model?: string
  status: 'ok' | 'error'
  errorCode?: string
}

export type StepRun = {
  id: string
  pipelineRunId: string
  stepId: string
  type: PipelineStepType
  status: StepRunStatus
  input: StepInput
  output: StepOutput | null
  startedAt?: string
  completedAt?: string
  error?: StepError | null
  usageRefs?: string[]
  routerAttempts?: RouterAttempt[]
}

export type PipelineRun = {
  id: string
  pipelineId: string
  pipelineVersion: number
  workspacePath: string
  status: PipelineRunStatus
  currentStepId: string | null
  input: PipelineInput
  context: RunContext
  stepRuns: StepRun[]
  abortRequestId?: string | null
  startedAt?: string
  completedAt?: string
  error?: PipelineError | null
}

export type PipelineEvent =
  | { type: 'run_started'; runId: string; pipelineId: string }
  | { type: 'step_started'; runId: string; stepId: string; stepRunId: string }
  | { type: 'step_completed'; runId: string; stepId: string; stepRunId: string; output: StepOutput }
  | { type: 'step_failed'; runId: string; stepId: string; stepRunId: string; error: StepError }
  | { type: 'run_completed'; runId: string }
  | { type: 'run_failed'; runId: string; error: PipelineError }
  | { type: 'run_cancelled'; runId: string }
  | { type: 'agent_delta'; runId: string; stepId: string; text: string }
  | {
      type: 'edit_proposal'
      runId: string
      stepId: string
      path: string
      content: string
    }

export type StartPipelineRunParams = {
  pipelineId: string
  input: PipelineInput
}

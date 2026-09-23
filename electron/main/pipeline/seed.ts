import type { PipelineDefinition } from './types'

export const FLAGSHIP_PIPELINE_ID = 'flagship-spec-implement-verify'

/** Seed: Spec → Implement → Verify → Output */
export function createFlagshipPipeline(now = new Date().toISOString()): PipelineDefinition {
  return {
    id: FLAGSHIP_PIPELINE_ID,
    name: 'Spec → Implement → Verify',
    description:
      'saforall Flagship Pipeline: 仕様化 → Agent 実装 → Agent 検証 → 結果集約',
    version: 1,
    createdAt: now,
    updatedAt: now,
    steps: [
      {
        id: 'spec',
        type: 'AI',
        name: 'Spec',
        order: 0,
        routing: { mode: 'auto' },
        promptTemplate: [
          'あなたはソフトウェア仕様担当です。次のタスクから、実装可能な短い仕様を日本語で書いてください。',
          '含めること: 目的、変更対象ファイル、実装手順、受け入れ条件。',
          '推測で大きなリファクタを増やさないこと。',
          '',
          'Task:',
          '{{pipeline.input.task}}'
        ].join('\n')
      },
      {
        id: 'implement',
        type: 'AGENT',
        name: 'Implement',
        order: 1,
        routing: { mode: 'auto' },
        promptTemplate: [
          'あなたは実装 Agent です。次の仕様に従い、必要なファイルを編集してください。',
          '説明だけで終わらず、ツールで実際に編集すること。',
          '',
          '仕様:',
          '{{steps.spec.output.text}}',
          '',
          '元タスク:',
          '{{pipeline.input.task}}'
        ].join('\n')
      },
      {
        id: 'verify',
        type: 'AGENT',
        name: 'Verify',
        order: 2,
        routing: { mode: 'auto' },
        promptTemplate: [
          'あなたは検証 Agent です。実装が仕様を満たすか確認し、不足があれば修正してください。',
          '可能なら typecheck / 関連テストを実行し、結果を要約すること。',
          '',
          '仕様:',
          '{{steps.spec.output.text}}',
          '',
          '実装結果メモ:',
          '{{steps.implement.output.text}}'
        ].join('\n')
      },
      {
        id: 'output',
        type: 'OUTPUT',
        name: 'Output',
        order: 3,
        promptTemplate: undefined
      }
    ]
  }
}

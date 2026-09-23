import type { RunContext, StepOutput } from '../types'

export function runOutputStep(ctx: RunContext): StepOutput {
  const spec = ctx.steps.spec?.output?.text || ''
  const implement = ctx.steps.implement?.output?.text || ''
  const verify = ctx.steps.verify?.output?.text || ''
  const changed = [
    ...(ctx.steps.implement?.output?.structured?.changedFiles || []),
    ...(ctx.steps.verify?.output?.structured?.changedFiles || [])
  ]
  const unique = Array.from(new Set(changed))
  const text = [
    '# Pipeline Output',
    '',
    '## Spec',
    spec || '(empty)',
    '',
    '## Implement',
    implement || '(empty)',
    '',
    '## Verify',
    verify || '(empty)',
    '',
    '## Changed files',
    unique.length ? unique.map((p) => `- ${p}`).join('\n') : '(none)'
  ].join('\n')

  return {
    text,
    artifacts: unique.map((path) => ({ kind: 'file' as const, path })),
    structured: {
      changedFiles: unique,
      verifySummary: verify.slice(0, 2000)
    }
  }
}

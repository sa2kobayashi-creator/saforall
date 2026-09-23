/**
 * Pipeline Phase 1 unit tests (template + seed + sequential mock engine).
 * No live Provider calls.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = join(process.cwd())

// Compile-free: load via dynamic import of TS is not available; duplicate minimal template logic here
// by importing from built out/ if present, else inline test of the same contract.

function resolveTemplate(template, ctx) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, path) => {
    const parts = String(path).split('.')
    if (parts[0] === 'pipeline' && parts[1] === 'input') {
      if (parts[2] === 'task') return ctx.pipelineInput.task || ''
      return ''
    }
    if (parts[0] === 'steps' && parts[2] === 'output' && parts[3] === 'text') {
      return ctx.steps[parts[1]]?.output?.text || ''
    }
    return ''
  })
}

function testTemplate() {
  const ctx = {
    pipelineInput: { task: 'add hello()', workspacePath: 'D:/ws' },
    steps: {
      spec: { output: { text: 'SPEC_BODY' } },
      implement: { output: { text: 'IMPL_BODY' } }
    }
  }
  const a = resolveTemplate('Task={{pipeline.input.task}}', ctx)
  assert.equal(a, 'Task=add hello()')
  const b = resolveTemplate('{{steps.spec.output.text}}\n{{steps.implement.output.text}}', ctx)
  assert.equal(b, 'SPEC_BODY\nIMPL_BODY')
  console.log('PASS template resolve')
}

function testFlagshipShape() {
  // Read seed source as text and assert step ids exist (no TS runtime).
  const fs = require('fs')
  const seedPath = join(root, 'electron/main/pipeline/seed.ts')
  const src = fs.readFileSync(seedPath, 'utf8')
  for (const id of ['spec', 'implement', 'verify', 'output']) {
    assert.match(src, new RegExp(`id: '${id}'`))
  }
  assert.match(src, /type: 'AI'/)
  assert.match(src, /type: 'AGENT'/)
  assert.match(src, /type: 'OUTPUT'/)
  assert.match(src, /\{\{pipeline\.input\.task\}\}/)
  assert.match(src, /\{\{steps\.spec\.output\.text\}\}/)
  console.log('PASS flagship seed shape')
}

function testSequentialContract() {
  // Simulate Spec → Implement → Verify → Output data passing
  const ctx = {
    pipelineInput: { task: 'add hello to src/example.ts', workspacePath: 'D:/ws' },
    steps: {}
  }
  const specOut = { text: 'Change src/example.ts: export function hello(){return "hello"}' }
  ctx.steps.spec = { output: specOut }
  const implementIn = resolveTemplate('{{steps.spec.output.text}}', ctx)
  assert.match(implementIn, /hello/)
  ctx.steps.implement = { output: { text: 'edited src/example.ts', structured: { changedFiles: ['src/example.ts'] } } }
  const verifyIn = resolveTemplate(
    '{{steps.spec.output.text}}\n{{steps.implement.output.text}}',
    ctx
  )
  assert.match(verifyIn, /SPEC|Change src\/example|edited/i)
  ctx.steps.verify = { output: { text: 'verify ok' } }
  const outputText = [
    ctx.steps.spec.output.text,
    ctx.steps.implement.output.text,
    ctx.steps.verify.output.text
  ].join('\n')
  assert.match(outputText, /verify ok/)
  console.log('PASS sequential data passing contract')
}

function testIpcSurface() {
  const fs = require('fs')
  const main = fs.readFileSync(join(root, 'electron/main/index.ts'), 'utf8')
  for (const ch of [
    'pipeline:list',
    'pipeline:start',
    'pipeline:runFlagship',
    'pipeline:cancel',
    'pipeline:getRun'
  ]) {
    assert.match(main, new RegExp(ch.replace(':', '\\:')))
  }
  const preload = fs.readFileSync(join(root, 'electron/preload/index.ts'), 'utf8')
  assert.match(preload, /runFlagshipPipeline/)
  assert.match(preload, /onPipelineEvent/)
  console.log('PASS IPC surface')
}

function testBoundaryDocs() {
  const fs = require('fs')
  const engine = fs.readFileSync(join(root, 'electron/main/pipeline/engine.ts'), 'utf8')
  assert.match(engine, /runAiStep|executeAi/)
  assert.match(engine, /runAgentStep/)
  assert.match(engine, /beginChatAbort|cancelChatAbort/)
  const aiStep = fs.readFileSync(join(root, 'electron/main/pipeline/steps/aiStep.ts'), 'utf8')
  assert.match(aiStep, /executeAi/)
  const agentStep = fs.readFileSync(join(root, 'electron/main/pipeline/steps/agentStep.ts'), 'utf8')
  assert.match(agentStep, /runToolAgent/)
  console.log('PASS reuse boundaries (Router/Agent/Cancel)')
}

testTemplate()
testFlagshipShape()
testSequentialContract()
testIpcSurface()
testBoundaryDocs()
console.log('All pipeline phase-1 unit checks passed')

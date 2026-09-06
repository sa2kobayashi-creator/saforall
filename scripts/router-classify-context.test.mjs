import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

test('classifyTask routes fix / design / summarize', async () => {
  const { classifyTask, engineForTask, agentPreferenceChain } = await import(
    '../electron/main/lib/taskClassify.ts'
  )
  assert.equal(classifyTask('このバグを直して'), 'codegen')
  assert.equal(classifyTask('アーキテクチャの方針を教えて'), 'design')
  assert.equal(classifyTask('要約して'), 'summarize')
  assert.equal(classifyTask('複数ファイルをリファクタして'), 'patch_multi')
  assert.equal(engineForTask('design', 'ask'), 'claude')
  assert.equal(engineForTask('codegen', 'ask'), 'openai')
  assert.equal(engineForTask('summarize', 'ask'), 'gemini')
  assert.deepEqual(agentPreferenceChain('claude'), ['claude', 'openai'])
  assert.deepEqual(agentPreferenceChain('openai'), ['openai', 'claude'])
})

test('classifyTask uses selection and problems context', async () => {
  const { classifyTask } = await import('../electron/main/lib/taskClassify.ts')
  assert.equal(
    classifyTask('お願い', {
      selection: { text: 'const x = 1', path: 'a.ts' }
    }),
    'codegen'
  )
  assert.equal(
    classifyTask('見て', {
      problems: ['error: src/a.ts:1 Cannot find name foo']
    }),
    'codegen'
  )
  assert.equal(
    classifyTask('直して', {
      files: [{ path: 'a.ts' }, { path: 'b.ts' }]
    }),
    'patch_multi'
  )
})

test('PHP and local router wire Claude agent chain + context classify', async () => {
  const root = join(import.meta.dirname, '..')
  const php = await readFile(join(root, 'server/src/AiRouter.php'), 'utf8')
  const local = await readFile(join(root, 'electron/main/localAiRouter.ts'), 'utf8')
  assert.match(php, /return \['claude', 'openai'\]/)
  assert.match(php, /classifyCorpus/)
  assert.match(local, /agentPreferenceChain/)
  assert.match(local, /classifyTask/)
  assert.match(local, /taskType/)
})

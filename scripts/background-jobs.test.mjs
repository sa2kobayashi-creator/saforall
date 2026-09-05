import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function applyJobTransition(job, event, now = Date.now()) {
  if (job.status === 'cancelled' || job.status === 'done' || job.status === 'error') {
    return job
  }
  if (event.type === 'start') {
    return { ...job, status: 'running' }
  }
  if (event.type === 'cancel') {
    return { ...job, status: 'cancelled', finishedAt: now, summary: 'cancelled' }
  }
  return {
    ...job,
    status: event.ok ? 'done' : 'error',
    finishedAt: now,
    summary: event.summary,
    error: event.error
  }
}

function extractBackgroundJobId(prompt) {
  const match = prompt.match(/【Background Agent · (job-[a-z0-9-]+)】/i)
  return match?.[1] ?? null
}

test('job transitions queued → running → done', () => {
  let job = {
    id: 'job-1',
    kind: 'agent',
    title: 't',
    status: 'queued',
    createdAt: 1,
    prompt: 'p',
    cwd: null
  }
  job = applyJobTransition(job, { type: 'start' })
  assert.equal(job.status, 'running')
  job = applyJobTransition(job, { type: 'complete', ok: true, summary: 'ok' })
  assert.equal(job.status, 'done')
  assert.equal(job.summary, 'ok')
  const frozen = applyJobTransition(job, { type: 'cancel' })
  assert.equal(frozen.status, 'done')
})

test('job cancel from running', () => {
  const job = applyJobTransition(
    {
      id: 'job-2',
      kind: 'agent',
      title: 't',
      status: 'running',
      createdAt: 1,
      prompt: 'p',
      cwd: null
    },
    { type: 'cancel' }
  )
  assert.equal(job.status, 'cancelled')
})

test('extractBackgroundJobId parses prompt prefix', () => {
  assert.equal(
    extractBackgroundJobId('【Background Agent · job-abc123】\n\nfix it'),
    'job-abc123'
  )
  assert.equal(extractBackgroundJobId('normal prompt'), null)
})

test('jobs enqueue no longer auto-completes in index.ts', async () => {
  const source = await readFile(join(__dirname, '../electron/main/index.ts'), 'utf8')
  assert.match(source, /Do NOT complete here/)
  assert.match(source, /jobs:complete/)
  assert.match(source, /suggestVerifyCommands/)
})

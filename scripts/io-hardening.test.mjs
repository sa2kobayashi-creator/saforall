/**
 * I/O hardening tests (tmpdir).
 * Mirrors production algorithms in electron/main + src/lib; wire-asserts keep them in sync.
 * Rule for future batches: add one pure helper test + one real I/O test per risky feature.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function localHistoryFileKey(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '')
  return createHash('sha1').update(normalized).digest('hex').slice(0, 16)
}

async function recordLocalHistory(workspaceRoot, relativePath, content, label) {
  const rel = relativePath.replace(/\\/g, '/').replace(/^\.\//, '')
  const dir = join(workspaceRoot, '.saforall', 'history', localHistoryFileKey(rel))
  await mkdir(dir, { recursive: true })
  const savedAt = Date.now()
  const id = `${savedAt.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const meta = { id, path: rel, savedAt, bytes: Buffer.byteLength(content, 'utf-8'), label }
  await writeFile(join(dir, `${id}.json`), JSON.stringify(meta), 'utf-8')
  await writeFile(join(dir, `${id}.txt`), content, 'utf-8')
  return meta
}

async function listLocalHistory(workspaceRoot, relativePath) {
  const dir = join(
    workspaceRoot,
    '.saforall',
    'history',
    localHistoryFileKey(relativePath.replace(/\\/g, '/'))
  )
  let files
  try {
    files = await readdir(dir)
  } catch {
    return []
  }
  const out = []
  for (const name of files) {
    if (!name.endsWith('.json')) continue
    const parsed = JSON.parse(await readFile(join(dir, name), 'utf-8'))
    if (parsed?.id && parsed.path) out.push(parsed)
  }
  return out.sort((a, b) => b.savedAt - a.savedAt)
}

async function restoreLocalHistory(workspaceRoot, entryId, relativePath) {
  const dir = join(
    workspaceRoot,
    '.saforall',
    'history',
    localHistoryFileKey(relativePath.replace(/\\/g, '/'))
  )
  const content = await readFile(join(dir, `${entryId}.txt`), 'utf-8')
  const absolute = join(workspaceRoot, ...relativePath.split('/'))
  await mkdir(dirname(absolute), { recursive: true })
  try {
    const current = await readFile(absolute, 'utf-8')
    await recordLocalHistory(workspaceRoot, relativePath, current, 'before-restore')
  } catch {
    // missing file ok
  }
  await writeFile(absolute, content, 'utf-8')
  return content
}

async function replaceInWorkspace(workspaceRoot, query, replacement, options = {}) {
  const needle = query
  if (needle.length < 2) {
    return { ok: false, filesChanged: 0, replacements: 0, error: '検索語は 2 文字以上' }
  }
  const dryRun = Boolean(options.dryRun)
  const caseSensitive = Boolean(options.caseSensitive)
  const skip = new Set(['node_modules', '.git', 'dist', 'out', 'release'])
  const files = []
  let replacements = 0
  let filesChanged = 0
  const rootPath = resolve(workspaceRoot)

  async function walk(dir, depth) {
    if (depth > 8) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue
        await walk(full, depth + 1)
        continue
      }
      let text
      try {
        text = await readFile(full, 'utf-8')
      } catch {
        continue
      }
      if (caseSensitive ? !text.includes(needle) : !text.toLowerCase().includes(needle.toLowerCase())) {
        continue
      }
      let count = 0
      let next = text
      if (caseSensitive) {
        const parts = text.split(needle)
        count = parts.length - 1
        next = parts.join(replacement)
      } else {
        const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        next = text.replace(new RegExp(escaped, 'gi'), () => {
          count += 1
          return replacement
        })
      }
      if (count <= 0) continue
      files.push({ path: relative(rootPath, full).split(/[/\\]/).join('/'), count })
      replacements += count
      filesChanged += 1
      if (!dryRun) await writeFile(full, next, 'utf-8')
    }
  }

  await walk(rootPath, 0)
  return { ok: true, dryRun, filesChanged, replacements, files }
}

function normalizeJobsAfterLoad(jobsList, now = Date.now()) {
  return jobsList.map((job) => {
    if (job.status !== 'queued' && job.status !== 'running') return job
    return {
      ...job,
      status: 'cancelled',
      finishedAt: job.finishedAt ?? now,
      summary: job.summary || 'interrupted (app restart)'
    }
  })
}

function serializeJobsForPersist(jobsList, now = Date.now()) {
  return JSON.stringify({ version: 1, savedAt: now, jobs: jobsList }, null, 2)
}

function parseKeybindings(raw) {
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((row) => row && typeof row.key === 'string' && typeof row.command === 'string')
      .map((row) => ({
        key: row.key.toLowerCase().replace(/\s+/g, ''),
        command: row.command,
        when: row.when
      }))
  } catch {
    return []
  }
}

function serializeKeybindings(entries) {
  const cleaned = entries
    .filter((row) => row.key.trim() && row.command.trim())
    .map((row) => ({
      key: row.key.trim().toLowerCase().replace(/\s+/g, ''),
      command: row.command.trim(),
      ...(row.when?.trim() ? { when: row.when.trim() } : {})
    }))
  return `${JSON.stringify(cleaned, null, 2)}\n`
}

function clampAutoSaveDelayMs(ms) {
  if (!Number.isFinite(ms)) return 1500
  return Math.min(10_000, Math.max(400, Math.round(ms)))
}

async function withTempWorkspace(run) {
  const dir = await mkdtemp(join(tmpdir(), 'saforall-io-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('I/O: local history record → list → restore', async () => {
  await withTempWorkspace(async (ws) => {
    const rel = 'src/demo.ts'
    const abs = join(ws, 'src', 'demo.ts')
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, ' const v = 1\n', 'utf-8')
    const first = await recordLocalHistory(ws, rel, 'const v = 1\n', 'save')
    await writeFile(abs, 'const v = 2\n', 'utf-8')
    const second = await recordLocalHistory(ws, rel, 'const v = 2\n', 'save')
    const listed = await listLocalHistory(ws, rel)
    assert.ok(listed.length >= 2)
    assert.ok(listed.some((row) => row.id === first.id))
    assert.ok(listed.some((row) => row.id === second.id))
    const restored = await restoreLocalHistory(ws, first.id, rel)
    assert.equal(restored, 'const v = 1\n')
    assert.equal(await readFile(abs, 'utf-8'), 'const v = 1\n')
    const after = await listLocalHistory(ws, rel)
    assert.ok(after.some((row) => row.label === 'before-restore'))
  })
})

test('I/O: replaceInWorkspace updates multiple files', async () => {
  await withTempWorkspace(async (ws) => {
    await mkdir(join(ws, 'src'), { recursive: true })
    await writeFile(join(ws, 'src', 'a.ts'), 'Foo bar FOO\n', 'utf-8')
    await writeFile(join(ws, 'src', 'b.ts'), 'no match\n', 'utf-8')
    await writeFile(join(ws, 'src', 'c.ts'), 'foo only\n', 'utf-8')
    const dry = await replaceInWorkspace(ws, 'foo', 'qux', { dryRun: true })
    assert.equal(dry.ok, true)
    assert.equal(dry.filesChanged, 2)
    assert.equal(await readFile(join(ws, 'src', 'a.ts'), 'utf-8'), 'Foo bar FOO\n')
    const live = await replaceInWorkspace(ws, 'foo', 'qux')
    assert.equal(live.ok, true)
    assert.equal(live.replacements, 3)
    assert.equal(await readFile(join(ws, 'src', 'a.ts'), 'utf-8'), 'qux bar qux\n')
    assert.equal(await readFile(join(ws, 'src', 'c.ts'), 'utf-8'), 'qux only\n')
    assert.equal(await readFile(join(ws, 'src', 'b.ts'), 'utf-8'), 'no match\n')
  })
})

test('I/O: jobs persist round-trip normalizes in-flight', async () => {
  await withTempWorkspace(async (ws) => {
    const path = join(ws, 'background-jobs.json')
    const jobs = [
      {
        id: 'job-1',
        kind: 'agent',
        title: 't',
        status: 'running',
        createdAt: 1,
        prompt: 'p',
        cwd: null
      },
      {
        id: 'job-2',
        kind: 'agent',
        title: 'done',
        status: 'done',
        createdAt: 2,
        finishedAt: 3,
        prompt: 'p',
        cwd: null,
        summary: 'ok'
      }
    ]
    await writeFile(path, serializeJobsForPersist(jobs, 100), 'utf-8')
    const parsed = JSON.parse(await readFile(path, 'utf-8'))
    assert.equal(parsed.version, 1)
    assert.equal(parsed.jobs[0].status, 'running')
    const loaded = normalizeJobsAfterLoad(parsed.jobs, 200)
    assert.equal(loaded[0].status, 'cancelled')
    assert.match(loaded[0].summary, /interrupted/)
    assert.equal(loaded[1].status, 'done')
  })
})

test('keybindings serialize ↔ parse round-trip', () => {
  const raw = serializeKeybindings([
    { key: 'Ctrl+Shift+F', command: 'view.search' },
    { key: '  ', command: 'skip' },
    { key: 'ctrl+s', command: 'file.save', when: 'editorFocus' }
  ])
  const parsed = parseKeybindings(raw)
  assert.equal(parsed.length, 2)
  assert.equal(parsed[0].key, 'ctrl+shift+f')
  assert.equal(parsed[0].command, 'view.search')
  assert.equal(parsed[1].when, 'editorFocus')
})

test('auto-save delay clamp', () => {
  assert.equal(clampAutoSaveDelayMs(100), 400)
  assert.equal(clampAutoSaveDelayMs(50_000), 10_000)
  assert.equal(clampAutoSaveDelayMs(1500.4), 1500)
  assert.equal(clampAutoSaveDelayMs(Number.NaN), 1500)
})

test('production sources stay aligned with I/O hardening contracts', async () => {
  const history = await readFile(join(root, 'electron/main/localHistory.ts'), 'utf8')
  assert.match(history, /recordLocalHistory/)
  assert.match(history, /restoreLocalHistory/)
  assert.match(history, /\.saforall\/history/)
  assert.match(history, /before-restore/)
  const tools = await readFile(join(root, 'electron/main/workspaceTools.ts'), 'utf8')
  assert.match(tools, /replaceInWorkspace/)
  assert.match(tools, /dryRun/)
  const jobs = await readFile(join(root, 'electron/main/backgroundJobs.ts'), 'utf8')
  assert.match(jobs, /normalizeJobsAfterLoad/)
  assert.match(jobs, /serializeJobsForPersist/)
  assert.match(jobs, /interrupted \(app restart\)/)
  const keys = await readFile(join(root, 'src/lib/keybindings.ts'), 'utf8')
  assert.match(keys, /serializeKeybindings/)
  assert.match(keys, /parseKeybindings/)
  const auto = await readFile(join(root, 'src/lib/autoSave.ts'), 'utf8')
  assert.match(auto, /clampAutoSaveDelayMs/)
  assert.match(auto, /Math\.min\(10_000/)
})

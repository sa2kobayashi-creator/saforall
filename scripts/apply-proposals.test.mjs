import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function normalizePathKey(path) {
  const unified = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = unified.split('/')
  const out = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop()
      else out.push('..')
      continue
    }
    out.push(part)
  }
  if (/^[a-zA-Z]:$/.test(out[0] ?? '')) {
    return `${out[0].toLowerCase()}/${out.slice(1).join('/').toLowerCase()}`.replace(/\/$/, '')
  }
  return out.join('/').toLowerCase()
}

function isPathInsideWorkspace(workspacePath, targetPath) {
  const root = normalizePathKey(workspacePath.trim())
  const target = normalizePathKey(targetPath.trim())
  if (!root || !target) return false
  if (target === root) return true
  return target.startsWith(`${root}/`)
}

function validateProposal(proposal, options) {
  const path = (proposal.targetPath || '').trim()
  if (!path) return { ok: false, reason: 'empty_path', message: '適用先パスが空です' }
  const workspace = options.workspacePath?.trim() || null
  if (workspace && !isPathInsideWorkspace(workspace, path)) {
    return { ok: false, reason: 'outside_workspace', message: 'outside' }
  }
  if (proposal.modified.length === 0) {
    return { ok: false, reason: 'empty_content', message: 'empty' }
  }
  const maxBytes = options.maxBytes ?? 2_000_000
  const bytes = Buffer.byteLength(proposal.modified, 'utf8')
  if (bytes > maxBytes) return { ok: false, reason: 'too_large', message: 'large' }
  const rejectTruncate = options.rejectSuspiciousTruncate !== false
  if (
    rejectTruncate &&
    (proposal.mode === 'replace' || proposal.mode === 'create') &&
    proposal.original.length > 400 &&
    proposal.modified.length < proposal.original.length * 0.35
  ) {
    return { ok: false, reason: 'suspicious_truncate', message: 'truncate' }
  }
  return { ok: true }
}

function formatAcceptAllSummary(result) {
  if (result.ok) return `${result.applied.length} 件を適用しました`
  const parts = []
  if (result.applied.length > 0) parts.push(`成功 ${result.applied.length}`)
  if (result.rejected.length > 0) parts.push(`検証拒否 ${result.rejected.length}`)
  if (result.failed.length > 0) parts.push(`失敗 ${result.failed.length}`)
  if (result.remaining.length > 0) parts.push(`未適用 ${result.remaining.length}`)
  return `一部のみ完了（全体成功ではありません）: ${parts.join(' · ')}`
}

async function acceptAllProposalsCollected(proposals, commit, options, opts = {}) {
  const stopOnFirstFailure = opts.stopOnFirstFailure !== false
  const applied = []
  const rejected = []
  const failed = []
  const remaining = []
  for (let i = 0; i < proposals.length; i += 1) {
    const proposal = proposals[i]
    const check = validateProposal(proposal, options)
    if (!check.ok) {
      rejected.push({ path: proposal.targetPath, reason: check.reason, message: check.message })
      if (stopOnFirstFailure) {
        remaining.push(...proposals.slice(i))
        break
      }
      remaining.push(proposal)
      continue
    }
    try {
      await commit(proposal)
      applied.push(proposal.targetPath)
    } catch (error) {
      failed.push({
        path: proposal.targetPath,
        error: error instanceof Error ? error.message : String(error)
      })
      if (stopOnFirstFailure) {
        remaining.push(...proposals.slice(i))
        break
      }
      remaining.push(proposal)
    }
  }
  const result = {
    ok: applied.length === proposals.length && proposals.length > 0,
    applied,
    rejected,
    failed,
    remaining,
    summary: ''
  }
  if (proposals.length === 0) {
    result.ok = true
    result.summary = '適用対象がありません'
    return result
  }
  result.summary = formatAcceptAllSummary(result)
  return result
}

function suggestPostApplyVerifyFromScripts(scripts) {
  if (!scripts || typeof scripts !== 'object') return null
  const fallbacks = []
  let primary = null
  if (scripts.typecheck) {
    primary = 'npm run typecheck'
    if (scripts.test) fallbacks.push('npm test')
  } else if (scripts.test) {
    primary = 'npm test'
  } else if (scripts.build) {
    primary = 'npm run build'
  }
  if (!primary) return null
  return { primary, fallbacks }
}

test('isPathInsideWorkspace allows children', () => {
  assert.equal(isPathInsideWorkspace('D:/proj', 'D:/proj/src/a.ts'), true)
  assert.equal(isPathInsideWorkspace('D:\\proj', 'D:\\proj\\src\\a.ts'), true)
})

test('isPathInsideWorkspace blocks escape', () => {
  assert.equal(isPathInsideWorkspace('D:/proj', 'D:/other/a.ts'), false)
  assert.equal(isPathInsideWorkspace('D:/proj', 'D:/proj/../secret'), false)
})

test('validateProposal rejects empty / outside / truncate', () => {
  assert.equal(validateProposal({ targetPath: '', original: '', modified: 'x', mode: 'create' }, { workspacePath: null }).reason, 'empty_path')
  assert.equal(
    validateProposal(
      { targetPath: 'D:/evil/a.ts', original: '', modified: 'x', mode: 'create' },
      { workspacePath: 'D:/proj' }
    ).reason,
    'outside_workspace'
  )
  assert.equal(
    validateProposal(
      { targetPath: 'D:/proj/a.ts', original: '', modified: '', mode: 'replace' },
      { workspacePath: 'D:/proj' }
    ).reason,
    'empty_content'
  )
  const long = 'a'.repeat(500)
  assert.equal(
    validateProposal(
      { targetPath: 'D:/proj/a.ts', original: long, modified: 'short', mode: 'replace' },
      { workspacePath: 'D:/proj' }
    ).reason,
    'suspicious_truncate'
  )
})

test('acceptAllProposalsCollected all success', async () => {
  const calls = []
  const proposals = [
    { targetPath: 'D:/proj/a.ts', original: '', modified: 'a\n', mode: 'create' },
    { targetPath: 'D:/proj/b.ts', original: '', modified: 'b\n', mode: 'create' }
  ]
  const result = await acceptAllProposalsCollected(
    proposals,
    async (p) => {
      calls.push(p.targetPath)
    },
    { workspacePath: 'D:/proj' }
  )
  assert.equal(result.ok, true)
  assert.deepEqual(calls, ['D:/proj/a.ts', 'D:/proj/b.ts'])
  assert.match(result.summary, /2 件を適用/)
})

test('acceptAllProposalsCollected stops on commit failure', async () => {
  const proposals = [
    { targetPath: 'D:/proj/a.ts', original: '', modified: 'a\n', mode: 'create' },
    { targetPath: 'D:/proj/b.ts', original: '', modified: 'b\n', mode: 'create' },
    { targetPath: 'D:/proj/c.ts', original: '', modified: 'c\n', mode: 'create' }
  ]
  const result = await acceptAllProposalsCollected(
    proposals,
    async (p) => {
      if (p.targetPath.endsWith('b.ts')) throw new Error('disk full')
    },
    { workspacePath: 'D:/proj' }
  )
  assert.equal(result.ok, false)
  assert.deepEqual(result.applied, ['D:/proj/a.ts'])
  assert.equal(result.failed.length, 1)
  assert.equal(result.remaining.length, 2)
  assert.match(result.summary, /全体成功ではありません/)
})

test('acceptAllProposalsCollected rejects invalid before commit', async () => {
  let commits = 0
  const proposals = [
    { targetPath: 'D:/evil/a.ts', original: '', modified: 'a\n', mode: 'create' },
    { targetPath: 'D:/proj/b.ts', original: '', modified: 'b\n', mode: 'create' }
  ]
  const result = await acceptAllProposalsCollected(
    proposals,
    async () => {
      commits += 1
    },
    { workspacePath: 'D:/proj' }
  )
  assert.equal(commits, 0)
  assert.equal(result.ok, false)
  assert.equal(result.rejected[0].reason, 'outside_workspace')
})

test('suggestPostApplyVerifyFromScripts prefers typecheck', () => {
  const suggestion = suggestPostApplyVerifyFromScripts({
    typecheck: 'tsc -p .',
    test: 'npm run typecheck && node --test'
  })
  assert.equal(suggestion.primary, 'npm run typecheck')
  assert.deepEqual(suggestion.fallbacks, ['npm test'])
})

test('applyProposals.ts source exports API', async () => {
  const source = await readFile(join(__dirname, '../src/lib/applyProposals.ts'), 'utf8')
  assert.match(source, /export function validateProposal/)
  assert.match(source, /export async function acceptAllProposalsCollected/)
  assert.match(source, /export function suggestPostApplyVerifyFromScripts/)
})

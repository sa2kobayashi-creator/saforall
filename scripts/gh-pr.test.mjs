import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

// Compile-free: duplicate pure helpers for unit tests (mirrors electron/main/gh.ts)
function buildPrCreateArgs(input) {
  const title = (input.title || '').trim()
  if (!title) return { error: 'PR タイトルが必要です' }
  const args = ['pr', 'create', '--title', title]
  const body = (input.body ?? '').trim()
  if (body) args.push('--body', body)
  else args.push('--body', '')
  const base = (input.base ?? '').trim()
  if (base) args.push('--base', base)
  if (input.draft) args.push('--draft')
  return args
}

function extractPrUrl(stdout, stderr = '') {
  const text = `${stdout}\n${stderr}`
  const match = text.match(/https?:\/\/[^\s]+\/pull\/\d+/i)
  return match ? match[0].replace(/[)\].,]+$/, '') : null
}

function parseAuthStatus(stdout, stderr = '') {
  const text = `${stdout}\n${stderr}`
  const loggedIn = /Logged in to /i.test(text) && !/not logged in/i.test(text)
  const hostMatch = text.match(/Logged in to\s+(\S+)/i)
  const accountMatch =
    text.match(/account\s+(\S+)/i) || text.match(/as\s+(\S+)/i) || text.match(/✓\s+(\S+)/)
  return {
    loggedIn,
    host: hostMatch?.[1]?.replace(/[()]/g, ''),
    account: accountMatch?.[1]?.replace(/[()]/g, '')
  }
}

test('buildPrCreateArgs requires title', () => {
  assert.deepEqual(buildPrCreateArgs({ title: '  ' }), { error: 'PR タイトルが必要です' })
})

test('buildPrCreateArgs builds gh argv', () => {
  assert.deepEqual(buildPrCreateArgs({ title: 'Fix scroll', body: 'details', base: 'main' }), [
    'pr',
    'create',
    '--title',
    'Fix scroll',
    '--body',
    'details',
    '--base',
    'main'
  ])
  assert.ok(buildPrCreateArgs({ title: 'Draft', draft: true }).includes('--draft'))
})

test('extractPrUrl finds github pull link', () => {
  const url = extractPrUrl('Creating pull request\nhttps://github.com/org/repo/pull/42\n')
  assert.equal(url, 'https://github.com/org/repo/pull/42')
  assert.equal(extractPrUrl('no link here'), null)
})

test('parseAuthStatus detects logged in', () => {
  const sample = `github.com
  ✓ Logged in to github.com account sa2kobayashi-creator (keyring)`
  const parsed = parseAuthStatus(sample)
  assert.equal(parsed.loggedIn, true)
  assert.equal(parsed.host, 'github.com')
})

test('parseAuthStatus detects logged out', () => {
  const parsed = parseAuthStatus('You are not logged into any GitHub hosts')
  assert.equal(parsed.loggedIn, false)
})

// Also assert the TypeScript source still exports the same helper names
test('gh.ts source exports helpers', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(join(__dirname, '../electron/main/gh.ts'), 'utf8')
  assert.match(source, /export function buildPrCreateArgs/)
  assert.match(source, /export function extractPrUrl/)
  assert.match(source, /export async function createPullRequest/)
  assert.match(source, /export async function getGhAuthStatus/)
  // silence unused require in some runners
  assert.equal(typeof require, 'function')
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

function parseGitBlamePorcelain(raw) {
  const lines = raw.split(/\r?\n/)
  const out = []
  let commit = ''
  let author = ''
  let summary = ''
  let time
  let lineNo = 0
  for (const row of lines) {
    const header = row.match(/^([0-9a-f]{7,40})\s+(\d+)\s+(\d+)(?:\s+(\d+))?$/i)
    if (header) {
      commit = header[1]
      lineNo = Number(header[3])
      continue
    }
    if (row.startsWith('author ')) {
      author = row.slice(7)
      continue
    }
    if (row.startsWith('author-time ')) {
      time = Number(row.slice(12)) || undefined
      continue
    }
    if (row.startsWith('summary ')) {
      summary = row.slice(8)
      continue
    }
    if (row.startsWith('\t') && lineNo > 0) {
      out.push({
        line: lineNo,
        commit: commit.slice(0, 8),
        author: author || 'unknown',
        summary: summary || '',
        time
      })
      lineNo = 0
    }
  }
  return out
}

function replaceLiteral(text, query, replacement, caseSensitive = false) {
  if (caseSensitive) {
    const parts = text.split(query)
    const count = parts.length - 1
    return { next: parts.join(replacement), count }
  }
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(escaped, 'gi')
  let count = 0
  const next = text.replace(re, () => {
    count += 1
    return replacement
  })
  return { next, count }
}

test('parseGitBlamePorcelain extracts author lines', () => {
  const raw = [
    'abcdef01 1 1 1',
    'author Alice',
    'author-time 1700000000',
    'summary first',
    '\tconst x = 1',
    'abcdef02 2 2 1',
    'author Bob',
    'summary second',
    '\tconst y = 2'
  ].join('\n')
  const lines = parseGitBlamePorcelain(raw)
  assert.equal(lines.length, 2)
  assert.equal(lines[0].author, 'Alice')
  assert.equal(lines[1].author, 'Bob')
  assert.equal(lines[0].commit, 'abcdef01')
})

test('replaceLiteral counts case-insensitive replacements', () => {
  const { next, count } = replaceLiteral('Foo foo FOO', 'foo', 'bar')
  assert.equal(count, 3)
  assert.equal(next, 'bar bar bar')
})

test('sources wire scm diff / replace / format / blame / outline', async () => {
  const git = await readFile(join(root, 'electron/main/git.ts'), 'utf8')
  assert.match(git, /getGitFileSides/)
  assert.match(git, /parseGitBlamePorcelain|getGitBlame/)
  const tools = await readFile(join(root, 'electron/main/workspaceTools.ts'), 'utf8')
  assert.match(tools, /replaceInWorkspace/)
  const lsp = await readFile(join(root, 'electron/main/lspClient.ts'), 'utf8')
  assert.match(lsp, /textDocument\/formatting/)
  assert.match(lsp, /documentSymbol/)
  const index = await readFile(join(root, 'electron/main/index.ts'), 'utf8')
  assert.match(index, /git:fileDiff/)
  assert.match(index, /git:blame/)
  assert.match(index, /fs:replaceInFiles/)
  assert.match(index, /lsp:format/)
  assert.match(index, /lsp:documentSymbols/)
  const app = await readFile(join(root, 'src/App.tsx'), 'utf8')
  assert.match(app, /ScmDiffDialog/)
  assert.match(app, /onOpenDiff/)
  assert.match(app, /replaceInFiles|onFilesReplaced/)
  const editor = await readFile(join(root, 'src/components/EditorPane.tsx'), 'utf8')
  assert.match(editor, /saforall\.formatDocument|lspFormat/)
  assert.match(editor, /gitBlame|Blame/)
  assert.match(editor, /OutlinePanel|EditorBreadcrumbs/)
})

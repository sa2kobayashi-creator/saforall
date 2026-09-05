import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function parseUnifiedDiffLines(diff) {
  const out = []
  let path = ''
  let newLine = 0
  for (const raw of diff.split(/\r?\n/)) {
    if (raw.startsWith('+++ ')) {
      path = raw.slice(4).trim().replace(/^b\//, '')
      continue
    }
    const hunk = raw.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/)
    if (hunk) {
      newLine = Number(hunk[1])
      continue
    }
    if (!path || path === '/dev/null') continue
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      out.push({ path, line: newLine, text: raw.slice(1), kind: 'add' })
      newLine += 1
    } else if (raw.startsWith('-') && !raw.startsWith('---')) {
      out.push({ path, line: Math.max(1, newLine), text: raw.slice(1), kind: 'del' })
    } else if (raw.startsWith(' ')) {
      newLine += 1
    }
  }
  return out
}

function heuristicBugbotFindings(diff) {
  const lines = parseUnifiedDiffLines(diff)
  const findings = []
  for (const row of lines) {
    if (row.kind !== 'add') continue
    if (/\beval\b/.test(row.text)) {
      findings.push({
        severity: 'error',
        path: row.path,
        line: row.line,
        title: '危険な API',
        detail: row.text.trim()
      })
    }
    if (/\bTODO\b/.test(row.text)) {
      findings.push({
        severity: 'warning',
        path: row.path,
        line: row.line,
        title: '未完了マーカー',
        detail: row.text.trim()
      })
    }
  }
  return findings
}

test('parseUnifiedDiffLines tracks added line numbers', () => {
  const diff = [
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,2 +1,3 @@',
    ' keep',
    '+added',
    ' keep2'
  ].join('\n')
  const lines = parseUnifiedDiffLines(diff)
  assert.equal(lines.length, 1)
  assert.equal(lines[0].path, 'src/a.ts')
  assert.equal(lines[0].line, 2)
  assert.equal(lines[0].text, 'added')
})

test('heuristicBugbotFindings flags eval and TODO', () => {
  const diff = [
    '--- a/x.js',
    '+++ b/x.js',
    '@@ -1,0 +1,2 @@',
    '+eval(user)',
    '+// TODO fix later'
  ].join('\n')
  const findings = heuristicBugbotFindings(diff)
  assert.ok(findings.some((row) => row.severity === 'error'))
  assert.ok(findings.some((row) => row.title === '未完了マーカー'))
})

test('bugbotReview wired into bugbot:prepare', async () => {
  const source = await readFile(join(__dirname, '../electron/main/index.ts'), 'utf8')
  assert.match(source, /heuristicBugbotFindings/)
  assert.match(source, /buildBugbotPrompt/)
  const review = await readFile(join(__dirname, '../electron/main/bugbotReview.ts'), 'utf8')
  assert.match(review, /export function heuristicBugbotFindings/)
})

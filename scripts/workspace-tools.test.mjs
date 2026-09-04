import assert from 'node:assert/strict'
import { isAbsolute, join, relative, resolve } from 'node:path'
import test from 'node:test'

function resolveWorkspacePath(workspaceRoot, targetPath) {
  const root = resolve(workspaceRoot)
  const absolute = resolve(isAbsolute(targetPath) ? targetPath : join(root, targetPath))
  const rel = relative(root, absolute)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('ワークスペース外のパスにはアクセスできません')
  }
  return absolute
}

function repairToolArguments(raw) {
  const trimmed = (raw || '').trim()
  if (!trimmed) return '{}'
  try {
    JSON.parse(trimmed)
    return trimmed
  } catch {
    // continue
  }

  let candidate = trimmed
  const quoteCount = (candidate.match(/"/g) ?? []).length
  if (quoteCount % 2 === 1) candidate += '"'
  const openCurly = (candidate.match(/\{/g) ?? []).length
  const closeCurly = (candidate.match(/\}/g) ?? []).length
  if (openCurly > closeCurly) candidate += '}'.repeat(openCurly - closeCurly)
  const openSquare = (candidate.match(/\[/g) ?? []).length
  const closeSquare = (candidate.match(/\]/g) ?? []).length
  if (openSquare > closeSquare) candidate += ']'.repeat(openSquare - closeSquare)

  try {
    JSON.parse(candidate)
    return candidate
  } catch {
    return '{}'
  }
}

function computeDiffStats(original, modified) {
  const a = original.replace(/\r\n/g, '\n').split('\n')
  const b = modified.replace(/\r\n/g, '\n').split('\n')
  const setA = new Map()
  for (const line of a) setA.set(line, (setA.get(line) ?? 0) + 1)
  const setB = new Map()
  for (const line of b) setB.set(line, (setB.get(line) ?? 0) + 1)
  let removed = 0
  let added = 0
  for (const [line, count] of setA) {
    const next = setB.get(line) ?? 0
    if (count > next) removed += count - next
  }
  for (const [line, count] of setB) {
    const prev = setA.get(line) ?? 0
    if (count > prev) added += count - prev
  }
  return { added, removed }
}

function buildRunFileCommand(filePath, inspect = false) {
  const lower = filePath.toLowerCase()
  const quoted = `"${filePath.replace(/"/g, '\\"')}"`
  if (lower.endsWith('.js')) {
    return inspect ? `node --inspect-brk=9229 ${quoted}` : `node ${quoted}`
  }
  if (lower.endsWith('.ts')) {
    return inspect
      ? `npx --yes tsx --inspect-brk=9229 ${quoted}`
      : `npx --yes tsx ${quoted}`
  }
  return null
}

test('resolveWorkspacePath allows children', () => {
  const root = resolve('D:/tmp/project')
  const child = resolveWorkspacePath(root, 'src/App.tsx')
  assert.equal(child, resolve(root, 'src/App.tsx'))
})

test('resolveWorkspacePath blocks escape', () => {
  const root = resolve('D:/tmp/project')
  assert.throws(() => resolveWorkspacePath(root, '../secret.txt'))
})

test('repairToolArguments keeps valid JSON', () => {
  const raw = '{"path":"a.ts","content":"x"}'
  assert.equal(repairToolArguments(raw), raw)
})

test('repairToolArguments closes truncated object', () => {
  const repaired = repairToolArguments('{"path":"a.ts","content":"hello')
  const parsed = JSON.parse(repaired)
  assert.equal(parsed.path, 'a.ts')
  assert.equal(typeof parsed.content, 'string')
})

test('computeDiffStats counts added/removed lines', () => {
  const stats = computeDiffStats('a\nb\n', 'a\nc\n')
  assert.equal(stats.added, 1)
  assert.equal(stats.removed, 1)
})

function unverifiedEditPaths(edited, verified) {
  const verifiedList = Array.from(verified)
  const pathKeyMatch = (a, b) => {
    const na = a.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
    const nb = b.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
    if (na === nb) return true
    const ba = na.split('/').pop() ?? na
    const bb = nb.split('/').pop() ?? nb
    return ba.length > 0 && ba === bb
  }
  return Array.from(edited).filter(
    (path) => !verifiedList.some((row) => pathKeyMatch(path, row))
  )
}

function activeMentionQuery(value, cursor) {
  const before = value.slice(0, cursor)
  const match = before.match(/(^|[\s([{])@([^\s@]*)$/)
  if (!match) return null
  const atIndex = before.lastIndexOf('@')
  if (atIndex < 0) return null
  return { start: atIndex, query: match[2] ?? '' }
}

test('unverifiedEditPaths requires read of edited files', () => {
  const pending = unverifiedEditPaths(['src/App.tsx', 'lib/x.ts'], new Set(['src/App.tsx']))
  assert.deepEqual(pending, ['lib/x.ts'])
})

test('activeMentionQuery detects @token at cursor', () => {
  const hit = activeMentionQuery('fix @App', 8)
  assert.equal(hit?.query, 'App')
  assert.equal(activeMentionQuery('hello', 5), null)
})

test('findReplaceableBlock patches unique function span', () => {
  const existing = 'const a = 1\nfunction foo() {\n  return 1\n}\nconst b = 2\n'
  const code = 'function foo() {\n  return 2\n}'
  const block = findReplaceableBlock(existing, code)
  assert.ok(block)
  assert.equal(existing.slice(block.start, block.end), 'function foo() {\n  return 1\n}')
})

test('buildRunFileCommand supports node inspect', () => {
  assert.match(buildRunFileCommand('D:/app/index.js', true), /node --inspect-brk=9229/)
})

function assertSafeShellCommand(command) {
  const trimmed = (command || '').trim()
  if (!trimmed) throw new Error('command が空です')
  if (trimmed.length > 2000) throw new Error('command が長すぎます')
  const dangerous =
    /\b(format\s+[a-z]:|mkfs\b|diskpart\b|shutdown(\s|\/)|reboot\b|rm\s+-rf\s+\/(?=\s|$)|del\s+\/[sq]\b|rd\s+\/s\b|reg\s+delete\b|Remove-Item\b.*-Recurse\b|Invoke-WebRequest\b.*\|\s*iex\b|curl\b.*\|\s*sh\b)/i
  if (dangerous.test(trimmed)) {
    throw new Error('危険な可能性があるコマンドはブロックしました')
  }
}

function truncateShellOutput(text, max = 12_000) {
  if (text.length <= max) return text
  const head = Math.floor(max * 0.65)
  const tail = max - head - 40
  return `${text.slice(0, head)}\n\n... (truncated ${text.length - max} chars) ...\n\n${text.slice(-tail)}`
}

test('assertSafeShellCommand allows npm test', () => {
  assert.doesNotThrow(() => assertSafeShellCommand('npm test'))
  assert.doesNotThrow(() => assertSafeShellCommand('npm run typecheck'))
})

test('assertSafeShellCommand blocks destructive commands', () => {
  assert.throws(() => assertSafeShellCommand('rm -rf /'))
  assert.throws(() => assertSafeShellCommand('shutdown /s'))
})

test('truncateShellOutput keeps head and tail', () => {
  const text = 'a'.repeat(20_000)
  const out = truncateShellOutput(text, 1000)
  assert.ok(out.includes('truncated'))
  assert.ok(out.length < text.length)
})

function looksLikeUtf16Le(buf) {
  if (buf.length < 4) return false
  const sample = Math.min(buf.length, 4000)
  const pairs = Math.floor(sample / 2)
  if (pairs < 8) return false
  let nullOnOdd = 0
  let nullOnEven = 0
  for (let i = 0; i + 1 < sample; i += 2) {
    if (buf[i] === 0) nullOnEven += 1
    if (buf[i + 1] === 0) nullOnOdd += 1
  }
  return nullOnOdd > pairs * 0.3 && nullOnOdd > nullOnEven * 2
}

function decodeTextBuffer(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: buf.toString('utf16le').replace(/^\uFEFF/, ''), encoding: 'utf-16le' }
  }
  if (looksLikeUtf16Le(buf)) {
    return { text: buf.toString('utf16le').replace(/^\uFEFF/, ''), encoding: 'utf-16le' }
  }
  return { text: buf.toString('utf8').replace(/^\uFEFF/, ''), encoding: 'utf-8' }
}

test('decodeTextBuffer detects UTF-16LE markdown without BOM', () => {
  const text = '# sa-Signboard\n\nシンプル\n'
  const buf = Buffer.from(text, 'utf16le')
  const decoded = decodeTextBuffer(buf)
  assert.equal(decoded.encoding, 'utf-16le')
  assert.match(decoded.text, /sa-Signboard/)
  assert.match(decoded.text, /シンプル/)
})

test('decodeTextBuffer keeps UTF-8', () => {
  const buf = Buffer.from('# hello\n日本語\n', 'utf8')
  const decoded = decodeTextBuffer(buf)
  assert.equal(decoded.encoding, 'utf-8')
  assert.match(decoded.text, /日本語/)
})

function applyTextEdits(source, edits) {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const ordered = [...edits].sort((a, b) => {
    if (a.startLine !== b.startLine) return b.startLine - a.startLine
    return b.startColumn - a.startColumn
  })
  for (const edit of ordered) {
    const startLine = Math.max(1, edit.startLine) - 1
    const endLine = Math.max(1, edit.endLine) - 1
    const startCol = Math.max(1, edit.startColumn) - 1
    const endCol = Math.max(1, edit.endColumn) - 1
    if (startLine >= lines.length) continue
    const before = lines[startLine].slice(0, startCol)
    const afterLine = lines[Math.min(endLine, lines.length - 1)] ?? ''
    const after = afterLine.slice(endCol)
    const inserted = edit.newText.replace(/\r\n/g, '\n').split('\n')
    inserted[0] = before + (inserted[0] ?? '')
    inserted[inserted.length - 1] = (inserted[inserted.length - 1] ?? '') + after
    lines.splice(startLine, endLine - startLine + 1, ...inserted)
  }
  return lines.join('\n')
}

test('applyTextEdits renames symbol spans', () => {
  const source = 'const foo = 1\nconsole.log(foo)\n'
  const next = applyTextEdits(source, [
    { startLine: 1, startColumn: 7, endLine: 1, endColumn: 10, newText: 'bar' },
    { startLine: 2, startColumn: 13, endLine: 2, endColumn: 16, newText: 'bar' }
  ])
  assert.equal(next, 'const bar = 1\nconsole.log(bar)\n')
})

function resolveMcpCommand(command) {
  const trimmed = (command || '').trim()
  if (!trimmed) return { command: trimmed, shell: false }
  if (/[\\/]/.test(trimmed) || trimmed.includes(':')) {
    return { command: trimmed, shell: /\.(cmd|bat)$/i.test(trimmed) }
  }
  return { command: trimmed, shell: true }
}

test('resolveMcpCommand uses shell for bare windows commands', () => {
  const resolved = resolveMcpCommand('npx')
  assert.equal(resolved.command, 'npx')
  assert.equal(resolved.shell, true)
})

test('resolveMcpCommand keeps absolute cmd paths', () => {
  const resolved = resolveMcpCommand('C:\\Program Files\\nodejs\\npx.cmd')
  assert.match(resolved.command, /npx\.cmd$/i)
  assert.equal(resolved.shell, true)
})

function findReplaceableBlock(existing, code) {
  const snippet = code.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '')
  if (!snippet || snippet.length < 12) return null
  const source = existing.replace(/\r\n/g, '\n')
  if (source.includes(snippet)) return null
  const lines = snippet.split('\n').filter((line) => line.trim() !== '')
  if (lines.length < 2) return null
  const first = lines[0]
  const last = lines[lines.length - 1]
  const start = source.indexOf(first)
  if (start < 0) return null
  if (source.indexOf(first, start + first.length) >= 0) return null
  const endIdx = source.indexOf(last, start + first.length)
  if (endIdx < 0) return null
  const end = endIdx + last.length
  const replacedLen = end - start
  if (replacedLen < snippet.length * 0.4 || replacedLen > snippet.length * 4) return null
  return { start, end }
}

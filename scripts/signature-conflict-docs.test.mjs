import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

function parseMergeConflicts(content) {
  const lines = content.split(/\r?\n/)
  const START = /^<<<<<<<(?: .*)?$/
  const MID = /^=======$/
  const END = /^>>>>>>>(?: .*)?$/
  const hunks = []
  let i = 0
  while (i < lines.length) {
    if (!START.test(lines[i] ?? '')) {
      i += 1
      continue
    }
    const startLine = i + 1
    let mid = -1
    let end = -1
    for (let j = i + 1; j < lines.length; j++) {
      if (mid < 0 && MID.test(lines[j] ?? '')) {
        mid = j
        continue
      }
      if (mid >= 0 && END.test(lines[j] ?? '')) {
        end = j
        break
      }
    }
    if (mid < 0 || end < 0) {
      i += 1
      continue
    }
    hunks.push({
      startLine,
      midLine: mid + 1,
      endLine: end + 1,
      current: lines.slice(i + 1, mid).join('\n'),
      incoming: lines.slice(mid + 1, end).join('\n')
    })
    i = end + 1
  }
  return hunks
}

function resolveMergeConflict(content, hunk, mode) {
  const lines = content.split(/\r?\n/)
  const replacement =
    mode === 'current'
      ? hunk.current
      : mode === 'incoming'
        ? hunk.incoming
        : [hunk.current, hunk.incoming].filter((part) => part.length > 0).join('\n')
  const replacementLines = replacement.length > 0 ? replacement.split('\n') : []
  return [...lines.slice(0, hunk.startLine - 1), ...replacementLines, ...lines.slice(hunk.endLine)].join(
    '\n'
  )
}

test('parse and resolve merge conflict hunks', () => {
  const raw = ['a', '<<<<<<< HEAD', 'ours', '=======', 'theirs', '>>>>>>> branch', 'z'].join('\n')
  const hunks = parseMergeConflicts(raw)
  assert.equal(hunks.length, 1)
  assert.equal(hunks[0].current, 'ours')
  assert.equal(hunks[0].incoming, 'theirs')
  assert.equal(resolveMergeConflict(raw, hunks[0], 'current'), ['a', 'ours', 'z'].join('\n'))
  assert.equal(resolveMergeConflict(raw, hunks[0], 'incoming'), ['a', 'theirs', 'z'].join('\n'))
  assert.equal(resolveMergeConflict(raw, hunks[0], 'both'), ['a', 'ours', 'theirs', 'z'].join('\n'))
})

test('sources wire signature help, conflict UI, and docs status', async () => {
  const lsp = await readFile(join(root, 'electron/main/lspClient.ts'), 'utf8')
  assert.match(lsp, /textDocument\/signatureHelp/)
  assert.match(lsp, /signatureHelp:/)
  const preload = await readFile(join(root, 'electron/preload/index.ts'), 'utf8')
  assert.match(preload, /lspSignatureHelp/)
  const providers = await readFile(join(root, 'src/lib/lspProviders.ts'), 'utf8')
  assert.match(providers, /registerSignatureHelpProvider/)
  const editor = await readFile(join(root, 'src/components/EditorPane.tsx'), 'utf8')
  assert.match(editor, /Accept Current/)
  assert.match(editor, /parseMergeConflicts/)
  const scm = await readFile(join(root, 'src/components/SourceControlPanel.tsx'), 'utf8')
  assert.match(scm, /Merge Conflicts/)
  assert.match(scm, /isGitConflictEntry/)
  const shell = await readFile(join(root, 'docs/IDE_SHELL.md'), 'utf8')
  assert.match(shell, /軽量版で完了/)
  const spec = await readFile(join(root, 'docs/SPECIFICATION.md'), 'utf8')
  assert.match(spec, /0\.3\.0/)
  assert.match(spec, /SCM-03/)
})

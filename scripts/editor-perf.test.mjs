import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const perf = await import(pathToFileURL(join(root, 'src/lib/editorPerf.ts')).href)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('editorPerfTier classifies by both size and line count', () => {
  const { editorPerfTier, LARGE_FILE_CHARS, HUGE_FILE_CHARS, LARGE_FILE_LINES } = perf

  assert.equal(editorPerfTier(''), 'normal')
  assert.equal(editorPerfTier(null), 'normal')
  assert.equal(editorPerfTier('const a = 1\n'.repeat(100)), 'normal')

  // Wide-but-short file crosses the byte threshold.
  assert.equal(editorPerfTier('x'.repeat(LARGE_FILE_CHARS)), 'large')
  // Narrow-but-tall file crosses the line threshold while staying small.
  const tall = 'a\n'.repeat(LARGE_FILE_LINES)
  assert.ok(tall.length < LARGE_FILE_CHARS, 'fixture must not trip the byte rule')
  assert.equal(editorPerfTier(tall), 'large')

  assert.equal(editorPerfTier('x'.repeat(HUGE_FILE_CHARS)), 'huge')
})

test('large and huge tiers drop the expensive Monaco features', () => {
  const { editorOptionsForTier, editorOptionsForContent, HUGE_FILE_CHARS } = perf

  const normal = editorOptionsForTier('normal')
  assert.equal(normal.minimap.enabled, true)
  assert.equal(normal.wordWrap, 'on')
  assert.equal(normal.folding, true)
  assert.equal(normal.inlineSuggest.enabled, true)

  const large = editorOptionsForTier('large')
  assert.equal(large.minimap.enabled, false)
  assert.equal(large.wordWrap, 'off')
  assert.equal(large.folding, false)
  assert.equal(large.occurrencesHighlight, 'off')
  assert.equal(large.bracketPairColorization.enabled, false)
  // Completions still help at this size; only rendering work is cut.
  assert.equal(large.inlineSuggest.enabled, true)

  const huge = editorOptionsForTier('huge')
  assert.equal(huge.inlineSuggest.enabled, false)
  assert.equal(huge.quickSuggestions, false)
  assert.equal(huge.wordBasedSuggestions, 'off')

  // Options that must never change with tier.
  for (const options of [normal, large, huge]) {
    assert.equal(options.automaticLayout, true)
    assert.equal(options.glyphMargin, true, 'breakpoints need the glyph margin')
    assert.equal(options.tabSize, 2)
    assert.equal(options.largeFileOptimizations, true)
  }

  assert.deepEqual(editorOptionsForContent('x'.repeat(HUGE_FILE_CHARS)), huge)
  assert.deepEqual(editorOptionsForContent('small'), normal)
})

test('perfNoticeForTier only warns above the normal tier', () => {
  const { perfNoticeForTier } = perf
  assert.equal(perfNoticeForTier('normal'), null)
  assert.match(perfNoticeForTier('large'), /軽量モード/)
  assert.match(perfNoticeForTier('huge'), /軽量モード/)
})

test('hasConflictMarkers only matches markers at line start', () => {
  const { hasConflictMarkers } = perf
  assert.equal(hasConflictMarkers(null), false)
  assert.equal(hasConflictMarkers('const a = 1\n'), false)
  // A string literal mentioning the marker must not trigger conflict parsing.
  assert.equal(hasConflictMarkers('const marker = "a <<<<<<< b"\n'), false)
  assert.equal(hasConflictMarkers('a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> other\n'), true)
  assert.equal(hasConflictMarkers('<<<<<<< HEAD\n'), true)
})

test('countLines stops early at the limit', () => {
  const { countLines } = perf
  assert.equal(countLines(''), 1)
  assert.equal(countLines('a'), 1)
  assert.equal(countLines('a\nb'), 2)
  assert.equal(countLines('a\nb\n'), 3)
  assert.equal(countLines('a\n'.repeat(1000), 10), 10)
})

test('debounce collapses a typing burst into one call with the last args', async () => {
  const { debounce } = perf
  const calls = []
  const fn = debounce((value) => calls.push(value), 20)

  fn('a')
  fn('b')
  fn('c')
  assert.deepEqual(calls, [], 'must not fire synchronously')

  await sleep(60)
  assert.deepEqual(calls, ['c'])
})

test('debounce cancel drops pending work and flush runs it now', async () => {
  const { debounce } = perf

  const cancelled = []
  const a = debounce((v) => cancelled.push(v), 20)
  a('x')
  a.cancel()
  await sleep(60)
  assert.deepEqual(cancelled, [])

  const flushed = []
  const b = debounce((v) => flushed.push(v), 1000)
  b('y')
  b.flush()
  assert.deepEqual(flushed, ['y'], 'flush must be synchronous')
  b.flush()
  assert.deepEqual(flushed, ['y'], 'flush on an idle debounce is a no-op')
})

test('withTimeout falls back instead of hanging or rejecting', async () => {
  const { withTimeout } = perf

  const fast = await withTimeout(Promise.resolve(['item']), 50, [])
  assert.deepEqual(fast, ['item'])

  const slow = await withTimeout(sleep(200).then(() => ['late']), 20, [])
  assert.deepEqual(slow, [], 'slow request must resolve the fallback')

  const failed = await withTimeout(Promise.reject(new Error('lsp down')), 50, [])
  assert.deepEqual(failed, [], 'rejection must not escape to the caller')
})

test('EditorPane applies the perf tier and debounces marker collection', () => {
  const src = readFileSync(join(root, 'src/components/EditorPane.tsx'), 'utf8')

  assert.match(src, /from '\.\.\/lib\/editorPerf'/)
  assert.match(src, /options=\{editorOptions\}/)
  assert.equal(
    /minimap: \{ enabled: true \}/.test(src),
    false,
    'editor options must come from the perf tier, not a hardcoded object'
  )
  assert.match(src, /debounce\(emitMarkers, MARKER_DEBOUNCE_MS\)/)
  assert.match(src, /emitMarkersRef\.current\?\.cancel\(\)/)
  assert.match(src, /editor-perf-bar/)
})

test('closing a tab frees its Monaco model exactly once', () => {
  const src = readFileSync(join(root, 'src/components/EditorPane.tsx'), 'utf8')

  assert.match(src, /monaco\.editor\.getModel\(monaco\.Uri\.parse\(path\)\)/)
  assert.match(src, /if \(model && !model\.isDisposed\(\)\) model\.dispose\(\)/)
  // The split pane shares `tabs`; only the provider owner may dispose.
  assert.match(src, /if \(!registerProviders \|\| !monaco\) return/)
  assert.match(src, /\}, \[tabs, registerProviders\]\)/)
})

test('EditorPane no longer reruns per-keystroke effects on content', () => {
  const src = readFileSync(join(root, 'src/components/EditorPane.tsx'), 'utf8')

  assert.match(src, /\}, \[breakpoints, pausedLine, activePath\]\)/)
  assert.match(src, /\}, \[conflicts, activePath\]\)/)
  // Blame shells out to git; keying it to dirty means once per save, not per key.
  assert.match(src, /\}, \[blameOn, activePath, workspacePath, file\?\.dirty\]\)/)
  assert.equal(
    /\[blameOn, activePath, workspacePath, file\?\.content\]/.test(src),
    false,
    'git blame must not refire on every keystroke'
  )
  assert.match(src, /hasConflictMarkers\(content\) \? parseMergeConflicts\(content\) : \[\]/)
})

test('Monaco TS worker is configured so it stops inventing diagnostics', () => {
  const src = readFileSync(join(root, 'src/components/EditorPane.tsx'), 'utf8')

  assert.match(src, /typescriptDefaults\.setCompilerOptions\(compilerOptions\)/)
  assert.match(src, /javascriptDefaults\.setCompilerOptions\(compilerOptions\)/)
  assert.match(src, /jsx: ts\.JsxEmit\.ReactJSX/)
  assert.match(src, /moduleResolution: ts\.ModuleResolutionKind\.NodeJs/)
  // 2307/2792/7016 are all "cannot resolve module", impossible in the worker.
  assert.match(src, /diagnosticCodesToIgnore: \[2307, 2792, 7016\]/)
})

test('LSP completion is bounded and the outline follows edits', () => {
  const providers = readFileSync(join(root, 'src/lib/lspProviders.ts'), 'utf8')
  assert.match(providers, /COMPLETION_TIMEOUT_MS, withTimeout \} from '\.\/editorPerf'/)
  assert.match(providers, /withTimeout\(\s*window\.saforall\.lspCompletion\(/)

  const outline = readFileSync(join(root, 'src/components/OutlinePanel.tsx'), 'utf8')
  assert.match(outline, /useDocumentSymbols\(activePath: string \| null, revision = 0\)/)
  assert.match(outline, /\}, \[activePath, revision\]\)/)

  const pane = readFileSync(join(root, 'src/components/EditorPane.tsx'), 'utf8')
  assert.match(pane, /useDocumentSymbols\(activePath, symbolRevision\)/)
  assert.match(pane, /setSymbolRevision\(\(value\) => value \+ 1\)/)
  assert.ok(
    perf.OUTLINE_DEBOUNCE_MS > 700,
    'outline refresh must trail the 700ms LSP didChange debounce'
  )
})

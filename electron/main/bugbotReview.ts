export type BugbotFinding = {
  severity: 'error' | 'warning' | 'info'
  path: string
  line?: number
  title: string
  detail: string
}

type HunkLine = { path: string; line: number; text: string; kind: 'add' | 'del' }

/** Parse unified diff into added/deleted lines with approximate new-file line numbers. */
export function parseUnifiedDiffLines(diff: string): HunkLine[] {
  const out: HunkLine[] = []
  let path = ''
  let newLine = 0
  for (const raw of diff.split(/\r?\n/)) {
    if (raw.startsWith('+++ ')) {
      const rest = raw.slice(4).trim()
      path = rest.replace(/^b\//, '')
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

/** Fast heuristic findings before the LLM Bugbot review. */
export function heuristicBugbotFindings(diff: string): BugbotFinding[] {
  const lines = parseUnifiedDiffLines(diff)
  const findings: BugbotFinding[] = []
  const seen = new Set<string>()

  const push = (finding: BugbotFinding): void => {
    const key = `${finding.severity}|${finding.path}|${finding.line ?? 0}|${finding.title}`
    if (seen.has(key)) return
    seen.add(key)
    findings.push(finding)
  }

  for (const row of lines) {
    if (row.kind !== 'add') continue
    const text = row.text
    if (/\b(eval|innerHTML\s*=|document\.write)\b/.test(text)) {
      push({
        severity: 'error',
        path: row.path,
        line: row.line,
        title: '危険な API',
        detail: text.trim().slice(0, 160)
      })
    }
    if (/\bTODO\b|\bFIXME\b|\bHACK\b/.test(text)) {
      push({
        severity: 'warning',
        path: row.path,
        line: row.line,
        title: '未完了マーカー',
        detail: text.trim().slice(0, 160)
      })
    }
    if (/\bconsole\.(log|debug|info)\s*\(/.test(text) && !/\.test\./.test(row.path)) {
      push({
        severity: 'info',
        path: row.path,
        line: row.line,
        title: 'デバッグログの追加',
        detail: text.trim().slice(0, 160)
      })
    }
    if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(text) || /catch\s*\{\s*\}/.test(text)) {
      push({
        severity: 'warning',
        path: row.path,
        line: row.line,
        title: '空の catch',
        detail: text.trim().slice(0, 160)
      })
    }
  }

  const deletedTests = lines.filter(
    (row) =>
      row.kind === 'del' &&
      (/\.test\./.test(row.path) || /describe\(|it\(|test\(/.test(row.text))
  )
  if (deletedTests.length >= 3) {
    push({
      severity: 'warning',
      path: deletedTests[0]!.path,
      line: deletedTests[0]!.line,
      title: 'テスト削除が多い',
      detail: `${deletedTests.length} 行のテスト関連削除があります`
    })
  }

  const byFile = new Map<string, number>()
  for (const row of lines) {
    if (row.kind !== 'add') continue
    byFile.set(row.path, (byFile.get(row.path) ?? 0) + 1)
  }
  for (const [path, count] of Array.from(byFile.entries())) {
    if (count >= 200) {
      push({
        severity: 'info',
        path,
        title: '大きな差分',
        detail: `追加 ${count} 行 — 分割レビューを推奨`
      })
    }
  }

  return findings.slice(0, 40)
}

export function buildBugbotPrompt(diff: string, findings: BugbotFinding[]): string {
  const heuristicBlock =
    findings.length === 0
      ? '（ヒューリスティック所見なし）'
      : findings
          .map(
            (row, i) =>
              `${i + 1}. [${row.severity}] ${row.path}${row.line ? `:${row.line}` : ''} — ${row.title}: ${row.detail}`
          )
          .join('\n')

  return [
    '【Bugbot】次の git diff をレビューしてください。',
    'バグ・回帰リスク・欠けているテストを重要度付きで日本語指摘。修正案はコードブロックで。',
    '',
    'まず次のヒューリスティック所見を確認し、妥当なら採用・深掘りしてください。',
    '最終回答の末尾に、次の JSON 配列（findings）を必ず付けてください:',
    '```json',
    '[{"severity":"error|warning|info","path":"相対パス","line":1,"title":"短い題","detail":"説明"}]',
    '```',
    '',
    '### ヒューリスティック所見',
    heuristicBlock,
    '',
    '```diff',
    diff.slice(0, 50_000),
    '```'
  ].join('\n')
}

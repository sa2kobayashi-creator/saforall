export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'code'; language: string; code: string; pathHint?: string }

const FENCE_RE = /```([^\n`]*)\n([\s\S]*?)```/g

function parseFenceMeta(meta: string): { language: string; pathHint?: string } {
  const trimmed = meta.trim()
  if (!trimmed) return { language: 'text' }

  // ```typescript path/to/file.ts
  // ```typescript:path/to/file.ts
  // ```path/to/file.ts
  const spaced = trimmed.match(/^([A-Za-z0-9_+#-]+)\s+(.+)$/)
  if (spaced) {
    return { language: spaced[1], pathHint: spaced[2].trim() }
  }

  const colon = trimmed.match(/^([A-Za-z0-9_+#-]+):(.+)$/)
  if (colon && (colon[2].includes('/') || colon[2].includes('\\') || colon[2].includes('.'))) {
    return { language: colon[1], pathHint: colon[2].trim() }
  }

  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return { language: 'text', pathHint: trimmed }
  }

  return { language: trimmed }
}

export function parseMessageParts(content: string): MessagePart[] {
  const parts: MessagePart[] = []
  let lastIndex = 0
  const fenceRe = new RegExp(FENCE_RE.source, 'g')
  let match: RegExpExecArray | null

  while ((match = fenceRe.exec(content)) !== null) {
    const index = match.index
    if (index > lastIndex) {
      parts.push({ type: 'text', text: content.slice(lastIndex, index) })
    }

    const meta = parseFenceMeta(match[1] ?? '')
    parts.push({
      type: 'code',
      language: meta.language,
      code: (match[2] ?? '').replace(/\n$/, ''),
      pathHint: meta.pathHint
    })

    lastIndex = index + match[0].length
  }

  if (lastIndex < content.length) {
    parts.push({ type: 'text', text: content.slice(lastIndex) })
  }

  if (parts.length === 0) {
    parts.push({ type: 'text', text: content })
  }

  return parts
}

export function joinPath(root: string, relative: string): string {
  const sep = root.includes('\\') ? '\\' : '/'
  const normalizedRelative = relative
    .replace(/^[\\/]+/, '')
    .replace(/[\\/]+/g, sep)
  return `${root.replace(/[\\/]+$/, '')}${sep}${normalizedRelative}`
}

export function isAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('\\\\')
}

const SHELL_LANGUAGES = new Set([
  'bash',
  'sh',
  'shell',
  'zsh',
  'powershell',
  'ps1',
  'pwsh',
  'cmd',
  'bat',
  'console',
  'terminal',
  'shellscript'
])

export function isShellLanguage(language?: string): boolean {
  if (!language) return false
  return SHELL_LANGUAGES.has(language.toLowerCase())
}

export function defaultFileName(language?: string): string {
  const map: Record<string, string> = {
    html: 'index.html',
    css: 'styles.css',
    javascript: 'index.js',
    js: 'index.js',
    jsx: 'App.jsx',
    typescript: 'index.ts',
    ts: 'index.ts',
    tsx: 'App.tsx',
    python: 'main.py',
    py: 'main.py',
    json: 'data.json',
    md: 'README.md',
    markdown: 'README.md'
  }
  return map[(language ?? '').toLowerCase()] ?? 'untitled.txt'
}

/** 断片コードなら既存ファイルへ追記、フルファイルなら置換 */
export function shouldAppendToFile(existing: string, incoming: string): boolean {
  if (!existing.trim()) return false

  const fullFileStart =
    /^(?:\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*)*(?:const|let|var|import\s|require\s*\(|module\.exports|export\s|<!DOCTYPE|<html)/i

  if (fullFileStart.test(incoming)) return false

  // app.post / router.get などの断片
  if (/^\s*(?:app|router)\./m.test(incoming)) return true

  return !fullFileStart.test(incoming)
}

/** PowerShell / シェルに貼り付けやすい形へ整える */
export function formatCommandForTerminal(code: string): string {
  const lines = code
    .split(/\r?\n/)
    .map((line) => line.trim())
    // PowerShell では # 以降がコメントになるため、コメント行を落とす
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => {
      // プロンプト記号を除去: "$ npm install" / "PS> dir" / "C:\\...> cmd"
      let cleaned = line
        .replace(/^PS\s+[A-Za-z]:[^>]*>\s*/i, '')
        .replace(/^[A-Za-z]:\\[^>]*>\s*/, '')
        .replace(/^\$+\s+/, '')
        .replace(/^>\s+/, '')
      // 行末コメントを除去（簡易）:  "cmd # comment"
      const hash = cleaned.indexOf(' #')
      if (hash >= 0) cleaned = cleaned.slice(0, hash).trimEnd()
      return cleaned.trim()
    })
    // Linux 専用やプレースホルダ URL は Windows では実行しない
    .filter((line) => {
      if (line.length === 0) return false
      if (/\b(apt-get|apt\s+install|yum\s+install|sudo\b)\b/i.test(line)) return false
      if (/github\.com\/username\//i.test(line)) return false
      if (/\.example\.com\b/i.test(line)) return false
      return true
    })

  if (lines.length === 0) return ''

  // Windows の PowerShell では複数行を ; でつなぐ方が安定しやすい
  const joined = lines.join('; ')
  return `${joined}\r`
}

/**
 * Agent 自動実行してよいコマンドか。
 * npm/node 系のみ許可し、pip/flask など未導入ツールはスキップする。
 */
export function isSafeAutoShellCommand(command: string): boolean {
  const lines = command
    .replace(/\r/g, '')
    .split(';')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length === 0) return false

  return lines.every((line) => {
    if (/^(npm|npx|node|yarn|pnpm)\b/i.test(line)) return true
    if (/^git\s+(status|add|commit|diff|log|pull|push|checkout|branch)\b/i.test(line)) {
      return true
    }
    if (/^(cd|dir|ls|echo|type|Get-ChildItem|Set-Location)\b/i.test(line)) return true
    if (/^mkdir\b/i.test(line)) return true
    return false
  })
}

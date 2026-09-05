import { shouldAppendToFile } from './codeBlocks'

export type AppliedContentPlan = {
  original: string
  modified: string
  mode: 'create' | 'replace' | 'append' | 'patch'
}

/** If `code` looks like a contiguous block already in the file, replace that span. */
export function findReplaceableBlock(
  existing: string,
  code: string
): { start: number; end: number } | null {
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
  const second = source.indexOf(first, start + first.length)
  if (second >= 0) return null // ambiguous
  const endSearchFrom = start + first.length
  const endIdx = source.indexOf(last, endSearchFrom)
  if (endIdx < 0) return null
  const end = endIdx + last.length
  // Require the replaced region to be reasonably sized vs snippet
  const replacedLen = end - start
  if (replacedLen < snippet.length * 0.4 || replacedLen > snippet.length * 4) {
    return null
  }
  return { start, end }
}

export function planAppliedContent(
  existing: string,
  code: string,
  options?: { preferReplace?: boolean }
): AppliedContentPlan {
  if (!existing.trim()) {
    return {
      original: existing,
      modified: code.endsWith('\n') ? code : `${code}\n`,
      mode: 'create'
    }
  }

  if (options?.preferReplace) {
    return {
      original: existing,
      modified: code.endsWith('\n') ? code : `${code}\n`,
      mode: 'replace'
    }
  }

  const block = findReplaceableBlock(existing, code)
  if (block) {
    const source = existing.replace(/\r\n/g, '\n')
    const snippet = code.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '')
    const modified =
      source.slice(0, block.start) +
      snippet +
      source.slice(block.end) +
      (existing.endsWith('\n') ? '' : '')
    return {
      original: existing,
      modified: modified.endsWith('\n') ? modified : `${modified}\n`,
      mode: 'patch'
    }
  }

  const append = shouldAppendToFile(existing, code)
  if (append) {
    return {
      original: existing,
      modified: `${existing.replace(/\s*$/, '')}\n\n${code}\n`,
      mode: 'append'
    }
  }

  return {
    original: existing,
    modified: code.endsWith('\n') ? code : `${code}\n`,
    mode: 'replace'
  }
}

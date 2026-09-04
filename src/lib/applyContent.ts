import { shouldAppendToFile } from './codeBlocks'

export type AppliedContentPlan = {
  original: string
  modified: string
  mode: 'create' | 'replace' | 'append'
}

export function planAppliedContent(existing: string, code: string): AppliedContentPlan {
  if (!existing.trim()) {
    return {
      original: existing,
      modified: code.endsWith('\n') ? code : `${code}\n`,
      mode: 'create'
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

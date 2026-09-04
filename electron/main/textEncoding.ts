import { readFile } from 'fs/promises'

export type DecodedText = {
  text: string
  encoding: 'utf-8' | 'utf-16le' | 'utf-16be' | 'shift_jis'
}

function countNullPairs(buf: Buffer, even: boolean): number {
  let hits = 0
  const start = even ? 0 : 1
  for (let i = start; i + 1 < Math.min(buf.length, 4000); i += 2) {
    if (buf[i] === 0) hits += 1
  }
  return hits
}

function looksLikeUtf16Le(buf: Buffer): boolean {
  if (buf.length < 4) return false
  const sample = Math.min(buf.length, 4000)
  const pairs = Math.floor(sample / 2)
  if (pairs < 8) return false
  const nullOnOdd = countNullPairs(buf, false)
  const nullOnEven = countNullPairs(buf, true)
  // ASCII-heavy UTF-16LE has many 0x00 on odd indices (# = 0x23 0x00)
  return nullOnOdd > pairs * 0.3 && nullOnOdd > nullOnEven * 2
}

function looksLikeUtf16Be(buf: Buffer): boolean {
  if (buf.length < 4) return false
  const sample = Math.min(buf.length, 4000)
  const pairs = Math.floor(sample / 2)
  if (pairs < 8) return false
  const nullOnEven = countNullPairs(buf, true)
  const nullOnOdd = countNullPairs(buf, false)
  return nullOnEven > pairs * 0.3 && nullOnEven > nullOnOdd * 2
}

function decodeUtf16Be(buf: Buffer): string {
  const swapped = Buffer.alloc(buf.length - (buf.length % 2))
  for (let i = 0; i + 1 < swapped.length; i += 2) {
    swapped[i] = buf[i + 1]
    swapped[i + 1] = buf[i]
  }
  return swapped.toString('utf16le')
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function replacementRatio(text: string): number {
  if (!text) return 0
  let bad = 0
  const sample = text.slice(0, 8000)
  for (const ch of sample) {
    if (ch === '\uFFFD') bad += 1
  }
  return bad / Math.max(sample.length, 1)
}

function tryDecode(label: string, buf: Buffer): string | null {
  try {
    return new TextDecoder(label, { fatal: false }).decode(buf)
  } catch {
    return null
  }
}

/** Detect common text encodings (UTF-8 / UTF-16 / Shift_JIS). */
export function decodeTextBuffer(buf: Buffer): DecodedText {
  if (buf.length === 0) return { text: '', encoding: 'utf-8' }

  // BOM
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: stripBom(buf.toString('utf16le')), encoding: 'utf-16le' }
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { text: stripBom(decodeUtf16Be(buf)), encoding: 'utf-16be' }
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: stripBom(buf.toString('utf8')), encoding: 'utf-8' }
  }

  if (looksLikeUtf16Le(buf)) {
    return { text: stripBom(buf.toString('utf16le')), encoding: 'utf-16le' }
  }
  if (looksLikeUtf16Be(buf)) {
    return { text: stripBom(decodeUtf16Be(buf)), encoding: 'utf-16be' }
  }

  const utf8 = buf.toString('utf8')
  if (replacementRatio(utf8) < 0.01) {
    return { text: stripBom(utf8), encoding: 'utf-8' }
  }

  for (const label of ['shift_jis', 'windows-31j', 'euc-jp'] as const) {
    const decoded = tryDecode(label, buf)
    if (decoded && replacementRatio(decoded) < replacementRatio(utf8)) {
      return {
        text: stripBom(decoded),
        encoding: 'shift_jis'
      }
    }
  }

  return { text: stripBom(utf8), encoding: 'utf-8' }
}

export async function readTextFile(filePath: string): Promise<DecodedText> {
  const buf = await readFile(filePath)
  return decodeTextBuffer(buf)
}

import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'

let rootDir: string | null = null

export function configureLocalDb(dir: string): void {
  rootDir = dir
}

export function getLocalDbRoot(): string {
  if (!rootDir) throw new Error('localDb が未初期化です')
  return rootDir
}

export async function ensureLocalDbReady(): Promise<string> {
  const root = getLocalDbRoot()
  await mkdir(root, { recursive: true })
  await mkdir(join(root, 'messages'), { recursive: true })
  return root
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

type Meta = { nextId: number }

export async function nextLocalId(counterFile: string): Promise<number> {
  const meta = await readJsonFile<Meta>(counterFile, { nextId: 1 })
  const id = meta.nextId
  meta.nextId = id + 1
  await writeJsonFile(counterFile, meta)
  return id
}

export function isoNow(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

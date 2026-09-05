import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function normalizeMcpServerRow(id, row) {
  const url = typeof row.url === 'string' ? row.url.trim() : ''
  const command = typeof row.command === 'string' ? row.command.trim() : ''
  if (url) {
    if (!/^https?:\/\//i.test(url)) return null
    const transport =
      row.transport === 'sse' || row.transport === 'http' || row.transport === 'stdio'
        ? row.transport
        : 'http'
    return {
      id,
      url,
      headers: row.headers,
      transport: transport === 'stdio' ? 'http' : transport
    }
  }
  if (!command) return null
  return { id, command, args: row.args, env: row.env, transport: 'stdio' }
}

function parseMcpHttpResponseBody(body, contentType) {
  const ct = contentType.toLowerCase()
  if (ct.includes('text/event-stream') || body.includes('data:')) {
    const lines = body.split(/\r?\n/)
    let last = null
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (!data || data === '[DONE]') continue
      try {
        const parsed = JSON.parse(data)
        if (parsed && typeof parsed === 'object' && ('result' in parsed || 'error' in parsed || 'id' in parsed)) {
          last = parsed
        }
      } catch {
        // ignore
      }
    }
    if (last) return last
    throw new Error('MCP SSE response had no JSON-RPC data')
  }
  return JSON.parse(body)
}

function nextVerifyFallback(failedCommand, hint, tried) {
  if (!hint) return null
  const norm = (s) => s.trim().replace(/\s+/g, ' ')
  const chain = [hint.primary, ...hint.fallbacks].map(norm).filter(Boolean)
  if (chain.length === 0) return null
  const triedSet = new Set(tried.map(norm))
  const failed = norm(failedCommand)
  triedSet.add(failed)
  const isVerifyRelated = chain.some(
    (cmd) => failed === cmd || failed.startsWith(cmd) || cmd.startsWith(failed)
  )
  if (!isVerifyRelated) return null
  for (const cmd of chain) {
    if (!triedSet.has(cmd)) return cmd
  }
  return null
}

test('normalizeMcpServerRow accepts http url without command', () => {
  const row = normalizeMcpServerRow('remote', {
    url: 'https://mcp.example.com/v1'
  })
  assert.equal(row.transport, 'http')
  assert.equal(row.url, 'https://mcp.example.com/v1')
  assert.equal(row.command, undefined)
})

test('normalizeMcpServerRow rejects non-http url', () => {
  assert.equal(normalizeMcpServerRow('bad', { url: 'ftp://x' }), null)
})

test('normalizeMcpServerRow keeps stdio command', () => {
  const row = normalizeMcpServerRow('fs', { command: 'npx', args: ['-y', 'pkg'] })
  assert.equal(row.transport, 'stdio')
  assert.equal(row.command, 'npx')
})

test('parseMcpHttpResponseBody reads SSE data frames', () => {
  const body = [
    'event: message',
    'data: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}',
    ''
  ].join('\n')
  const msg = parseMcpHttpResponseBody(body, 'text/event-stream')
  assert.deepEqual(msg.result, { tools: [] })
})

test('nextVerifyFallback chains typecheck → test', () => {
  const hint = { primary: 'npm run typecheck', fallbacks: ['npm test', 'npm run lint'] }
  assert.equal(nextVerifyFallback('npm run typecheck', hint, []), 'npm test')
  assert.equal(
    nextVerifyFallback('npm test', hint, ['npm run typecheck', 'npm test']),
    'npm run lint'
  )
  assert.equal(
    nextVerifyFallback('npm run lint', hint, [
      'npm run typecheck',
      'npm test',
      'npm run lint'
    ]),
    null
  )
})

test('nextVerifyFallback ignores unrelated shell commands', () => {
  const hint = { primary: 'npm run typecheck', fallbacks: ['npm test'] }
  assert.equal(nextVerifyFallback('echo hello', hint, []), null)
})

test('mcpClient and toolAgent wire HTTP + auto fallback', async () => {
  const mcp = await readFile(join(__dirname, '../electron/main/mcpClient.ts'), 'utf8')
  assert.match(mcp, /export class McpHttpSession/)
  assert.match(mcp, /normalizeMcpServerRow/)
  assert.match(mcp, /parseMcpHttpResponseBody/)

  const agent = await readFile(join(__dirname, '../electron/main/toolAgent.ts'), 'utf8')
  assert.match(agent, /nextVerifyFallback/)
  assert.match(agent, /auto_fallback/)

  const tools = await readFile(join(__dirname, '../electron/main/workspaceTools.ts'), 'utf8')
  assert.match(tools, /export function nextVerifyFallback/)
})

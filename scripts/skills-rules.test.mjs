import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function parseMarkdownFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { meta: {}, body: content }
  const meta = {}
  for (const line of match[1].split(/\r?\n/)) {
    const row = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!row) continue
    meta[row[1]] = row[2].trim().replace(/^["']|["']$/g, '')
  }
  return { meta, body: match[2] }
}

test('sample skill has Cursor-compatible frontmatter', async () => {
  const skillPath = join(
    __dirname,
    '../.saforall/skills/saforall-workflow/SKILL.md'
  )
  const raw = await readFile(skillPath, 'utf8')
  const { meta, body } = parseMarkdownFrontmatter(raw)
  assert.equal(meta.name, 'saforall-workflow')
  assert.ok(meta.description)
  assert.match(body, /edit_file/)
})

test('skills / rules wiring present in sources', async () => {
  const tools = await readFile(join(__dirname, '../electron/main/workspaceTools.ts'), 'utf8')
  assert.match(tools, /export async function listProjectSkills/)
  assert.match(tools, /export async function readProjectSkill/)
  assert.match(tools, /export async function formatSkillsCatalog/)
  assert.match(tools, /\.saforall\/rules/)
  assert.match(tools, /\.saforall\/skills/)

  const agent = await readFile(join(__dirname, '../electron/main/toolAgent.ts'), 'utf8')
  assert.match(agent, /name: 'read_skill'/)
  assert.match(agent, /formatSkillsCatalog/)

  const index = await readFile(join(__dirname, '../electron/main/index.ts'), 'utf8')
  assert.match(index, /skills:list/)
  assert.match(index, /skills:read/)
  assert.match(index, /skills:catalog/)

  const preload = await readFile(join(__dirname, '../electron/preload/index.ts'), 'utf8')
  assert.match(preload, /listSkills:/)
  assert.match(preload, /skillsCatalog:/)

  const mentions = await readFile(join(__dirname, '../src/lib/chatMentions.ts'), 'utf8')
  assert.match(mentions, /special:skills/)
  assert.match(mentions, /@skills/)

  const panel = await readFile(join(__dirname, '../src/components/RulesPanel.tsx'), 'utf8')
  assert.match(panel, /Rules \/ Memories \/ Skills/)
  assert.match(panel, /listSkills/)

  const router = await readFile(join(__dirname, '../electron/main/localAiRouter.ts'), 'utf8')
  assert.match(router, /context\.rules/)
  assert.match(router, /context\.skills/)

  const php = await readFile(join(__dirname, '../server/src/ChatService.php'), 'utf8')
  assert.match(php, /\$context\['skills'\]/)
})

test('frontmatter parser extracts name/description', () => {
  const { meta, body } = parseMarkdownFrontmatter(
    '---\nname: demo\ndescription: hello world\n---\n\n# Body\n'
  )
  assert.equal(meta.name, 'demo')
  assert.equal(meta.description, 'hello world')
  assert.match(body, /# Body/)
})

test('temp skill layout mirrors Cursor skills dirs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'saforall-skills-'))
  const skillDir = join(root, '.saforall', 'skills', 'demo-skill')
  await mkdir(skillDir, { recursive: true })
  await writeFile(
    join(skillDir, 'SKILL.md'),
    '---\nname: demo-skill\ndescription: test skill\n---\n\nDo the thing.\n',
    'utf8'
  )
  const raw = await readFile(join(skillDir, 'SKILL.md'), 'utf8')
  const { meta } = parseMarkdownFrontmatter(raw)
  assert.equal(meta.name, 'demo-skill')
})

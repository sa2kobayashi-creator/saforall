import assert from 'node:assert/strict'
import test from 'node:test'

test('agent mode banner copy distinguishes tool execution', () => {
  const ask = '説明・提案が中心。コードは差分確認してから適用します。'
  const agent = 'ツール必須（plan → explore → edit_file → run_shell）。文章だけで終わらず Composer に載せます。'
  assert.match(ask, /確認/)
  assert.match(agent, /edit_file/)
  assert.match(agent, /Composer/)
})

test('prose-only block message requires edit_file', () => {
  const msg =
    'システム: Agent モードでは説明や markdown コード提示だけでは終了できません。必ずツールを呼び出してください（set_phase → read_file/search_code → edit_file）。edit_file なしの「修正案の説明」は無効です。'
  assert.match(msg, /edit_file/)
  assert.match(msg, /ツール/)
})

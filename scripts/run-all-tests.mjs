#!/usr/bin/env node
/**
 * Runs the project unit/integration script suite (after typecheck via npm script).
 * Keep this list in sync when adding scripts/*.test.mjs to CI.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const tests = [
  'scripts/workspace-tools.test.mjs',
  'scripts/problems.test.mjs',
  'scripts/codebase-mentions.test.mjs',
  'scripts/agent-verify.test.mjs',
  'scripts/agent-mode.test.mjs',
  'scripts/gh-pr.test.mjs',
  'scripts/gh-auth.test.mjs',
  'scripts/apply-proposals.test.mjs',
  'scripts/background-jobs.test.mjs',
  'scripts/codebase-rank.test.mjs',
  'scripts/tab-lsp.test.mjs',
  'scripts/cursor-cloud.test.mjs',
  'scripts/debug-extras.test.mjs',
  'scripts/mcp-http-verify.test.mjs',
  'scripts/bugbot-review.test.mjs',
  'scripts/rules-jobs-inlay-bb.test.mjs',
  'scripts/skills-rules.test.mjs',
  'scripts/next-four-slices.test.mjs',
  'scripts/packaging-daily.test.mjs',
  'scripts/scm-daily-ide.test.mjs',
  'scripts/autosave-history-ide.test.mjs',
  'scripts/io-hardening.test.mjs',
  'scripts/cursor-gap-ide.test.mjs',
  'scripts/editor-nav-ide.test.mjs',
  'scripts/signature-conflict-docs.test.mjs',
  'scripts/ai-router-claude.test.mjs',
  'scripts/budget-preestimate-plan.test.mjs',
  'scripts/claude-agent-codex.test.mjs',
  'scripts/router-insight-ui.test.mjs',
  'scripts/offline-chat-ux.test.mjs',
  'scripts/local-offline-stack.test.mjs',
  'scripts/local-persistence.test.mjs',
  'scripts/local-settings-ux.test.mjs',
  'scripts/ux-polish-batch.test.mjs',
  'scripts/ui-batch-seven.test.mjs',
  'scripts/agent-context-attach.test.mjs',
  'scripts/feedback-loop.test.mjs',
  'scripts/router-classify-context.test.mjs',
  'scripts/router-categories.test.mjs',
  'scripts/chat-cancel.test.mjs',
  'scripts/chat-latency.test.mjs',
  'scripts/session-heal.test.mjs',
  'scripts/edit-guards.test.mjs',
  'scripts/editor-perf.test.mjs',
  'scripts/editor-quality-batch.test.mjs',
  'scripts/chat-attachments.test.mjs',
  'scripts/chat-images.test.mjs',
  'scripts/chat-edit-resubmit.test.mjs',
  'scripts/chat-always-reply.test.mjs',
  'scripts/auto-credit-fallback.test.mjs',
  'scripts/claude-prepaid.test.mjs',
  'scripts/ai-foundation.test.mjs',
  'scripts/ai-tool-adapter.test.mjs',
  'scripts/ai-byok.test.mjs',
  'scripts/ai-byok-phase-2b2.test.mjs',
  'scripts/ai-byok-phase-2b31.test.mjs',
  'scripts/ai-usage-credential-ui.test.mjs'
]

const result = spawnSync(process.execPath, ['--test', ...tests], {
  cwd: root,
  stdio: 'inherit',
  env: process.env
})

process.exit(result.status ?? 1)

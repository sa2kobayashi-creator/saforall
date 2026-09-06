/** Local mirror of server AiRouter::classify / engineForTask (heuristic). */

export type RouterTaskType =
  | 'light_qa'
  | 'summarize'
  | 'explain'
  | 'codegen'
  | 'design'
  | 'patch_multi'
  | 'repo_analysis'
  | 'test_fix'
  | 'long_dev'
  | 'patch_small'

function matches(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase()
  return needles.some((needle) => needle !== '' && lower.includes(needle.toLowerCase()))
}

export function buildClassifyCorpus(
  message: string,
  context: Record<string, unknown> | null | undefined
): string {
  const parts = [message]
  if (!context) return message

  const selection =
    typeof context.selection === 'object' && context.selection !== null
      ? (context.selection as Record<string, unknown>)
      : null
  if (selection && typeof selection.text === 'string' && selection.text.trim()) {
    parts.push('selection_present')
    parts.push(selection.text.slice(0, 500))
  }

  if (Array.isArray(context.problems) && context.problems.length > 0) {
    const joined = context.problems.slice(0, 20).map(String).join('\n')
    parts.push('problems_present')
    parts.push(joined)
    if (/\berror\b|severity:\s*error|❌/i.test(joined)) {
      parts.push('problems_have_errors')
    }
  }

  if (Array.isArray(context.files) && context.files.length >= 2) {
    parts.push('multi_file_context')
  }

  if (
    typeof context.index_summary === 'string' &&
    context.index_summary.trim().length > 200
  ) {
    parts.push('codebase_context')
  }

  return parts.join('\n')
}

export function classifyTask(
  message: string,
  context?: Record<string, unknown> | null,
  options?: { workersMaxChars?: number; fixWordsToCursor?: boolean }
): RouterTaskType {
  const corpus = buildClassifyCorpus(message, context)
  const text = corpus.toLowerCase()
  const workersMax = options?.workersMaxChars ?? 200
  const fixToCursor = Boolean(options?.fixWordsToCursor)

  if (
    matches(text, [
      'テストして',
      'テストを通',
      '失敗するまで',
      'test and fix',
      'make tests pass',
      '型エラー',
      'type error',
      'typecheck',
      'tsc ',
      'compile error',
      'ビルドエラー'
    ])
  ) {
    return 'test_fix'
  }
  if (matches(text, ['時間かけて', 'じっくり', 'long running', 'thorough', '大規模リファクタ'])) {
    return 'long_dev'
  }
  if (
    matches(text, [
      '複数ファイル',
      '一式',
      'ログイン全体',
      'リファクタ',
      'refactor',
      'across files',
      'multi_file_context',
      'まとめて直',
      '一括で直'
    ])
  ) {
    return 'patch_multi'
  }
  if (
    matches(text, [
      'リポジトリ',
      'コードベース全体',
      'プロジェクト全体',
      'analyze repo',
      'codebase_context'
    ])
  ) {
    return 'repo_analysis'
  }

  if (
    fixToCursor &&
    matches(text, [
      '直して',
      'なおして',
      '修正して',
      'バグ',
      '実装して',
      'fix',
      'implement',
      'バグを直',
      'エラーを直',
      'problems_have_errors'
    ])
  ) {
    return 'patch_small'
  }
  if (
    !fixToCursor &&
    matches(text, [
      '直して',
      'なおして',
      '修正して',
      'バグを直',
      'fix this',
      'fix bug',
      'fix the',
      'バグ',
      'エラーを',
      '直す',
      '直し',
      '実装して',
      '実装する',
      '追加して',
      'problems_have_errors',
      'selection_present'
    ])
  ) {
    return 'codegen'
  }

  if (
    matches(text, [
      '設計',
      'アーキテクチャ',
      '方針',
      'architecture',
      'design',
      'レビューして',
      'code review'
    ])
  ) {
    return 'design'
  }
  if (
    matches(text, [
      '説明して',
      '何をしている',
      'なぜ',
      'explain',
      'what does',
      'どう動く',
      '仕組み'
    ])
  ) {
    return 'explain'
  }
  if (
    matches(text, [
      '要約',
      '翻訳',
      '短く',
      'ドキュメント',
      'コメントを書いて',
      'summarize',
      'translate',
      'docs'
    ])
  ) {
    return 'summarize'
  }
  if (
    message.includes('```') ||
    matches(text, ['コードを書いて', '生成して', '実装して', 'write code', 'implement', '書いて'])
  ) {
    return 'codegen'
  }

  if (message.trim().length < workersMax) return 'light_qa'
  return 'explain'
}

export function engineForTask(taskType: RouterTaskType, mode: string): 'openai' | 'gemini' | 'claude' {
  if (mode === 'agent' && (taskType === 'light_qa' || taskType === 'summarize')) {
    return 'openai'
  }
  switch (taskType) {
    case 'light_qa':
    case 'summarize':
      return 'gemini'
    case 'design':
    case 'patch_multi':
    case 'repo_analysis':
    case 'test_fix':
    case 'long_dev':
      return 'claude'
    case 'codegen':
    case 'patch_small':
    case 'explain':
    default:
      return 'openai'
  }
}

/** Agent Auto: tool-capable engines only, Claude first when preferred. */
export function agentPreferenceChain(preferred: string): Array<'openai' | 'claude'> {
  if (preferred === 'claude') return ['claude', 'openai']
  return ['openai', 'claude']
}

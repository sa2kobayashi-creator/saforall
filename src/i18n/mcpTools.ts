import type { Locale } from './messages'

type McpToolLocale = {
  label: string
  description: string
}

/** Known MCP filesystem-server tools (English names stay for Agent calls). */
const MCP_JA: Record<string, McpToolLocale> = {
  read_file: {
    label: 'ファイルを読む',
    description: '指定パスのファイル内容を読み取ります（テキスト向けの別名あり）。'
  },
  read_text_file: {
    label: 'テキストファイルを読む',
    description: 'テキストファイルの内容を読み取ります。'
  },
  read_media_file: {
    label: 'メディアファイルを読む',
    description: '画像などのメディアファイルを読み取ります。'
  },
  read_multiple_files: {
    label: '複数ファイルを読む',
    description: '複数パスのファイル内容をまとめて読み取ります。'
  },
  write_file: {
    label: 'ファイルに書き込む',
    description: 'ファイルを新規作成、または内容を上書きします。'
  },
  edit_file: {
    label: 'ファイルを編集する',
    description: '既存ファイルの一部を編集・置換します。'
  },
  create_directory: {
    label: 'ディレクトリを作成',
    description: '新しいフォルダを作成します。'
  },
  list_directory: {
    label: 'ディレクトリ一覧',
    description: 'フォルダ内のファイルとサブフォルダを一覧します。'
  },
  list_directory_with_sizes: {
    label: 'サイズ付きディレクトリ一覧',
    description: 'フォルダ内容をファイルサイズ付きで一覧します。'
  },
  directory_tree: {
    label: 'ディレクトリツリー',
    description: 'フォルダ構造をツリー形式で取得します。'
  },
  move_file: {
    label: 'ファイルを移動',
    description: 'ファイルまたはフォルダを移動・リネームします。'
  },
  search_files: {
    label: 'ファイルを検索',
    description: 'パターンに一致するファイルを検索します。'
  },
  get_file_info: {
    label: 'ファイル情報',
    description: 'サイズや更新日時などメタ情報を取得します。'
  },
  list_allowed_directories: {
    label: '許可ディレクトリ一覧',
    description: 'この MCP サーバーがアクセスできるルートを表示します。'
  }
}

export function localizeMcpTool(
  locale: Locale,
  name: string,
  fallbackDescription?: string
): { title: string; description?: string } {
  if (locale !== 'ja') {
    return {
      title: name,
      description: fallbackDescription
    }
  }
  const row = MCP_JA[name]
  if (!row) {
    return {
      title: name,
      description: fallbackDescription
    }
  }
  return {
    title: `${row.label} · ${name}`,
    description: row.description || fallbackDescription
  }
}

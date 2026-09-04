import { useMemo } from 'react'
import { marked } from 'marked'
import './PreviewPane.css'

type Props = {
  language: string
  content: string
  fileName?: string
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildPreviewDocument(bodyHtml: string, title: string): string {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      padding: 20px 28px 40px;
      font-family: "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif;
      font-size: 14px;
      line-height: 1.65;
      color: #e6edf3;
      background: #0d1117;
    }
    h1, h2, h3, h4 { line-height: 1.3; margin: 1.2em 0 0.5em; }
    h1 { font-size: 1.7rem; border-bottom: 1px solid #30363d; padding-bottom: 0.3em; }
    h2 { font-size: 1.35rem; border-bottom: 1px solid #30363d; padding-bottom: 0.25em; }
    a { color: #58a6ff; }
    code {
      font-family: Cascadia Code, Consolas, monospace;
      background: #161b22;
      padding: 0.15em 0.4em;
      border-radius: 4px;
      font-size: 0.92em;
    }
    pre {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 12px 14px;
      overflow: auto;
    }
    pre code { background: transparent; padding: 0; }
    blockquote {
      margin: 0.8em 0;
      padding: 0.2em 1em;
      border-left: 3px solid #3d444d;
      color: #9aa4b2;
    }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    th, td { border: 1px solid #30363d; padding: 6px 10px; }
    th { background: #161b22; }
    img { max-width: 100%; }
    ul, ol { padding-left: 1.4em; }
    hr { border: none; border-top: 1px solid #30363d; margin: 1.5em 0; }
  </style>
</head>
<body>${bodyHtml}</body>
</html>`
}

function toPreviewHtml(language: string, content: string): string {
  const lower = language.toLowerCase()
  if (lower === 'html') {
    // Keep author HTML but strip script/event handlers roughly for safety;
    // final isolation is iframe sandbox (no scripts).
    return content
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  }

  const parsed = marked.parse(content, { async: false, gfm: true, breaks: false })
  return typeof parsed === 'string' ? parsed : String(parsed)
}

export function supportsPreview(language: string, path?: string | null): boolean {
  const lower = (language || '').toLowerCase()
  if (lower === 'markdown' || lower === 'html') return true
  const name = (path || '').toLowerCase()
  return name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.html') || name.endsWith('.htm')
}

export function PreviewPane({ language, content, fileName = 'preview' }: Props) {
  const srcDoc = useMemo(() => {
    const body = toPreviewHtml(language, content)
    return buildPreviewDocument(body, fileName)
  }, [language, content, fileName])

  return (
    <div className="preview-pane">
      <iframe
        className="preview-frame"
        title={`Preview: ${fileName}`}
        sandbox=""
        srcDoc={srcDoc}
      />
    </div>
  )
}

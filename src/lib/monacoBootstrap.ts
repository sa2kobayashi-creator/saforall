import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import 'monaco-editor/min/vs/editor/editor.main.css'

/**
 * This module pulls in all of monaco-editor, so it must only ever be reached
 * through the dynamic import in monacoSetup.ts. Importing it statically puts
 * several megabytes back into the entry chunk and blocks first paint even on
 * the welcome screen. See monacoSetup.ts for the entry point.
 *
 * Electron CSP (script-src 'self') blocks the default CDN loader used by
 * @monaco-editor/react, so monaco is bundled locally and workers are wired
 * through Vite.
 */
export async function bootstrapMonaco(): Promise<void> {
  ;(globalThis as typeof globalThis & {
    MonacoEnvironment?: {
      getWorker: (workerId: string, label: string) => Worker
    }
  }).MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      if (label === 'json') return new jsonWorker()
      if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
      if (label === 'typescript' || label === 'javascript') return new tsWorker()
      return new editorWorker()
    }
  }

  loader.config({ monaco })
  await loader.init()
}

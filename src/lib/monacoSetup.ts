import { useEffect, useState } from 'react'

/**
 * Monaco is a multi-megabyte dependency. Loading it from the entry chunk cost
 * the same startup time whether or not the user ever opened a file, so it now
 * lives behind a dynamic import that only editor-bearing components trigger.
 */

let readyPromise: Promise<void> | null = null
let ready = false

export function isMonacoReady(): boolean {
  return ready
}

/** Idempotent: concurrent callers share one load. */
export function setupMonaco(): Promise<void> {
  if (!readyPromise) {
    readyPromise = import('./monacoBootstrap')
      .then((module) => module.bootstrapMonaco())
      .then(() => {
        ready = true
      })
      .catch((error) => {
        // Allow a later mount to retry instead of wedging the editor forever.
        readyPromise = null
        throw error
      })
  }
  return readyPromise
}

/**
 * Components that render a Monaco editor call this and hold a placeholder until
 * it returns true. Mounting `<Editor>` before `loader.config` runs would make
 * @monaco-editor/react fall back to its CDN loader, which Electron's CSP blocks.
 */
export function useMonacoReady(): boolean {
  const [loaded, setLoaded] = useState(ready)

  useEffect(() => {
    if (loaded) return
    let cancelled = false
    void setupMonaco().then(
      () => {
        if (!cancelled) setLoaded(true)
      },
      () => undefined
    )
    return () => {
      cancelled = true
    }
  }, [loaded])

  return loaded
}

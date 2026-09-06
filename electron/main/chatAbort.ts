/** Active chat stream abort controllers (Main process). */

const controllers = new Map<string, AbortController>()

export function beginChatAbort(requestId: string): AbortSignal {
  cancelChatAbort(requestId)
  const controller = new AbortController()
  controllers.set(requestId, controller)
  return controller.signal
}

export function cancelChatAbort(requestId: string): boolean {
  const controller = controllers.get(requestId)
  if (!controller) return false
  if (!controller.signal.aborted) {
    controller.abort()
  }
  controllers.delete(requestId)
  return true
}

export function endChatAbort(requestId: string): void {
  controllers.delete(requestId)
}

export function isChatAbortError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof Error) {
    if (error.name === 'AbortError') return true
    if (/aborted|abort|cancelled|canceled/i.test(error.message)) return true
  }
  return false
}

export function throwIfChatAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) {
    const err = new Error('Chat cancelled by user')
    err.name = 'AbortError'
    throw err
  }
}

/** Combine timeout + optional outer abort into one signal. */
export function linkedAbortSignal(
  timeoutMs: number,
  outer?: AbortSignal | null
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onOuter = () => controller.abort()
  if (outer) {
    if (outer.aborted) controller.abort()
    else outer.addEventListener('abort', onOuter, { once: true })
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer)
      if (outer) outer.removeEventListener('abort', onOuter)
    }
  }
}

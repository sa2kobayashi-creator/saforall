/** Active chat stream abort controllers (Main process). */

const controllers = new Map<string, AbortController>()
/** Cancel requested before beginChatAbort (e.g. during renderer context prep). */
const pendingCancelIds = new Set<string>()

export function beginChatAbort(requestId: string): AbortSignal {
  const existing = controllers.get(requestId)
  if (existing) {
    return existing.signal
  }
  const controller = new AbortController()
  if (pendingCancelIds.has(requestId)) {
    pendingCancelIds.delete(requestId)
    controller.abort()
  }
  controllers.set(requestId, controller)
  return controller.signal
}

export function cancelChatAbort(requestId: string): boolean {
  const id = String(requestId || '')
  if (!id) return false
  const controller = controllers.get(id)
  if (controller) {
    if (!controller.signal.aborted) {
      controller.abort()
    }
    return true
  }
  // Stream not started yet — remember so beginChatAbort aborts immediately.
  pendingCancelIds.add(id)
  return true
}

export function endChatAbort(requestId: string): void {
  const id = String(requestId || '')
  controllers.delete(id)
  pendingCancelIds.delete(id)
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

export type DebugCallFrame = {
  functionName: string
  url: string
  lineNumber: number
  columnNumber: number
  callFrameId?: string
}

export type DebugVariable = {
  name: string
  value: string
  type?: string
}

export type DebugBreakpointEntry = {
  line: number
  condition?: string
}

/** path -> breakpoint entries */
export type DebugBreakpointMap = Record<string, DebugBreakpointEntry[]>

export type DebugCallFrame = {
  functionName: string
  url: string
  lineNumber: number
  columnNumber: number
}

export type DebugBreakpointMap = Record<string, number[]>

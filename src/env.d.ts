/// <reference types="vite/client" />

import type { SaforallApi } from '../electron/preload/index'

declare global {
  interface Window {
    saforall: SaforallApi
  }
}

export {}

export type ExtensionPermission =
  | 'terminal.run'
  | 'terminal.run.dangerous'
  | 'fs.read'
  | 'fs.write'
  | 'network'

export type ExtensionCommand = {
  id: string
  title: string
  run: string
  /** Optional override; otherwise inferred from run string */
  permissions?: ExtensionPermission[]
}

export type WorkspaceExtension = {
  id: string
  name: string
  description?: string
  /** When false, commands are hidden / blocked in UI */
  enabled?: boolean
  permissions?: ExtensionPermission[]
  commands: ExtensionCommand[]
}

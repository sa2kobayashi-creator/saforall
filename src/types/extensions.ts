export type ExtensionCommand = {
  id: string
  title: string
  run: string
}

export type WorkspaceExtension = {
  id: string
  name: string
  description?: string
  commands: ExtensionCommand[]
}

import { BrowserWindow, Menu, shell } from 'electron'

export type MenuCommand =
  | 'workspace:open'
  | 'file:save'
  | 'view:explorer'
  | 'view:scm'
  | 'view:terminal'
  | 'view:problems'
  | 'view:chat'
  | 'view:settings'
  | 'git:clone'
  | 'git:refresh'
  | 'git:pull'
  | 'git:push'

function send(command: MenuCommand): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  win?.webContents.send('menu:command', command)
}

export function setupApplicationMenu(): void {
  const isMac = process.platform === 'darwin'

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: 'saforall',
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder…',
          accelerator: 'CmdOrCtrl+O',
          click: () => send('workspace:open')
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => send('file:save')
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Explorer',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => send('view:explorer')
        },
        {
          label: 'Source Control',
          accelerator: 'CmdOrCtrl+Shift+G',
          click: () => send('view:scm')
        },
        { type: 'separator' },
        {
          label: 'Toggle Terminal',
          accelerator: 'Ctrl+`',
          click: () => send('view:terminal')
        },
        {
          label: 'Problems',
          accelerator: 'CmdOrCtrl+Shift+M',
          click: () => send('view:problems')
        },
        {
          label: 'Toggle AI Chat',
          accelerator: 'CmdOrCtrl+L',
          click: () => send('view:chat')
        },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => send('view:settings')
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Terminal',
      submenu: [
        {
          label: 'New Terminal',
          accelerator: 'Ctrl+Shift+`',
          click: () => send('view:terminal')
        }
      ]
    },
    {
      label: 'Git',
      submenu: [
        {
          label: 'Clone Repository…',
          click: () => send('git:clone')
        },
        {
          label: 'Refresh Status',
          click: () => send('git:refresh')
        },
        { type: 'separator' },
        {
          label: 'Pull',
          click: () => send('git:pull')
        },
        {
          label: 'Push',
          click: () => send('git:push')
        },
        {
          label: 'Show Source Control',
          click: () => send('view:scm')
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Documentation',
          click: () => {
            void shell.openExternal(
              'https://github.com/sa2kobayashi-creator/saforall'
            )
          }
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

import { BrowserWindow, Menu } from 'electron'

export type MenuCommand =
  | 'workspace:open'
  | 'workspace:close'
  | 'file:save'
  | 'view:explorer'
  | 'view:scm'
  | 'view:terminal'
  | 'view:problems'
  | 'view:chat'
  | 'view:settings'
  | 'view:usage'
  | 'view:usage-right'
  | 'view:usage-overlay'
  | 'view:usage-hidden'
  | 'git:clone'
  | 'git:refresh'
  | 'git:pull'
  | 'git:push'
  | 'run:file'
  | 'run:file-inspect'
  | 'run:npm-start'
  | 'debug:continue'
  | 'debug:stepOver'
  | 'debug:stop'
  | 'view:debug'
  | 'view:extensions'
  | 'edit:inline'
  | 'help:welcome'
  | 'help:docs'
  | 'help:shortcuts'
  | 'help:report'
  | 'help:license'
  | 'help:about'

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
          label: 'Close Folder',
          click: () => send('workspace:close')
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
        { type: 'separator' },
        {
          label: 'Inline Edit Selection',
          accelerator: 'CmdOrCtrl+K',
          click: () => send('edit:inline')
        },
        { type: 'separator' },
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
          label: 'AI Usage',
          accelerator: 'CmdOrCtrl+Shift+U',
          click: () => send('view:usage')
        },
        {
          label: 'Usage Layout',
          submenu: [
            {
              label: 'Dock Right',
              click: () => send('view:usage-right')
            },
            {
              label: 'Overlay',
              click: () => send('view:usage-overlay')
            },
            {
              label: 'Hide',
              click: () => send('view:usage-hidden')
            }
          ]
        },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => send('view:settings')
        },
        {
          label: 'Extensions',
          accelerator: 'CmdOrCtrl+Shift+X',
          click: () => send('view:extensions')
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Run',
      submenu: [
        {
          label: 'Run Current File',
          accelerator: 'F5',
          click: () => send('run:file')
        },
        {
          label: 'Start Debugging',
          accelerator: 'Shift+F5',
          click: () => send('run:file-inspect')
        },
        {
          label: 'Continue',
          accelerator: 'F8',
          click: () => send('debug:continue')
        },
        {
          label: 'Step Over',
          accelerator: 'F10',
          click: () => send('debug:stepOver')
        },
        {
          label: 'Stop Debugging',
          accelerator: 'Shift+F8',
          click: () => send('debug:stop')
        },
        {
          label: 'Show Debug Panel',
          click: () => send('view:debug')
        },
        { type: 'separator' },
        {
          label: 'npm start',
          click: () => send('run:npm-start')
        }
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
          label: 'Welcome',
          click: () => send('help:welcome')
        },
        {
          label: 'Documentation',
          click: () => send('help:docs')
        },
        {
          label: 'Keyboard Shortcuts Reference',
          accelerator: 'F1',
          click: () => send('help:shortcuts')
        },
        { type: 'separator' },
        {
          label: 'Extensions Folder Tips',
          click: () => send('view:extensions')
        },
        {
          label: 'Report Issue…',
          click: () => send('help:report')
        },
        {
          label: 'View License',
          click: () => send('help:license')
        },
        { type: 'separator' },
        {
          label: 'About saforall',
          click: () => send('help:about')
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

import { BrowserWindow, Menu } from 'electron'
import { menuLabels, type MenuLocale } from './menuI18n'

export type MenuCommand =
  | 'workspace:open'
  | 'workspace:close'
  | 'file:save'
  | 'view:explorer'
  | 'view:search'
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
  | 'view:commands'
  | 'terminal:new'
  | 'go:symbolInFile'
  | 'go:workspaceSymbol'
  | 'go:peekDefinition'
  | 'go:peekReferences'
  | 'view:splitEditor'
  | 'edit:inline'
  | 'agent:bugbot'
  | 'agent:background'
  | 'help:welcome'
  | 'help:docs'
  | 'help:shortcuts'
  | 'help:report'
  | 'help:license'
  | 'help:about'

let currentLocale: MenuLocale = 'ja'

function send(command: MenuCommand): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  win?.webContents.send('menu:command', command)
}

export function setupApplicationMenu(locale: MenuLocale = currentLocale): void {
  currentLocale = locale === 'en' ? 'en' : 'ja'
  const L = menuLabels(currentLocale)
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
      label: L.file,
      submenu: [
        {
          label: L.openFolder,
          accelerator: 'CmdOrCtrl+O',
          click: () => send('workspace:open')
        },
        {
          label: L.closeFolder,
          click: () => send('workspace:close')
        },
        {
          label: L.save,
          accelerator: 'CmdOrCtrl+S',
          click: () => send('file:save')
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: L.edit,
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        {
          label: L.inlineEdit,
          accelerator: 'CmdOrCtrl+K',
          click: () => send('edit:inline')
        },
        {
          label: L.goSymbolInFile,
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => send('go:symbolInFile')
        },
        {
          label: L.goWorkspaceSymbol,
          accelerator: 'CmdOrCtrl+T',
          click: () => send('go:workspaceSymbol')
        },
        {
          label: L.peekDefinition,
          accelerator: 'Alt+F12',
          click: () => send('go:peekDefinition')
        },
        {
          label: L.peekReferences,
          accelerator: 'Shift+Alt+F12',
          click: () => send('go:peekReferences')
        },
        { type: 'separator' },
        {
          label: L.bugbot,
          click: () => send('agent:bugbot')
        },
        {
          label: L.backgroundAgent,
          click: () => send('agent:background')
        },
        { type: 'separator' },
        { role: 'selectAll' }
      ]
    },
    {
      label: L.view,
      submenu: [
        {
          label: L.explorer,
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => send('view:explorer')
        },
        {
          label: L.search,
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => send('view:search')
        },
        {
          label: L.scm,
          accelerator: 'CmdOrCtrl+Shift+G',
          click: () => send('view:scm')
        },
        { type: 'separator' },
        {
          label: L.toggleTerminal,
          accelerator: 'Ctrl+`',
          click: () => send('view:terminal')
        },
        {
          label: L.commandPalette,
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => send('view:commands')
        },
        {
          label: L.problems,
          accelerator: 'CmdOrCtrl+Shift+M',
          click: () => send('view:problems')
        },
        {
          label: L.toggleChat,
          accelerator: 'CmdOrCtrl+L',
          click: () => send('view:chat')
        },
        {
          label: L.aiUsage,
          accelerator: 'CmdOrCtrl+Shift+U',
          click: () => send('view:usage')
        },
        {
          label: L.usageLayout,
          submenu: [
            {
              label: L.dockRight,
              click: () => send('view:usage-right')
            },
            {
              label: L.overlay,
              click: () => send('view:usage-overlay')
            },
            {
              label: L.hide,
              click: () => send('view:usage-hidden')
            }
          ]
        },
        {
          label: L.settings,
          accelerator: 'CmdOrCtrl+,',
          click: () => send('view:settings')
        },
        {
          label: L.extensions,
          accelerator: 'CmdOrCtrl+Shift+X',
          click: () => send('view:extensions')
        },
        {
          label: L.splitEditor,
          accelerator: 'CmdOrCtrl+\\',
          click: () => send('view:splitEditor')
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: L.run,
      submenu: [
        {
          label: L.runFile,
          accelerator: 'F5',
          click: () => send('run:file')
        },
        {
          label: L.startDebug,
          accelerator: 'Shift+F5',
          click: () => send('run:file-inspect')
        },
        {
          label: L.continue,
          accelerator: 'F8',
          click: () => send('debug:continue')
        },
        {
          label: L.stepOver,
          accelerator: 'F10',
          click: () => send('debug:stepOver')
        },
        {
          label: L.stopDebug,
          accelerator: 'Shift+F8',
          click: () => send('debug:stop')
        },
        {
          label: L.showDebug,
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
      label: L.terminal,
      submenu: [
        {
          label: L.newTerminal,
          accelerator: 'Ctrl+Shift+`',
          click: () => send('terminal:new')
        }
      ]
    },
    {
      label: L.git,
      submenu: [
        {
          label: L.clone,
          click: () => send('git:clone')
        },
        {
          label: L.refreshGit,
          click: () => send('git:refresh')
        },
        { type: 'separator' },
        {
          label: L.pull,
          click: () => send('git:pull')
        },
        {
          label: L.push,
          click: () => send('git:push')
        },
        {
          label: L.showScm,
          click: () => send('view:scm')
        }
      ]
    },
    {
      label: L.help,
      submenu: [
        {
          label: L.welcome,
          click: () => send('help:welcome')
        },
        {
          label: L.docs,
          click: () => send('help:docs')
        },
        {
          label: L.shortcuts,
          accelerator: 'F1',
          click: () => send('help:shortcuts')
        },
        { type: 'separator' },
        {
          label: L.extensionsTips,
          click: () => send('view:extensions')
        },
        {
          label: L.report,
          click: () => send('help:report')
        },
        {
          label: L.license,
          click: () => send('help:license')
        },
        { type: 'separator' },
        {
          label: L.about,
          click: () => send('help:about')
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

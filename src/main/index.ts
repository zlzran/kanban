import { dirname, extname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import {
  addQuickInboxCard,
  closeStorage,
  createDatabase,
  getDatabaseInfo,
  initializeStorage,
  loadBoardState,
  saveBoardState,
  selectExistingDatabase,
  switchDatabase
} from './storage'

app.setName('Vistask')

let mainWindow: BrowserWindow | null = null
let quickInboxWindow: BrowserWindow | null = null
let currentInboxShortcut = 'CommandOrControl+Shift+I'
const appIconPath = join(app.getAppPath(), 'build/icon.png')
type DockFocusState = 'none' | 'running' | 'paused'

function setDockFocusMenu(state: DockFocusState): void {
  if (process.platform !== 'darwin' || !app.dock) return
  const template = state === 'running'
    ? [{ label: '暂停推进', click: () => performDockFocusAction('pause') }]
    : state === 'paused'
      ? [{ label: '继续推进', click: () => performDockFocusAction('resume') }]
      : []
  app.dock.setMenu(Menu.buildFromTemplate(template))
}

function performDockFocusAction(action: 'pause' | 'resume'): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('focus:dock-action', action)
    setDockFocusMenu(action === 'pause' ? 'paused' : 'running')
    return
  }
  const state = loadBoardState()
  if (!state.focus) { setDockFocusMenu('none'); return }
  const now = Date.now()
  if (action === 'pause' && state.focus.running) {
    state.focus = { ...state.focus, remainingMs: Math.max(0, state.focus.endsAt - now), running: false }
  } else if (action === 'resume' && !state.focus.running) {
    const remainingMs = Math.max(0, state.focus.remainingMs)
    state.focus = { ...state.focus, startedAt: now, endsAt: now + remainingMs, remainingMs, running: true }
  } else return
  saveBoardState(state)
  setDockFocusMenu(state.focus.running ? 'running' : 'paused')
}

function registerInboxShortcut(accelerator: string): { success: boolean; error?: string } {
  if (accelerator === currentInboxShortcut && globalShortcut.isRegistered(accelerator)) return { success: true }
  const previous = currentInboxShortcut
  if (previous) globalShortcut.unregister(previous)
  const success = globalShortcut.register(accelerator, openInbox)
  if (success) {
    currentInboxShortcut = accelerator
    return { success: true }
  }
  if (previous) globalShortcut.register(previous, openInbox)
  return { success: false, error: '该快捷键已被其他应用占用，请换一个组合' }
}

function openInbox(): void {
  if (quickInboxWindow && !quickInboxWindow.isDestroyed()) {
    quickInboxWindow.show()
    quickInboxWindow.focus()
    return
  }
  createQuickInboxWindow()
}

function createQuickInboxWindow(): void {
  quickInboxWindow = new BrowserWindow({
    width: 460,
    height: 340,
    minWidth: 460,
    minHeight: 340,
    maxWidth: 460,
    maxHeight: 340,
    show: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#eef8f6',
    icon: existsSync(appIconPath) ? appIconPath : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  const window = quickInboxWindow
  window.on('ready-to-show', () => {
    window.show()
    window.focus()
    if (process.platform === 'darwin') app.focus({ steal: true })
  })
  window.on('closed', () => { if (quickInboxWindow === window) quickInboxWindow = null })
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}?mode=quick-inbox`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { query: { mode: 'quick-inbox' } })
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 820,
    minWidth: 860,
    minHeight: 620,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#eef8f6',
    icon: existsSync(appIconPath) ? appIconPath : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  const window = mainWindow

  window.on('ready-to-show', () => window.show())
  window.on('closed', () => { if (mainWindow === window) mainWindow = null })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    const currentUrl = window.webContents.getURL()
    if (url !== currentUrl) event.preventDefault()
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.vistask.desktop')
  if (process.platform === 'darwin' && app.dock && existsSync(appIconPath)) {
    const icon = nativeImage.createFromPath(appIconPath)
    if (!icon.isEmpty()) app.dock.setIcon(icon)
  }
  await initializeStorage(app.getPath('userData'))
  const initialState = loadBoardState()
  currentInboxShortcut = initialState.shortcuts.inbox
  registerInboxShortcut(currentInboxShortcut)
  setDockFocusMenu(initialState.focus ? initialState.focus.running ? 'running' : 'paused' : 'none')

  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  ipcMain.handle('app:get-system-info', () => ({
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch
  }))

  ipcMain.handle('app:set-dock-icon', (_event, dataUrl: unknown) => {
    if (process.platform !== 'darwin' || !app.dock) return false
    if (typeof dataUrl !== 'string' || dataUrl.length > 2_000_000) return false
    const icon = dataUrl === ''
      ? nativeImage.createFromPath(is.dev ? appIconPath : join(process.resourcesPath, 'icon.icns'))
      : dataUrl.startsWith('data:image/png;base64,') ? nativeImage.createFromDataURL(dataUrl) : nativeImage.createEmpty()
    if (icon.isEmpty()) return false
    app.dock.setBadge('')
    app.dock.setIcon(icon)
    return true
  })
  ipcMain.handle('focus:set-dock-state', (_event, state: unknown) => {
    if (state !== 'none' && state !== 'running' && state !== 'paused') return false
    setDockFocusMenu(state)
    return true
  })

  ipcMain.handle('shortcut:capture-start', () => {
    if (currentInboxShortcut) globalShortcut.unregister(currentInboxShortcut)
    return true
  })
  ipcMain.handle('shortcut:capture-cancel', () => {
    if (currentInboxShortcut && !globalShortcut.isRegistered(currentInboxShortcut)) {
      return globalShortcut.register(currentInboxShortcut, openInbox)
    }
    return true
  })
  ipcMain.handle('shortcut:set-inbox', (_event, accelerator: unknown) => {
    if (typeof accelerator !== 'string' || accelerator.length > 80) return { success: false, error: '快捷键格式无效' }
    return registerInboxShortcut(accelerator)
  })

  ipcMain.handle('inbox:quick-add', (event, title: unknown, content: unknown) => {
    if (typeof title !== 'string' || typeof content !== 'string') throw new TypeError('快速收件内容格式无效')
    const card = addQuickInboxCard(title, content)
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('inbox:quick-added', card)
    BrowserWindow.fromWebContents(event.sender)?.close()
    return card
  })
  ipcMain.handle('inbox:quick-close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
    return true
  })

  ipcMain.handle('boards:load', () => loadBoardState())
  ipcMain.handle('boards:save', (_event, state: unknown) => {
    const saved = saveBoardState(state)
    const candidate = state as { focus?: { running?: unknown } | null; shortcuts?: { inbox?: unknown } } | null
    const accelerator = candidate?.shortcuts?.inbox
    if (typeof accelerator === 'string' && accelerator) registerInboxShortcut(accelerator)
    setDockFocusMenu(candidate?.focus ? candidate.focus.running === true ? 'running' : 'paused' : 'none')
    return saved
  })

  ipcMain.handle('database:get-info', () => getDatabaseInfo())
  ipcMain.handle('database:create', async () => {
    const current = getDatabaseInfo()
    const result = await dialog.showSaveDialog({
      title: '新建 Vistask 数据库',
      defaultPath: join(dirname(current.path), 'vistask-new.db'),
      buttonLabel: '新建数据库',
      properties: ['createDirectory'],
      filters: [{ name: 'SQLite 数据库', extensions: ['db', 'sqlite', 'sqlite3'] }]
    })
    if (result.canceled || !result.filePath) return null
    const filePath = extname(result.filePath) ? result.filePath : `${result.filePath}.db`
    const state = await createDatabase(filePath)
    return { info: getDatabaseInfo(), state }
  })

  ipcMain.handle('database:choose', async () => {
    const current = getDatabaseInfo()
    const result = await dialog.showOpenDialog({
      title: '选择已有的 Vistask 数据库',
      defaultPath: dirname(current.path),
      buttonLabel: '打开数据库',
      properties: ['openFile'],
      filters: [{ name: 'SQLite 数据库', extensions: ['db', 'sqlite', 'sqlite3'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const state = await selectExistingDatabase(result.filePaths[0])
    return { info: getDatabaseInfo(), state }
  })

  ipcMain.handle('database:use-default', async () => {
    const state = await switchDatabase(getDatabaseInfo().defaultPath)
    return { info: getDatabaseInfo(), state }
  })

  ipcMain.handle('database:reveal', () => {
    shell.showItemInFolder(getDatabaseInfo().path)
    return true
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  closeStorage()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

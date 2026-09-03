import { contextBridge, ipcRenderer } from 'electron'

interface SystemInfo {
  appVersion: string
  electronVersion: string
  nodeVersion: string
  platform: string
  arch: string
}

const api = {
  getSystemInfo: (): Promise<SystemInfo> => ipcRenderer.invoke('app:get-system-info'),
  setDockIcon: (dataUrl: string): Promise<boolean> => ipcRenderer.invoke('app:set-dock-icon', dataUrl),
  setDockFocusState: (state: 'none' | 'running' | 'paused'): Promise<boolean> => ipcRenderer.invoke('focus:set-dock-state', state),
  setStatusBarFocus: (focus: { running: boolean; endsAt: number; remainingMs: number } | null): Promise<boolean> => ipcRenderer.invoke('focus:set-status-bar', focus),
  onDockFocusAction: (callback: (action: 'pause' | 'resume') => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, action: 'pause' | 'resume'): void => callback(action)
    ipcRenderer.on('focus:dock-action', listener)
    return () => ipcRenderer.removeListener('focus:dock-action', listener)
  },
  startShortcutCapture: (): Promise<boolean> => ipcRenderer.invoke('shortcut:capture-start'),
  cancelShortcutCapture: (): Promise<boolean> => ipcRenderer.invoke('shortcut:capture-cancel'),
  setInboxShortcut: (accelerator: string): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('shortcut:set-inbox', accelerator),
  quickAddInbox: (title: string, content: string): Promise<unknown> => ipcRenderer.invoke('inbox:quick-add', title, content),
  closeQuickInbox: (): Promise<boolean> => ipcRenderer.invoke('inbox:quick-close'),
  onQuickInboxAdded: (callback: (card: unknown) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, card: unknown): void => callback(card)
    ipcRenderer.on('inbox:quick-added', listener)
    return () => ipcRenderer.removeListener('inbox:quick-added', listener)
  },
  loadBoards: (): Promise<unknown> => ipcRenderer.invoke('boards:load'),
  saveBoards: (state: unknown): Promise<boolean> => ipcRenderer.invoke('boards:save', state),
  getDatabaseInfo: (): Promise<unknown> => ipcRenderer.invoke('database:get-info'),
  createDatabase: (): Promise<unknown> => ipcRenderer.invoke('database:create'),
  chooseDatabase: (): Promise<unknown> => ipcRenderer.invoke('database:choose'),
  useDefaultDatabase: (): Promise<unknown> => ipcRenderer.invoke('database:use-default'),
  revealDatabase: (): Promise<boolean> => ipcRenderer.invoke('database:reveal')
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // This branch only supports environments where context isolation was explicitly disabled.
  const target = window as typeof window & {
    api: typeof api
  }
  target.api = api
}

declare global {
  type CardStatus = 'staged' | 'in_progress' | 'done' | 'deleted'
  type RepeatUnit = 'minute' | 'hour' | 'day' | 'week' | 'month'
  type ChildMode = 'parallel' | 'serial'
  type ChildDisplay = 'all' | 'in_progress' | 'in_progress_first' | 'done' | 'staged'
  type BoardStatus = 'active' | 'archived' | 'deleted'

  interface BoardCard {
    id: string
    boardId: string
    parentId: string | null
    title: string
    content: string
    status: CardStatus
    flagged: boolean
    dueAt: string | null
    repeatEnabled: boolean
    repeatInterval: number
    repeatUnit: RepeatUnit
    repeatStart: string | null
    repeatWeekdays: number[]
    repeatMonthDays: number[]
    tagIds: string[]
    childMode: ChildMode
    sort: number
    focusMinutes: number
    pomodoroCount: number
    statusBeforeDelete: Exclude<CardStatus, 'deleted'> | null
    statusChangedAt: string | null
    createdAt: string
    updatedAt: string
  }

  interface BoardFilter {
    staged: boolean
    in_progress: boolean
    done: boolean
    deleted: boolean
  }

  interface Project {
    id: string
    title: string
    color: string
    sort: number
    createdAt: string
    updatedAt: string
    deletedAt: string | null
    archivedAt: string | null
  }

  interface CardTag {
    id: string
    title: string
    parentId: string | null
    sort: number
    createdAt: string
    updatedAt: string
    deletedAt: string | null
  }

  interface TagViewConfig {
    enabled: boolean
    categoryTagId: string
    statuses: BoardFilter
  }

  interface Board {
    id: string
    projectId: string
    status: BoardStatus
    statusChangedAt: string | null
    title: string
    color: string
    sort: number
    height: number | null
    filter: BoardFilter
    cards: BoardCard[]
  }

  interface FocusSession {
    cardId: string
    startedAt: number
    endsAt: number
    remainingMs: number
    durationMs: number
    running: boolean
  }

  interface BoardState {
    version: 1
    projects: Project[]
    tags: CardTag[]
    boards: Board[]
    focus: FocusSession | null
    lastProjectId: string | null
    boardDisplaySettings: Record<string, 'all' | 'in_progress' | 'staged' | 'done'>
    tagViewSettings: Record<string, TagViewConfig>
    displaySettings: {
      boardColumns: number | 'auto'
      boardWidth: 'narrow' | 'medium' | 'wide'
      boardHeight: 'small' | 'medium' | 'large'
      fontSize: 'small' | 'medium' | 'large'
      dockTimerEnabled: boolean
    }
    inboxSettings: { in_progress: boolean; done: boolean; deleted: boolean }
    focusSettings: { durationMinutes: number }
    shortcuts: { inbox: string }
  }

  interface DatabaseInfo {
    path: string
    defaultPath: string
    customized: boolean
  }

  interface DatabaseSwitchResult {
    info: DatabaseInfo
    state: BoardState
  }

  interface SystemInfo {
    appVersion: string
    electronVersion: string
    nodeVersion: string
    platform: NodeJS.Platform
    arch: string
  }

  interface Window {
    api: {
      getSystemInfo: () => Promise<SystemInfo>
      setDockIcon: (dataUrl: string) => Promise<boolean>
      setDockFocusState: (state: 'none' | 'running' | 'paused') => Promise<boolean>
      onDockFocusAction: (callback: (action: 'pause' | 'resume') => void) => () => void
      startShortcutCapture: () => Promise<boolean>
      cancelShortcutCapture: () => Promise<boolean>
      setInboxShortcut: (accelerator: string) => Promise<{ success: boolean; error?: string }>
      quickAddInbox: (title: string, content: string) => Promise<BoardCard>
      closeQuickInbox: () => Promise<boolean>
      onQuickInboxAdded: (callback: (card: BoardCard) => void) => () => void
      loadBoards: () => Promise<unknown>
      saveBoards: (state: BoardState) => Promise<boolean>
      getDatabaseInfo: () => Promise<DatabaseInfo>
      createDatabase: () => Promise<DatabaseSwitchResult | null>
      chooseDatabase: () => Promise<DatabaseSwitchResult | null>
      useDefaultDatabase: () => Promise<DatabaseSwitchResult>
      revealDatabase: () => Promise<boolean>
    }
  }
}

export {}

import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

interface StoredCard {
  id: string
  boardId: string
  parentId: string | null
  title: string
  content: string
  status: string
  flagged: boolean
  dueAt: string | null
  repeatEnabled: boolean
  repeatInterval: number
  repeatUnit: string
  repeatStart: string | null
  repeatWeekdays: number[]
  repeatMonthDays: number[]
  tagIds: string[]
  childMode: 'parallel' | 'serial'
  sort: number
  focusMinutes: number
  pomodoroCount: number
  statusBeforeDelete: 'staged' | 'in_progress' | 'done' | null
  statusChangedAt: string | null
  createdAt: string
  updatedAt: string
}

interface StoredProject {
  id: string
  title: string
  color: string
  sort: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  archivedAt: string | null
}

interface StoredTag {
  id: string
  title: string
  parentId: string | null
  sort: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

interface StoredBoard {
  id: string
  projectId: string
  status: 'active' | 'archived' | 'deleted'
  statusChangedAt: string | null
  title: string
  color: string
  sort: number
  height: number | null
  filter: { staged: boolean; in_progress: boolean; done: boolean; deleted: boolean }
  cards: StoredCard[]
}

interface StoredFocus {
  cardId: string
  startedAt: number
  endsAt: number
  remainingMs: number
  durationMs: number
  running: boolean
}

interface StoredThemePalette {
  color: string
  projectBrightness: number
  boardBrightness: number
  cardBrightness: number
}

interface StoredThemeSettings {
  activeThemeId: string
  customDraft: StoredThemePalette
  themes: Array<StoredThemePalette & { id: string; title: string }>
}

interface StoredShortcutSettings {
  inbox: string
  projectTabs: string
  planTabs: string
  boards: string
  tags: string
  settings: string
  plan: string
  search: string
  undo: string
  redo: string
}

interface StoredState {
  version: 1
  projects: StoredProject[]
  tags: StoredTag[]
  boards: StoredBoard[]
  focus: StoredFocus | null
  lastProjectId: string | null
  lastView: 'boards' | 'inbox' | 'flagged' | 'overdue' | 'tags' | 'statistics' | 'settings'
  boardDisplaySettings: Record<string, 'all' | 'in_progress' | 'staged' | 'done'>
  tagViewSettings: Record<string, {
    activeViewId: string | null
    views: Array<{ id: string; pinned: boolean; categoryTagId: string; statuses: { staged: boolean; in_progress: boolean; done: boolean; deleted: boolean } }>
  }>
  themeSettings: StoredThemeSettings
  displaySettings: { boardColumns: number | 'auto'; boardWidth: 'auto' | 'narrow' | 'medium' | 'wide'; boardHeight: 'small' | 'medium' | 'large'; fontSize: 'small' | 'medium' | 'large'; dockTimerEnabled: boolean }
  inboxSettings: { staged: boolean; in_progress: boolean; done: boolean; deleted: boolean }
  focusSettings: { durationMinutes: number }
  shortcuts: StoredShortcutSettings
}

const DEFAULT_THEME_PALETTE: StoredThemePalette = {
  color: '#b3b3b3', projectBrightness: 94, boardBrightness: 83, cardBrightness: 94
}

const DEFAULT_SHORTCUTS: StoredShortcutSettings = {
  inbox: 'CommandOrControl+Shift+I', projectTabs: 'Command+1', planTabs: 'Command+1',
  boards: 'Command+Shift+P', tags: 'Command+Shift+T', settings: 'Command+Shift+S',
  plan: 'Command+Shift+A', search: 'Command+Shift+F', undo: 'Command+Z', redo: 'Command+Shift+Z'
}

function normalizeShortcuts(value: unknown): StoredShortcutSettings {
  const candidate = value && typeof value === 'object' ? value as Partial<StoredShortcutSettings> : {}
  return Object.fromEntries(Object.entries(DEFAULT_SHORTCUTS).map(([key, fallback]) => [
    key, typeof candidate[key as keyof StoredShortcutSettings] === 'string' && candidate[key as keyof StoredShortcutSettings]
      ? candidate[key as keyof StoredShortcutSettings] : fallback
  ])) as unknown as StoredShortcutSettings
}

function normalizeThemePalette(value: unknown): StoredThemePalette {
  const candidate = value && typeof value === 'object' ? value as Partial<StoredThemePalette> : {}
  const brightness = (raw: unknown, fallback: number): number => Math.min(100, Math.max(60, Number(raw) || fallback))
  return {
    color: typeof candidate.color === 'string' && /^#[0-9a-f]{6}$/i.test(candidate.color) ? candidate.color.toLowerCase() : DEFAULT_THEME_PALETTE.color,
    projectBrightness: brightness(candidate.projectBrightness, DEFAULT_THEME_PALETTE.projectBrightness),
    boardBrightness: brightness(candidate.boardBrightness, DEFAULT_THEME_PALETTE.boardBrightness),
    cardBrightness: brightness(candidate.cardBrightness, DEFAULT_THEME_PALETTE.cardBrightness)
  }
}

function normalizeThemeSettings(value: unknown): StoredThemeSettings {
  const candidate = value && typeof value === 'object' ? value as Partial<StoredThemeSettings> : {}
  const themes = Array.isArray(candidate.themes) ? candidate.themes.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return []
    const theme = raw as Partial<StoredThemeSettings['themes'][number]>
    if (typeof theme.id !== 'string' || !theme.id || typeof theme.title !== 'string' || !theme.title.trim()) return []
    return [{ id: theme.id, title: theme.title.trim().slice(0, 30), ...normalizeThemePalette(theme) }]
  }) : []
  const requested = typeof candidate.activeThemeId === 'string' ? candidate.activeThemeId : 'default'
  const activeThemeId = requested === 'default' || requested === 'custom' || themes.some((theme) => theme.id === requested) ? requested : 'default'
  return { activeThemeId, customDraft: normalizeThemePalette(candidate.customDraft), themes }
}

interface BoardRow {
  id: string
  project_id: string
  status: string
  status_changed_at: string | null
  title: string
  color: string
  sort: number
  height: number | null
  filter_staged: number
  filter_in_progress: number
  filter_done: number
  filter_deleted: number
}

interface ProjectRow {
  id: string
  title: string
  color: string
  sort: number
  created_at: string
  updated_at: string
  deleted_at: string | null
  archived_at: string | null
}

interface TagRow {
  id: string
  title: string
  parent_id: string | null
  sort: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

interface CardRow {
  id: string
  board_id: string
  parent_id: string | null
  title: string
  content: string
  status: string
  flagged: number
  due_at: string | null
  repeat_enabled: number
  repeat_interval: number
  repeat_unit: string
  repeat_start: string | null
  repeat_weekdays: string
  repeat_month_days: string
  child_mode: string
  sort: number
  focus_minutes: number
  pomodoro_count: number
  status_before_delete: string | null
  status_changed_at: string | null
  created_at: string
  updated_at: string
}

let database: DatabaseSync | null = null
let databasePath = ''
let defaultDatabasePath = ''
let settingsPath = ''

function parseStoredNumberArray(value: string | null | undefined, minimum: number, maximum: number): number[] {
  try {
    const parsed = JSON.parse(value || '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.map(Number).filter((item) => Number.isInteger(item) && item >= minimum && item <= maximum))].sort((a, b) => a - b)
  } catch {
    return []
  }
}

function ensureSchema(target: DatabaseSync): void {
  target.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '',
      sort INTEGER NOT NULL DEFAULT 0,
      record_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      archived_at TEXT
    );

    CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      status_changed_at TEXT,
      title TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '',
      sort INTEGER NOT NULL DEFAULT 0,
      height INTEGER,
      filter_staged INTEGER NOT NULL DEFAULT 0,
      filter_in_progress INTEGER NOT NULL DEFAULT 1,
      filter_done INTEGER NOT NULL DEFAULT 0,
      filter_deleted INTEGER NOT NULL DEFAULT 0,
      record_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      parent_id TEXT,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'in_progress',
      status_before_delete TEXT,
      status_changed_at TEXT,
      flagged INTEGER NOT NULL DEFAULT 0,
      due_at TEXT,
      repeat_enabled INTEGER NOT NULL DEFAULT 0,
      repeat_interval INTEGER NOT NULL DEFAULT 1,
      repeat_unit TEXT NOT NULL DEFAULT 'day',
      repeat_start TEXT,
      repeat_weekdays TEXT NOT NULL DEFAULT '[]',
      repeat_month_days TEXT NOT NULL DEFAULT '[]',
      child_mode TEXT NOT NULL DEFAULT 'parallel',
      sort REAL NOT NULL DEFAULT 0,
      focus_minutes INTEGER NOT NULL DEFAULT 0,
      pomodoro_count INTEGER NOT NULL DEFAULT 0,
      record_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_cards_board_sort ON cards(board_id, sort, id);
    CREATE INDEX IF NOT EXISTS idx_cards_parent ON cards(parent_id);
    CREATE INDEX IF NOT EXISTS idx_cards_updated ON cards(updated_at);

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      parent_id TEXT,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS card_tags (
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (card_id, tag_id)
    );

    CREATE INDEX IF NOT EXISTS idx_tags_parent_sort ON tags(parent_id, sort, id);
    CREATE INDEX IF NOT EXISTS idx_card_tags_tag ON card_tags(tag_id, card_id);

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_outbox (
      operation_id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      synced_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sync_outbox_pending ON sync_outbox(synced_at, created_at);
  `)
  const boardColumns = target.prepare('PRAGMA table_info(boards)').all() as unknown as Array<{ name: string }>
  if (!boardColumns.some((column) => column.name === 'project_id')) target.exec('ALTER TABLE boards ADD COLUMN project_id TEXT')
  if (!boardColumns.some((column) => column.name === 'height')) target.exec('ALTER TABLE boards ADD COLUMN height INTEGER')
  if (!boardColumns.some((column) => column.name === 'status')) {
    target.exec("ALTER TABLE boards ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
    target.exec("UPDATE boards SET status = 'deleted' WHERE deleted_at IS NOT NULL")
  }
  if (!boardColumns.some((column) => column.name === 'status_changed_at')) target.exec('ALTER TABLE boards ADD COLUMN status_changed_at TEXT')
  const projectColumns = target.prepare('PRAGMA table_info(projects)').all() as unknown as Array<{ name: string }>
  if (!projectColumns.some((column) => column.name === 'archived_at')) target.exec('ALTER TABLE projects ADD COLUMN archived_at TEXT')
  const cardColumns = target.prepare('PRAGMA table_info(cards)').all() as unknown as Array<{ name: string }>
  if (!cardColumns.some((column) => column.name === 'repeat_start')) target.exec('ALTER TABLE cards ADD COLUMN repeat_start TEXT')
  if (!cardColumns.some((column) => column.name === 'repeat_weekdays')) target.exec("ALTER TABLE cards ADD COLUMN repeat_weekdays TEXT NOT NULL DEFAULT '[]'")
  if (!cardColumns.some((column) => column.name === 'repeat_month_days')) target.exec("ALTER TABLE cards ADD COLUMN repeat_month_days TEXT NOT NULL DEFAULT '[]'")
  if (!cardColumns.some((column) => column.name === 'child_mode')) {
    target.exec("ALTER TABLE cards ADD COLUMN child_mode TEXT NOT NULL DEFAULT 'parallel'")
    target.exec("UPDATE cards SET child_mode = 'serial' WHERE repeat_enabled = 1")
  }
  if (!cardColumns.some((column) => column.name === 'status_before_delete')) target.exec('ALTER TABLE cards ADD COLUMN status_before_delete TEXT')
  if (!cardColumns.some((column) => column.name === 'status_changed_at')) target.exec('ALTER TABLE cards ADD COLUMN status_changed_at TEXT')
  const tagColumns = target.prepare('PRAGMA table_info(tags)').all() as unknown as Array<{ name: string }>
  if (!tagColumns.some((column) => column.name === 'deleted_at')) target.exec('ALTER TABLE tags ADD COLUMN deleted_at TEXT')
  const boardCount = (target.prepare("SELECT COUNT(*) AS count FROM boards WHERE deleted_at IS NULL AND id <> '__cardex_inbox__'").get() as { count: number }).count
  const projectCount = (target.prepare('SELECT COUNT(*) AS count FROM projects WHERE deleted_at IS NULL').get() as { count: number }).count
  if (boardCount > 0 && projectCount === 0) {
    const now = new Date().toISOString()
    target.prepare('INSERT INTO projects (id, title, color, sort, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)')
      .run('default-project', '默认项目', '#657df0', now, now)
    target.prepare("UPDATE boards SET project_id = ? WHERE id <> '__cardex_inbox__' AND (project_id IS NULL OR project_id = ?)").run('default-project', '')
  }
}

function openDatabase(filePath: string): DatabaseSync {
  const target = new DatabaseSync(filePath)
  ensureSchema(target)
  return target
}

function openExistingVistaskDatabase(filePath: string): DatabaseSync {
  const target = new DatabaseSync(filePath)
  try {
    const tables = target.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN ('metadata', 'boards', 'cards')
    `).all() as unknown as Array<{ name: string }>
    if (tables.length !== 3) throw new Error('所选文件不是 Vistask 数据库')
    ensureSchema(target)
    return target
  } catch (error) {
    target.close()
    throw error
  }
}

function currentDatabase(): DatabaseSync {
  if (!database) throw new Error('SQLite storage is not initialized')
  return database
}

function isStoredState(value: unknown): value is StoredState {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<StoredState>
  return candidate.version === 1 && Array.isArray(candidate.boards)
}

function normalizeState(value: StoredState): StoredState {
  const boardColumns = value.displaySettings?.boardColumns === 'auto'
    ? 'auto' as const : Math.min(8, Math.max(3, Number(value.displaySettings?.boardColumns) || 4))
  const requestedBoardWidth = ['auto', 'narrow', 'medium', 'wide'].includes(value.displaySettings?.boardWidth) ? value.displaySettings.boardWidth : 'medium'
  const boardWidth = boardColumns === 'auto' && requestedBoardWidth === 'auto' ? 'medium' : requestedBoardWidth
  const boardHeight = value.displaySettings?.boardHeight === 'small' || value.displaySettings?.boardHeight === 'large'
    ? value.displaySettings.boardHeight : 'medium'
  const fontSize = ['small', 'medium', 'large'].includes(value.displaySettings?.fontSize) ? value.displaySettings.fontSize : 'medium'
  const dockTimerEnabled = value.displaySettings?.dockTimerEnabled !== false
  const durationMinutes = Math.min(120, Math.max(10, Number(value.focusSettings?.durationMinutes) || 60))
  const shortcuts = normalizeShortcuts(value.shortcuts)
  const boards: StoredBoard[] = value.boards.map((board) => {
    const status = board.status === 'archived' || board.status === 'deleted' ? board.status : 'active'
    return {
      ...board,
      status,
      statusChangedAt: status === 'active' ? null : board.statusChangedAt || new Date().toISOString(),
      cards: board.cards.map((card) => ({
        ...card,
        repeatWeekdays: Array.isArray(card.repeatWeekdays) ? card.repeatWeekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6) : [],
        repeatMonthDays: Array.isArray(card.repeatMonthDays) ? card.repeatMonthDays.filter((day) => Number.isInteger(day) && day >= 1 && day <= 31) : [],
        tagIds: Array.isArray(card.tagIds) ? card.tagIds.filter((id) => typeof id === 'string') : [],
        statusBeforeDelete: card.status === 'deleted'
          ? card.statusBeforeDelete === 'staged' || card.statusBeforeDelete === 'done' ? card.statusBeforeDelete : 'in_progress'
          : null,
        statusChangedAt: card.status === 'deleted' ? card.statusChangedAt || card.updatedAt || null : null
      }))
    }
  })
  const normalized: StoredState = {
    ...value,
    boards,
    boardDisplaySettings: value.boardDisplaySettings && typeof value.boardDisplaySettings === 'object' ? value.boardDisplaySettings : {},
    tagViewSettings: value.tagViewSettings && typeof value.tagViewSettings === 'object' ? value.tagViewSettings : {},
    themeSettings: normalizeThemeSettings(value.themeSettings),
    projects: Array.isArray(value.projects) ? value.projects.map((project) => ({ ...project, archivedAt: project.archivedAt || null })) : [],
    tags: Array.isArray(value.tags) ? value.tags.map((tag) => ({ ...tag, deletedAt: tag.deletedAt || null })) : [],
    lastProjectId: typeof value.lastProjectId === 'string' && value.lastProjectId ? value.lastProjectId : null,
    lastView: ['boards', 'inbox', 'flagged', 'overdue', 'tags', 'statistics', 'settings'].includes(value.lastView) ? value.lastView : 'boards',
    displaySettings: { boardColumns, boardWidth, boardHeight, fontSize, dockTimerEnabled },
    inboxSettings: {
      staged: value.inboxSettings?.staged === true,
      in_progress: value.inboxSettings?.in_progress !== false,
      done: value.inboxSettings?.done === true,
      deleted: false
    },
    focusSettings: { durationMinutes }, shortcuts
  }
  if (Array.isArray(value.projects)) return normalized
  if (!value.boards.length) return { ...normalized, projects: [] }
  const now = new Date().toISOString()
  const project: StoredProject = {
    id: 'default-project', title: '默认项目', color: '#657df0', sort: 0, createdAt: now, updatedAt: now, deletedAt: null, archivedAt: null
  }
  return { ...normalized, projects: [project], boards: normalized.boards.map((board) => ({ ...board, projectId: project.id })) }
}

function saveStateTo(target: DatabaseSync, state: StoredState): void {
  const now = new Date().toISOString()
  const upsertProject = target.prepare(`
    INSERT INTO projects (id, title, color, sort, created_at, updated_at, deleted_at, archived_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, color=excluded.color, sort=excluded.sort,
      record_version=projects.record_version + 1, updated_at=excluded.updated_at,
      deleted_at=excluded.deleted_at, archived_at=excluded.archived_at
  `)
  const upsertBoard = target.prepare(`
    INSERT INTO boards (id, project_id, status, status_changed_at, title, color, sort, height, filter_staged, filter_in_progress, filter_done, filter_deleted, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET
      project_id=excluded.project_id, status=excluded.status, status_changed_at=excluded.status_changed_at,
      title=excluded.title, color=excluded.color, sort=excluded.sort, height=excluded.height,
      filter_staged=excluded.filter_staged, filter_in_progress=excluded.filter_in_progress,
      filter_done=excluded.filter_done, filter_deleted=excluded.filter_deleted,
      record_version=boards.record_version + 1, updated_at=excluded.updated_at, deleted_at=NULL
  `)
  const upsertTag = target.prepare(`
    INSERT INTO tags (id, title, parent_id, sort, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, parent_id=excluded.parent_id, sort=excluded.sort,
      updated_at=excluded.updated_at, deleted_at=excluded.deleted_at
  `)
  const upsertCard = target.prepare(`
    INSERT INTO cards (id, board_id, parent_id, title, content, status, status_before_delete, status_changed_at, flagged, due_at, repeat_enabled, repeat_interval, repeat_unit, repeat_start, repeat_weekdays, repeat_month_days, child_mode, sort, focus_minutes, pomodoro_count, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET
      board_id=excluded.board_id, parent_id=excluded.parent_id, title=excluded.title,
      content=excluded.content, status=excluded.status, status_before_delete=excluded.status_before_delete,
      status_changed_at=excluded.status_changed_at, flagged=excluded.flagged,
      due_at=excluded.due_at, repeat_enabled=excluded.repeat_enabled,
      repeat_interval=excluded.repeat_interval, repeat_unit=excluded.repeat_unit,
      repeat_start=excluded.repeat_start, repeat_weekdays=excluded.repeat_weekdays,
      repeat_month_days=excluded.repeat_month_days, child_mode=excluded.child_mode,
      sort=excluded.sort, focus_minutes=excluded.focus_minutes,
      pomodoro_count=excluded.pomodoro_count, record_version=cards.record_version + 1,
      updated_at=excluded.updated_at, deleted_at=NULL
  `)
  target.exec('BEGIN IMMEDIATE')
  try {
    const projectIds = new Set<string>()
    const tagIds = new Set<string>()
    const boardIds = new Set<string>()
    const cardIds = new Set<string>()
    for (const project of state.projects) {
      projectIds.add(project.id)
      upsertProject.run(
        project.id, project.title, project.color || '', project.sort || 0,
        project.createdAt || now, project.updatedAt || now, project.deletedAt || null, project.archivedAt || null
      )
    }
    for (const tag of state.tags || []) {
      tagIds.add(tag.id)
      upsertTag.run(tag.id, tag.title, tag.parentId, tag.sort || 0, tag.createdAt || now, tag.updatedAt || now, tag.deletedAt || null)
    }
    for (const board of state.boards) {
      boardIds.add(board.id)
      upsertBoard.run(
        board.id, board.projectId, board.status || 'active', board.statusChangedAt || null,
        board.title, board.color || '', board.sort || 0, board.height || null,
        Number(board.filter?.staged ?? false), Number(board.filter?.in_progress ?? true),
        Number(board.filter?.done ?? false), Number(board.filter?.deleted ?? false), now, now
      )
      for (const card of board.cards || []) {
        cardIds.add(card.id)
        upsertCard.run(
          card.id, board.id, card.parentId, card.title || '', card.content || '', card.status || 'in_progress',
          card.statusBeforeDelete || null, card.statusChangedAt || null,
          Number(Boolean(card.flagged)), card.dueAt, Number(Boolean(card.repeatEnabled)),
          Math.max(1, card.repeatInterval || 1), card.repeatUnit || 'day', card.repeatStart || null,
          JSON.stringify(card.repeatWeekdays || []), JSON.stringify(card.repeatMonthDays || []),
          card.childMode === 'serial' ? 'serial' : 'parallel', card.sort || 0,
          card.focusMinutes || 0, card.pomodoroCount || 0, card.createdAt || now, card.updatedAt || now
        )
      }
    }
    const existingCards = target.prepare('SELECT id FROM cards').all() as Array<{ id: string }>
    const deleteCard = target.prepare('DELETE FROM cards WHERE id = ?')
    for (const row of existingCards) if (!cardIds.has(row.id)) deleteCard.run(row.id)
    target.exec('DELETE FROM card_tags')
    const insertCardTag = target.prepare('INSERT OR IGNORE INTO card_tags (card_id, tag_id) VALUES (?, ?)')
    for (const board of state.boards) for (const card of board.cards || []) {
      for (const tagId of card.tagIds || []) if (cardIds.has(card.id) && tagIds.has(tagId)) insertCardTag.run(card.id, tagId)
    }
    const existingTags = target.prepare('SELECT id FROM tags').all() as Array<{ id: string }>
    const deleteTag = target.prepare('DELETE FROM tags WHERE id = ?')
    for (const row of existingTags) if (!tagIds.has(row.id)) deleteTag.run(row.id)
    const existingBoards = target.prepare('SELECT id FROM boards').all() as Array<{ id: string }>
    const deleteBoard = target.prepare('DELETE FROM boards WHERE id = ?')
    for (const row of existingBoards) if (!boardIds.has(row.id)) deleteBoard.run(row.id)
    const existingProjects = target.prepare('SELECT id FROM projects').all() as Array<{ id: string }>
    const deleteProject = target.prepare('DELETE FROM projects WHERE id = ?')
    for (const row of existingProjects) if (!projectIds.has(row.id)) deleteProject.run(row.id)
    target.prepare(`
      INSERT INTO app_state (key, value_json, updated_at) VALUES ('focus', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at
    `).run(JSON.stringify(state.focus), now)
    target.prepare(`
      INSERT INTO app_state (key, value_json, updated_at) VALUES ('display_settings', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at
    `).run(JSON.stringify(state.displaySettings), now)
    target.prepare(`
      INSERT INTO app_state (key, value_json, updated_at) VALUES ('board_display_settings', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at
    `).run(JSON.stringify(state.boardDisplaySettings), now)
    target.prepare(`
      INSERT INTO app_state (key, value_json, updated_at) VALUES ('tag_view_settings', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at
    `).run(JSON.stringify(state.tagViewSettings), now)
    target.prepare(`
      INSERT INTO app_state (key, value_json, updated_at) VALUES ('theme_settings', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at
    `).run(JSON.stringify(state.themeSettings), now)
    target.prepare(`
      INSERT INTO app_state (key, value_json, updated_at) VALUES ('shortcuts', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at
    `).run(JSON.stringify(state.shortcuts), now)
    target.prepare(`
      INSERT INTO app_state (key, value_json, updated_at) VALUES ('navigation', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at
    `).run(JSON.stringify({ lastProjectId: state.lastProjectId || null, lastView: state.lastView }), now)
    target.prepare(`
      INSERT INTO app_state (key, value_json, updated_at) VALUES ('focus_settings', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at
    `).run(JSON.stringify(state.focusSettings), now)
    target.prepare(`
      INSERT INTO app_state (key, value_json, updated_at) VALUES ('inbox_settings', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at
    `).run(JSON.stringify(state.inboxSettings), now)
    target.exec('COMMIT')
  } catch (error) {
    target.exec('ROLLBACK')
    throw error
  }
}

export function loadBoardState(): StoredState {
  const target = currentDatabase()
  const projectRows = target.prepare(`
    SELECT id, title, color, sort, created_at, updated_at, deleted_at, archived_at
    FROM projects ORDER BY sort, id
  `).all() as unknown as ProjectRow[]
  const tagRows = target.prepare(`
    SELECT id, title, parent_id, sort, created_at, updated_at, deleted_at FROM tags ORDER BY parent_id, sort, id
  `).all() as unknown as TagRow[]
  const cardTagRows = target.prepare('SELECT card_id, tag_id FROM card_tags').all() as Array<{ card_id: string; tag_id: string }>
  const tagIdsByCard = new Map<string, string[]>()
  for (const row of cardTagRows) tagIdsByCard.set(row.card_id, [...(tagIdsByCard.get(row.card_id) || []), row.tag_id])
  const boardRows = target.prepare(`
    SELECT id, project_id, status, status_changed_at, title, color, sort, height, filter_staged, filter_in_progress, filter_done, filter_deleted
    FROM boards ORDER BY sort, id
  `).all() as unknown as BoardRow[]
  const cardRows = target.prepare(`
    SELECT id, board_id, parent_id, title, content, status, status_before_delete, status_changed_at, flagged, due_at,
           repeat_enabled, repeat_interval, repeat_unit, repeat_start, repeat_weekdays, repeat_month_days, child_mode, sort, focus_minutes,
           pomodoro_count, created_at, updated_at
    FROM cards WHERE deleted_at IS NULL ORDER BY board_id, sort, id
  `).all() as unknown as CardRow[]
  const cardsByBoard = new Map<string, StoredCard[]>()
  for (const row of cardRows) {
    const cards = cardsByBoard.get(row.board_id) || []
    cards.push({
      id: row.id, boardId: row.board_id, parentId: row.parent_id, title: row.title,
      content: row.content, status: row.status,
      statusBeforeDelete: row.status_before_delete === 'staged' || row.status_before_delete === 'done' ? row.status_before_delete : row.status === 'deleted' ? 'in_progress' : null,
      statusChangedAt: row.status_changed_at || (row.status === 'deleted' ? row.updated_at : null),
      flagged: Boolean(row.flagged), dueAt: row.due_at,
      repeatEnabled: Boolean(row.repeat_enabled), repeatInterval: row.repeat_interval,
      repeatUnit: row.repeat_unit, repeatStart: row.repeat_start,
      repeatWeekdays: parseStoredNumberArray(row.repeat_weekdays, 0, 6),
      repeatMonthDays: parseStoredNumberArray(row.repeat_month_days, 1, 31),
      tagIds: tagIdsByCard.get(row.id) || [],
      childMode: row.child_mode === 'serial' ? 'serial' : 'parallel',
      sort: row.sort, focusMinutes: row.focus_minutes,
      pomodoroCount: row.pomodoro_count, createdAt: row.created_at, updatedAt: row.updated_at
    })
    cardsByBoard.set(row.board_id, cards)
  }
  const focusRow = target.prepare("SELECT value_json FROM app_state WHERE key = 'focus'").get() as { value_json: string } | undefined
  const displaySettingsRow = target.prepare("SELECT value_json FROM app_state WHERE key = 'display_settings'").get() as { value_json: string } | undefined
  const boardDisplaySettingsRow = target.prepare("SELECT value_json FROM app_state WHERE key = 'board_display_settings'").get() as { value_json: string } | undefined
  const tagViewSettingsRow = target.prepare("SELECT value_json FROM app_state WHERE key = 'tag_view_settings'").get() as { value_json: string } | undefined
  const themeSettingsRow = target.prepare("SELECT value_json FROM app_state WHERE key = 'theme_settings'").get() as { value_json: string } | undefined
  const shortcutsRow = target.prepare("SELECT value_json FROM app_state WHERE key = 'shortcuts'").get() as { value_json: string } | undefined
  const navigationRow = target.prepare("SELECT value_json FROM app_state WHERE key = 'navigation'").get() as { value_json: string } | undefined
  const focusSettingsRow = target.prepare("SELECT value_json FROM app_state WHERE key = 'focus_settings'").get() as { value_json: string } | undefined
  const inboxSettingsRow = target.prepare("SELECT value_json FROM app_state WHERE key = 'inbox_settings'").get() as { value_json: string } | undefined
  let focus: StoredFocus | null = null
  let boardColumns: number | 'auto' = 4
  let boardWidth: 'auto' | 'narrow' | 'medium' | 'wide' = 'medium'
  let boardHeight: 'small' | 'medium' | 'large' = 'medium'
  let fontSize: 'small' | 'medium' | 'large' = 'medium'
  let dockTimerEnabled = true
  let boardDisplaySettings: StoredState['boardDisplaySettings'] = {}
  let tagViewSettings: StoredState['tagViewSettings'] = {}
  let themeSettings = normalizeThemeSettings(null)
  let shortcuts = normalizeShortcuts(null)
  let lastProjectId: string | null = navigationRow ? null : projectRows.find((row) => !row.deleted_at)?.id || null
  let lastView: StoredState['lastView'] = 'boards'
  let focusDurationMinutes = 60
  try { focus = focusRow ? JSON.parse(focusRow.value_json) as StoredFocus : null } catch { focus = null }
  try {
    const stored = displaySettingsRow ? JSON.parse(displaySettingsRow.value_json) as { boardColumns?: unknown; boardWidth?: unknown; boardHeight?: unknown; fontSize?: unknown; dockTimerEnabled?: unknown } : null
    boardColumns = stored?.boardColumns === 'auto' ? 'auto' : Math.min(8, Math.max(3, Number(stored?.boardColumns) || 4))
    const width = (stored as { boardWidth?: unknown } | null)?.boardWidth
    if (width === 'auto' || width === 'narrow' || width === 'medium' || width === 'wide') boardWidth = width
    if (boardColumns === 'auto' && boardWidth === 'auto') boardWidth = 'medium'
    const height = stored?.boardHeight
    if (height === 'small' || height === 'medium' || height === 'large') boardHeight = height
    const size = stored?.fontSize
    if (size === 'small' || size === 'medium' || size === 'large') fontSize = size
    dockTimerEnabled = stored?.dockTimerEnabled !== false
  } catch { boardColumns = 4 }
  try {
    shortcuts = normalizeShortcuts(shortcutsRow ? JSON.parse(shortcutsRow.value_json) : null)
  } catch { shortcuts = normalizeShortcuts(null) }
  try {
    const stored = boardDisplaySettingsRow ? JSON.parse(boardDisplaySettingsRow.value_json) as Record<string, unknown> : null
    if (stored) boardDisplaySettings = Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, 'all' | 'in_progress' | 'staged' | 'done'] =>
      entry[1] === 'all' || entry[1] === 'in_progress' || entry[1] === 'staged' || entry[1] === 'done'))
  } catch { boardDisplaySettings = {} }
  try {
    const stored = tagViewSettingsRow ? JSON.parse(tagViewSettingsRow.value_json) as Record<string, unknown> : null
    if (stored) tagViewSettings = Object.fromEntries(Object.entries(stored).flatMap(([projectId, raw]) => {
      if (!raw || typeof raw !== 'object') return []
      const value = raw as {
        activeViewId?: unknown
        views?: unknown
        enabled?: unknown
        categoryTagId?: unknown
        statuses?: Partial<Record<'staged' | 'in_progress' | 'done' | 'deleted', unknown>>
      }
      const normalizeView = (candidate: unknown, fallbackId: string): StoredState['tagViewSettings'][string]['views'][number] | null => {
        if (!candidate || typeof candidate !== 'object') return null
        const view = candidate as { id?: unknown; pinned?: unknown; categoryTagId?: unknown; statuses?: Partial<Record<'staged' | 'in_progress' | 'done' | 'deleted', unknown>> }
        if (typeof view.categoryTagId !== 'string' || !view.categoryTagId) return null
        return {
          id: typeof view.id === 'string' && view.id ? view.id : fallbackId,
          pinned: view.pinned === true,
          categoryTagId: view.categoryTagId,
          statuses: {
            staged: view.statuses?.staged === true,
            in_progress: view.statuses?.in_progress !== false,
            done: view.statuses?.done === true,
            deleted: view.statuses?.deleted === true
          }
        }
      }
      const views = Array.isArray(value.views)
        ? value.views.map((view, index) => normalizeView(view, `view-${projectId}-${index}`)).filter((view): view is NonNullable<typeof view> => Boolean(view))
        : []
      if (!views.length) {
        const legacy = normalizeView(value, `view-${projectId}-legacy`)
        if (legacy) views.push(legacy)
      }
      if (!views.length) return []
      const requestedActiveId = typeof value.activeViewId === 'string' ? value.activeViewId : value.enabled === true ? views[0].id : null
      return [[projectId, {
        activeViewId: views.some((view) => view.id === requestedActiveId) ? requestedActiveId : null,
        views
      }]]
    }))
  } catch { tagViewSettings = {} }
  try {
    themeSettings = normalizeThemeSettings(themeSettingsRow ? JSON.parse(themeSettingsRow.value_json) : null)
  } catch { themeSettings = normalizeThemeSettings(null) }
  try {
    const stored = navigationRow ? JSON.parse(navigationRow.value_json) as { lastProjectId?: unknown; lastView?: unknown } : null
    if (typeof stored?.lastProjectId === 'string' && stored.lastProjectId) lastProjectId = stored.lastProjectId
    if (stored && typeof stored.lastView === 'string' && ['boards', 'inbox', 'flagged', 'overdue', 'tags', 'statistics', 'settings'].includes(stored.lastView)) {
      lastView = stored.lastView as StoredState['lastView']
    }
  } catch { lastProjectId = null; lastView = 'boards' }
  try {
    const stored = focusSettingsRow ? JSON.parse(focusSettingsRow.value_json) as { durationMinutes?: unknown } : null
    focusDurationMinutes = Math.min(120, Math.max(10, Number(stored?.durationMinutes) || 60))
  } catch { focusDurationMinutes = 60 }
  let inboxSettings = { staged: false, in_progress: true, done: false, deleted: false }
  try {
    const stored = inboxSettingsRow ? JSON.parse(inboxSettingsRow.value_json) as { staged?: unknown; in_progress?: unknown; done?: unknown; deleted?: unknown } : null
    if (stored) inboxSettings = {
      staged: stored.staged === true,
      in_progress: stored.in_progress !== false,
      done: stored.done === true,
      deleted: false
    }
  } catch { inboxSettings = { staged: false, in_progress: true, done: false, deleted: false } }
  return {
    version: 1,
    focus,
    lastProjectId,
    lastView,
    boardDisplaySettings,
    tagViewSettings,
    themeSettings,
    displaySettings: { boardColumns, boardWidth, boardHeight, fontSize, dockTimerEnabled },
    inboxSettings,
    focusSettings: { durationMinutes: focusDurationMinutes },
    shortcuts,
    projects: projectRows.map((row) => ({
      id: row.id, title: row.title, color: row.color, sort: row.sort,
      createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at, archivedAt: row.archived_at
    })),
    tags: tagRows.map((row) => ({
      id: row.id, title: row.title, parentId: row.parent_id, sort: row.sort, createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at
    })),
    boards: boardRows.map((row) => ({
      id: row.id, projectId: row.project_id, status: row.status === 'archived' || row.status === 'deleted' ? row.status : 'active',
      statusChangedAt: row.status_changed_at || (row.status === 'archived' || row.status === 'deleted' ? new Date().toISOString() : null),
      title: row.title, color: row.color, sort: row.sort, height: row.height,
      filter: {
        staged: Boolean(row.filter_staged), in_progress: Boolean(row.filter_in_progress),
        done: Boolean(row.filter_done), deleted: Boolean(row.filter_deleted)
      },
      cards: cardsByBoard.get(row.id) || []
    }))
  }
}

export function saveBoardState(value: unknown): boolean {
  if (!isStoredState(value)) throw new TypeError('Invalid board state')
  saveStateTo(currentDatabase(), normalizeState(value))
  return true
}

export function addQuickInboxCard(titleValue: string, contentValue: string): StoredCard {
  const title = titleValue.trim()
  if (!title) throw new Error('标题不能为空')
  const content = contentValue.trim()
  const target = currentDatabase()
  const now = new Date().toISOString()
  const boardId = '__cardex_inbox__'
  const cardId = crypto.randomUUID()
  target.exec('BEGIN IMMEDIATE')
  try {
    target.prepare(`
      INSERT INTO boards
        (id, project_id, title, color, sort, filter_staged, filter_in_progress, filter_done, filter_deleted, created_at, updated_at, deleted_at)
      VALUES (?, '', '__CARDEX_INBOX__', '#aeb1b9', -1, 1, 1, 0, 0, ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET deleted_at=NULL, updated_at=excluded.updated_at
    `).run(boardId, now, now)
    const sort = (target.prepare(
      'SELECT COALESCE(MIN(sort), 0) - 1 AS sort FROM cards WHERE board_id = ? AND deleted_at IS NULL'
    ).get(boardId) as { sort: number }).sort
    target.prepare(`
      INSERT INTO cards
        (id, board_id, parent_id, title, content, status, flagged, due_at,
         repeat_enabled, repeat_interval, repeat_unit, sort, focus_minutes,
         pomodoro_count, created_at, updated_at, deleted_at)
      VALUES (?, ?, NULL, ?, ?, 'in_progress', 0, NULL, 0, 1, 'day', ?, 0, 0, ?, ?, NULL)
    `).run(cardId, boardId, title, content, sort, now, now)
    target.exec('COMMIT')
    return {
      id: cardId, boardId, parentId: null, title, content, status: 'in_progress', flagged: false,
      dueAt: null, repeatEnabled: false, repeatInterval: 1, repeatUnit: 'day', repeatStart: null,
      repeatWeekdays: [], repeatMonthDays: [],
      tagIds: [],
      childMode: 'parallel', sort,
      focusMinutes: 0, pomodoroCount: 0, statusBeforeDelete: null, statusChangedAt: null, createdAt: now, updatedAt: now
    }
  } catch (error) {
    target.exec('ROLLBACK')
    throw error
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try { await access(filePath); return true } catch { return false }
}

async function saveSettings(): Promise<void> {
  const temporaryPath = `${settingsPath}.tmp`
  await writeFile(temporaryPath, JSON.stringify({ databasePath }, null, 2), 'utf8')
  await rename(temporaryPath, settingsPath)
}

export async function initializeStorage(userDataPath: string): Promise<void> {
  await mkdir(userDataPath, { recursive: true })
  defaultDatabasePath = join(userDataPath, 'vistask.db')
  settingsPath = join(userDataPath, 'storage-settings.json')
  databasePath = defaultDatabasePath
  let hasCurrentSettings = false
  try {
    const settings = JSON.parse(await readFile(settingsPath, 'utf8')) as { databasePath?: unknown }
    hasCurrentSettings = true
    if (typeof settings.databasePath === 'string' && settings.databasePath.trim()) databasePath = resolve(settings.databasePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Failed to read storage settings:', error)
  }

  // Renaming the app changes Electron's userData directory. On first launch,
  // retain the former Cardex database selection so existing data remains intact.
  if (!hasCurrentSettings) {
    const appDataPath = dirname(userDataPath)
    const legacyDirectories = [join(appDataPath, 'cardex'), join(appDataPath, 'Cardex')]
      .filter((path, index, paths) => resolve(path) !== resolve(userDataPath) && paths.indexOf(path) === index)
    for (const legacyDirectory of legacyDirectories) {
      let configuredPath: string | null = null
      try {
        const legacySettings = JSON.parse(await readFile(join(legacyDirectory, 'storage-settings.json'), 'utf8')) as { databasePath?: unknown }
        if (typeof legacySettings.databasePath === 'string' && legacySettings.databasePath.trim()) configuredPath = resolve(legacySettings.databasePath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Failed to read legacy Cardex storage settings:', error)
      }
      const legacyDefaultPath = join(legacyDirectory, 'cardex.db')
      const candidate = configuredPath && await pathExists(configuredPath)
        ? configuredPath
        : await pathExists(legacyDefaultPath) ? legacyDefaultPath : null
      if (!candidate) continue
      databasePath = candidate
      await saveSettings()
      break
    }
  }
  await mkdir(dirname(databasePath), { recursive: true })
  database = openDatabase(databasePath)

  const imported = database.prepare("SELECT value FROM metadata WHERE key = 'legacy_json_imported'").get()
  if (!imported) {
    const legacyPath = join(userDataPath, 'boards.json')
    try {
      const legacyState = JSON.parse(await readFile(legacyPath, 'utf8')) as unknown
      const count = (database.prepare('SELECT COUNT(*) AS count FROM boards').get() as { count: number }).count
      if (count === 0 && isStoredState(legacyState)) saveStateTo(database, normalizeState(legacyState))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Failed to import legacy JSON:', error)
    }
    database.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('legacy_json_imported', ?)").run(new Date().toISOString())
  }
}

export function getDatabaseInfo(): { path: string; defaultPath: string; customized: boolean } {
  return { path: databasePath, defaultPath: defaultDatabasePath, customized: databasePath !== defaultDatabasePath }
}

async function activateDatabase(nextDatabase: DatabaseSync, resolvedPath: string): Promise<StoredState> {
  const oldDatabase = currentDatabase()
  const oldPath = databasePath
  database = nextDatabase
  databasePath = resolvedPath
  try {
    await saveSettings()
  } catch (error) {
    database = oldDatabase
    databasePath = oldPath
    nextDatabase.close()
    throw error
  }
  oldDatabase.close()
  return loadBoardState()
}

export async function createDatabase(nextPath: string): Promise<StoredState> {
  const resolvedPath = resolve(nextPath)
  if (resolvedPath === databasePath || await pathExists(resolvedPath)) {
    throw new Error('该文件已经存在，请使用其他名称或选择“选择数据库”')
  }
  await mkdir(dirname(resolvedPath), { recursive: true })
  return activateDatabase(openDatabase(resolvedPath), resolvedPath)
}

export async function selectExistingDatabase(nextPath: string): Promise<StoredState> {
  const resolvedPath = resolve(nextPath)
  if (resolvedPath === databasePath) return loadBoardState()
  if (!await pathExists(resolvedPath)) throw new Error('所选数据库文件不存在')
  return activateDatabase(openExistingVistaskDatabase(resolvedPath), resolvedPath)
}

export async function switchDatabase(nextPath: string): Promise<StoredState> {
  const resolvedPath = resolve(nextPath)
  if (resolvedPath === databasePath) return loadBoardState()
  await mkdir(dirname(resolvedPath), { recursive: true })
  const existed = await pathExists(resolvedPath)
  const currentState = loadBoardState()
  const nextDatabase = openDatabase(resolvedPath)
  try {
    if (!existed) saveStateTo(nextDatabase, currentState)
    return await activateDatabase(nextDatabase, resolvedPath)
  } catch (error) {
    if (database !== nextDatabase) nextDatabase.close()
    throw error
  }
}

export function closeStorage(): void {
  database?.close()
  database = null
}

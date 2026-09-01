import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LineChartOutlined, MailOutlined, TagOutlined, TagsOutlined } from '@ant-design/icons'

const STATUS_LABELS: Record<CardStatus, string> = {
  staged: '已放弃', in_progress: '进行中', done: '已完成', deleted: '已删除'
}
const EDITABLE_STATUSES: CardStatus[] = ['staged', 'in_progress', 'done']
const CHILD_DISPLAY_LABELS: Record<ChildDisplay, string> = {
  all: '全部', in_progress: '进行中', in_progress_first: '进行中-首个', done: '已完成', staged: '已放弃'
}
const COLORS = ['#5b8def', '#9b7de5', '#ec6f8c', '#e7a33e', '#42a57c', '#4aa8b8']
const BOARD_HEIGHT_PIXELS = { small: 300, medium: 430, large: 560 } as const
const FOCUS_CREDIT_THRESHOLD = 1 / 5
type BoardParentDisplay = 'all' | 'in_progress' | 'staged' | 'done'
const DEFAULT_FILTER: BoardFilter = { staged: false, in_progress: true, done: false, deleted: false }
const INBOX_FILTER: BoardFilter = { staged: true, in_progress: true, done: false, deleted: false }
const INBOX_BOARD_ID = '__cardex_inbox__'
const INBOX_BOARD_TITLE = '__CARDEX_INBOX__'
const LEGACY_DEFAULT_BOARDS = ['收集箱', '本周', '进行中', '等待中', '已完成']
const uid = (): string => crypto.randomUUID()

function setScaledDragPreview(event: React.DragEvent<HTMLElement>, source: HTMLElement): void {
  const rect = source.getBoundingClientRect()
  const preview = source.cloneNode(true) as HTMLElement
  const scale = 2 / 3
  const container = document.createElement('div')
  preview.classList.remove('dragging', 'drag-target')
  preview.classList.add('drag-preview')
  Object.assign(container.style, {
    position: 'fixed',
    left: '-10000px',
    top: '-10000px',
    width: `${rect.width * scale}px`,
    height: `${rect.height * scale}px`,
    margin: '0',
    overflow: 'hidden',
    pointerEvents: 'none'
  })
  Object.assign(preview.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: '0',
    opacity: '1',
    transform: `scale(${scale})`,
    transformOrigin: 'top left',
    pointerEvents: 'none'
  })
  container.appendChild(preview)
  document.body.appendChild(container)
  event.dataTransfer.setDragImage(container,
    Math.max(0, Math.min(rect.width * scale, (event.clientX - rect.left) * scale)),
    Math.max(0, Math.min(rect.height * scale, (event.clientY - rect.top) * scale)))
  window.setTimeout(() => container.remove(), 0)
}

interface StatisticPeriod {
  completedCards: number
  pomodoros: number
  hours: number
}

interface StatisticsData {
  current: { inProgress: number; important: number; overdue: number; importantOverdue: number }
  today: StatisticPeriod
  week: StatisticPeriod
  month: StatisticPeriod
}

interface DataManagementItem {
  id: string
  type: '项目' | '看板' | '卡片'
  title: string
  context: string
  projectName: string
  projectStatus: '正常' | '已删除' | '已归档' | ''
  boardName: string
  boardStatus: '正常' | '已删除' | '已归档' | ''
  restoreBlockedMessage: string | null
  changedAt: string
  restore: () => void
  permanentlyDelete?: () => void
}

type SearchLifecycle = 'active' | 'archived' | 'deleted'
type SearchResultType = 'project' | 'board' | 'card'

interface SearchResult {
  id: string
  type: SearchResultType
  title: string
  content: string
  lifecycle: SearchLifecycle
  projectId: string | null
  boardId: string | null
  cardStatus: CardStatus | null
  updatedAt: string | null
  navigable: boolean
}

function FlagIcon({ filled = false }: { filled?: boolean }): React.JSX.Element {
  return <svg className={filled ? 'bi bi-flag-fill' : 'bi bi-flag'} viewBox="0 0 16 16" aria-hidden="true">
    {filled
      ? <path d="M4 1.35C7.12-.18 9.7 3.08 14.5 1v7.1C9.7 10.18 7.12 6.92 4 8.45V15H3V1.72l1-.37Z" />
      : <path d="M14.778.085A.5.5 0 0 1 15 .5V8a.5.5 0 0 1-.314.464l-.032.013a12.44 12.44 0 0 1-.438.164c-.255.09-.683.228-1.26.368-1.156.28-2.834.559-4.956.559-1.207 0-2.218-.1-3-.242V14.5a.5.5 0 0 1-1 0V.5a.5.5 0 0 1 .757-.429C5.491.51 6.979 1 9 1c1.871 0 3.354-.243 4.369-.49A12.93 12.93 0 0 0 14.759.06l.019-.007.004-.002h.001L14.778.085ZM5 1.149v6.725c.74.157 1.721.266 3 .266 2.038 0 3.644-.267 4.72-.528A11.72 11.72 0 0 0 14 7.199V1.162c-.33.1-.717.2-1.162.308C11.745 1.735 10.184 2 8 2c-1.854 0-3.32-.393-4-.702v-.149Z" />}
  </svg>
}

function ClockIcon(): React.JSX.Element {
  return <svg className="bi bi-clock" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="6.6" /><path d="M8 4.25V8l2.45 1.45" />
  </svg>
}

function OverdueIcon(): React.JSX.Element {
  return <svg className="overdue-nav-icon" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.2v5.2l3.3 2M12 3.5V2M5.9 5.9 4.8 4.8" />
  </svg>
}

function SearchIcon(): React.JSX.Element {
  return <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="10.8" cy="10.8" r="6.5" /><path d="m15.7 15.7 4.1 4.1" />
  </svg>
}

function ManageIcon(): React.JSX.Element {
  return <svg className="manage-icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
  </svg>
}

function MoreIcon(): React.JSX.Element {
  return <svg className="more-icon" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
  </svg>
}

function EyeIcon(): React.JSX.Element {
  return <svg className="bi bi-eye" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8ZM1.17 8a13.1 13.1 0 0 1 1.66-2.04C4.12 4.67 5.88 3.5 8 3.5s3.88 1.17 5.17 2.46A13.1 13.1 0 0 1 14.83 8a13.1 13.1 0 0 1-1.66 2.04C11.88 11.33 10.12 12.5 8 12.5s-3.88-1.17-5.17-2.46A13.1 13.1 0 0 1 1.17 8Z" />
    <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM6.5 8a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Z" />
  </svg>
}

function CardTextIcon(): React.JSX.Element {
  return <svg className="bi bi-card-text" viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1" y="2" width="14" height="12" rx="1.5" />
    <path d="M3.5 5.5h9M3.5 8h6M3.5 10.5h7.5" />
  </svg>
}

function AssignIcon(): React.JSX.Element {
  return <svg className="assign-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 6.5h8.5v4H20M16.5 7l3.5 3.5-3.5 3.5M4 10.5v7h12v-3" />
  </svg>
}

type CardActionIconName = 'child' | 'focus' | 'delete'

function CardActionIcon({ name }: { name: CardActionIconName }): React.JSX.Element {
  if (name === 'child') return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="11" height="11" rx="2" /><path d="M15 9h5v10a1 1 0 0 1-1 1H9v-5M9.5 7v5M7 9.5h5" /></svg>
  if (name === 'focus') return <svg className="tomato-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="m7 8.2-2.4 2.3-.8 3.6.9 3.5 2.8 2.5 4.5.8 4.5-.8 2.8-2.5.9-3.5-.8-3.6L17 8.2" />
    <path d="m12 8.8-2.5 1.4.7-2.8-3.1-.8 3-1.1-1.8-2.2 3.4 1.2L12.5 2l1 2.5 3.2-1.2-1.8 2.2 3 1.1-3.1.8.7 2.8L12 8.8Z" />
  </svg>
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 7h15M9 7V4.5h6V7m3 0-.7 12H6.7L6 7m4 4v5m4-5v5" /></svg>
}

function OverflowIcon({ direction }: { direction: 'right' | 'down' }): React.JSX.Element {
  return <svg className={`bi bi-chevron-double-${direction}`} viewBox="0 0 16 16" aria-hidden="true">
    {direction === 'right'
      ? <><path d="m3.5 2.5 5.5 5.5-5.5 5.5" /><path d="M8 2.5 13.5 8 8 13.5" /></>
      : <><path d="M2.5 3.5 8 9l5.5-5.5" /><path d="M2.5 8 8 13.5 13.5 8" /></>}
  </svg>
}

function emptyState(): BoardState {
  return {
    version: 1, focus: null, lastProjectId: null, projects: [], tags: [], boards: [],
    boardDisplaySettings: {}, tagViewSettings: {},
    displaySettings: { boardColumns: 4, boardWidth: 'medium', boardHeight: 'medium', fontSize: 'medium', dockTimerEnabled: true },
    inboxSettings: { in_progress: true, done: false, deleted: false },
    focusSettings: { durationMinutes: 60 },
    shortcuts: { inbox: 'CommandOrControl+Shift+I' }
  }
}

function isBoardState(value: unknown): value is BoardState {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<BoardState>
  return candidate.version === 1 && Array.isArray(candidate.boards)
}

function normalizeStoredState(value: unknown): BoardState {
  if (!isBoardState(value)) return emptyState()
  const boardColumns: BoardState['displaySettings']['boardColumns'] = value.displaySettings?.boardColumns === 'auto'
    ? 'auto' : Math.min(8, Math.max(3, Number(value.displaySettings?.boardColumns) || 4))
  const boardWidth: BoardState['displaySettings']['boardWidth'] = value.displaySettings?.boardWidth === 'narrow' || value.displaySettings?.boardWidth === 'wide'
    ? value.displaySettings.boardWidth : 'medium'
  const boardHeight: BoardState['displaySettings']['boardHeight'] = value.displaySettings?.boardHeight === 'small'
    || value.displaySettings?.boardHeight === 'large' ? value.displaySettings.boardHeight : 'medium'
  const fontSize: BoardState['displaySettings']['fontSize'] = value.displaySettings?.fontSize === 'small' || value.displaySettings?.fontSize === 'large'
    ? value.displaySettings.fontSize : 'medium'
  const dockTimerEnabled = value.displaySettings?.dockTimerEnabled !== false
  const durationMinutes = Math.min(120, Math.max(10, Number(value.focusSettings?.durationMinutes) || 60))
  const shortcuts = { inbox: value.shortcuts?.inbox || 'CommandOrControl+Shift+I' }
  const focus = value.focus ? {
    ...value.focus,
    durationMs: Number(value.focus.durationMs) || durationMinutes * 60 * 1000
  } : null
  const normalized = {
    ...value,
    focus,
    lastProjectId: typeof value.lastProjectId === 'string' && value.lastProjectId ? value.lastProjectId : null,
    boardDisplaySettings: Object.fromEntries(Object.entries(value.boardDisplaySettings || {}).filter((entry): entry is [string, BoardParentDisplay] =>
      entry[1] === 'all' || entry[1] === 'in_progress' || entry[1] === 'staged' || entry[1] === 'done')),
    tagViewSettings: Object.fromEntries(Object.entries(value.tagViewSettings || {}).flatMap(([projectId, raw]) => {
      if (!raw || typeof raw !== 'object') return []
      const config = raw as Partial<TagViewConfig>
      if (typeof config.categoryTagId !== 'string' || !config.categoryTagId) return []
      return [[projectId, {
        enabled: config.enabled === true,
        categoryTagId: config.categoryTagId,
        statuses: {
          staged: config.statuses?.staged === true,
          in_progress: config.statuses?.in_progress !== false,
          done: config.statuses?.done === true,
          deleted: config.statuses?.deleted === true
        }
      }]]
    })),
    tags: Array.isArray(value.tags) ? value.tags.map((tag) => ({ ...tag, deletedAt: tag.deletedAt || null })) : [],
    displaySettings: { boardColumns, boardWidth, boardHeight, fontSize, dockTimerEnabled },
    inboxSettings: {
      in_progress: value.inboxSettings?.in_progress !== false,
      done: value.inboxSettings?.done === true,
      deleted: value.inboxSettings?.deleted === true
    },
    focusSettings: { durationMinutes }, shortcuts
  }
  const isUntouchedLegacyDefault = value.boards.length === LEGACY_DEFAULT_BOARDS.length
    && value.boards.every((board, index) => board.title === LEGACY_DEFAULT_BOARDS[index] && board.cards.length === 0)
  const boards = isUntouchedLegacyDefault ? [] : value.boards
  if (Array.isArray(value.projects)) {
    const projects = value.projects.map((project) => ({ ...project, deletedAt: project.deletedAt || null, archivedAt: project.archivedAt || null }))
    const fallbackProjectId = projects.find((project) => !project.deletedAt && !project.archivedAt)?.id || ''
    return { ...normalized, projects, boards: boards.map((board) => normalizeBoardCards({
      ...board, status: board.status === 'archived' || board.status === 'deleted' ? board.status : 'active',
      statusChangedAt: board.status === 'archived' || board.status === 'deleted' ? board.statusChangedAt || null : null,
      height: board.height || null, projectId: board.id === INBOX_BOARD_ID ? '' : board.projectId || fallbackProjectId
    })) }
  }
  if (!boards.length) return { ...normalized, projects: [], boards: [] }
  const now = new Date().toISOString()
  const project: Project = { id: 'default-project', title: '默认项目', color: '#657df0', sort: 0, createdAt: now, updatedAt: now, deletedAt: null, archivedAt: null }
  return { ...normalized, projects: [project], boards: boards.map((board) => normalizeBoardCards({
    ...board, status: board.status === 'archived' || board.status === 'deleted' ? board.status : 'active',
    statusChangedAt: board.status === 'archived' || board.status === 'deleted' ? board.statusChangedAt || null : null,
    height: board.height || null, projectId: project.id
  })) }
}

function newCard(boardId: string, parentId: string | null = null): BoardCard {
  const now = new Date().toISOString()
  return {
    id: uid(), boardId, parentId, title: '', content: '', status: 'in_progress', flagged: false,
    dueAt: null, repeatEnabled: false, repeatInterval: 1, repeatUnit: 'day', sort: Date.now(),
    repeatStart: null, repeatWeekdays: [], repeatMonthDays: [], tagIds: [], childMode: 'parallel',
    focusMinutes: 0, pomodoroCount: 0, statusBeforeDelete: null, statusChangedAt: null, createdAt: now, updatedAt: now
  }
}

function dateTimeInputValue(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatDue(value: string): { text: string; overdue: boolean } {
  const date = new Date(value)
  return {
    text: date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }),
    overdue: date.getTime() < Date.now()
  }
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function calculateFocusCredit(durationMs: number, remainingMs: number): {
  eligible: boolean; elapsedMinutes: number; minimumMinutes: number; pomodoros: number
} {
  const safeDuration = Math.max(1, durationMs)
  const elapsedMs = Math.min(safeDuration, Math.max(0, safeDuration - Math.max(0, remainingMs)))
  const elapsedMinutes = elapsedMs / 60_000
  const minimumMinutes = safeDuration / 60_000 * FOCUS_CREDIT_THRESHOLD
  const eligible = elapsedMs >= safeDuration * FOCUS_CREDIT_THRESHOLD
  const pomodoros = eligible ? Math.min(1, Math.max(FOCUS_CREDIT_THRESHOLD, Number((elapsedMs / safeDuration).toFixed(1)))) : 0
  return { eligible, elapsedMinutes, minimumMinutes, pomodoros }
}

function formatShortcut(accelerator: string): string {
  const mac = navigator.platform.toLowerCase().includes('mac')
  return accelerator.split('+').map((part) => ({
    CommandOrControl: mac ? '⌘' : 'Ctrl', Command: '⌘', Control: mac ? '⌃' : 'Ctrl',
    Shift: '⇧', Alt: mac ? '⌥' : 'Alt'
  }[part] || part)).join(' ')
}

function acceleratorFromEvent(event: React.KeyboardEvent): string | null {
  if (['Meta', 'Control', 'Shift', 'Alt'].includes(event.key)) return null
  const keyAliases: Record<string, string> = {
    ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Escape: 'Esc', ',': 'Comma', '.': 'Period', '/': '/', ';': ';', "'": "'", '[': '[', ']': ']'
  }
  const key = keyAliases[event.key] || (event.key.length === 1 ? event.key.toUpperCase() : event.key)
  const modifiers: string[] = []
  if (event.metaKey) modifiers.push('Command')
  if (event.ctrlKey) modifiers.push('Control')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')
  if (modifiers.length === 0 && !/^F\d{1,2}$/.test(key)) return null
  return [...modifiers, key].join('+')
}

function resizeInlineTextarea(element: HTMLTextAreaElement): void {
  const scrollContainer = element.closest<HTMLElement>('.cards-list')
  const scrollTop = scrollContainer?.scrollTop
  const styles = window.getComputedStyle(element)
  const fontSize = Number.parseFloat(styles.fontSize) || 11
  const lineHeight = Number.parseFloat(styles.lineHeight) || fontSize * 1.45
  const verticalChrome = (Number.parseFloat(styles.paddingTop) || 0)
    + (Number.parseFloat(styles.paddingBottom) || 0)
    + (Number.parseFloat(styles.borderTopWidth) || 0)
    + (Number.parseFloat(styles.borderBottomWidth) || 0)
  const maximumHeight = Math.ceil(lineHeight * 30 + verticalChrome)
  element.style.height = 'auto'
  const contentHeight = element.scrollHeight
  element.style.height = `${Math.min(maximumHeight, Math.max(24, contentHeight))}px`
  element.style.overflowY = contentHeight > maximumHeight ? 'auto' : 'hidden'
  if (scrollContainer && scrollTop !== undefined) scrollContainer.scrollTop = scrollTop
}

function createDockIconDataUrl(label = ''): string {
  if (!label) return ''
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const context = canvas.getContext('2d')
  if (!context) return ''
  const gradient = context.createLinearGradient(58, 38, 455, 474)
  gradient.addColorStop(0, '#59d4c4')
  gradient.addColorStop(0.55, '#35bead')
  gradient.addColorStop(1, '#1e9f91')
  context.fillStyle = gradient
  context.beginPath()
  context.roundRect(10, 10, 492, 492, 126)
  context.fill()
  context.fillStyle = '#fbfbf9'
  context.textAlign = 'center'
  context.textBaseline = 'alphabetic'
  const paused = label.startsWith('Ⅱ')
  const [minutes = '00', seconds = '00'] = label.replace(/^Ⅱ/, '').split(':')
  context.font = '800 226px -apple-system, BlinkMacSystemFont, sans-serif'
  const minuteWidth = context.measureText(minutes).width
  if (minuteWidth > 454) context.font = `800 ${Math.floor(226 * 454 / minuteWidth)}px -apple-system, BlinkMacSystemFont, sans-serif`
  context.fillText(minutes, 256, 270)
  context.globalAlpha = 0.92
  context.font = '750 150px -apple-system, BlinkMacSystemFont, sans-serif'
  context.fillText(seconds, 256, 438)
  if (paused) {
    context.save()
    context.globalAlpha = 1
    context.fillStyle = 'rgba(17, 91, 82, .48)'
    context.beginPath()
    context.arc(256, 256, 74, 0, Math.PI * 2)
    context.fill()
    context.strokeStyle = 'rgba(255, 255, 255, .68)'
    context.lineWidth = 5
    context.stroke()
    context.fillStyle = 'rgba(255, 255, 255, .96)'
    context.beginPath()
    context.moveTo(238, 214)
    context.lineTo(238, 298)
    context.lineTo(306, 256)
    context.closePath()
    context.fill()
    context.restore()
  }
  return canvas.toDataURL('image/png')
}

function normalizeBoardCards(board: Board): Board {
  const initial: BoardCard[] = board.cards.map((card) => ({
    ...card,
    repeatStart: card.repeatStart || null,
    repeatWeekdays: Array.isArray(card.repeatWeekdays) ? card.repeatWeekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6) : [],
    repeatMonthDays: Array.isArray(card.repeatMonthDays) ? card.repeatMonthDays.filter((day) => Number.isInteger(day) && day >= 1 && day <= 31) : [],
    tagIds: Array.isArray(card.tagIds) ? card.tagIds.filter((id) => typeof id === 'string') : [],
    childMode: card.childMode === 'serial' || (card.repeatEnabled && !card.childMode) ? 'serial' as const : 'parallel' as const,
    statusBeforeDelete: card.status === 'deleted'
      ? card.statusBeforeDelete === 'staged' || card.statusBeforeDelete === 'done' ? card.statusBeforeDelete : 'in_progress'
      : null,
    statusChangedAt: card.status === 'deleted' ? card.statusChangedAt || card.updatedAt || null : null
  }))
  const recovered = initial.map((card) => {
    if (!card.repeatEnabled || card.parentId || card.repeatStart) return card
    const firstChildDue = initial.filter((child) => child.parentId === card.id && child.dueAt)
      .map((child) => child.dueAt as string).sort()[0]
    return { ...card, repeatStart: firstChildDue || card.dueAt || card.createdAt || null }
  })
  const cards = recovered.map((card) => {
    if (!card.repeatEnabled) return card
    const baseDate = new Date(card.repeatStart || card.createdAt)
    if (card.repeatUnit === 'week' && card.repeatWeekdays.length === 0) return { ...card, repeatWeekdays: [baseDate.getDay()] }
    if (card.repeatUnit === 'month' && card.repeatMonthDays.length === 0) return { ...card, repeatMonthDays: [baseDate.getDate()] }
    return card
  })
  return { ...board, cards }
}

function repeatOccurrence(start: Date, index: number, interval: number, unit: RepeatUnit): Date {
  const result = new Date(start)
  const amount = Math.max(1, interval) * index
  if (unit === 'minute') result.setMinutes(result.getMinutes() + amount)
  if (unit === 'hour') result.setHours(result.getHours() + amount)
  if (unit === 'day') result.setDate(result.getDate() + amount)
  if (unit === 'week') result.setDate(result.getDate() + amount * 7)
  if (unit === 'month') {
    const day = result.getDate()
    result.setDate(1)
    result.setMonth(result.getMonth() + amount)
    const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()
    result.setDate(Math.min(day, lastDay))
  }
  return result
}

function repeatOccurrences(card: BoardCard, start: Date, at: Date): Date[] {
  const occurrences: Date[] = []
  const interval = Math.max(1, card.repeatInterval)
  if (card.repeatUnit === 'week') {
    const weekdays = [...new Set(card.repeatWeekdays.length ? card.repeatWeekdays : [start.getDay()])].sort((a, b) => a - b)
    const weekStart = new Date(start)
    weekStart.setHours(0, 0, 0, 0)
    weekStart.setDate(weekStart.getDate() - weekStart.getDay())
    for (let cycle = 0; occurrences.length < 500; cycle += 1) {
      const cycleStart = new Date(weekStart)
      cycleStart.setDate(cycleStart.getDate() + cycle * interval * 7)
      if (cycleStart.getTime() > at.getTime()) break
      for (const weekday of weekdays) {
        const occurrence = new Date(cycleStart)
        occurrence.setDate(occurrence.getDate() + weekday)
        occurrence.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds())
        if (occurrence.getTime() >= start.getTime() && occurrence.getTime() <= at.getTime()) occurrences.push(occurrence)
      }
    }
    return occurrences
  }
  if (card.repeatUnit === 'month') {
    const monthDays = [...new Set(card.repeatMonthDays.length ? card.repeatMonthDays : [start.getDate()])].sort((a, b) => a - b)
    for (let cycle = 0; occurrences.length < 500; cycle += 1) {
      const monthStart = new Date(start.getFullYear(), start.getMonth() + cycle * interval, 1,
        start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds())
      if (monthStart.getTime() > at.getTime()) break
      const lastDay = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate()
      for (const day of monthDays) {
        if (day > lastDay) continue
        const occurrence = new Date(monthStart)
        occurrence.setDate(day)
        if (occurrence.getTime() >= start.getTime() && occurrence.getTime() <= at.getTime()) occurrences.push(occurrence)
      }
    }
    return occurrences
  }
  for (let index = 0; index < 500; index += 1) {
    const occurrence = repeatOccurrence(start, index, interval, card.repeatUnit)
    if (occurrence.getTime() > at.getTime()) break
    occurrences.push(occurrence)
  }
  return occurrences
}

export function expandRepeatCards(state: BoardState, at = new Date()): BoardState {
  let changed = false
  const boards = state.boards.map((board) => {
    let cards = [...board.cards]
    let maxSort = cards.reduce((maximum, card) => Math.max(maximum, Number(card.sort) || 0), 0)
    const roots = cards.filter((card) => card.repeatEnabled && !card.parentId && card.status === 'in_progress')
    for (const originalRoot of roots) {
      const children = cards.filter((card) => card.parentId === originalRoot.id)
      const recoveredStart = originalRoot.repeatStart || children.filter((child) => child.dueAt)
        .map((child) => child.dueAt as string).sort()[0] || originalRoot.dueAt || dateTimeInputValue(at)
      if (!recoveredStart) continue
      const root = { ...originalRoot, repeatStart: recoveredStart, dueAt: null }
      if (root.repeatStart !== originalRoot.repeatStart || originalRoot.dueAt) {
        cards = cards.map((card) => card.id === root.id ? root : card)
        changed = true
      }
      const start = new Date(recoveredStart)
      if (Number.isNaN(start.getTime()) || start.getTime() > at.getTime()) continue
      const existingByDue = new Map<string, BoardCard>()
      for (const child of children) if (child.dueAt) existingByDue.set(dateTimeInputValue(new Date(child.dueAt)), child)
      for (const occurrence of repeatOccurrences(root, start, at)) {
        const dueAt = dateTimeInputValue(occurrence)
        const existing = existingByDue.get(dueAt)
        if (existing) continue
        const timestamp = new Date().toISOString()
        maxSort += 1
        const child: BoardCard = {
          id: uid(), boardId: root.boardId, parentId: root.id, title: root.title, content: root.content,
          status: 'in_progress', flagged: false, dueAt, repeatEnabled: false, repeatInterval: 1,
          repeatUnit: 'day', repeatStart: null, repeatWeekdays: [], repeatMonthDays: [], tagIds: [...root.tagIds], childMode: 'parallel', sort: maxSort,
          focusMinutes: 0, pomodoroCount: 0, statusBeforeDelete: null, statusChangedAt: null, createdAt: timestamp, updatedAt: timestamp
        }
        cards.push(child)
        existingByDue.set(dueAt, child)
        changed = true
      }
    }
    return cards === board.cards ? board : { ...board, cards }
  })
  return changed ? { ...state, boards } : state
}

function App(): React.JSX.Element {
  const [state, setState] = useState<BoardState | null>(null)
  const [view, setView] = useState<'boards' | 'inbox' | 'flagged' | 'overdue' | 'tags' | 'statistics' | 'settings'>('boards')
  const [includeCompleted, setIncludeCompleted] = useState(false)
  const [editingCard, setEditingCard] = useState<BoardCard | null>(null)
  const [editingCardAnchor, setEditingCardAnchor] = useState<DOMRect | null>(null)
  const [editingBoard, setEditingBoard] = useState<{ id: string | null; title: string } | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [locatedSearchResult, setLocatedSearchResult] = useState<{ type: SearchResultType; id: string } | null>(null)
  const [projectManagerOpen, setProjectManagerOpen] = useState(false)
  const [requestedProjectRenameId, setRequestedProjectRenameId] = useState<string | null>(null)
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [isNewCard, setIsNewCard] = useState(false)
  const [filterBoardId, setFilterBoardId] = useState<string | null>(null)
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [childDisplaySelections, setChildDisplaySelections] = useState<Record<string, ChildDisplay>>({})
  const [boardDisplaySelections, setBoardDisplaySelections] = useState<Record<string, BoardParentDisplay>>({})
  const [importantChildDisplay, setImportantChildDisplay] = useState<'first' | 'all'>('first')
  const [overdueChildDisplay, setOverdueChildDisplay] = useState<'first' | 'all'>('first')
  const [overdueFlaggedOnly, setOverdueFlaggedOnly] = useState(false)
  const [dragCardId, setDragCardId] = useState<string | null>(null)
  const [dragCardTargetId, setDragCardTargetId] = useState<string | null>(null)
  const [dragCardTargetBoardId, setDragCardTargetBoardId] = useState<string | null>(null)
  const [dragBoardId, setDragBoardId] = useState<string | null>(null)
  const [dragBoardTargetId, setDragBoardTargetId] = useState<string | null>(null)
  const dragBoardIdRef = useRef<string | null>(null)
  const dragBoardTargetIdRef = useRef<string | null>(null)
  const [inlineEditingCardId, setInlineEditingCardId] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const [storageSwitching, setStorageSwitching] = useState(false)
  const [hasMoreBoardsRight, setHasMoreBoardsRight] = useState(false)
  const [hasMoreBoardsBelow, setHasMoreBoardsBelow] = useState(false)
  const boardsViewportRef = useRef<HTMLDivElement | null>(null)
  const saveTimerRef = useRef<number | null>(null)

  useEffect(() => {
    void window.api.loadBoards().then((stored) => {
      const normalized = expandRepeatCards(normalizeStoredState(stored))
      setState(normalized)
      setBoardDisplaySelections(normalized.boardDisplaySettings)
      const restoredProjectId = normalized.lastProjectId && normalized.projects.some((project) => project.id === normalized.lastProjectId && !project.deletedAt && !project.archivedAt)
        ? normalized.lastProjectId : normalized.lastProjectId ? normalized.projects.find((project) => !project.deletedAt && !project.archivedAt)?.id || null : null
      setActiveProjectId(restoredProjectId)
    })
  }, [])

  useEffect(() => {
    const fontSize = state?.displaySettings.fontSize || 'medium'
    const offset = fontSize === 'small' ? 0 : fontSize === 'large' ? 2 : 1
    document.documentElement.style.setProperty('--font-offset', `${offset}px`)
  }, [state?.displaySettings.fontSize])

  useEffect(() => window.api.onQuickInboxAdded((card) => {
    setState((current) => {
      if (!current) return current
      const inbox = current.boards.find((board) => board.id === INBOX_BOARD_ID)
      if (inbox) return {
        ...current,
        boards: current.boards.map((board) => board.id === INBOX_BOARD_ID ? { ...board, cards: [card, ...board.cards.filter((item) => item.id !== card.id)] } : board)
      }
      const board: Board = {
        id: INBOX_BOARD_ID, projectId: '', status: 'active', statusChangedAt: null, title: INBOX_BOARD_TITLE, color: '#aeb1b9', sort: -1, height: null,
        filter: { ...INBOX_FILTER }, cards: [card]
      }
      return { ...current, boards: [...current.boards, board] }
    })
  }), [])

  useEffect(() => {
    if (!state || !activeProjectId) return
    if (state.projects.some((project) => project.id === activeProjectId && !project.deletedAt && !project.archivedAt)) return
    const fallbackProjectId = state.projects.find((project) => !project.deletedAt && !project.archivedAt)?.id || null
    setActiveProjectId(fallbackProjectId)
    setState((current) => current ? { ...current, lastProjectId: fallbackProjectId } : current)
  }, [activeProjectId, state])

  useEffect(() => {
    if (!state || storageSwitching) return
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void window.api.saveBoards(state).catch((error) => console.error('保存数据失败', error))
    }, 250)
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [state, storageSwitching])

  useEffect(() => {
    const expandDueRepeats = (): void => {
      setNow(Date.now())
      setState((current) => current ? expandRepeatCards(current, new Date()) : current)
    }
    const timer = window.setInterval(expandDueRepeats, 30_000)
    window.addEventListener('focus', expandDueRepeats)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', expandDueRepeats)
    }
  }, [])

  useEffect(() => {
    if (!state?.focus?.running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [state?.focus?.running])

  useEffect(() => {
    if (!state?.focus?.running || now < state.focus.endsAt) return
    setState((current) => {
      if (!current?.focus || current.focus.endsAt > Date.now()) return current
      const cardId = current.focus.cardId
      const completedMinutes = (current.focus.durationMs || current.focusSettings.durationMinutes * 60 * 1000) / 60_000
      return {
        ...current, focus: null,
        boards: current.boards.map((board) => ({ ...board, cards: board.cards.map((card) => card.id === cardId
          ? { ...card, focusMinutes: card.focusMinutes + completedMinutes, pomodoroCount: card.pomodoroCount + 1 }
          : card) }))
      }
    })
  }, [now, state?.focus])

  useEffect(() => {
    const remaining = state?.focus ? (state.focus.running ? state.focus.endsAt - now : state.focus.remainingMs) : 0
    const label = state?.displaySettings.dockTimerEnabled && state.focus ? `${state.focus.running ? '' : 'Ⅱ'}${formatDuration(remaining)}` : ''
    const dataUrl = createDockIconDataUrl(label)
    void window.api.setDockIcon(dataUrl).then((updated) => {
      if (!updated) console.warn('Dock icon update was not applied')
    })
  }, [now, state?.displaySettings.dockTimerEnabled, state?.focus])

  useEffect(() => {
    const dockState = state?.focus ? state.focus.running ? 'running' : 'paused' : 'none'
    void window.api.setDockFocusState(dockState)
  }, [state?.focus])

  useEffect(() => window.api.onDockFocusAction((action) => {
    const timestamp = Date.now()
    setState((current) => {
      if (!current?.focus) return current
      if (action === 'pause') {
        if (!current.focus.running) return current
        return { ...current, focus: { ...current.focus, remainingMs: Math.max(0, current.focus.endsAt - timestamp), running: false } }
      }
      if (current.focus.running) return current
      const remainingMs = Math.max(0, current.focus.remainingMs)
      return { ...current, focus: { ...current.focus, startedAt: timestamp, endsAt: timestamp + remainingMs, remainingMs, running: true } }
    })
    setNow(timestamp)
  }), [])

  const activeProjects = useMemo(() => state?.projects.filter((project) => !project.deletedAt && !project.archivedAt).sort((a, b) => a.sort - b.sort) ?? [], [state])
  const activeTags = useMemo(() => state?.tags.filter((tag) => !tag.deletedAt).sort((a, b) => a.sort - b.sort) ?? [], [state])
  const activeProjectIds = useMemo(() => new Set(activeProjects.map((project) => project.id)), [activeProjects])
  const allCards = useMemo(() => state?.boards.filter((board) => board.id === INBOX_BOARD_ID || (board.status === 'active' && activeProjectIds.has(board.projectId))).flatMap((board) => board.cards) ?? [], [activeProjectIds, state])
  const selectedTagIds = useMemo(() => {
    const ids = new Set<string>()
    if (!selectedTagId || !state) return ids
    const visit = (tagId: string): void => {
      if (ids.has(tagId)) return
      ids.add(tagId)
      activeTags.filter((tag) => tag.parentId === tagId).forEach((tag) => visit(tag.id))
    }
    visit(selectedTagId)
    return ids
  }, [activeTags, selectedTagId, state])
  const taggedCards = useMemo(() => selectedTagIds.size
    ? allCards.filter((card) => card.status !== 'deleted' && card.tagIds.some((tagId) => selectedTagIds.has(tagId)))
    : [], [allCards, selectedTagIds])
  const tagBoard = useMemo<Board>(() => ({
    id: '__vistask_tags__', projectId: '', status: 'active', statusChangedAt: null, title: 'Tag', color: '#25ae9f', sort: 0, height: null,
    filter: { staged: true, in_progress: true, done: true, deleted: false }, cards: taggedCards
  }), [taggedCards])

  useEffect(() => {
    if (!activeTags.length) { if (selectedTagId) setSelectedTagId(null); return }
    if (!selectedTagId || !activeTags.some((tag) => tag.id === selectedTagId)) setSelectedTagId(activeTags[0].id)
  }, [activeTags, selectedTagId])
  const flaggedCards = useMemo(() => allCards.filter((card) => card.flagged && card.status !== 'deleted' && (includeCompleted || card.status !== 'done')), [allCards, includeCompleted])
  const displayedFlaggedCards = useMemo(() => {
    const parents = new Map(allCards.filter((card) => !card.parentId).map((card) => [card.id, card]))
    const candidateIds = new Set<string>()
    for (const card of flaggedCards) {
      if (card.parentId) {
        candidateIds.add(card.id)
        continue
      }
      const children = allCards.filter((child) => child.parentId === card.id)
      if (!children.length) {
        candidateIds.add(card.id)
        continue
      }
      children.filter((child) => child.status !== 'deleted' && (includeCompleted || child.status !== 'done'))
        .forEach((child) => candidateIds.add(child.id))
    }
    const candidates = allCards.filter((card) => candidateIds.has(card.id))
    if (importantChildDisplay === 'all') return candidates
    const firstSerialChildIds = new Set<string>()
    for (const parent of parents.values()) {
      if (parent.childMode !== 'serial') continue
      const children = candidates.filter((card) => card.parentId === parent.id).sort((left, right) => {
        if (parent.repeatEnabled) {
          const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.POSITIVE_INFINITY
          const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.POSITIVE_INFINITY
          if (leftDue !== rightDue) return leftDue - rightDue
        }
        return left.sort - right.sort || left.createdAt.localeCompare(right.createdAt)
      })
      if (children[0]) firstSerialChildIds.add(children[0].id)
    }
    return candidates.filter((card) => {
      if (!card.parentId) return true
      const parent = parents.get(card.parentId)
      return !parent || parent.childMode !== 'serial' || firstSerialChildIds.has(card.id)
    })
  }, [allCards, flaggedCards, importantChildDisplay, includeCompleted])
  const importantBoard = useMemo<Board>(() => ({
    id: '__cardex_important__', projectId: '', status: 'active', statusChangedAt: null, title: '重要', color: '#e6a02d', sort: 0, height: null,
    filter: { staged: true, in_progress: true, done: includeCompleted, deleted: false }, cards: displayedFlaggedCards
  }), [displayedFlaggedCards, includeCompleted])
  const overdueCards = useMemo(() => allCards.filter((card) => {
    if (card.status !== 'in_progress' || !card.dueAt) return false
    const dueTimestamp = new Date(card.dueAt).getTime()
    return Number.isFinite(dueTimestamp) && dueTimestamp < now
  }), [allCards, now])
  const filteredOverdueCards = useMemo(() => overdueFlaggedOnly
    ? overdueCards.filter((card) => card.flagged)
    : overdueCards, [overdueCards, overdueFlaggedOnly])
  const displayedOverdueCards = useMemo(() => {
    if (overdueChildDisplay === 'all') return filteredOverdueCards
    const parents = new Map(allCards.filter((card) => !card.parentId).map((card) => [card.id, card]))
    const firstSerialChildIds = new Set<string>()
    for (const parent of parents.values()) {
      if (parent.childMode !== 'serial') continue
      const children = filteredOverdueCards.filter((card) => card.parentId === parent.id).sort((left, right) => {
        if (parent.repeatEnabled) {
          const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.POSITIVE_INFINITY
          const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.POSITIVE_INFINITY
          if (leftDue !== rightDue) return leftDue - rightDue
        }
        return left.sort - right.sort || left.createdAt.localeCompare(right.createdAt)
      })
      if (children[0]) firstSerialChildIds.add(children[0].id)
    }
    return filteredOverdueCards.filter((card) => {
      if (!card.parentId) return true
      const parent = parents.get(card.parentId)
      return !parent || parent.childMode !== 'serial' || firstSerialChildIds.has(card.id)
    })
  }, [allCards, filteredOverdueCards, overdueChildDisplay])
  const overdueBoard = useMemo<Board>(() => {
    return {
      id: '__cardex_overdue__', projectId: '', status: 'active', statusChangedAt: null, title: '过期', color: '#d96767', sort: 0, height: null,
      filter: { staged: false, in_progress: true, done: false, deleted: false },
      cards: displayedOverdueCards
    }
  }, [displayedOverdueCards])
  const statistics = useMemo(() => {
    const currentCards = allCards.filter((card) => card.status === 'in_progress')
    const currentOverdue = currentCards.filter((card) => card.dueAt && new Date(card.dueAt).getTime() < now)
    const current = {
      inProgress: currentCards.length,
      important: currentCards.filter((card) => card.flagged).length,
      overdue: currentOverdue.length,
      importantOverdue: currentOverdue.filter((card) => card.flagged).length
    }
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const monthStart = new Date(now)
    monthStart.setMonth(monthStart.getMonth() - 1)
    const period = (start: number): StatisticPeriod => {
      const completed = allCards.filter((card) => card.status === 'done' && new Date(card.updatedAt).getTime() >= start)
      const pomodoros = completed.reduce((total, card) => total + (Number(card.pomodoroCount) || 0), 0)
      const minutes = completed.reduce((total, card) => total + (Number(card.focusMinutes) || 0), 0)
      return { completedCards: completed.length, pomodoros, hours: minutes / 60 }
    }
    return {
      current,
      today: period(todayStart.getTime()),
      week: period(now - 7 * 24 * 60 * 60 * 1000),
      month: period(monthStart.getTime())
    }
  }, [allCards, now])
  const inboxBoard = useMemo(() => state?.boards.find((board) => board.id === INBOX_BOARD_ID) ?? null, [state])
  const displayedInboxBoard = useMemo<Board | null>(() => inboxBoard && state ? {
    ...inboxBoard,
    filter: {
      staged: state.inboxSettings.in_progress,
      in_progress: state.inboxSettings.in_progress,
      done: state.inboxSettings.done,
      deleted: state.inboxSettings.deleted
    }
  } : null, [inboxBoard, state])
  const inboxVisibleCount = displayedInboxBoard?.cards.filter((card) => displayedInboxBoard.filter[card.status] !== false).length ?? 0
  const regularVisibleBoards = useMemo(() => {
    if (!state) return []
    const boards = state.boards
      .filter((board) => board.id !== INBOX_BOARD_ID && board.status === 'active' && activeProjectIds.has(board.projectId))
      .sort((left, right) => left.sort - right.sort)
    return activeProjectId ? boards.filter((board) => board.projectId === activeProjectId) : boards
  }, [activeProjectId, activeProjectIds, state])
  const activeTagViewConfig = activeProjectId ? state?.tagViewSettings[activeProjectId] : undefined
  const visibleBoards = useMemo(() => {
    if (!state || !activeProjectId || !activeTagViewConfig?.enabled) return regularVisibleBoards
    const categoryValues = activeTags.filter((tag) => tag.parentId === activeTagViewConfig.categoryTagId)
    if (!categoryValues.length) return regularVisibleBoards
    const projectCards = state.boards
      .filter((board) => board.id !== INBOX_BOARD_ID && board.status === 'active' && board.projectId === activeProjectId)
      .flatMap((board) => board.cards)
      .filter((card) => activeTagViewConfig.statuses[card.status])
    const descendantIds = (rootId: string): Set<string> => {
      const result = new Set<string>()
      const visit = (tagId: string): void => {
        if (result.has(tagId)) return
        result.add(tagId)
        activeTags.filter((tag) => tag.parentId === tagId).forEach((tag) => visit(tag.id))
      }
      visit(rootId)
      return result
    }
    const valueTagIds = categoryValues.map((tag) => ({ tag, ids: descendantIds(tag.id) }))
    const matchedCardIds = new Set<string>()
    const boards = valueTagIds.map(({ tag, ids }, index): Board => {
      const cards = projectCards.filter((card) => card.tagIds.some((tagId) => ids.has(tagId)))
      cards.forEach((card) => matchedCardIds.add(card.id))
      return {
        id: `__tag_view__:${activeProjectId}:${tag.id}`,
        projectId: activeProjectId,
        status: 'active', statusChangedAt: null, title: tag.title, color: COLORS[index % COLORS.length], sort: index, height: null,
        filter: { ...activeTagViewConfig.statuses }, cards
      }
    })
    boards.push({
      id: `__tag_view__:${activeProjectId}:unassigned`,
      projectId: activeProjectId,
      status: 'active', statusChangedAt: null, title: '无该类别标签', color: '#a5aaa8', sort: boards.length, height: null,
      filter: { ...activeTagViewConfig.statuses }, cards: projectCards.filter((card) => !matchedCardIds.has(card.id))
    })
    return boards
  }, [activeProjectId, activeTagViewConfig, activeTags, regularVisibleBoards, state])
  const isTagViewActive = Boolean(activeProjectId && activeTagViewConfig?.enabled
    && activeTags.some((tag) => tag.parentId === activeTagViewConfig.categoryTagId))
  const selectedProject = activeProjectId ? activeProjects.find((project) => project.id === activeProjectId) || null : null
  const visibleProjectCardCount = new Set(visibleBoards.flatMap((board) => board.cards.map((card) => card.id))).size

  useEffect(() => {
    const handleAppShortcut = (event: KeyboardEvent): void => {
      if (event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setSearchOpen(true)
        return
      }
      if (event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        setView('boards')
        return
      }
      if (event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === 't') {
        event.preventDefault()
        setView('tags')
        return
      }
      if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      if (view !== 'boards' || !/^[1-9]$/.test(event.key)) return
      const project = activeProjects[Number(event.key) - 1]
      if (!project) return
      event.preventDefault()
      setActiveProjectId(project.id)
      setState((current) => {
        if (!current) return current
        const next = { ...current, lastProjectId: project.id }
        void window.api.saveBoards(next).catch((error) => console.error('保存快捷键切换项目失败', error))
        return next
      })
    }
    window.addEventListener('keydown', handleAppShortcut)
    return () => window.removeEventListener('keydown', handleAppShortcut)
  }, [activeProjects, view])

  useEffect(() => {
    if (!locatedSearchResult) return
    let attempts = 0
    let timer = 0
    const locate = (): void => {
      const element = document.querySelector<HTMLElement>(`[data-search-key="${locatedSearchResult.type}:${locatedSearchResult.id}"]`)
      if (!element && attempts < 12) {
        attempts += 1
        timer = window.setTimeout(locate, 70)
        return
      }
      if (!element) { setLocatedSearchResult(null); return }
      element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
      element.classList.add('search-located-target')
      timer = window.setTimeout(() => {
        element.classList.remove('search-located-target')
        setLocatedSearchResult(null)
      }, 2200)
    }
    timer = window.setTimeout(locate, 40)
    return () => window.clearTimeout(timer)
  }, [activeProjectId, locatedSearchResult, view])

  useEffect(() => {
    if (view !== 'boards') return
    const viewport = boardsViewportRef.current
    const row = viewport?.querySelector<HTMLElement>('.boards-row')
    if (!viewport || !row) return
    viewport.scrollTo({ left: 0, top: 0 })
    const updateOverflow = (): void => {
      setHasMoreBoardsRight(viewport.scrollWidth - viewport.scrollLeft - viewport.clientWidth > 2)
      setHasMoreBoardsBelow(viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight > 2)
    }
    const frame = window.requestAnimationFrame(updateOverflow)
    const observer = new ResizeObserver(updateOverflow)
    observer.observe(viewport)
    observer.observe(row)
    Array.from(row.children).forEach((child) => observer.observe(child))
    viewport.addEventListener('scroll', updateOverflow, { passive: true })
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      viewport.removeEventListener('scroll', updateOverflow)
    }
  }, [activeProjectId, state?.displaySettings.boardColumns, state?.displaySettings.boardWidth, view, visibleBoards.length])

  function updateBoard(boardId: string, updater: (board: Board) => Board): void {
    setState((current) => current ? { ...current, boards: current.boards.map((board) => board.id === boardId ? updater(board) : board) } : current)
  }

  function setBoardHeight(boardId: string, height: number | null): void {
    if (!state) return
    const nextState: BoardState = {
      ...state,
      boards: state.boards.map((board) => board.id === boardId ? { ...board, height } : board)
    }
    setState(nextState)
    void window.api.saveBoards(nextState).catch((error) => console.error('保存看板高度失败', error))
  }

  function setBoardHeightMode(boardHeight: BoardState['displaySettings']['boardHeight']): void {
    if (!state) return
    const nextState: BoardState = {
      ...state,
      displaySettings: { ...state.displaySettings, boardHeight }
    }
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    setState(nextState)
    void window.api.saveBoards(nextState).catch((error) => console.error('保存看板高度设置失败', error))
  }

  function updateCard(cardId: string, patch: Partial<BoardCard>): void {
    setState((current) => {
      if (!current) return current
      const updatedAt = new Date().toISOString()
      const next = { ...current, boards: current.boards.map((board) => ({
        ...board,
        cards: board.cards.map((card) => {
          if (card.id !== cardId) return card
          if (patch.status === 'deleted' && card.status !== 'deleted') return {
            ...card, ...patch, statusBeforeDelete: card.status, statusChangedAt: updatedAt, updatedAt
          }
          return { ...card, ...patch, updatedAt }
        })
      })) }
      return expandRepeatCards(next)
    })
  }

  function openNewCard(boardId: string, parentId: string | null = null): void {
    if (parentId) {
      const card = { ...newCard(boardId, parentId), title: '未命名' }
      const parentMode = state?.boards.find((board) => board.id === boardId)?.cards.find((item) => item.id === parentId)?.childMode
      setState((current) => current ? {
        ...current,
        boards: current.boards.map((board) => {
          if (board.id !== boardId) return board
          const siblingSorts = board.cards.filter((item) => item.parentId === parentId).map((item) => item.sort)
          const child = { ...card, sort: (siblingSorts.length ? Math.min(...siblingSorts) : 0) - 1 }
          return {
            ...board,
            filter: { ...board.filter, in_progress: true },
            cards: [...board.cards, child]
          }
        })
      } : current)
      setCollapsed((current) => {
        if (!current.has(parentId)) return current
        const next = new Set(current)
        next.delete(parentId)
        return next
      })
      setChildDisplaySelections((current) => ({ ...current, [parentId]: parentMode === 'serial' ? 'in_progress_first' : 'in_progress' }))
      setInlineEditingCardId(card.id)
      return
    }
    const card = { ...newCard(boardId), title: '未命名' }
    setState((current) => current ? {
      ...current,
      inboxSettings: boardId === INBOX_BOARD_ID ? { ...current.inboxSettings, in_progress: true } : current.inboxSettings,
      boards: current.boards.map((board) => board.id === boardId ? {
        ...board,
        filter: { ...board.filter, in_progress: true },
        cards: [card, ...board.cards].map((item, sort) => ({ ...item, sort }))
      } : board)
    } : current)
    setInlineEditingCardId(card.id)
  }

  function saveCard(): void {
    if (!editingCard?.title.trim()) return
    const timestamp = new Date().toISOString()
    const card: BoardCard = {
      ...editingCard,
      title: editingCard.title.trim(),
      repeatStart: editingCard.repeatEnabled ? editingCard.repeatStart || dateTimeInputValue() : editingCard.repeatStart,
      childMode: editingCard.childMode,
      dueAt: editingCard.repeatEnabled ? null : editingCard.dueAt,
      updatedAt: timestamp
    }
    setState((current) => {
      if (!current) return current
      const boards = current.boards.map((board) => {
        if (board.id !== card.boardId) return board
        return isNewCard
          ? { ...board, cards: [...board.cards, card] }
          : { ...board, cards: board.cards.map((item) => item.id === card.id ? card : item) }
      })
      return expandRepeatCards({ ...current, boards })
    })
    setEditingCard(null)
    setEditingCardAnchor(null)
  }

  function openCardEditor(card: BoardCard, anchor: DOMRect): void {
    setEditingCard({ ...card })
    setEditingCardAnchor(anchor)
    setIsNewCard(false)
  }

  function closeCardEditor(): void {
    setEditingCard(null)
    setEditingCardAnchor(null)
  }

  function addBoard(): void {
    if (!activeProjects.length) {
      setProjectManagerOpen(true)
      return
    }
    setEditingBoard({ id: null, title: '' })
  }

  function addInboxCard(): void {
    if (!state) return
    const inbox = state.boards.find((board) => board.id === INBOX_BOARD_ID)
    if (inbox) {
      openNewCard(inbox.id)
      return
    }
    const board: Board = {
      id: INBOX_BOARD_ID, projectId: '', status: 'active', statusChangedAt: null, title: INBOX_BOARD_TITLE, color: '#aeb1b9', sort: -1, height: null,
      filter: { ...INBOX_FILTER }, cards: []
    }
    setState({ ...state, boards: [...state.boards, board] })
    openNewCard(INBOX_BOARD_ID)
  }

  function saveBoard(): void {
    const title = editingBoard?.title.trim()
    if (!title || !editingBoard || !state) return
    if (editingBoard.id) {
      updateBoard(editingBoard.id, (board) => ({ ...board, title }))
    } else {
      setState({ ...state, boards: [...state.boards, {
        id: uid(), projectId: activeProjectId || activeProjects[0]?.id || '', title,
        color: COLORS[state.boards.length % COLORS.length], sort: state.boards.length,
        status: 'active', statusChangedAt: null, height: null, filter: { ...DEFAULT_FILTER }, cards: []
      }] })
    }
    setEditingBoard(null)
  }

  function addProject(titleValue: string): string | null {
    const title = titleValue.trim()
    if (!title || !state) return null
    const now = new Date().toISOString()
    const project: Project = {
      id: uid(), title, color: COLORS[state.projects.length % COLORS.length], sort: state.projects.length,
      createdAt: now, updatedAt: now, deletedAt: null, archivedAt: null
    }
    setState({ ...state, projects: [...state.projects, project], lastProjectId: project.id })
    setActiveProjectId(project.id)
    return project.id
  }

  function selectActiveProject(projectId: string): void {
    const nextProjectId = activeProjectId === projectId ? null : projectId
    setActiveProjectId(nextProjectId)
    setState((current) => {
      if (!current) return current
      const next = { ...current, lastProjectId: nextProjectId }
      void window.api.saveBoards(next).catch((error) => console.error('保存上次项目失败', error))
      return next
    })
  }

  function renameProject(projectId: string, titleValue: string): void {
    const title = titleValue.trim()
    if (!title) return
    const updatedAt = new Date().toISOString()
    setState((current) => current ? { ...current, projects: current.projects.map((project) => project.id === projectId ? { ...project, title, updatedAt } : project) } : current)
  }

  function setProjectDeleted(projectId: string, deleted: boolean): void {
    const updatedAt = new Date().toISOString()
    setState((current) => current ? {
      ...current,
      lastProjectId: deleted && current.lastProjectId === projectId ? null : current.lastProjectId,
      projects: current.projects.map((project) => project.id === projectId
        ? { ...project, deletedAt: deleted ? updatedAt : null, archivedAt: deleted ? null : project.archivedAt, updatedAt }
        : project)
    } : current)
    if (deleted && activeProjectId === projectId) setActiveProjectId(null)
  }

  function archiveProject(projectId: string): void {
    const updatedAt = new Date().toISOString()
    setState((current) => current ? {
      ...current,
      lastProjectId: current.lastProjectId === projectId ? null : current.lastProjectId,
      projects: current.projects.map((project) => project.id === projectId
        ? { ...project, archivedAt: updatedAt, deletedAt: null, updatedAt }
        : project)
    } : current)
    if (activeProjectId === projectId) setActiveProjectId(null)
  }

  function reorderProjects(draggedId: string, targetId: string): void {
    if (draggedId === targetId) return
    setState((current) => {
      if (!current) return current
      const projects = [...current.projects].sort((a, b) => a.sort - b.sort)
      const from = projects.findIndex((project) => project.id === draggedId)
      const to = projects.findIndex((project) => project.id === targetId)
      if (from < 0 || to < 0) return current
      const [moving] = projects.splice(from, 1)
      projects.splice(to, 0, moving)
      const updatedAt = new Date().toISOString()
      return { ...current, projects: projects.map((project, sort) => ({ ...project, sort, updatedAt })) }
    })
  }

  function reorderBoards(draggedId: string, targetId: string): void {
    if (draggedId === targetId) return
    setState((current) => {
      if (!current) return current
      const boards = current.boards.filter((board) => board.id !== INBOX_BOARD_ID && board.status === 'active').sort((left, right) => left.sort - right.sort)
      const from = boards.findIndex((board) => board.id === draggedId)
      const to = boards.findIndex((board) => board.id === targetId)
      if (from < 0 || to < 0) return current
      const [moving] = boards.splice(from, 1)
      boards.splice(to, 0, moving)
      const reordered = new Map(boards.map((board, sort) => [board.id, { ...board, sort }]))
      return { ...current, boards: current.boards.map((board) => reordered.get(board.id) || board) }
    })
  }

  function previewBoardOrder(targetId: string): void {
    const draggedId = dragBoardIdRef.current
    if (!draggedId || draggedId === targetId || dragBoardTargetIdRef.current === targetId) return
    dragBoardTargetIdRef.current = targetId
    setDragBoardTargetId(targetId)
    reorderBoards(draggedId, targetId)
  }

  function dropBoard(draggedId: string, targetId: string): void {
    if (draggedId && draggedId !== targetId && dragBoardTargetIdRef.current !== targetId) reorderBoards(draggedId, targetId)
    finishBoardDrag()
  }

  function finishBoardDrag(): void {
    dragBoardIdRef.current = null
    dragBoardTargetIdRef.current = null
    setDragBoardId(null)
    setDragBoardTargetId(null)
  }

  function setBoardStatus(boardId: string, status: BoardStatus): void {
    setFilterBoardId(null)
    updateBoard(boardId, (board) => ({ ...board, status, statusChangedAt: status === 'active' ? null : new Date().toISOString() }))
  }

  function restoreProject(projectId: string): void {
    const updatedAt = new Date().toISOString()
    setState((current) => current ? {
      ...current,
      projects: current.projects.map((project) => project.id === projectId
        ? { ...project, deletedAt: null, archivedAt: null, updatedAt }
        : project)
    } : current)
  }

  function restoreCard(cardId: string): void {
    const updatedAt = new Date().toISOString()
    setState((current) => current ? {
      ...current,
      boards: current.boards.map((board) => ({
        ...board,
        cards: board.cards.map((card) => card.id === cardId && card.status === 'deleted'
          ? { ...card, status: card.statusBeforeDelete || 'in_progress', statusBeforeDelete: null, statusChangedAt: null, updatedAt }
          : card)
      }))
    } : current)
  }

  function permanentlyDelete(type: DataManagementItem['type'], id: string): void {
    if (!state) return
    let nextState: BoardState
    if (type === '项目') {
      const removedCardIds = new Set(state.boards.filter((board) => board.projectId === id).flatMap((board) => board.cards).map((card) => card.id))
      nextState = {
        ...state,
        focus: state.focus && removedCardIds.has(state.focus.cardId) ? null : state.focus,
        lastProjectId: state.lastProjectId === id ? null : state.lastProjectId,
        projects: state.projects.filter((project) => project.id !== id),
        boards: state.boards.filter((board) => board.projectId !== id)
      }
      if (activeProjectId === id) setActiveProjectId(null)
    } else if (type === '看板') {
      const removedCardIds = new Set(state.boards.find((board) => board.id === id)?.cards.map((card) => card.id) || [])
      nextState = {
        ...state,
        focus: state.focus && removedCardIds.has(state.focus.cardId) ? null : state.focus,
        boards: state.boards.filter((board) => board.id !== id)
      }
    } else {
      const deleteIds = new Set<string>([id])
      let changed = true
      while (changed) {
        changed = false
        for (const card of state.boards.flatMap((board) => board.cards)) {
          if (card.parentId && deleteIds.has(card.parentId) && !deleteIds.has(card.id)) {
            deleteIds.add(card.id)
            changed = true
          }
        }
      }
      nextState = {
        ...state,
        focus: state.focus && deleteIds.has(state.focus.cardId) ? null : state.focus,
        boards: state.boards.map((board) => ({ ...board, cards: board.cards.filter((card) => !deleteIds.has(card.id)) }))
      }
    }
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    setState(nextState)
    void window.api.saveBoards(nextState).catch((error) => console.error('彻底删除失败', error))
  }

  function toggleCollapse(cardId: string): void {
    setCollapsed((current) => {
      const next = new Set(current); if (next.has(cardId)) next.delete(cardId); else next.add(cardId); return next
    })
  }

  function setChildDisplaySelection(cardId: string, display: ChildDisplay): void {
    setChildDisplaySelections((current) => ({ ...current, [cardId]: display }))
  }

  function addTag(parentId: string | null, titleValue: string): void {
    if (!state) return
    let depth = 1
    let parent = parentId ? state.tags.find((tag) => tag.id === parentId) : undefined
    while (parent?.parentId) {
      depth += 1
      parent = state.tags.find((tag) => tag.id === parent?.parentId)
    }
    if (parentId && depth >= 3) {
      window.alert('Tag 最多支持三级，不能继续新增子 Tag。')
      return
    }
    const title = titleValue.trim()
    if (!title) return
    const timestamp = new Date().toISOString()
    const tag: CardTag = {
      id: uid(), title, parentId,
      sort: state.tags.filter((item) => item.parentId === parentId).length,
      createdAt: timestamp, updatedAt: timestamp, deletedAt: null
    }
    setState((current) => current ? { ...current, tags: [...current.tags, tag] } : current)
    setSelectedTagId(tag.id)
  }

  function deleteTag(tagId: string): void {
    if (!state) return
    const tag = state.tags.find((item) => item.id === tagId)
    if (!tag || !window.confirm(`删除 Tag“${tag.title}”？已添加到卡片的关联会保留。`)) return
    const updatedAt = new Date().toISOString()
    setState((current) => current ? {
      ...current,
      tags: current.tags.map((item) => item.id === tagId ? { ...item, deletedAt: updatedAt, updatedAt } : item)
    } : current)
    if (selectedTagId === tagId) setSelectedTagId(null)
  }

  function reorderTags(draggedId: string, targetId: string): void {
    if (draggedId === targetId) return
    setState((current) => {
      if (!current) return current
      const dragged = current.tags.find((tag) => tag.id === draggedId && !tag.deletedAt)
      const target = current.tags.find((tag) => tag.id === targetId && !tag.deletedAt)
      if (!dragged || !target || dragged.parentId !== target.parentId) return current
      const siblings = current.tags.filter((tag) => !tag.deletedAt && tag.parentId === dragged.parentId).sort((left, right) => left.sort - right.sort)
      const from = siblings.findIndex((tag) => tag.id === draggedId)
      const to = siblings.findIndex((tag) => tag.id === targetId)
      if (from < 0 || to < 0) return current
      const [moving] = siblings.splice(from, 1)
      siblings.splice(to, 0, moving)
      const updatedAt = new Date().toISOString()
      const reordered = new Map(siblings.map((tag, sort) => [tag.id, { ...tag, sort, updatedAt }]))
      return { ...current, tags: current.tags.map((tag) => reordered.get(tag.id) || tag) }
    })
  }

  function cycleCardStatus(card: BoardCard): void {
    setState((current) => {
      if (!current) return current
      const updatedAt = new Date().toISOString()
      const boards = current.boards.map((board) => ({
        ...board,
        cards: board.cards.map((item) => item.id === card.id
          ? item.status === 'deleted' ? item : { ...item, status: item.status === 'in_progress' ? 'done' as const : 'in_progress' as const, updatedAt }
          : item)
      }))
      return expandRepeatCards({ ...current, boards })
    })
  }

  function moveCard(cardId: string, targetBoardId: string, beforeId: string | null = null): void {
    if (!state || cardId === beforeId) return
    const moving = allCards.find((card) => card.id === cardId)
    if (!moving) return
    const childIds = moving.parentId ? [] : allCards.filter((card) => card.parentId === cardId).map((card) => card.id)
    const movingIds = new Set([cardId, ...childIds])
    const moved = allCards.filter((card) => movingIds.has(card.id)).map((card) => ({
      ...card, boardId: targetBoardId,
      parentId: card.id === cardId && moving.parentId && moving.boardId !== targetBoardId ? null : card.parentId
    }))
    setState({ ...state, boards: state.boards.map((board) => {
      const remaining = board.cards.filter((card) => !movingIds.has(card.id))
      if (board.id !== targetBoardId) return { ...board, cards: remaining }
      const index = beforeId ? remaining.findIndex((card) => card.id === beforeId) : -1
      const merged = index >= 0 ? [...remaining.slice(0, index), ...moved, ...remaining.slice(index)] : [...remaining, ...moved]
      return { ...board, cards: merged.map((card, sort) => ({ ...card, sort })) }
    }) })
  }

  function startCardDrag(cardId: string | null): void {
    setDragCardId(cardId)
    if (cardId) {
      setDragCardTargetId(null)
      setDragCardTargetBoardId(null)
    } else {
      setDragCardTargetId(null)
      setDragCardTargetBoardId(null)
    }
  }

  function previewCardPosition(targetBoardId: string, beforeId: string | null = null): void {
    if (!dragCardId || dragCardId === beforeId) return
    if (dragCardTargetBoardId === targetBoardId && dragCardTargetId === beforeId) return
    setDragCardTargetBoardId(targetBoardId)
    setDragCardTargetId(beforeId)
    const moving = allCards.find((card) => card.id === dragCardId)
    if (moving?.boardId === targetBoardId) moveCard(dragCardId, targetBoardId, beforeId)
  }

  function startFocus(cardId: string): void {
    setState((current) => {
      if (!current || (current.focus && current.focus.cardId !== cardId)) return current
      if (current.focus?.running) return current
      const durationMs = current.focus?.durationMs || current.focusSettings.durationMinutes * 60 * 1000
      const remainingMs = current.focus?.remainingMs || durationMs
      return { ...current, focus: { cardId, startedAt: Date.now(), endsAt: Date.now() + remainingMs, remainingMs, durationMs, running: true } }
    })
    setNow(Date.now())
  }

  function pauseFocus(): void {
    setState((current) => current?.focus ? {
      ...current, focus: { ...current.focus, remainingMs: Math.max(0, current.focus.endsAt - Date.now()), running: false }
    } : current)
  }

  function stopFocus(): void {
    if (!state?.focus) return
    const focus = state.focus
    const durationMs = focus.durationMs || state.focusSettings.durationMinutes * 60 * 1000
    const remainingMs = focus.running ? Math.max(0, focus.endsAt - Date.now()) : focus.remainingMs
    const credit = calculateFocusCredit(durationMs, remainingMs)
    if (!credit.eligible) {
      const confirmed = window.confirm(`本次仅推进 ${credit.elapsedMinutes.toFixed(1)} 分钟，未达到有效记录门槛 ${credit.minimumMinutes.toFixed(1)} 分钟，因此不会计入统计。仍要结束推进吗？`)
      if (confirmed) setState((current) => current ? { ...current, focus: null } : current)
      return
    }
    const confirmed = window.confirm(`本次推进 ${credit.elapsedMinutes.toFixed(1)} 分钟，折合 ${credit.pomodoros.toFixed(1)} 个番茄。确认结束并计入统计吗？`)
    if (!confirmed) return
    const creditedMinutes = Number(credit.elapsedMinutes.toFixed(1))
    setState((current) => current ? {
      ...current,
      focus: null,
      boards: current.boards.map((board) => ({
        ...board,
        cards: board.cards.map((card) => card.id === focus.cardId
          ? { ...card, focusMinutes: card.focusMinutes + creditedMinutes, pomodoroCount: card.pomodoroCount + credit.pomodoros }
          : card)
      }))
    } : current)
  }

  async function selectDatabase(mode: 'create' | 'choose' | 'default'): Promise<DatabaseInfo | null> {
    setStorageSwitching(true)
    try {
      const result = mode === 'create' ? await window.api.createDatabase()
        : mode === 'choose' ? await window.api.chooseDatabase()
          : await window.api.useDefaultDatabase()
      if (!result) return null
      const normalized = expandRepeatCards(normalizeStoredState(result.state))
      setState(normalized)
      setBoardDisplaySelections(normalized.boardDisplaySettings)
      const restoredProjectId = normalized.lastProjectId && normalized.projects.some((project) => project.id === normalized.lastProjectId && !project.deletedAt && !project.archivedAt)
        ? normalized.lastProjectId : normalized.lastProjectId ? normalized.projects.find((project) => !project.deletedAt && !project.archivedAt)?.id || null : null
      setActiveProjectId(restoredProjectId)
      return result.info
    } finally {
      setStorageSwitching(false)
    }
  }

  function openSearchResult(result: SearchResult): void {
    if (!state) return
    setSearchOpen(false)
    if (!result.navigable) {
      setView('settings')
      return
    }
    setLocatedSearchResult({ type: result.type, id: result.id })
    if (result.projectId) {
      setActiveProjectId(result.projectId)
      setState((current) => current ? { ...current, lastProjectId: result.projectId } : current)
    }
    if (result.type === 'project' || result.type === 'board') {
      setView('boards')
      return
    }
    const board = state.boards.find((item) => item.id === result.boardId)
    const card = board?.cards.find((item) => item.id === result.id)
    if (!card) return
    if (board && board.id !== INBOX_BOARD_ID) setBoardDisplaySelections((current) => ({ ...current, [board.id]: 'all' }))
    if (card.parentId) {
      setCollapsed((current) => { const next = new Set(current); next.delete(card.parentId as string); return next })
      setChildDisplaySelections((current) => ({ ...current, [card.parentId as string]: 'all' }))
    }
    setView(board?.id === INBOX_BOARD_ID ? 'inbox' : 'boards')
  }

  if (!state) return <div className="loading-screen">正在打开 Vistask…</div>
  const focusCard = state.focus ? allCards.find((card) => card.id === state.focus?.cardId) : null
  const focusRemaining = state.focus ? (state.focus.running ? state.focus.endsAt - now : state.focus.remainingMs) : 0
  const boardWidthPixels = ({ narrow: 220, medium: 276, wide: 340 } as const)[state.displaySettings.boardWidth]
  const boardRowWidth = state.displaySettings.boardColumns === 'auto' ? '100%'
    : `${state.displaySettings.boardColumns * boardWidthPixels + (state.displaySettings.boardColumns - 1) * 10}px`
  return <div className={`app-shell font-${state.displaySettings.fontSize}`}>
    <aside className="sidebar">
      <button className={view === 'boards' ? 'brand-mark active' : 'brand-mark'} onClick={() => setView('boards')} title="项目主页" aria-label="项目主页">
        <svg className="projects-nav-icon" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3.5" y="7.5" width="3.5" height="8.5" rx="1.35" />
          <rect x="10.25" y="5" width="3.5" height="13.5" rx="1.35" />
          <rect x="17" y="6.5" width="3.5" height="10.5" rx="1.35" />
        </svg>
      </button>
      <nav>
        <button className={view === 'inbox' ? 'nav-button active' : 'nav-button'} onClick={() => setView('inbox')} title="收件箱" aria-label="收件箱">
          <MailOutlined className="inbox-nav-icon" />
        </button>
        <button className={view === 'overdue' ? 'nav-button overdue-nav-button active' : 'nav-button overdue-nav-button'} onClick={() => setView('overdue')} title="过期" aria-label="过期"><OverdueIcon /></button>
        <button className={view === 'flagged' ? 'nav-button active' : 'nav-button'} onClick={() => setView('flagged')} title="重要" aria-label="重要"><FlagIcon filled={view === 'flagged'} /></button>
        <button className={view === 'tags' ? 'nav-button active' : 'nav-button'} onClick={() => setView('tags')} title="Tag" aria-label="Tag">
          <TagsOutlined className="tags-nav-icon" />
        </button>
        <button className={view === 'statistics' ? 'nav-button active' : 'nav-button'} onClick={() => setView('statistics')} title="统计" aria-label="统计">
          <LineChartOutlined className="statistics-nav-icon" />
        </button>
      </nav>
      <div className="sidebar-footer">
        <button className={view === 'settings' ? 'settings-button active' : 'settings-button'} onClick={() => setView('settings')} title="设置" aria-label="设置">
          <svg className="settings-gear" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.07-.94l2.03-1.58-1.92-3.32-2.39.96a7.3 7.3 0 0 0-1.62-.94L14.87 3h-3.84l-.37 3.18c-.58.24-1.12.56-1.62.94l-2.39-.96-1.92 3.32 2.03 1.58c-.04.31-.07.64-.07.94s.03.63.07.94l-2.03 1.58 1.92 3.32 2.39-.96c.5.39 1.04.7 1.62.94l.37 3.18h3.84l.36-3.18c.59-.24 1.13-.55 1.63-.94l2.39.96 1.92-3.32-2.03-1.58ZM12.95 15.3a3.3 3.3 0 1 1 0-6.6 3.3 3.3 0 0 1 0 6.6Z" />
          </svg>
        </button>
      </div>
    </aside>
    <main className="workspace">
      {view === 'boards' && <ProjectBar projects={activeProjects} activeProjectId={activeProjectId}
        requestedRenameId={requestedProjectRenameId} onRenameRequestHandled={() => setRequestedProjectRenameId(null)}
        onSelect={selectActiveProject} onAdd={() => addProject('未命名项目')} onRename={renameProject} onReorder={reorderProjects} />}
      {view === 'boards' && <ProjectInfoBar project={selectedProject} projectCount={activeProjects.length}
        boardCount={visibleBoards.length} cardCount={visibleProjectCardCount}
        tags={activeTags} tagViewConfig={activeProjectId ? state.tagViewSettings[activeProjectId] : undefined}
        onTagViewChange={(projectId, config) => setState((current) => current ? {
          ...current, tagViewSettings: { ...current.tagViewSettings, [projectId]: config }
        } : current)}
        onRenameRequest={setRequestedProjectRenameId} onArchive={archiveProject} onDelete={(projectId) => setProjectDeleted(projectId, true)} />}
      {view === 'flagged' && <>
        <header className="topbar">
          <div className="topbar-title"><h1>重要</h1><span>{displayedFlaggedCards.length}</span></div>
          <label className="completed-toggle"><input type="checkbox" checked={includeCompleted} onChange={(event) => setIncludeCompleted(event.target.checked)} />显示已完成</label>
        </header>
        <ChildDisplayFilterControl groupName="important" value={importantChildDisplay} onChange={setImportantChildDisplay} />
      </>}
      {view === 'overdue' && <>
        <header className="topbar">
          <div className="topbar-title"><h1>过期</h1><span>{filteredOverdueCards.length}</span></div>
        </header>
        <ChildDisplayFilterControl groupName="overdue" value={overdueChildDisplay} onChange={setOverdueChildDisplay}
          flaggedOnly={overdueFlaggedOnly} onFlaggedOnlyChange={setOverdueFlaggedOnly} />
      </>}
      {view === 'inbox' && <InboxHeader count={inboxVisibleCount} settings={state.inboxSettings}
        onChange={(inboxSettings) => setState((current) => current ? { ...current, inboxSettings } : current)} />}
      {view === 'statistics' && <header className="topbar">
        <div className="topbar-title"><h1>统计</h1></div>
      </header>}

      {state.focus && focusCard && <section className="focus-panel">
        <span className={state.focus.running ? 'focus-pulse' : 'focus-pulse paused'} />
        <div className="focus-copy"><small>{state.focus.running ? '正在推进' : '推进已暂停'}</small><strong>{focusCard.title}</strong></div>
        <span className="focus-time">{formatDuration(focusRemaining)}</span>
        <button onClick={state.focus.running ? pauseFocus : () => startFocus(focusCard.id)}>{state.focus.running ? '暂停' : '继续'}</button>
        <button className="icon-button" onClick={stopFocus}>×</button>
      </section>}

      {view === 'boards' ? <div className="boards-stage" style={{
        '--board-width': `${boardWidthPixels}px`, '--board-row-width': boardRowWidth
      } as React.CSSProperties}>
        <div className="boards-viewport" ref={boardsViewportRef}>
          <section className="boards-row">
            {visibleBoards.map((board) => <BoardColumn
              key={board.id} board={board} tags={activeTags} collapsed={collapsed} focus={state.focus} dragCardId={dragCardId}
              virtual={isTagViewActive}
              dragCardTargetId={dragCardTargetId} dragCardTargetBoardId={dragCardTargetBoardId}
              dragBoardId={dragBoardId} dragBoardTargetId={dragBoardTargetId}
              heightMode={state.displaySettings.boardHeight}
              parentDisplay={boardDisplaySelections[board.id] || 'in_progress'}
              onParentDisplayChange={(display) => {
                setBoardDisplaySelections((current) => ({ ...current, [board.id]: display }))
                setState((current) => current ? { ...current, boardDisplaySettings: { ...current.boardDisplaySettings, [board.id]: display } } : current)
              }}
              autoEditCardId={inlineEditingCardId} onAutoEditComplete={() => setInlineEditingCardId(null)}
              childDisplaySelections={childDisplaySelections} onSetChildDisplay={setChildDisplaySelection}
              onAddCard={openNewCard}
              onEditCard={openCardEditor}
              onUpdateCard={updateCard} onCycleStatus={cycleCardStatus}
              onRename={(title) => updateBoard(board.id, (current) => ({ ...current, title }))} onSetStatus={(status) => setBoardStatus(board.id, status)}
              manageOpen={filterBoardId === board.id} projects={activeProjects}
              onManage={() => setFilterBoardId((current) => current === board.id ? null : board.id)}
              onSetProject={(projectId) => updateBoard(board.id, (current) => ({ ...current, projectId }))}
              onSetHeight={(height) => setBoardHeight(board.id, height)}
              onBoardDragStart={(boardId) => {
                dragBoardIdRef.current = boardId
                dragBoardTargetIdRef.current = null
                setDragBoardId(boardId)
                if (boardId) setDragBoardTargetId(null)
              }}
              onBoardDragEnter={previewBoardOrder} onBoardDrop={dropBoard} onBoardDragEnd={finishBoardDrag}
              onToggleCollapse={toggleCollapse} onDragStart={startCardDrag} onCardDragEnter={previewCardPosition} onDropCard={moveCard} onStartFocus={startFocus}
            />)}
            {!isTagViewActive && <button className="add-board" onClick={addBoard}>＋ 添加看板</button>}
          </section>
        </div>
        {hasMoreBoardsRight && <button className="boards-overflow-button right" title="显示右侧更多看板" aria-label="显示右侧更多看板"
          onClick={() => boardsViewportRef.current?.scrollBy({ left: Math.max(boardWidthPixels, boardsViewportRef.current.clientWidth * .72), behavior: 'smooth' })}><OverflowIcon direction="right" /></button>}
        {hasMoreBoardsBelow && <button className="boards-overflow-button down" title="显示下方更多看板" aria-label="显示下方更多看板"
          onClick={() => boardsViewportRef.current?.scrollBy({ top: Math.max(180, boardsViewportRef.current.clientHeight * .72), behavior: 'smooth' })}><OverflowIcon direction="down" /></button>}
      </div> : view === 'inbox' ? <section className="inbox-view">
        <button className="add-card inbox-add-card" onClick={addInboxCard}>＋ 添加卡片</button>
        {displayedInboxBoard ? <CardList board={displayedInboxBoard} tags={activeTags} collapsed={collapsed} focus={state.focus} dragCardId={dragCardId}
          dragCardTargetId={dragCardTargetId} dragCardTargetBoardId={dragCardTargetBoardId}
          autoEditCardId={inlineEditingCardId} onAutoEditComplete={() => setInlineEditingCardId(null)}
          childDisplaySelections={childDisplaySelections} onSetChildDisplay={setChildDisplaySelection}
          assignmentProjects={activeProjects} assignmentBoards={state.boards.filter((board) => board.id !== INBOX_BOARD_ID && board.status === 'active' && activeProjectIds.has(board.projectId))}
          onAssignCard={(card, targetBoardId) => moveCard(card.id, targetBoardId)}
          onAddCard={openNewCard} onEditCard={openCardEditor}
          onUpdateCard={updateCard} onCycleStatus={cycleCardStatus} onToggleCollapse={toggleCollapse}
          onDragStart={startCardDrag} onCardDragEnter={previewCardPosition} onDropCard={moveCard} onStartFocus={startFocus} />
          : <div className="board-empty">暂无卡片</div>}
      </section> : view === 'flagged' ? <section className="important-view">
        <CardList board={importantBoard} tags={activeTags} aggregate flat showTypeBadges contextCards={allCards}
          collapsed={collapsed} focus={state.focus} dragCardId={dragCardId}
          dragCardTargetId={dragCardTargetId} dragCardTargetBoardId={dragCardTargetBoardId}
          autoEditCardId={inlineEditingCardId} onAutoEditComplete={() => setInlineEditingCardId(null)}
          childDisplaySelections={childDisplaySelections} onSetChildDisplay={setChildDisplaySelection}
          onAddCard={openNewCard} onEditCard={openCardEditor}
          onUpdateCard={updateCard} onCycleStatus={cycleCardStatus} onToggleCollapse={toggleCollapse}
          onDragStart={startCardDrag} onCardDragEnter={previewCardPosition} onDropCard={moveCard} onStartFocus={startFocus} />
      </section> : view === 'overdue' ? <section className="overdue-view">
        <CardList board={overdueBoard} tags={activeTags} aggregate flat showTypeBadges contextCards={allCards}
          collapsed={collapsed} focus={state.focus} dragCardId={dragCardId}
          dragCardTargetId={dragCardTargetId} dragCardTargetBoardId={dragCardTargetBoardId}
          autoEditCardId={inlineEditingCardId} onAutoEditComplete={() => setInlineEditingCardId(null)}
          childDisplaySelections={childDisplaySelections} onSetChildDisplay={setChildDisplaySelection}
          onAddCard={openNewCard} onEditCard={openCardEditor}
          onUpdateCard={updateCard} onCycleStatus={cycleCardStatus} onToggleCollapse={toggleCollapse}
          onDragStart={startCardDrag} onCardDragEnter={previewCardPosition} onDropCard={moveCard} onStartFocus={startFocus} />
      </section> : view === 'tags' ? <section className="tags-page">
        <TagManager tags={activeTags} selectedTagId={selectedTagId} onSelect={setSelectedTagId} onAdd={addTag} onDelete={deleteTag} onReorder={reorderTags} />
        <section className="tag-cards-panel">
          <header><div><h2>{activeTags.find((tag) => tag.id === selectedTagId)?.title || '选择 Tag'}</h2></div><strong>{taggedCards.length}</strong></header>
          {selectedTagId ? <CardList board={tagBoard} tags={activeTags} aggregate flat contextCards={allCards}
            collapsed={collapsed} focus={state.focus} dragCardId={dragCardId}
            dragCardTargetId={dragCardTargetId} dragCardTargetBoardId={dragCardTargetBoardId}
            autoEditCardId={inlineEditingCardId} onAutoEditComplete={() => setInlineEditingCardId(null)}
            childDisplaySelections={childDisplaySelections} onSetChildDisplay={setChildDisplaySelection}
            onAddCard={openNewCard} onEditCard={openCardEditor}
            onUpdateCard={updateCard} onCycleStatus={cycleCardStatus} onToggleCollapse={toggleCollapse}
            onDragStart={startCardDrag} onCardDragEnter={previewCardPosition} onDropCard={moveCard} onStartFocus={startFocus} />
            : <div className="tag-empty-state">请先在左侧新增并选择 Tag</div>}
        </section>
      </section> : view === 'statistics' ? <StatisticsPage statistics={statistics} />
        : <SettingsPage projectCount={activeProjects.length} boardCount={state.boards.filter((board) => board.id !== INBOX_BOARD_ID && board.status === 'active' && activeProjectIds.has(board.projectId)).length} cardCount={allCards.length}
        projects={state.projects} boards={state.boards}
        switching={storageSwitching} onCreate={() => selectDatabase('create')} onChoose={() => selectDatabase('choose')}
        onUseDefault={() => selectDatabase('default')} boardColumns={state.displaySettings.boardColumns} boardWidth={state.displaySettings.boardWidth}
        boardHeight={state.displaySettings.boardHeight} fontSize={state.displaySettings.fontSize}
        dockTimerEnabled={state.displaySettings.dockTimerEnabled} focusDurationMinutes={state.focusSettings.durationMinutes} inboxShortcut={state.shortcuts.inbox}
        onBoardColumnsChange={(boardColumns) => setState((current) => current ? { ...current, displaySettings: { ...current.displaySettings, boardColumns } } : current)}
        onBoardWidthChange={(boardWidth) => setState((current) => current ? { ...current, displaySettings: { ...current.displaySettings, boardWidth } } : current)}
        onBoardHeightChange={setBoardHeightMode}
        onFontSizeChange={(fontSize) => setState((current) => current ? { ...current, displaySettings: { ...current.displaySettings, fontSize } } : current)}
        onDockTimerChange={(dockTimerEnabled) => setState((current) => current ? { ...current, displaySettings: { ...current.displaySettings, dockTimerEnabled } } : current)}
        onFocusDurationChange={(durationMinutes) => setState((current) => current ? { ...current, focusSettings: { durationMinutes } } : current)}
        onInboxShortcutChange={(inbox) => setState((current) => current ? { ...current, shortcuts: { ...current.shortcuts, inbox } } : current)}
        onRestoreProject={restoreProject} onRestoreBoard={(boardId) => setBoardStatus(boardId, 'active')} onRestoreCard={restoreCard}
        onPermanentlyDelete={permanentlyDelete} />}
    </main>
    <button type="button" className="global-search-trigger"
      onPointerDown={(event) => event.stopPropagation()} onClick={() => setSearchOpen(true)} aria-label="搜索" title="搜索">
      <SearchIcon />
    </button>
    {searchOpen && <SearchDialog state={state} onClose={() => setSearchOpen(false)} onOpenResult={openSearchResult} />}
    {editingCard && editingCardAnchor && <CardModal card={editingCard} anchor={editingCardAnchor} parent={editingCard.parentId ? allCards.find((card) => card.id === editingCard.parentId) : undefined}
      hasChildren={allCards.some((card) => card.parentId === editingCard.id)} onChange={setEditingCard} onClose={closeCardEditor} onSave={saveCard} />}
    {editingBoard && <BoardModal value={editingBoard} onChange={setEditingBoard} onClose={() => setEditingBoard(null)} onSave={saveBoard} />}
    {projectManagerOpen && <ProjectManagerModal projects={state.projects} onClose={() => setProjectManagerOpen(false)}
      onAdd={addProject} onRename={renameProject} onReorder={reorderProjects}
      onDelete={(project) => { if (window.confirm(`删除项目“${project.title}”？项目下的数据会保留，可随时恢复。`)) setProjectDeleted(project.id, true) }}
      onRestore={(projectId) => setProjectDeleted(projectId, false)} />}
  </div>
}

function HighlightedText({ text, query }: { text: string; query: string }): React.JSX.Element {
  const needle = query.trim().toLocaleLowerCase('zh-CN')
  if (!needle) return <>{text}</>
  const source = text.toLocaleLowerCase('zh-CN')
  const parts: React.ReactNode[] = []
  let cursor = 0
  let match = source.indexOf(needle)
  while (match >= 0) {
    if (match > cursor) parts.push(text.slice(cursor, match))
    parts.push(<mark className="search-match" key={`${match}-${parts.length}`}>{text.slice(match, match + needle.length)}</mark>)
    cursor = match + needle.length
    match = source.indexOf(needle, cursor)
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}

function SearchContentPopover({ content, query, position, onClose }: {
  content: string
  query: string
  position: { left: number; top: number; width: number }
  onClose: () => void
}): React.JSX.Element {
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [hasMore, setHasMore] = useState(false)

  useEffect(() => {
    const close = (event: PointerEvent): void => {
      if (!popoverRef.current?.contains(event.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [onClose])

  useLayoutEffect(() => {
    const element = contentRef.current
    if (!element) return
    const update = (): void => setHasMore(element.scrollHeight - element.scrollTop - element.clientHeight > 2)
    update()
    element.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => { element.removeEventListener('scroll', update); observer.disconnect() }
  }, [content])

  return createPortal(<div ref={popoverRef} className="search-content-popover" style={position} onPointerDown={(event) => event.stopPropagation()}>
    <div ref={contentRef} className="search-content-popover-body"><HighlightedText text={content} query={query} /></div>
    {hasMore && <button className="search-content-more" title="显示更多内容" aria-label="显示更多内容"
      onClick={() => contentRef.current?.scrollBy({ top: Math.max(90, contentRef.current.clientHeight * .72), behavior: 'smooth' })}>
      <OverflowIcon direction="down" />
    </button>}
  </div>, document.body)
}

function SearchDialog({ state, onClose, onOpenResult }: {
  state: BoardState
  onClose: () => void
  onOpenResult: (result: SearchResult) => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [resultTypes, setResultTypes] = useState<Set<SearchResultType>>(new Set())
  const [lifecycles, setLifecycles] = useState<Set<SearchLifecycle>>(new Set())
  const [cardStatuses, setCardStatuses] = useState<Set<CardStatus>>(new Set())
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [openFilter, setOpenFilter] = useState<'type' | 'status' | 'card' | 'project' | null>(null)
  const [contentPopover, setContentPopover] = useState<{ id: string; content: string; left: number; top: number; width: number } | null>(null)

  const projectLifecycle = (project: Project): SearchLifecycle => project.deletedAt ? 'deleted' : project.archivedAt ? 'archived' : 'active'
  const projectMap = useMemo(() => new Map(state.projects.map((project) => [project.id, project])), [state.projects])
  const availableProjects = useMemo(() => state.projects
    .filter((project) => lifecycles.size === 0 || lifecycles.has(projectLifecycle(project)))
    .sort((left, right) => left.sort - right.sort), [lifecycles, state.projects])

  useEffect(() => {
    if (projectId && !availableProjects.some((project) => project.id === projectId)) setProjectId(null)
  }, [availableProjects, projectId])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const results = useMemo<SearchResult[]>(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')
    const hasCriteria = normalizedQuery || resultTypes.size > 0 || lifecycles.size > 0 || cardStatuses.size > 0 || flaggedOnly || projectId
    if (!hasCriteria) return []
    const matchesText = (title: string, content: string): boolean => !normalizedQuery
      || title.toLocaleLowerCase('zh-CN').includes(normalizedQuery)
      || content.toLocaleLowerCase('zh-CN').includes(normalizedQuery)
    const matchesLifecycle = (lifecycle: SearchLifecycle): boolean => lifecycles.size === 0 || lifecycles.has(lifecycle)
    const matchesType = (type: SearchResultType): boolean => resultTypes.size === 0 || resultTypes.has(type)
    const latestUpdate = (...values: Array<string | null | undefined>): string | null => values
      .filter((value): value is string => typeof value === 'string' && Number.isFinite(new Date(value).getTime()))
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] || null
    const entries: SearchResult[] = []

    for (const project of state.projects) {
      const lifecycle = projectLifecycle(project)
      if (matchesType('project') && !flaggedOnly && (!projectId || project.id === projectId) && matchesLifecycle(lifecycle) && matchesText(project.title, '')) {
        entries.push({ id: project.id, type: 'project', title: project.title, content: '', lifecycle,
          projectId: project.id, boardId: null, cardStatus: null, updatedAt: project.updatedAt, navigable: lifecycle === 'active' })
      }
    }
    for (const board of state.boards) {
      if (board.id === INBOX_BOARD_ID) {
        if (!matchesType('card')) continue
        for (const card of board.cards) {
          const lifecycle: SearchLifecycle = card.status === 'deleted' ? 'deleted' : 'active'
          if (projectId || !matchesLifecycle(lifecycle) || (cardStatuses.size > 0 && !cardStatuses.has(card.status))
            || (flaggedOnly && !card.flagged) || !matchesText(card.title, card.content)) continue
          entries.push({ id: card.id, type: 'card', title: card.title || '无标题', content: card.content, lifecycle,
            projectId: null, boardId: board.id, cardStatus: card.status, updatedAt: card.updatedAt, navigable: lifecycle === 'active' })
        }
        continue
      }
      const project = projectMap.get(board.projectId)
      const parentLifecycle = project ? projectLifecycle(project) : 'active'
      const lifecycle: SearchLifecycle = parentLifecycle === 'deleted' || board.status === 'deleted' ? 'deleted'
        : parentLifecycle === 'archived' || board.status === 'archived' ? 'archived' : 'active'
      if (matchesType('board') && !flaggedOnly && (!projectId || board.projectId === projectId) && matchesLifecycle(lifecycle) && matchesText(board.title, '')) {
        const updatedAt = latestUpdate(board.statusChangedAt, ...board.cards.map((card) => card.updatedAt))
        entries.push({ id: board.id, type: 'board', title: board.title, content: '', lifecycle,
          projectId: board.projectId, boardId: board.id, cardStatus: null, updatedAt, navigable: lifecycle === 'active' })
      }
      for (const card of board.cards) {
        const cardLifecycle: SearchLifecycle = lifecycle === 'deleted' || card.status === 'deleted' ? 'deleted'
          : lifecycle === 'archived' ? 'archived' : 'active'
        if (matchesType('card') && (!projectId || board.projectId === projectId) && matchesLifecycle(cardLifecycle)
          && (cardStatuses.size === 0 || cardStatuses.has(card.status)) && (!flaggedOnly || card.flagged) && matchesText(card.title, card.content)) {
          entries.push({ id: card.id, type: 'card', title: card.title || '无标题', content: card.content, lifecycle: cardLifecycle,
            projectId: board.projectId, boardId: board.id, cardStatus: card.status, updatedAt: card.updatedAt, navigable: cardLifecycle === 'active' })
        }
      }
    }
    return entries.sort((left, right) => {
      const leftTime = left.updatedAt ? new Date(left.updatedAt).getTime() : 0
      const rightTime = right.updatedAt ? new Date(right.updatedAt).getTime() : 0
      return rightTime - leftTime
    })
  }, [cardStatuses, flaggedOnly, lifecycles, projectId, projectMap, query, resultTypes, state.boards, state.projects])

  function toggleResultType(value: SearchResultType): void {
    setResultTypes((current) => {
      const next = new Set(current)
      if (next.has(value)) next.delete(value); else next.add(value)
      return next
    })
  }

  function toggleLifecycle(value: SearchLifecycle): void {
    setLifecycles((current) => {
      const next = new Set(current)
      if (next.has(value)) next.delete(value); else next.add(value)
      return next
    })
  }

  function toggleCardStatus(value: CardStatus): void {
    setCardStatuses((current) => {
      const next = new Set(current)
      if (next.has(value)) next.delete(value); else next.add(value)
      return next
    })
  }

  function showCardContent(event: React.MouseEvent<HTMLButtonElement>, result: SearchResult): void {
    if (contentPopover?.id === result.id) { setContentPopover(null); return }
    const rect = event.currentTarget.getBoundingClientRect()
    const width = Math.min(480, window.innerWidth - 32)
    const left = Math.min(window.innerWidth - width - 16, Math.max(16, rect.left))
    const estimatedHeight = 250
    const below = rect.bottom + 7
    const top = below + estimatedHeight <= window.innerHeight - 16 ? below : Math.max(16, rect.top - estimatedHeight - 7)
    setContentPopover({ id: result.id, content: result.content, left, top, width })
  }

  const lifecycleLabels: Record<SearchLifecycle, string> = { active: '正常', archived: '已归档', deleted: '已删除' }
  const typeLabels: Record<SearchResultType, string> = { project: '项目', board: '看板', card: '卡片' }
  const formatUpdatedAt = (value: string | null): string => value
    ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    : '—'
  const hasCriteria = query.trim() || resultTypes.size > 0 || lifecycles.size > 0 || cardStatuses.size > 0 || flaggedOnly || projectId

  return createPortal(<div className="modal-backdrop search-backdrop" onPointerDown={(event) => {
    if (event.target === event.currentTarget) onClose()
  }}>
    <section className="search-modal" role="dialog" aria-modal="true" aria-label="搜索"
      onPointerDown={(event) => { if (!(event.target as HTMLElement).closest('.search-filter-control')) setOpenFilter(null) }}>
      <header className="search-input-row">
        <SearchIcon />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onFocus={() => setOpenFilter(null)}
          placeholder="搜索项目、看板和卡片" aria-label="搜索关键词" />
        {query && <button onClick={() => setQuery('')} aria-label="清空搜索">×</button>}
      </header>
      <div className="search-filter-row">
        <div className="search-filter-control">
          <button className={resultTypes.size ? 'search-filter-button selected' : 'search-filter-button'} onClick={() => setOpenFilter(openFilter === 'type' ? null : 'type')}>
            类型{resultTypes.size ? ` · ${resultTypes.size}` : ''}<span>⌄</span>
          </button>
          {openFilter === 'type' && <div className="search-filter-popover">
            {(['project', 'board', 'card'] as SearchResultType[]).map((value) => <label key={value}>
              <input type="checkbox" checked={resultTypes.has(value)} onChange={() => toggleResultType(value)} />{typeLabels[value]}
            </label>)}
            <small>未选择代表全部</small>
          </div>}
        </div>
        <div className="search-filter-control">
          <button className={lifecycles.size ? 'search-filter-button selected' : 'search-filter-button'} onClick={() => setOpenFilter(openFilter === 'status' ? null : 'status')}>
            状态{lifecycles.size ? ` · ${lifecycles.size}` : ''}<span>⌄</span>
          </button>
          {openFilter === 'status' && <div className="search-filter-popover">
            {(['active', 'archived', 'deleted'] as SearchLifecycle[]).map((value) => <label key={value}>
              <input type="checkbox" checked={lifecycles.has(value)} onChange={() => toggleLifecycle(value)} />{lifecycleLabels[value]}
            </label>)}
            <small>未选择代表全部</small>
          </div>}
        </div>
        <button className={flaggedOnly ? 'search-flag-filter selected' : 'search-flag-filter'} aria-pressed={flaggedOnly}
          title={flaggedOnly ? '仅搜索重要卡片' : '只搜索重要卡片'} aria-label="只搜索重要卡片" onClick={() => setFlaggedOnly((value) => !value)}>
          <FlagIcon filled={flaggedOnly} />
        </button>
        <div className="search-filter-control">
          <button className={cardStatuses.size ? 'search-filter-button selected' : 'search-filter-button'} onClick={() => setOpenFilter(openFilter === 'card' ? null : 'card')}>
            卡片{cardStatuses.size ? ` · ${cardStatuses.size}` : ''}<span>⌄</span>
          </button>
          {openFilter === 'card' && <div className="search-filter-popover">
            {([['staged', '已放弃'], ['done', '已完成'], ['in_progress', '进行中']] as const).map(([value, label]) => <label key={value}>
              <input type="checkbox" checked={cardStatuses.has(value)} onChange={() => toggleCardStatus(value)} />{label}
            </label>)}
            <small>未选择代表全部</small>
          </div>}
        </div>
        <div className="search-filter-control">
          <button className={projectId ? 'search-filter-button selected' : 'search-filter-button'} onClick={() => setOpenFilter(openFilter === 'project' ? null : 'project')}>
            {projectId ? projectMap.get(projectId)?.title || '项目' : '项目'}<span>⌄</span>
          </button>
          {openFilter === 'project' && <div className="search-filter-popover project-options">
            <button className={!projectId ? 'active' : ''} onClick={() => { setProjectId(null); setOpenFilter(null) }}>全部项目</button>
            {availableProjects.map((project) => <button key={project.id} className={projectId === project.id ? 'active' : ''}
              onClick={() => { setProjectId(project.id); setOpenFilter(null) }}>
              <span style={{ background: project.color }} />{project.title}<small>{lifecycleLabels[projectLifecycle(project)]}</small>
            </button>)}
            {!availableProjects.length && <p>当前状态下没有项目</p>}
          </div>}
        </div>
        <span className="search-result-count">{hasCriteria ? `${results.length} 条结果` : '可组合筛选'}</span>
      </div>
      <div className="search-results" onScroll={() => setContentPopover(null)}>
        <div className="search-results-header"><span>类型</span><span>标题</span><span>内容</span><span>更新时间</span><span>操作</span></div>
        {hasCriteria ? results.length ? results.map((result) => <div className="search-result-row" key={`${result.type}-${result.id}`}>
          <span><i className={`search-type ${result.type}`}>{typeLabels[result.type]}</i><small>{lifecycleLabels[result.lifecycle]}</small></span>
          <strong title={result.title}><HighlightedText text={result.title} query={query} /></strong>
          {result.type === 'card' && result.content
            ? <button className="search-content-preview" title="点击展开内容" onClick={(event) => showCardContent(event, result)}>
              <HighlightedText text={result.content} query={query} />
            </button>
            : <p>—</p>}
          <time className="search-updated-at" dateTime={result.updatedAt || undefined}>{formatUpdatedAt(result.updatedAt)}</time>
          <button className="search-locate-button" onClick={() => onOpenResult(result)}>定位</button>
        </div>) : <div className="search-empty">没有找到符合条件的内容</div>
          : <div className="search-empty">输入关键词，或选择条件开始搜索</div>}
      </div>
    </section>
    {contentPopover && <SearchContentPopover content={contentPopover.content} query={query} position={contentPopover}
      onClose={() => setContentPopover(null)} />}
  </div>, document.body)
}

function ProjectBar({ projects, activeProjectId, requestedRenameId, onRenameRequestHandled, onSelect, onAdd, onRename, onReorder }: {
  projects: Project[]
  activeProjectId: string | null
  requestedRenameId: string | null
  onRenameRequestHandled: () => void
  onSelect: (projectId: string) => void
  onAdd: () => string | null
  onRename: (projectId: string, title: string) => void
  onReorder: (draggedId: string, targetId: string) => void
}): React.JSX.Element {
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState('')
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const draggedProjectIdRef = useRef<string | null>(null)
  const suppressClickRef = useRef(false)
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null)
  const [dragTargetProjectId, setDragTargetProjectId] = useState<string | null>(null)

  useLayoutEffect(() => {
    if (!editingProjectId || !titleInputRef.current) return
    titleInputRef.current.focus()
    titleInputRef.current.select()
  }, [editingProjectId, projects])

  useEffect(() => {
    if (!requestedRenameId) return
    const project = projects.find((item) => item.id === requestedRenameId)
    if (project) {
      setTitleDraft(project.title)
      setEditingProjectId(project.id)
    }
    onRenameRequestHandled()
  }, [onRenameRequestHandled, projects, requestedRenameId])

  function finishRename(project: Project): void {
    const title = titleDraft.trim()
    if (title && title !== project.title) onRename(project.id, title)
    setEditingProjectId(null)
  }

  return <header className="project-bar">
    <div className="project-tabs">
      {projects.map((project) => editingProjectId === project.id
        ? <div key={project.id} className="project-tab active editing" data-search-key={`project:${project.id}`}>
          <span style={{ backgroundColor: project.color }} />
          <input ref={titleInputRef} value={titleDraft} maxLength={40} aria-label="重命名项目"
            onChange={(event) => setTitleDraft(event.target.value)} onBlur={() => finishRename(project)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') { setTitleDraft(project.title); setEditingProjectId(null) }
            }} />
        </div>
        : <button key={project.id} draggable data-search-key={`project:${project.id}`} className={`${project.id === activeProjectId ? 'project-tab active' : 'project-tab'}${draggedProjectId === project.id ? ' dragging' : ''}${dragTargetProjectId === project.id ? ' drag-target' : ''}`}
          aria-pressed={project.id === activeProjectId} title={project.id === activeProjectId ? '当前项目，拖拽调整顺序' : `切换到${project.title}，拖拽调整顺序`}
          onDragStart={(event) => {
            draggedProjectIdRef.current = project.id
            setDraggedProjectId(project.id)
            setDragTargetProjectId(null)
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/x-vistask-project', project.id)
            setScaledDragPreview(event, event.currentTarget)
          }}
          onDragEnter={(event) => {
            const draggedId = draggedProjectIdRef.current
            if (!draggedId || draggedId === project.id || dragTargetProjectId === project.id) return
            event.preventDefault()
            setDragTargetProjectId(project.id)
            onReorder(draggedId, project.id)
          }}
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }}
          onDrop={(event) => {
            event.preventDefault()
            suppressClickRef.current = true
            draggedProjectIdRef.current = null
            setDraggedProjectId(null)
            setDragTargetProjectId(null)
          }}
          onDragEnd={() => {
            suppressClickRef.current = true
            draggedProjectIdRef.current = null
            setDraggedProjectId(null)
            setDragTargetProjectId(null)
            window.setTimeout(() => { suppressClickRef.current = false }, 180)
          }}
          onClick={() => {
            if (suppressClickRef.current) { suppressClickRef.current = false; return }
            if (project.id !== activeProjectId) onSelect(project.id)
          }}>
          <span style={{ backgroundColor: project.color }} />{project.title}
        </button>)}
      {projects.length === 0 && <span className="project-empty-hint">先创建一个项目</span>}
      <button className="project-add-inline" onClick={() => {
        const projectId = onAdd()
        if (projectId) { setTitleDraft('未命名项目'); setEditingProjectId(projectId) }
      }} title="添加项目" aria-label="添加项目">＋</button>
    </div>
  </header>
}

function ProjectInfoBar({ project, projectCount, boardCount, cardCount, tags, tagViewConfig, onTagViewChange, onRenameRequest, onArchive, onDelete }: {
  project: Project | null
  projectCount: number
  boardCount: number
  cardCount: number
  tags: CardTag[]
  tagViewConfig?: TagViewConfig
  onTagViewChange: (projectId: string, config: TagViewConfig) => void
  onRenameRequest: (projectId: string) => void
  onArchive: (projectId: string) => void
  onDelete: (projectId: string) => void
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<'archive' | 'delete' | null>(null)
  const [tagViewOpen, setTagViewOpen] = useState(false)

  useEffect(() => {
    setOpen(false)
    setPendingAction(null)
    setTagViewOpen(false)
  }, [project?.id])

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setPendingAction(null)
      }
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  function startRename(): void {
    if (!project) return
    setOpen(false)
    setPendingAction(null)
    onRenameRequest(project.id)
  }

  function confirmAction(): void {
    if (!project || !pendingAction) return
    if (pendingAction === 'archive') onArchive(project.id)
    else onDelete(project.id)
    setOpen(false)
    setPendingAction(null)
  }

  return <section className="project-info-bar">
    <div className="project-info-copy">
      <span>{project ? `${boardCount} 个看板 · ${cardCount} 张卡片` : `${projectCount} 个项目 · ${boardCount} 个看板 · ${cardCount} 张卡片`}</span>
    </div>
    <div className="project-info-actions">
      <button className={tagViewConfig?.enabled ? 'tag-view-button active' : 'tag-view-button'} disabled={!project}
        onClick={() => setTagViewOpen(true)} title="配置标签视图" aria-label="配置标签视图">
        <TagOutlined /><span>标签视图</span>
      </button>
      <div className="project-info-menu" ref={containerRef}>
        <button className={open ? 'icon-button active' : 'icon-button'} onClick={() => { setOpen((value) => !value); setPendingAction(null) }}
          title="项目管理" aria-label="项目管理"><MoreIcon /></button>
        {open && <div className="project-info-popover">
          {!project ? <span className="project-info-menu-hint">请先选择一个项目</span>
            : pendingAction ? <div className="project-info-confirm">
              <strong>{pendingAction === 'archive' ? '归档项目' : '删除项目'}</strong>
              <p>{pendingAction === 'archive'
                ? `确认归档“${project.title}”？项目及其中的数据会保留，可在设置中恢复。`
                : `确认删除“${project.title}”？项目及其中的数据会保留，可在设置中恢复。`}</p>
              <div>
                <button onClick={() => setPendingAction(null)}>取消</button>
                <button className={pendingAction === 'delete' ? 'danger' : 'confirm'} onClick={confirmAction}>确认</button>
              </div>
            </div> : <>
              <button className="board-menu-action" onClick={startRename}>重命名项目</button>
              <button className="board-menu-action" onClick={() => setPendingAction('archive')}>归档项目</button>
              <button className="board-menu-action danger" onClick={() => setPendingAction('delete')}>删除项目</button>
            </>}
        </div>}
      </div>
    </div>
    {tagViewOpen && project && <TagViewConfigModal tags={tags} value={tagViewConfig}
      onClose={() => setTagViewOpen(false)} onSave={(config) => { onTagViewChange(project.id, config); setTagViewOpen(false) }} />}
  </section>
}

function TagViewConfigModal({ tags, value, onClose, onSave }: {
  tags: CardTag[]
  value?: TagViewConfig
  onClose: () => void
  onSave: (value: TagViewConfig) => void
}): React.JSX.Element {
  const categories = tags.filter((tag) => tags.some((child) => child.parentId === tag.id))
  const fallbackCategoryId = categories[0]?.id || ''
  const [draft, setDraft] = useState<TagViewConfig>(() => value || {
    enabled: true,
    categoryTagId: fallbackCategoryId,
    statuses: { staged: false, in_progress: true, done: false, deleted: false }
  })
  const hasStatus = Object.values(draft.statuses).some(Boolean)

  return createPortal(<div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="board-settings-modal tag-view-modal" role="dialog" aria-modal="true" aria-label="标签视图配置">
      <header><h2>标签视图</h2><button className="icon-button" onClick={onClose}>×</button></header>
      <div className="modal-body">
        <label>选择标签类别
          <select value={draft.categoryTagId} disabled={!categories.length}
            onChange={(event) => setDraft((current) => ({ ...current, categoryTagId: event.target.value }))}>
            {!categories.length && <option value="">暂无可用的标签类别</option>}
            {categories.map((tag) => <option key={tag.id} value={tag.id}>{tag.title}</option>)}
          </select>
          <small className="field-hint">该类别的直接子标签将作为动态看板；更深层子标签会归入其上级枚举值。</small>
        </label>
        <div className="board-settings-section">
          <strong>卡片状态筛选</strong>
          <div className="board-settings-options">
            {EDITABLE_STATUSES.concat('deleted').map((status) => <label key={status}>
              <input type="checkbox" checked={draft.statuses[status]}
                onChange={(event) => setDraft((current) => ({
                  ...current, statuses: { ...current.statuses, [status]: event.target.checked }
                }))} />
              <span>{STATUS_LABELS[status]}</span>
            </label>)}
          </div>
        </div>
        {!hasStatus && <small className="tag-view-error">请至少选择一种卡片状态</small>}
      </div>
      <footer>
        {value?.enabled && <button className="secondary-button tag-view-disable" onClick={() => onSave({ ...draft, enabled: false })}>恢复普通视图</button>}
        <button className="secondary-button" onClick={onClose}>取消</button>
        <button className="primary-button" disabled={!draft.categoryTagId || !hasStatus}
          onClick={() => onSave({ ...draft, enabled: true })}>确定</button>
      </footer>
    </section>
  </div>, document.body)
}

function StatisticsPage({ statistics }: { statistics: StatisticsData }): React.JSX.Element {
  const formatDecimal = (value: number): string => value.toFixed(1)
  const periodCards: Array<{ title: string; value: StatisticPeriod }> = [
    { title: '当天', value: statistics.today },
    { title: '最近一周', value: statistics.week },
    { title: '最近一月', value: statistics.month }
  ]
  return <section className="statistics-page">
    <article className="statistics-card current">
      <header><span>当前</span><small>实时概览</small></header>
      <div className="statistics-metrics four-columns">
        <div className="statistics-metric"><strong>{statistics.current.inProgress}</strong><span>进行中的卡片数</span></div>
        <div className="statistics-metric important"><strong>{statistics.current.important}</strong><span>重要卡片数</span></div>
        <div className="statistics-metric overdue"><strong>{statistics.current.overdue}</strong><span>过期卡片数</span></div>
        <div className="statistics-metric important-overdue"><strong>{statistics.current.importantOverdue}</strong><span>重要过期卡片数</span></div>
      </div>
    </article>
    {periodCards.map(({ title, value }) => <article className="statistics-card" key={title}>
      <header><span>{title}</span></header>
      <div className="statistics-metrics">
        <div className="statistics-metric"><strong>{value.completedCards}</strong><span>完成卡片数</span></div>
        <div className="statistics-metric tomato"><strong>{formatDecimal(value.pomodoros)}</strong><span>完成番茄时钟个数</span></div>
        <div className="statistics-metric hours"><strong>{formatDecimal(value.hours)}</strong><span>完成的番茄时钟小时数</span></div>
      </div>
    </article>)}
  </section>
}

function ChildDisplayFilterControl({ groupName, value, onChange, flaggedOnly, onFlaggedOnlyChange }: {
  groupName: string
  value: 'first' | 'all'
  onChange: (value: 'first' | 'all') => void
  flaggedOnly?: boolean
  onFlaggedOnlyChange?: (value: boolean) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  return <section className="overdue-display-bar">
    {onFlaggedOnlyChange && <button className={flaggedOnly ? 'overdue-flag-filter selected' : 'overdue-flag-filter'}
      aria-pressed={Boolean(flaggedOnly)} data-tooltip={flaggedOnly ? '显示全部过期任务' : '只显示重要的过期任务'}
      aria-label="只显示重要的过期任务" onClick={() => onFlaggedOnlyChange(!flaggedOnly)}>
      <FlagIcon filled={flaggedOnly} />
    </button>}
    <div className="overdue-display-action" ref={containerRef}>
      <button className={open ? 'overdue-display-button active' : 'overdue-display-button'}
        onClick={() => setOpen((current) => !current)} data-tooltip="顺序子卡片显示" aria-label="顺序子卡片显示">
        <EyeIcon />
      </button>
      {open && <div className="overdue-display-popover" role="radiogroup" aria-label="顺序子卡片显示" onPointerDown={(event) => event.stopPropagation()}>
        <strong>顺序子卡片显示</strong>
        {([['first', '首个卡片'], ['all', '全部卡片']] as const).map(([option, optionLabel]) => <label key={option}>
          <input type="radio" name={`${groupName}-child-display`} value={option} checked={value === option}
            onChange={() => { onChange(option); setOpen(false) }} />
          <span>{optionLabel}</span>
        </label>)}
      </div>}
    </div>
  </section>
}

function InboxHeader({ count, settings, onChange }: {
  count: number
  settings: BoardState['inboxSettings']
  onChange: (settings: BoardState['inboxSettings']) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  const options: Array<{ key: keyof BoardState['inboxSettings']; label: string }> = [
    { key: 'in_progress', label: '进行中' },
    { key: 'done', label: '已完成' },
    { key: 'deleted', label: '已删除' }
  ]
  return <header className="topbar inbox-topbar">
    <div className="topbar-title"><h1>收件箱</h1><span>{count}</span></div>
    <div className="inbox-manager" ref={containerRef}>
      <button className={open ? 'icon-button active' : 'icon-button'} onClick={() => setOpen((value) => !value)}
        title="收件箱管理" aria-label="收件箱管理"><ManageIcon /></button>
      {open && <div className="inbox-manager-popover" onPointerDown={(event) => event.stopPropagation()}>
        <strong>显示类型</strong>
        {options.map((option) => <label key={option.key}>
          <input type="checkbox" checked={settings[option.key]}
            onChange={(event) => onChange({ ...settings, [option.key]: event.target.checked })} />
          {option.label}
        </label>)}
      </div>}
    </div>
  </header>
}

function DataRestoreAction({ item }: { item: DataManagementItem }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 8, top: 8 })
  const containerRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!containerRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false)
    }
    const closeOnViewportChange = (): void => setOpen(false)
    document.addEventListener('pointerdown', close)
    document.addEventListener('scroll', closeOnViewportChange, true)
    window.addEventListener('resize', closeOnViewportChange)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('scroll', closeOnViewportChange, true)
      window.removeEventListener('resize', closeOnViewportChange)
    }
  }, [open])

  function toggle(): void {
    if (open) { setOpen(false); return }
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = 250
    const estimatedHeight = item.restoreBlockedMessage ? 116 : 126
    const left = Math.min(window.innerWidth - width - 8, Math.max(8, rect.right - width))
    const below = rect.bottom + 6
    const top = below + estimatedHeight <= window.innerHeight - 8 ? below : Math.max(8, rect.top - estimatedHeight - 6)
    setPosition({ left, top })
    setOpen(true)
  }

  return <div className="data-restore-action" ref={containerRef}>
    <button ref={buttonRef} className="data-restore-button" onClick={toggle}>恢复</button>
    {open && createPortal(<div ref={popoverRef} className="data-restore-popover" style={position} role="alertdialog"
      aria-label={item.restoreBlockedMessage ? '无法恢复' : `确认恢复${item.type}`} onPointerDown={(event) => event.stopPropagation()}>
      <strong>{item.restoreBlockedMessage ? '暂时无法恢复' : `恢复${item.type}`}</strong>
      <p>{item.restoreBlockedMessage || `确认恢复“${item.title}”？`}</p>
      <div className="data-restore-popover-actions">
        <button onClick={() => setOpen(false)}>{item.restoreBlockedMessage ? '知道了' : '取消'}</button>
        {!item.restoreBlockedMessage && <button className="confirm" onClick={() => { item.restore(); setOpen(false) }}>确认恢复</button>}
      </div>
    </div>, document.body)}
  </div>
}

function DataPermanentDeleteAction({ item }: { item: DataManagementItem }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 8, top: 8 })
  const containerRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!containerRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false)
    }
    const closeOnViewportChange = (): void => setOpen(false)
    document.addEventListener('pointerdown', close)
    document.addEventListener('scroll', closeOnViewportChange, true)
    window.addEventListener('resize', closeOnViewportChange)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('scroll', closeOnViewportChange, true)
      window.removeEventListener('resize', closeOnViewportChange)
    }
  }, [open])

  function toggle(): void {
    if (open) { setOpen(false); return }
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = 280
    const estimatedHeight = 150
    const left = Math.min(window.innerWidth - width - 8, Math.max(8, rect.right - width))
    const below = rect.bottom + 6
    const top = below + estimatedHeight <= window.innerHeight - 8 ? below : Math.max(8, rect.top - estimatedHeight - 6)
    setPosition({ left, top })
    setOpen(true)
  }

  const consequence = item.type === '项目' ? '该项目及其所有看板、卡片都会被永久删除。'
    : item.type === '看板' ? '该看板及其中的所有卡片都会被永久删除。'
      : '该卡片及其所有子卡片都会被永久删除。'
  return <div className="data-delete-action" ref={containerRef}>
    <button ref={buttonRef} className="data-delete-button" onClick={toggle}>彻底删除</button>
    {open && createPortal(<div ref={popoverRef} className="data-delete-popover" style={position} role="alertdialog"
      aria-label={`确认彻底删除${item.type}`} onPointerDown={(event) => event.stopPropagation()}>
      <strong>彻底删除{item.type}</strong>
      <p>{consequence}<em>彻底删除后无法恢复。</em></p>
      <div className="data-delete-popover-actions">
        <button onClick={() => setOpen(false)}>取消</button>
        <button className="danger" onClick={() => { item.permanentlyDelete?.(); setOpen(false) }}>确认彻底删除</button>
      </div>
    </div>, document.body)}
  </div>
}

function SettingsPage({ projectCount, boardCount, cardCount, projects, boards, switching, onCreate, onChoose, onUseDefault, boardColumns, boardWidth, boardHeight, fontSize, dockTimerEnabled, focusDurationMinutes, inboxShortcut, onBoardColumnsChange, onBoardWidthChange, onBoardHeightChange, onFontSizeChange, onDockTimerChange, onFocusDurationChange, onInboxShortcutChange, onRestoreProject, onRestoreBoard, onRestoreCard, onPermanentlyDelete }: {
  projectCount: number
  boardCount: number
  cardCount: number
  projects: Project[]
  boards: Board[]
  switching: boolean
  onCreate: () => Promise<DatabaseInfo | null>
  onChoose: () => Promise<DatabaseInfo | null>
  onUseDefault: () => Promise<DatabaseInfo | null>
  boardColumns: number | 'auto'
  boardWidth: 'narrow' | 'medium' | 'wide'
  boardHeight: 'small' | 'medium' | 'large'
  fontSize: 'small' | 'medium' | 'large'
  dockTimerEnabled: boolean
  focusDurationMinutes: number
  inboxShortcut: string
  onBoardColumnsChange: (value: number | 'auto') => void
  onBoardWidthChange: (value: 'narrow' | 'medium' | 'wide') => void
  onBoardHeightChange: (value: 'small' | 'medium' | 'large') => void
  onFontSizeChange: (value: 'small' | 'medium' | 'large') => void
  onDockTimerChange: (value: boolean) => void
  onFocusDurationChange: (value: number) => void
  onInboxShortcutChange: (value: string) => void
  onRestoreProject: (projectId: string) => void
  onRestoreBoard: (boardId: string) => void
  onRestoreCard: (cardId: string) => void
  onPermanentlyDelete: (type: DataManagementItem['type'], id: string) => void
}): React.JSX.Element {
  const [databaseInfo, setDatabaseInfo] = useState<DatabaseInfo | null>(null)
  const [databaseError, setDatabaseError] = useState('')
  const [activeTab, setActiveTab] = useState<'data' | 'display' | 'shortcuts' | 'other'>('data')
  const [dataManagementTab, setDataManagementTab] = useState<'archived' | 'deleted'>('archived')
  const [capturingShortcut, setCapturingShortcut] = useState(false)
  const [shortcutError, setShortcutError] = useState('')
  const shortcutButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    void window.api.getDatabaseInfo().then(setDatabaseInfo).catch(() => setDatabaseError('无法读取数据库信息'))
  }, [])

  async function switchDatabase(action: () => Promise<DatabaseInfo | null>): Promise<void> {
    setDatabaseError('')
    try {
      const info = await action()
      if (info) setDatabaseInfo(info)
    } catch (error) {
      setDatabaseError(error instanceof Error ? error.message : '切换数据库失败')
    }
  }

  async function beginShortcutCapture(): Promise<void> {
    setShortcutError('')
    await window.api.startShortcutCapture()
    setCapturingShortcut(true)
    window.requestAnimationFrame(() => shortcutButtonRef.current?.focus())
  }

  async function cancelShortcutCapture(): Promise<void> {
    await window.api.cancelShortcutCapture()
    setCapturingShortcut(false)
  }

  async function captureShortcut(event: React.KeyboardEvent<HTMLButtonElement>): Promise<void> {
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      await cancelShortcutCapture()
      return
    }
    const accelerator = acceleratorFromEvent(event)
    if (!accelerator) {
      if (!['Meta', 'Control', 'Shift', 'Alt'].includes(event.key)) setShortcutError('请使用至少一个修饰键')
      return
    }
    const result = await window.api.setInboxShortcut(accelerator)
    if (!result.success) {
      setShortcutError(result.error || '快捷键注册失败')
      await window.api.startShortcutCapture()
      return
    }
    onInboxShortcutChange(accelerator)
    setShortcutError('')
    setCapturingShortcut(false)
  }

  const projectsById = new Map(projects.map((project) => [project.id, project]))
  const projectStatus = (project: Project | undefined): DataManagementItem['projectStatus'] => {
    if (!project) return ''
    if (project.deletedAt) return '已删除'
    if (project.archivedAt) return '已归档'
    return '正常'
  }
  const boardStatus = (board: Board | undefined): DataManagementItem['boardStatus'] => {
    if (!board) return ''
    if (board.status === 'deleted') return '已删除'
    if (board.status === 'archived') return '已归档'
    return '正常'
  }
  const boardRestoreBlock = (board: Board): string | null => {
    const project = projectsById.get(board.projectId)
    if (!project) return '未找到该看板的所属项目，暂时无法恢复。'
    const status = projectStatus(project)
    return status === '正常' ? null : `所属项目“${project.title}”当前为${status}，请先恢复所属项目。`
  }
  const deletedBoardRestoreBlock = (board: Board): string | null => {
    const project = projectsById.get(board.projectId)
    if (!project) return '未找到该看板的所属项目，暂时无法恢复。'
    return project.deletedAt ? `所属项目“${project.title}”当前为已删除，请先恢复所属项目。` : null
  }
  const deletedCardRestoreBlock = (board: Board): string | null => {
    const project = projectsById.get(board.projectId)
    if (!project) return '未找到该卡片的所属项目，暂时无法恢复。'
    const deletedParents: string[] = []
    if (project.deletedAt) deletedParents.push(`所属项目“${project.title}”`)
    if (board.status === 'deleted') deletedParents.push(`所属看板“${board.title}”`)
    return deletedParents.length ? `${deletedParents.join('和')}当前为已删除，请先恢复${deletedParents.length > 1 ? '所属项目和所属看板' : deletedParents[0].startsWith('所属项目') ? '所属项目' : '所属看板'}。` : null
  }
  const archivedData: DataManagementItem[] = [
    ...projects.filter((project) => project.archivedAt).map((project) => ({
      id: project.id, type: '项目' as const, title: project.title, context: '', projectName: '', projectStatus: '' as const,
      boardName: '', boardStatus: '' as const, restoreBlockedMessage: null,
      changedAt: project.archivedAt || '', restore: () => onRestoreProject(project.id)
    })),
    ...boards.filter((board) => board.id !== INBOX_BOARD_ID && board.status === 'archived').map((board) => {
      const project = projectsById.get(board.projectId)
      return {
        id: board.id, type: '看板' as const, title: board.title, context: '', projectName: project?.title || '所属项目不存在',
        projectStatus: projectStatus(project), boardName: '', boardStatus: '' as const, restoreBlockedMessage: boardRestoreBlock(board),
        changedAt: board.statusChangedAt || '', restore: () => onRestoreBoard(board.id)
      }
    })
  ].sort((left, right) => new Date(right.changedAt).getTime() - new Date(left.changedAt).getTime())
  const deletedData: DataManagementItem[] = [
    ...projects.filter((project) => project.deletedAt).map((project) => ({
      id: project.id, type: '项目' as const, title: project.title, context: '', projectName: '', projectStatus: '' as const,
      boardName: '', boardStatus: '' as const, restoreBlockedMessage: null, changedAt: project.deletedAt || '',
      restore: () => onRestoreProject(project.id), permanentlyDelete: () => onPermanentlyDelete('项目', project.id)
    })),
    ...boards.filter((board) => board.id !== INBOX_BOARD_ID && board.status === 'deleted').map((board) => {
      const project = projectsById.get(board.projectId)
      return {
        id: board.id, type: '看板' as const, title: board.title, context: '', projectName: project?.title || '所属项目不存在',
        projectStatus: projectStatus(project), boardName: '', boardStatus: '' as const, restoreBlockedMessage: deletedBoardRestoreBlock(board),
        changedAt: board.statusChangedAt || '', restore: () => onRestoreBoard(board.id), permanentlyDelete: () => onPermanentlyDelete('看板', board.id)
      }
    }),
    ...boards.flatMap((board) => {
      const project = projectsById.get(board.projectId)
      return board.cards.filter((card) => card.status === 'deleted').map((card) => ({
        id: card.id, type: '卡片' as const, title: card.title || '无标题', context: '',
        projectName: project?.title || '所属项目不存在', projectStatus: projectStatus(project),
        boardName: board.title, boardStatus: boardStatus(board), restoreBlockedMessage: deletedCardRestoreBlock(board),
        changedAt: card.statusChangedAt || card.updatedAt, restore: () => onRestoreCard(card.id),
        permanentlyDelete: () => onPermanentlyDelete('卡片', card.id)
      }))
    })
  ].sort((left, right) => new Date(right.changedAt).getTime() - new Date(left.changedAt).getTime())
  const managedData = dataManagementTab === 'archived' ? archivedData : deletedData

  return <section className="settings-view">
    <nav className="settings-tabs" aria-label="设置分类">
      <button className={activeTab === 'data' ? 'active' : ''} aria-pressed={activeTab === 'data'} onClick={() => setActiveTab('data')}>数据</button>
      <button className={activeTab === 'display' ? 'active' : ''} aria-pressed={activeTab === 'display'} onClick={() => setActiveTab('display')}>显示</button>
      <button className={activeTab === 'shortcuts' ? 'active' : ''} aria-pressed={activeTab === 'shortcuts'} onClick={() => setActiveTab('shortcuts')}>快捷键</button>
      <button className={activeTab === 'other' ? 'active' : ''} aria-pressed={activeTab === 'other'} onClick={() => setActiveTab('other')}>其他</button>
    </nav>
    {activeTab === 'data' ? <div className="settings-data-page">
      <div className="settings-panel">
        <div className="settings-row database-settings-row">
          <div className="database-copy"><strong>SQLite 数据库</strong><span className="database-path" title={databaseInfo?.path}>{databaseInfo?.path || '正在读取路径…'}</span>{databaseError && <span className="database-error">{databaseError}</span>}</div>
          <div className="database-actions">
            <span className="settings-value">{projectCount} 个项目 · {boardCount} 个看板 · {cardCount} 张卡片</span>
            <div className="database-buttons">
              <button onClick={() => void window.api.revealDatabase()} disabled={!databaseInfo}>在 Finder 中显示</button>
              <button onClick={() => void switchDatabase(onCreate)} disabled={switching}>{switching ? '处理中…' : '新建数据库'}</button>
              <button onClick={() => void switchDatabase(onChoose)} disabled={switching}>{switching ? '切换中…' : '选择数据库'}</button>
              {databaseInfo?.customized && <button onClick={() => void switchDatabase(onUseDefault)} disabled={switching}>恢复默认路径</button>}
            </div>
          </div>
        </div>
      </div>
      <section className="data-management-section">
        <nav className="data-management-tabs" aria-label="数据管理分类">
          <button className={dataManagementTab === 'archived' ? 'active' : ''} onClick={() => setDataManagementTab('archived')}>已归档</button>
          <button className={dataManagementTab === 'deleted' ? 'active' : ''} onClick={() => setDataManagementTab('deleted')}>已删除</button>
        </nav>
        <div className="data-management-list">
          {managedData.length > 0 && <div className={`data-management-header ${dataManagementTab === 'archived' ? 'with-project' : 'with-relations'}`}>
            <span>类型</span><span>名称</span><span>所属项目</span>{dataManagementTab === 'deleted' && <span>所属看板</span>}<span>变更时间</span><span>操作</span>
          </div>}
          {managedData.length === 0 && <div className="data-management-empty">暂无{dataManagementTab === 'archived' ? '已归档' : '已删除'}数据</div>}
          {managedData.map((item) => <div className={`data-management-row ${dataManagementTab === 'archived' ? 'with-project' : 'with-relations'}`} key={`${item.type}-${item.id}`}>
            <span className={`data-kind ${item.type === '项目' ? 'project' : item.type === '看板' ? 'board' : 'card'}`}>{item.type}</span>
            <div className="data-item-copy"><strong>{item.title}</strong>{item.context && <span>{item.context}</span>}</div>
            <div className="data-relation-cell">
              {item.projectName && <><span title={item.projectName}>{item.projectName}</span>{item.projectStatus && <small className={`status-${item.projectStatus === '正常' ? 'active' : item.projectStatus === '已删除' ? 'deleted' : 'archived'}`}>{item.projectStatus}</small>}</>}
            </div>
            {dataManagementTab === 'deleted' && <div className="data-relation-cell">
              {item.boardName && <><span title={item.boardName}>{item.boardName}</span>{item.boardStatus && <small className={`status-${item.boardStatus === '正常' ? 'active' : item.boardStatus === '已删除' ? 'deleted' : 'archived'}`}>{item.boardStatus}</small>}</>}
            </div>}
            <time>{item.changedAt ? new Date(item.changedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '时间未知'}</time>
            <div className="data-management-actions">
              <DataRestoreAction item={item} />
              {dataManagementTab === 'deleted' && item.permanentlyDelete && <DataPermanentDeleteAction item={item} />}
            </div>
          </div>)}
        </div>
      </section>
    </div>
      : activeTab === 'display' ? <div className="settings-panel">
        <div className="settings-row"><div><strong>每行看板列数</strong><span>项目主页同时展示的看板数量</span></div>
          <select className="settings-select" value={boardColumns} onChange={(event) => onBoardColumnsChange(event.target.value === 'auto' ? 'auto' : Number(event.target.value))}>
            <option value="auto">自适应</option>
            {[3, 4, 5, 6, 7, 8].map((value) => <option key={value} value={value}>{value} 列</option>)}
          </select>
        </div>
        <div className="settings-row"><div><strong>看板宽度</strong><span>调整看板和卡片的横向空间</span></div>
          <select className="settings-select" value={boardWidth} onChange={(event) => onBoardWidthChange(event.target.value as 'narrow' | 'medium' | 'wide')}>
            <option value="narrow">窄</option><option value="medium">中</option><option value="wide">宽</option>
          </select>
        </div>
        <div className="settings-row"><div><strong>看板最大高度</strong><span>内容较少时自动收缩；拖拽看板下边缘可单独调整上限</span></div>
          <select className="settings-select" value={boardHeight} onChange={(event) => onBoardHeightChange(event.target.value as 'small' | 'medium' | 'large')}>
            <option value="small">小</option><option value="medium">中</option><option value="large">大</option>
          </select>
        </div>
        <div className="settings-row"><div><strong>字体大小</strong><span>调整应用内文字的整体显示大小</span></div>
          <select className="settings-select" value={fontSize} onChange={(event) => onFontSizeChange(event.target.value as 'small' | 'medium' | 'large')}>
            <option value="small">小</option><option value="medium">中</option><option value="large">大</option>
          </select>
        </div>
        <div className="settings-row"><div><strong>Dock 推进计时</strong><span>推进时在 macOS Dock 图标显示剩余时间</span></div>
          <button className={dockTimerEnabled ? 'switch-control active' : 'switch-control'} role="switch" aria-checked={dockTimerEnabled}
            onClick={() => onDockTimerChange(!dockTimerEnabled)}><span /></button>
        </div>
      </div>
      : activeTab === 'shortcuts' ? <div className="settings-panel">
        <section className="shortcut-section">
          <header className="shortcut-section-title"><strong>全局快捷键</strong><span>在其他应用中也可以使用</span></header>
          <div className="settings-row shortcut-settings-row"><div><strong>快速添加到收件箱</strong><span>唤醒快速添加对话框，无需打开应用主界面</span></div>
            <div className="shortcut-control-wrap">
              <button ref={shortcutButtonRef} className={capturingShortcut ? 'shortcut-capture active' : 'shortcut-capture'}
                onClick={() => { if (!capturingShortcut) void beginShortcutCapture() }}
                onKeyDown={(event) => { if (capturingShortcut) void captureShortcut(event) }}
                onBlur={() => { if (capturingShortcut) void cancelShortcutCapture() }}>
                {capturingShortcut ? '请按新的组合键…' : formatShortcut(inboxShortcut)}
              </button>
              {shortcutError && <span className="shortcut-error">{shortcutError}</span>}
            </div>
          </div>
        </section>
        <section className="shortcut-section">
          <header className="shortcut-section-title"><strong>应用内快捷键</strong><span>仅在 Vistask 窗口中生效，不可修改</span></header>
          <div className="settings-row shortcut-reference-row"><div><strong>切换项目标签</strong><span>跳转到对应序号的项目，数字以项目在顶部的排列顺序为准</span></div><kbd>⌘ + 1…9</kbd></div>
          <div className="settings-row shortcut-reference-row"><div><strong>进入项目主页</strong><span>无论当前在哪个页面，都返回项目主界面</span></div><kbd>⌘ + ⇧ + P</kbd></div>
          <div className="settings-row shortcut-reference-row"><div><strong>进入 Tag 页面</strong><span>打开 Tag 管理与相关卡片页面</span></div><kbd>⌘ + ⇧ + T</kbd></div>
          <div className="settings-row shortcut-reference-row"><div><strong>打开搜索</strong><span>打开全局搜索对话框</span></div><kbd>⌘ + ⇧ + F</kbd></div>
        </section>
      </div>
      : <div className="settings-panel">
        <div className="settings-row"><div><strong>推进番茄时长</strong><span>设置一个完整番茄的推进时间；提前结束满五分之一即可计入统计</span></div>
          <select className="settings-select" value={focusDurationMinutes}
            onChange={(event) => onFocusDurationChange(Math.min(120, Math.max(10, Number(event.target.value))))}>
            {Array.from({ length: 23 }, (_, index) => 10 + index * 5).map((minutes) => <option key={minutes} value={minutes}>{minutes === 120 ? '120 分钟（2 小时）' : `${minutes} 分钟`}</option>)}
          </select>
        </div>
      </div>}
  </section>
}

function orderedChildCards(board: Board, parent: BoardCard): BoardCard[] {
  return board.cards.filter((card) => card.parentId === parent.id).sort((left, right) => {
    if (parent.repeatEnabled) {
      const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.POSITIVE_INFINITY
      const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.POSITIVE_INFINITY
      if (leftDue !== rightDue) return leftDue - rightDue
    }
    return left.sort - right.sort || left.createdAt.localeCompare(right.createdAt)
  })
}

export function displayedChildCards(board: Board, parent: BoardCard, selectedDisplay?: ChildDisplay): BoardCard[] {
  const ordered = orderedChildCards(board, parent)
  const display = selectedDisplay || (parent.childMode === 'serial' ? 'in_progress_first' : 'in_progress')
  if (display === 'in_progress_first') {
    const first = ordered.find((card) => card.status === 'in_progress')
    return first ? [first] : []
  }
  return ordered.filter((card) => card.status !== 'deleted' && (display === 'all' || card.status === display))
}

interface BoardColumnProps {
  board: Board; tags: CardTag[]; collapsed: Set<string>; focus: FocusSession | null; dragCardId: string | null
  virtual?: boolean
  dragCardTargetId: string | null; dragCardTargetBoardId: string | null; dragBoardId: string | null; dragBoardTargetId: string | null
  heightMode: 'small' | 'medium' | 'large'
  parentDisplay: BoardParentDisplay; onParentDisplayChange: (display: BoardParentDisplay) => void
  autoEditCardId: string | null; onAutoEditComplete: () => void
  childDisplaySelections: Record<string, ChildDisplay>; onSetChildDisplay: (cardId: string, display: ChildDisplay) => void
  onAddCard: (boardId: string, parentId?: string | null) => void; onEditCard: (card: BoardCard, anchor: DOMRect) => void
  onUpdateCard: (cardId: string, patch: Partial<BoardCard>) => void; onCycleStatus: (card: BoardCard) => void
  onRename: (title: string) => void; onSetStatus: (status: 'archived' | 'deleted') => void; manageOpen: boolean; projects: Project[]; onManage: () => void
  onSetProject: (projectId: string) => void; onSetHeight: (height: number | null) => void
  onBoardDragStart: (boardId: string | null) => void; onBoardDragEnter: (targetId: string) => void
  onBoardDrop: (draggedId: string, targetId: string) => void; onBoardDragEnd: () => void
  onToggleCollapse: (cardId: string) => void; onDragStart: (cardId: string | null) => void
  onCardDragEnter: (boardId: string, beforeId?: string | null) => void
  onDropCard: (cardId: string, boardId: string, beforeId?: string | null) => void; onStartFocus: (cardId: string) => void
}

function BoardDisplayAction({ value, managementOpen, onOpen, onChange }: {
  value: BoardParentDisplay
  managementOpen: boolean
  onOpen: () => void
  onChange: (display: BoardParentDisplay) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 8, top: 8 })
  const containerRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const options: Array<{ value: BoardParentDisplay; label: string }> = [
    { value: 'all', label: '全部' },
    { value: 'in_progress', label: '进行中' },
    { value: 'staged', label: '已放弃' },
    { value: 'done', label: '已完成' }
  ]

  useEffect(() => { if (managementOpen) setOpen(false) }, [managementOpen])
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!containerRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false)
    }
    const closeOnViewportChange = (): void => setOpen(false)
    document.addEventListener('pointerdown', close)
    document.addEventListener('scroll', closeOnViewportChange, true)
    window.addEventListener('resize', closeOnViewportChange)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('scroll', closeOnViewportChange, true)
      window.removeEventListener('resize', closeOnViewportChange)
    }
  }, [open])

  function toggle(): void {
    if (open) { setOpen(false); return }
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = 140
    const estimatedHeight = 128
    const left = Math.min(window.innerWidth - width - 8, Math.max(8, rect.right - width))
    const below = rect.bottom + 6
    const top = below + estimatedHeight <= window.innerHeight - 8 ? below : Math.max(8, rect.top - estimatedHeight - 6)
    setPosition({ left, top })
    onOpen()
    setOpen(true)
  }

  return <div className="board-display-action" ref={containerRef}>
    <button ref={buttonRef} className={open ? 'icon-button board-display-button active' : 'icon-button board-display-button'}
      onPointerDown={(event) => event.stopPropagation()} onDragStart={(event) => event.preventDefault()}
      onClick={toggle} title="卡片显示类型" aria-label="卡片显示类型"><EyeIcon /></button>
    {open && createPortal(<div ref={popoverRef} className="board-display-popover" style={position} role="radiogroup" aria-label="卡片显示类型"
      onPointerDown={(event) => event.stopPropagation()}>
      <strong>显示类型</strong>
      {options.map((option) => <label key={option.value}>
        <input type="radio" name="board-parent-display" value={option.value} checked={value === option.value}
          onChange={() => { onChange(option.value); setOpen(false) }} />
        <span>{option.label}</span>
      </label>)}
    </div>, document.body)}
  </div>
}

function measureBoardNaturalHeight(article: HTMLElement): number | null {
  const cardsList = article.querySelector<HTMLElement>(':scope > .cards-list')
  const header = article.querySelector<HTMLElement>(':scope > .board-header')
  const addButton = article.querySelector<HTMLElement>(':scope > .add-card')
  if (!cardsList || !header || !addButton) return null
  const articleStyle = window.getComputedStyle(article)
  const addStyle = window.getComputedStyle(addButton)
  return Math.ceil(header.offsetHeight + cardsList.scrollHeight + addButton.offsetHeight
    + Number.parseFloat(addStyle.marginTop || '0') + Number.parseFloat(addStyle.marginBottom || '0')
    + Number.parseFloat(articleStyle.borderTopWidth || '0') + Number.parseFloat(articleStyle.borderBottomWidth || '0'))
}

function BoardColumn(props: BoardColumnProps): React.JSX.Element {
  const { board } = props
  const defaultHeight = BOARD_HEIGHT_PIXELS[props.heightMode]
  const resolvedHeight = board.height ?? defaultHeight
  const articleRef = useRef<HTMLElement | null>(null)
  const manageRef = useRef<HTMLDivElement | null>(null)
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const resizeLimitTimerRef = useRef<number | null>(null)
  const suppressRenameRef = useRef(false)
  const cancelRenameRef = useRef(false)
  const [previewHeight, setPreviewHeight] = useState<number | null>(resolvedHeight)
  const [resizing, setResizing] = useState(false)
  const [contentExceedsMaximum, setContentExceedsMaximum] = useState(false)
  const [hasHiddenCardsBelow, setHasHiddenCardsBelow] = useState(false)
  const [showResizeLimit, setShowResizeLimit] = useState(false)
  const [pendingBoardAction, setPendingBoardAction] = useState<'archive' | 'delete' | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState(board.title)

  useEffect(() => setPreviewHeight(resolvedHeight), [resolvedHeight])
  useEffect(() => () => {
    if (resizeLimitTimerRef.current !== null) window.clearTimeout(resizeLimitTimerRef.current)
  }, [])
  useEffect(() => { if (!renaming) setTitleDraft(board.title) }, [board.title, renaming])
  useEffect(() => { if (!props.manageOpen) setPendingBoardAction(null) }, [props.manageOpen])

  useLayoutEffect(() => {
    if (!renaming) return
    titleInputRef.current?.focus()
    titleInputRef.current?.select()
  }, [renaming])

  useEffect(() => {
    if (!props.manageOpen) return
    const close = (event: PointerEvent): void => {
      if (!manageRef.current?.contains(event.target as Node)) props.onManage()
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [props.manageOpen, props.onManage])

  useEffect(() => {
    const article = articleRef.current
    const cardsList = article?.querySelector<HTMLElement>(':scope > .cards-list')
    const header = article?.querySelector<HTMLElement>(':scope > .board-header')
    const addButton = article?.querySelector<HTMLElement>(':scope > .add-card')
    if (!article || !cardsList || !header || !addButton) return

    const updateContentFit = (): void => {
      const naturalHeight = measureBoardNaturalHeight(article)
      if (naturalHeight === null) return
      const maximumHeight = previewHeight ?? defaultHeight
      setContentExceedsMaximum(naturalHeight > maximumHeight + 1)
    }

    const frame = window.requestAnimationFrame(updateContentFit)
    const observer = new ResizeObserver(updateContentFit)
    observer.observe(cardsList)
    observer.observe(header)
    observer.observe(addButton)
    Array.from(cardsList.children).forEach((child) => observer.observe(child))
    window.addEventListener('resize', updateContentFit)
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', updateContentFit)
    }
  }, [board.cards, board.filter, previewHeight, defaultHeight, props.collapsed, props.parentDisplay, props.childDisplaySelections])

  useEffect(() => {
    const cardsList = articleRef.current?.querySelector<HTMLElement>('.cards-list')
    if (!cardsList) return
    const updateOverflow = (): void => {
      setHasHiddenCardsBelow(contentExceedsMaximum && cardsList.scrollHeight - cardsList.scrollTop - cardsList.clientHeight > 2)
    }
    const frame = window.requestAnimationFrame(updateOverflow)
    const observer = new ResizeObserver(updateOverflow)
    observer.observe(cardsList)
    Array.from(cardsList.children).forEach((child) => observer.observe(child))
    cardsList.addEventListener('scroll', updateOverflow, { passive: true })
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      cardsList.removeEventListener('scroll', updateOverflow)
    }
  }, [board.cards, board.filter, previewHeight, props.collapsed, contentExceedsMaximum])

  function startResize(event: React.PointerEvent<HTMLButtonElement>): void {
    event.preventDefault()
    event.stopPropagation()
    const handle = event.currentTarget
    handle.setPointerCapture?.(event.pointerId)
    const renderedHeight = articleRef.current?.getBoundingClientRect().height
    const startHeight = renderedHeight && renderedHeight > 0 ? renderedHeight : previewHeight ?? defaultHeight
    const startY = event.clientY
    const naturalHeight = articleRef.current ? measureBoardNaturalHeight(articleRef.current) : null
    const maximum = Math.max(160, naturalHeight ?? defaultHeight)
    const edgeTolerance = 4
    const startedAtMaximum = startHeight >= maximum - edgeTolerance
    let nextHeight = Math.round(startHeight)
    let limitNotified = false
    let lastY = startY
    const notifyLimit = (): void => {
      if (limitNotified) return
      limitNotified = true
      setShowResizeLimit(true)
      if (resizeLimitTimerRef.current !== null) window.clearTimeout(resizeLimitTimerRef.current)
      resizeLimitTimerRef.current = window.setTimeout(() => {
        setShowResizeLimit(false)
        resizeLimitTimerRef.current = null
      }, 1600)
    }
    setResizing(true)
    const move = (pointerEvent: PointerEvent): void => {
      const deltaY = pointerEvent.clientY - startY
      const requestedHeight = startHeight + deltaY
      const movingDown = pointerEvent.clientY > lastY || deltaY >= 1
      if (movingDown && ((startedAtMaximum && deltaY >= 1) || requestedHeight >= maximum - 0.5)) notifyLimit()
      nextHeight = Math.round(Math.min(maximum, Math.max(160, requestedHeight)))
      setPreviewHeight(nextHeight)
      lastY = pointerEvent.clientY
    }
    const finish = (): void => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', finish)
      document.removeEventListener('pointercancel', finish)
      document.body.classList.remove('resizing-board')
      if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId)
      setResizing(false)
      props.onSetHeight(nextHeight)
    }
    document.body.classList.add('resizing-board')
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', finish, { once: true })
    document.addEventListener('pointercancel', finish, { once: true })
  }

  function startRename(): void {
    cancelRenameRef.current = false
    setTitleDraft(board.title)
    setRenaming(true)
    if (props.manageOpen) props.onManage()
  }

  function finishRename(): void {
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false
      setTitleDraft(board.title)
      setRenaming(false)
      return
    }
    const title = titleDraft.trim()
    if (title && title !== board.title) props.onRename(title)
    if (!title) setTitleDraft(board.title)
    setRenaming(false)
  }

  const matchesParentDisplay = (card: BoardCard): boolean => props.virtual
    ? board.filter[card.status] !== false
    : card.status !== 'deleted' && (props.parentDisplay === 'all' || card.status === props.parentDisplay)
  const visibleParents = board.cards.filter((card) => !card.parentId && matchesParentDisplay(card))
  const orphans = board.cards.filter((card) => card.parentId && !board.cards.some((parent) => parent.id === card.parentId) && matchesParentDisplay(card))
  const cards = [...visibleParents, ...orphans]
  const visibleChildCount = visibleParents.reduce((total, parent) => total + (props.collapsed.has(parent.id) ? 0 : displayedChildCards(board, parent).length), 0)
  const visibleCount = cards.length + visibleChildCount
  const boardFocusCards = board.cards.filter((card) => card.status !== 'deleted')
  const boardFocusMinutes = boardFocusCards.reduce((total, card) => total + card.focusMinutes, 0)
  const boardPomodoroCount = boardFocusCards.reduce((total, card) => total + (card.pomodoroCount > 0 ? card.pomodoroCount : card.focusMinutes / 50), 0)
  const hasBoardFocusStats = boardFocusMinutes > 0 || boardPomodoroCount > 0
  const boardFocusMinutesText = Number.isInteger(boardFocusMinutes) ? String(boardFocusMinutes) : boardFocusMinutes.toFixed(1)
  const boardFocusTooltip = `${boardPomodoroCount.toFixed(1)}个番茄，共${boardFocusMinutesText}分钟`
  const hasCustomHeight = board.height !== null || resizing
  return <article ref={articleRef} data-search-key={`board:${board.id}`} className={`board-column height-limited${hasCustomHeight ? ' custom-height' : ''}${contentExceedsMaximum ? ' content-overflowing' : ''}${props.dragBoardId === board.id ? ' dragging' : ''}${props.dragBoardTargetId === board.id ? ' drag-target' : ''}${props.dragCardId && props.dragCardTargetBoardId === board.id && props.dragCardTargetId === null ? ' card-drop-target' : ''}`}
    style={hasCustomHeight ? { height: `${previewHeight}px`, maxHeight: 'none' } : { maxHeight: `${previewHeight}px` }}
    onDragEnter={(event) => {
      if (props.virtual) return
      if (props.dragBoardId) {
        event.preventDefault()
        props.onBoardDragEnter(board.id)
      } else if (props.dragCardId && !(event.target as HTMLElement).closest('.card-item')) {
        event.preventDefault()
        props.onCardDragEnter(board.id, null)
      }
    }}
    onDragOver={(event) => {
      if (props.virtual) return
      event.preventDefault()
      if (props.dragBoardId && props.dragBoardId !== board.id) {
        event.dataTransfer.dropEffect = 'move'
        props.onBoardDragEnter(board.id)
      }
    }} onDrop={(event) => {
      if (props.virtual) return
      event.preventDefault()
      const draggedBoardId = event.dataTransfer.getData('text/x-vistask-board')
      if (draggedBoardId) props.onBoardDrop(draggedBoardId, board.id)
      else if (props.dragCardId) props.onDropCard(props.dragCardId, board.id)
      if (props.dragCardId) props.onDragStart(null)
      if (!draggedBoardId) props.onBoardDragEnd()
    }}>
    <header className="board-header" draggable={!renaming && !props.virtual} aria-grabbed={!props.virtual && props.dragBoardId === board.id}
      title={renaming || props.virtual ? undefined : '按住并拖拽调整看板位置'}
      onDragStart={(event) => {
        if (props.virtual) { event.preventDefault(); return }
        const article = articleRef.current
        if (!article) return
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/x-vistask-board', board.id)
        setScaledDragPreview(event, article)
        props.onBoardDragStart(board.id)
      }}
      onDragEnd={() => {
        suppressRenameRef.current = true
        props.onBoardDragEnd()
        window.setTimeout(() => { suppressRenameRef.current = false }, 180)
      }}>
      <span className="board-color" style={{ backgroundColor: board.color }} />
      {renaming
        ? <input ref={titleInputRef} className="board-title board-title-input" value={titleDraft} maxLength={40} aria-label="重命名看板"
          onPointerDown={(event) => event.stopPropagation()} onDragStart={(event) => event.preventDefault()}
          onChange={(event) => setTitleDraft(event.target.value)} onBlur={finishRename}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') { cancelRenameRef.current = true; event.currentTarget.blur() }
          }} />
        : <button className="board-title" draggable={!props.virtual} onClick={() => { if (!props.virtual && !suppressRenameRef.current) startRename() }}>{board.title}</button>}
      <span className="board-count">{visibleCount}</span>
      {hasBoardFocusStats && <span className="board-focus-stat" data-tooltip={boardFocusTooltip} aria-label={boardFocusTooltip}>
        <CardActionIcon name="focus" /><span>{boardPomodoroCount.toFixed(1)}</span>
      </span>}
      {!props.virtual && <BoardDisplayAction value={props.parentDisplay} managementOpen={props.manageOpen}
        onOpen={() => { if (props.manageOpen) props.onManage() }} onChange={props.onParentDisplayChange} />
      }
      {!props.virtual && <div className="board-menu" ref={manageRef}>
        <button className={props.manageOpen ? 'icon-button active' : 'icon-button'} onClick={props.onManage} title="看板管理" aria-label="看板管理"><MoreIcon /></button>
        {props.manageOpen && <div className="filter-popover">
          {pendingBoardAction ? <div className="board-action-confirm">
            <strong>{pendingBoardAction === 'delete' ? '删除看板' : '归档看板'}</strong>
            <p>{pendingBoardAction === 'delete'
              ? `确认将“${board.title}”标记为已删除？看板及其中的卡片数据会保留。`
              : `确认将“${board.title}”标记为已归档？看板及其中的卡片数据会保留。`}</p>
            <div className="board-action-confirm-buttons">
              <button onClick={() => setPendingBoardAction(null)}>取消</button>
              <button className={pendingBoardAction === 'delete' ? 'danger' : 'confirm'} onClick={() => props.onSetStatus(pendingBoardAction === 'delete' ? 'deleted' : 'archived')}>确认</button>
            </div>
          </div> : <>
            <strong>看板管理</strong>
            <label className="project-select-label">归属项目<select value={board.projectId} disabled={!props.projects.length} onChange={(event) => props.onSetProject(event.target.value)}>
              {props.projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
            </select></label>
            <div className="filter-divider" />
            <strong>操作</strong>
            <button className="board-menu-action" onClick={startRename}>重命名看板</button>
            <button className="board-menu-action danger" onClick={() => setPendingBoardAction('delete')}>删除看板</button>
            <button className="board-menu-action" onClick={() => setPendingBoardAction('archive')}>归档看板</button>
          </>}
        </div>}
      </div>}
    </header>
    <CardList {...props} aggregate={props.virtual} parentDisplay={props.virtual ? undefined : props.parentDisplay} disableDrag={props.virtual} />
    {props.virtual
      ? <button className="add-card virtual-placeholder" disabled aria-hidden="true" />
      : <button className="add-card" onClick={() => props.onAddCard(board.id)}>＋ 添加卡片</button>}
    {hasHiddenCardsBelow && <button className="boards-overflow-button down board-card-overflow-button"
      title="显示下方更多卡片" aria-label="显示下方更多卡片" onClick={(event) => {
        event.stopPropagation()
        const cardsList = articleRef.current?.querySelector<HTMLElement>('.cards-list')
        cardsList?.scrollBy({ top: Math.max(80, cardsList.clientHeight * .7), behavior: 'smooth' })
      }}><OverflowIcon direction="down" /></button>}
    {showResizeLimit && <span className="board-resize-limit" role="status">已经到底</span>}
    {!props.virtual && <button className="board-resize-handle" onPointerDown={startResize}
      onDoubleClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setPreviewHeight(defaultHeight)
        props.onSetHeight(null)
      }} title="拖拽调整看板最大高度，双击恢复默认高度" aria-label="调整看板最大高度" />}
  </article>
}

interface CardListProps {
  board: Board; tags: CardTag[]; collapsed: Set<string>; focus: FocusSession | null; dragCardId: string | null
  dragCardTargetId: string | null; dragCardTargetBoardId: string | null
  parentDisplay?: BoardParentDisplay
  flat?: boolean
  showTypeBadges?: boolean
  contextCards?: BoardCard[]
  autoEditCardId: string | null; onAutoEditComplete: () => void
  childDisplaySelections: Record<string, ChildDisplay>; onSetChildDisplay: (cardId: string, display: ChildDisplay) => void
  aggregate?: boolean
  disableDrag?: boolean
  assignmentProjects?: Project[]
  assignmentBoards?: Board[]
  onAssignCard?: (card: BoardCard, targetBoardId: string) => void
  onAddCard: (boardId: string, parentId?: string | null) => void; onEditCard: (card: BoardCard, anchor: DOMRect) => void
  onUpdateCard: (cardId: string, patch: Partial<BoardCard>) => void; onCycleStatus: (card: BoardCard) => void
  onToggleCollapse: (cardId: string) => void; onDragStart: (cardId: string | null) => void
  onCardDragEnter: (boardId: string, beforeId?: string | null) => void
  onDropCard: (cardId: string, boardId: string, beforeId?: string | null) => void; onStartFocus: (cardId: string) => void
}

function CardList(props: CardListProps): React.JSX.Element {
  const { board } = props
  const matchesParentDisplay = (card: BoardCard): boolean => props.parentDisplay
    ? card.status !== 'deleted' && (props.parentDisplay === 'all' || card.status === props.parentDisplay)
    : board.filter[card.status] !== false
  const visibleParents = board.cards.filter((card) => !card.parentId && matchesParentDisplay(card))
  const orphans = board.cards.filter((card) => card.parentId && !board.cards.some((parent) => parent.id === card.parentId) && matchesParentDisplay(card))
  const cards = props.flat ? board.cards.filter(matchesParentDisplay) : [...visibleParents, ...orphans]
  const listDropTarget = !props.aggregate && Boolean(props.dragCardId) && props.dragCardTargetBoardId === board.id && props.dragCardTargetId === null
  return <div className={`cards-list${listDropTarget ? ' card-drop-target' : ''}`}
    onDragEnter={(event) => {
      if (props.aggregate || !props.dragCardId || event.target !== event.currentTarget) return
      event.preventDefault()
      props.onCardDragEnter(board.id, null)
    }}
    onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }}
    onDrop={(event) => {
      event.preventDefault()
      if (!props.aggregate && props.dragCardId) props.onDropCard(props.dragCardId, board.id)
      props.onDragStart(null)
    }}>
    {cards.length === 0 && <div className="board-empty">暂无卡片</div>}
    {cards.map((card) => {
      const allChildren = props.flat ? [] : orderedChildCards(board, card)
      const childDisplay = props.childDisplaySelections[card.id] || (card.childMode === 'serial' ? 'in_progress_first' : 'in_progress')
      const children = props.flat || props.collapsed.has(card.id) ? [] : displayedChildCards(board, card, childDisplay)
      const sourceParent = card.parentId ? props.contextCards?.find((candidate) => candidate.id === card.parentId) : undefined
      const completedChildCount = allChildren.filter((child) => child.status === 'done').length
      const overdueChildCount = allChildren.filter((child) => child.status !== 'done' && child.status !== 'deleted' && child.dueAt
        && new Date(child.dueAt).getTime() < Date.now()).length
      return <CardItem key={card.id} card={card} isChild={Boolean(card.parentId)} childCount={allChildren.length}
        tags={props.tags}
        disableDrag={props.disableDrag}
        dragging={props.dragCardId === card.id} dragTarget={props.dragCardId !== card.id && props.dragCardTargetId === card.id}
        completedChildCount={completedChildCount} overdueChildCount={overdueChildCount}
        childDisplay={childDisplay}
        showChildBadge={Boolean(props.showTypeBadges && card.parentId)}
        showRepeatTaskBadge={Boolean(props.showTypeBadges && (card.repeatEnabled || sourceParent?.repeatEnabled))}
        hideChildDisplayControl={Boolean(props.flat)}
        collapsed={props.collapsed.has(card.id)} focus={props.focus?.cardId === card.id ? props.focus : null}
        autoEditTitle={props.autoEditCardId === card.id} onAutoEditComplete={props.onAutoEditComplete}
        onEdit={(anchor) => props.onEditCard(card, anchor)} onCycle={() => props.onCycleStatus(card)}
        onUpdateText={(patch) => props.onUpdateCard(card.id, patch)}
        onSetTags={(tagIds) => props.onUpdateCard(card.id, { tagIds })}
        onFlag={() => props.onUpdateCard(card.id, { flagged: !card.flagged })}
        onDelete={() => { if (window.confirm(`删除卡片“${card.title || '无标题'}”？`)) props.onUpdateCard(card.id, { status: 'deleted' }) }}
        onSetDue={(dueAt) => props.onUpdateCard(card.id, { dueAt })}
        onAddChild={() => props.onAddCard(card.boardId, card.id)} onToggleCollapse={() => props.onToggleCollapse(card.id)}
        onSetChildDisplay={(childDisplay) => {
          if (props.collapsed.has(card.id)) props.onToggleCollapse(card.id)
          props.onSetChildDisplay(card.id, childDisplay)
        }}
        assignmentProjects={props.assignmentProjects} assignmentBoards={props.assignmentBoards}
        onAssign={props.onAssignCard ? (targetBoardId) => props.onAssignCard?.(card, targetBoardId) : undefined}
        onStartFocus={() => props.onStartFocus(card.id)} onDragStart={() => props.onDragStart(card.id)} onDragEnd={() => props.onDragStart(null)}
        onDragEnter={() => props.onCardDragEnter(card.boardId, card.id)}
        onDrop={() => { if (props.dragCardId) props.onDropCard(props.dragCardId, card.boardId, card.id); props.onDragStart(null) }}>
        {children.length > 0 && <div className="subcards-list">
          {children.map((child) => <CardItem key={child.id} card={child} isChild childCount={0} embedded
            tags={props.tags}
            disableDrag={props.disableDrag}
            dragging={props.dragCardId === child.id} dragTarget={props.dragCardId !== child.id && props.dragCardTargetId === child.id}
            completedChildCount={0} overdueChildCount={0}
            childDisplay="in_progress"
            hideChildDisplayControl
            collapsed={false} focus={props.focus?.cardId === child.id ? props.focus : null}
            autoEditTitle={props.autoEditCardId === child.id} onAutoEditComplete={props.onAutoEditComplete}
            onEdit={(anchor) => props.onEditCard(child, anchor)} onCycle={() => props.onCycleStatus(child)}
            onUpdateText={(patch) => props.onUpdateCard(child.id, patch)}
            onSetTags={(tagIds) => props.onUpdateCard(child.id, { tagIds })}
            onFlag={() => props.onUpdateCard(child.id, { flagged: !child.flagged })}
            onDelete={() => { if (window.confirm(`删除卡片“${child.title || '无标题'}”？`)) props.onUpdateCard(child.id, { status: 'deleted' }) }}
            onSetDue={(dueAt) => props.onUpdateCard(child.id, { dueAt })}
            onAddChild={() => undefined} onToggleCollapse={() => undefined}
            onSetChildDisplay={() => undefined}
            assignmentProjects={props.assignmentProjects} assignmentBoards={props.assignmentBoards}
            onAssign={props.onAssignCard ? (targetBoardId) => props.onAssignCard?.(child, targetBoardId) : undefined}
            onStartFocus={() => props.onStartFocus(child.id)} onDragStart={() => props.onDragStart(child.id)} onDragEnd={() => props.onDragStart(null)}
            onDragEnter={() => props.onCardDragEnter(child.boardId, child.id)}
            onDrop={() => { if (props.dragCardId) props.onDropCard(props.dragCardId, child.boardId, child.id); props.onDragStart(null) }} />)}
        </div>}
      </CardItem>
    })}
  </div>
}

interface CardItemProps {
  card: BoardCard; tags: CardTag[]; isChild: boolean; childCount: number; completedChildCount: number; overdueChildCount: number
  dragging: boolean; dragTarget: boolean
  disableDrag?: boolean
  childDisplay: ChildDisplay
  showChildBadge?: boolean
  showRepeatTaskBadge?: boolean
  hideChildDisplayControl?: boolean
  collapsed: boolean; focus: FocusSession | null
  autoEditTitle: boolean; onAutoEditComplete: () => void
  embedded?: boolean; children?: React.ReactNode
  assignmentProjects?: Project[]; assignmentBoards?: Board[]; onAssign?: (targetBoardId: string) => void
  onEdit: (anchor: DOMRect) => void; onCycle: () => void; onUpdateText: (patch: Pick<BoardCard, 'title'> | Pick<BoardCard, 'content'>) => void
  onSetTags: (tagIds: string[]) => void
  onFlag: () => void; onDelete: () => void; onSetDue: (dueAt: string | null) => void; onAddChild: () => void
  onToggleCollapse: () => void; onSetChildDisplay: (display: ChildDisplay) => void; onStartFocus: () => void
  onDragStart: () => void; onDragEnd: () => void; onDragEnter: () => void; onDrop: () => void
}

function ChildDisplayAction({ value, mode, onChange }: { value: ChildDisplay; mode: ChildMode; onChange: (value: ChildDisplay) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 8, top: 8 })
  const containerRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const displayValue: ChildDisplay = mode === 'parallel' && value === 'in_progress_first' ? 'in_progress' : value
  const options: ChildDisplay[] = mode === 'serial'
    ? ['all', 'in_progress', 'in_progress_first', 'done', 'staged']
    : ['all', 'in_progress', 'done', 'staged']

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!containerRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false)
    }
    const closeOnViewportChange = (): void => setOpen(false)
    document.addEventListener('pointerdown', close)
    document.addEventListener('scroll', closeOnViewportChange, true)
    window.addEventListener('resize', closeOnViewportChange)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('scroll', closeOnViewportChange, true)
      window.removeEventListener('resize', closeOnViewportChange)
    }
  }, [open])

  function toggle(): void {
    if (open) { setOpen(false); return }
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = 146
    const estimatedHeight = mode === 'serial' ? 145 : 121
    const left = Math.min(window.innerWidth - width - 8, Math.max(8, rect.left + rect.width / 2 - width / 2))
    const below = rect.bottom + 6
    const top = below + estimatedHeight <= window.innerHeight - 8 ? below : Math.max(8, rect.top - estimatedHeight - 6)
    setPosition({ left, top })
    setOpen(true)
  }

  return <div className="child-display-action" ref={containerRef}>
    <button ref={buttonRef} className={open ? 'child-display-button active' : 'child-display-button'} onClick={toggle}
      data-tooltip="子卡片显示类型" aria-label="子卡片显示类型"><EyeIcon /></button>
    {open && createPortal(<div ref={popoverRef} className="child-display-popover" style={position} role="radiogroup" aria-label="子卡片显示类型" onPointerDown={(event) => event.stopPropagation()}>
      <strong>子卡片显示类型</strong>
      {options.map((option) => <label key={option}>
        <input type="radio" name="child-display" value={option} checked={displayValue === option} onChange={() => { onChange(option); setOpen(false) }} />
        <span>{option === 'in_progress' && mode === 'serial' ? '进行中-所有' : CHILD_DISPLAY_LABELS[option]}</span>
      </label>)}
    </div>, document.body)}
  </div>
}

function DueDateAction({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value || dateTimeInputValue())
  const containerRef = useRef<HTMLDivElement | null>(null)
  const due = value ? formatDue(value) : null

  useEffect(() => {
    if (!open) return
    const closeOnOutsideClick = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [open])

  function toggle(): void {
    if (!open) setDraft(value || dateTimeInputValue())
    setOpen((current) => !current)
  }

  return <div className={value ? 'due-action has-value' : 'due-action'} ref={containerRef}>
    <button className={`card-action-button due-button${due?.overdue ? ' overdue' : ''}`} onClick={toggle}
      data-tooltip={value ? '修改截止时间' : '设置截止时间'} aria-label={value ? '修改截止时间' : '设置截止时间'}>
      {!due && <ClockIcon />}{due && <span>{due.text}</span>}
    </button>
    {open && <div className="due-popover" onPointerDown={(event) => event.stopPropagation()}>
      <strong>截止时间</strong>
      <input type="datetime-local" autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} />
      <div className="due-popover-actions">
        {value && <button onClick={() => { onChange(null); setOpen(false) }}>清除</button>}
        <button onClick={() => setOpen(false)}>取消</button>
        <button className="confirm" disabled={!draft} onClick={() => { if (draft) onChange(draft); setOpen(false) }}>确定</button>
      </div>
    </div>}
  </div>
}

function AssignmentAction({ projects, boards, onAssign }: {
  projects: Project[]
  boards: Board[]
  onAssign: (targetBoardId: string) => void
}): React.JSX.Element {
  const availableProjects = useMemo(() => projects.filter((project) => boards.some((board) => board.projectId === project.id)), [boards, projects])
  const [open, setOpen] = useState(false)
  const [projectId, setProjectId] = useState(availableProjects[0]?.id || '')
  const availableBoards = useMemo(() => boards.filter((board) => board.projectId === projectId).sort((a, b) => a.sort - b.sort), [boards, projectId])
  const [boardId, setBoardId] = useState(availableBoards[0]?.id || '')
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (availableProjects.some((project) => project.id === projectId)) return
    setProjectId(availableProjects[0]?.id || '')
  }, [availableProjects, projectId])

  useEffect(() => {
    if (availableBoards.some((board) => board.id === boardId)) return
    setBoardId(availableBoards[0]?.id || '')
  }, [availableBoards, boardId])

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  return <div className="assignment-action" ref={containerRef}>
    <button className="card-action-button icon-only" onClick={() => setOpen((value) => !value)}
      data-tooltip="分配到看板" aria-label="分配到看板"><AssignIcon /></button>
    {open && <div className="assignment-popover" onPointerDown={(event) => event.stopPropagation()}>
      <strong>分配卡片</strong>
      {availableProjects.length ? <>
        <label>项目<select value={projectId} onChange={(event) => {
          const nextProjectId = event.target.value
          setProjectId(nextProjectId)
          setBoardId(boards.filter((board) => board.projectId === nextProjectId).sort((a, b) => a.sort - b.sort)[0]?.id || '')
        }}>{availableProjects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label>
        <label>看板<select value={boardId} onChange={(event) => setBoardId(event.target.value)}>
          {availableBoards.map((board) => <option key={board.id} value={board.id}>{board.title}</option>)}
        </select></label>
        <button className="assignment-confirm" disabled={!boardId} onClick={() => { if (boardId) { onAssign(boardId); setOpen(false) } }}>分配</button>
      </> : <span className="assignment-empty">请先在项目中创建看板</span>}
    </div>}
  </div>
}

function CardTagAction({ tags, selectedIds, onAdd }: {
  tags: CardTag[]
  selectedIds: string[]
  onAdd: (tagId: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 8, top: 8 })
  const containerRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const childrenOf = (parentId: string | null): CardTag[] => tags
    .filter((tag) => tag.parentId === parentId)
    .sort((left, right) => left.sort - right.sort)

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!containerRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false)
    }
    const closeOnViewportChange = (): void => setOpen(false)
    document.addEventListener('pointerdown', close)
    document.addEventListener('scroll', closeOnViewportChange, true)
    window.addEventListener('resize', closeOnViewportChange)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('scroll', closeOnViewportChange, true)
      window.removeEventListener('resize', closeOnViewportChange)
    }
  }, [open])

  function toggle(): void {
    if (open) { setOpen(false); return }
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = 210
    const height = Math.min(270, 45 + tags.length * 29)
    setPosition({
      left: Math.min(window.innerWidth - width - 8, Math.max(8, rect.left + rect.width / 2 - width / 2)),
      top: rect.bottom + 6 + height <= window.innerHeight - 8 ? rect.bottom + 6 : Math.max(8, rect.top - height - 6)
    })
    setOpen(true)
  }

  const renderBranch = (parentId: string | null, depth: number): React.ReactNode => childrenOf(parentId).map((tag) => {
    const hasChildren = childrenOf(tag.id).length > 0
    const selected = selectedIds.includes(tag.id)
    return <div key={tag.id}>
      <button className={selected ? 'card-tag-option selected' : 'card-tag-option'} style={{ '--tag-depth': depth } as React.CSSProperties}
        disabled={selected} onClick={() => onAdd(tag.id)}>
        {hasChildren ? <TagsOutlined /> : <TagOutlined />}
        <span>{tag.title}</span>
        {selected && <small>已添加</small>}
      </button>
      {renderBranch(tag.id, depth + 1)}
    </div>
  })

  return <div className="card-tag-action" ref={containerRef}>
    <button ref={buttonRef} className={open ? 'card-action-button card-tag-action-button icon-only active' : 'card-action-button card-tag-action-button icon-only'}
      onClick={toggle} data-tooltip="添加 Tag" aria-label="添加 Tag"><TagOutlined /></button>
    {open && createPortal(<div ref={popoverRef} className="card-tag-popover" style={position} onPointerDown={(event) => event.stopPropagation()}>
      <strong>添加 Tag</strong>
      <div className="card-tag-options">{tags.length ? renderBranch(null, 1) : <span className="card-tag-options-empty">暂无可用 Tag</span>}</div>
    </div>, document.body)}
  </div>
}

function CardTagChip({ tag, tags, onRemove, onReplace }: {
  tag: CardTag
  tags: CardTag[]
  onRemove: () => void
  onReplace: (tagId: string) => void
}): React.JSX.Element {
  const siblings = tags.filter((item) => item.id !== tag.id && item.parentId === tag.parentId).sort((left, right) => left.sort - right.sort)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 8, top: 8 })
  const containerRef = useRef<HTMLSpanElement | null>(null)
  const switchButtonRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!containerRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false)
    }
    const closeOnViewportChange = (): void => setOpen(false)
    document.addEventListener('pointerdown', close)
    document.addEventListener('scroll', closeOnViewportChange, true)
    window.addEventListener('resize', closeOnViewportChange)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('scroll', closeOnViewportChange, true)
      window.removeEventListener('resize', closeOnViewportChange)
    }
  }, [open])

  function toggleSiblings(): void {
    if (open) { setOpen(false); return }
    const rect = switchButtonRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = 170
    const height = Math.min(220, 37 + siblings.length * 28)
    setPosition({
      left: Math.min(window.innerWidth - width - 8, Math.max(8, rect.right - width)),
      top: rect.bottom + 5 + height <= window.innerHeight - 8 ? rect.bottom + 5 : Math.max(8, rect.top - height - 5)
    })
    setOpen(true)
  }

  return <span ref={containerRef} className={open ? 'card-tag-chip open' : 'card-tag-chip'}>
    <TagOutlined /><span className="card-tag-chip-title">{tag.title}</span>
    <span className="card-tag-chip-actions">
      {siblings.length > 0 && <button ref={switchButtonRef} className="switch" onClick={toggleSiblings} title="切换同级 Tag" aria-label={`切换 ${tag.title}`}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
      </button>}
      <button className="remove" onClick={onRemove} title={`移除 ${tag.title}`} aria-label={`移除 ${tag.title}`}>×</button>
    </span>
    {open && createPortal(<div ref={popoverRef} className="card-tag-sibling-popover" style={position} onPointerDown={(event) => event.stopPropagation()}>
      <strong>切换 Tag</strong>
      {siblings.map((sibling) => <button key={sibling.id} onClick={() => { onReplace(sibling.id); setOpen(false) }}>
        <TagOutlined /><span>{sibling.title}</span>
      </button>)}
    </div>, document.body)}
  </span>
}

function CardItem(props: CardItemProps): React.JSX.Element {
  const { card } = props
  const repeatUnitLabel = ({ minute: '分钟', hour: '小时', day: '天', week: '周', month: '月' } as Record<RepeatUnit, string>)[card.repeatUnit]
  const repeatScheduleLabel = card.repeatUnit === 'week' && card.repeatWeekdays.length
    ? ` · ${card.repeatWeekdays.map((day) => ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][day]).join('、')}`
    : card.repeatUnit === 'month' && card.repeatMonthDays.length ? ` · ${card.repeatMonthDays.join('、')}日` : ''
  const pomodoroCount = card.pomodoroCount > 0 ? card.pomodoroCount : card.focusMinutes / 50
  const hasFocusStats = card.focusMinutes > 0 || card.pomodoroCount > 0
  const focusMinutesText = Number.isInteger(card.focusMinutes) ? String(card.focusMinutes) : card.focusMinutes.toFixed(1)
  const focusTooltip = hasFocusStats
    ? `${pomodoroCount.toFixed(1)}个番茄，共${focusMinutesText}分钟，点击继续推进`
    : '推进'
  const assignedTags = props.tags.filter((tag) => card.tagIds.includes(tag.id))
  const [editingField, setEditingField] = useState<'title' | 'content' | null>(null)
  const [titleDraft, setTitleDraft] = useState(card.title)
  const [contentDraft, setContentDraft] = useState(card.content)
  const [contentExpanded, setContentExpanded] = useState(false)
  const [contentTruncated, setContentTruncated] = useState(false)
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const contentInputRef = useRef<HTMLTextAreaElement | null>(null)
  const contentDisplayRef = useRef<HTMLButtonElement | null>(null)
  const contentScrollRef = useRef<{ container: HTMLElement; scrollTop: number } | null>(null)

  useEffect(() => { if (editingField !== 'title') setTitleDraft(card.title) }, [card.title, editingField])
  useEffect(() => {
    if (editingField !== 'content') setContentDraft(card.content)
    setContentExpanded(false)
  }, [card.content, editingField])
  useEffect(() => {
    if (!props.autoEditTitle) return
    setTitleDraft(card.title)
    setEditingField('title')
  }, [card.title, props.autoEditTitle])

  useLayoutEffect(() => {
    if (!props.autoEditTitle || editingField !== 'title' || !titleInputRef.current) return
    titleInputRef.current.focus()
    titleInputRef.current.setSelectionRange(0, titleInputRef.current.value.length)
  }, [editingField, props.autoEditTitle])

  useLayoutEffect(() => {
    if (editingField !== 'content' || !contentInputRef.current) return
    resizeInlineTextarea(contentInputRef.current)
    contentInputRef.current.focus({ preventScroll: true })
    const cursor = contentInputRef.current.value.length
    contentInputRef.current.setSelectionRange(cursor, cursor)
    const savedScroll = contentScrollRef.current
    if (savedScroll) {
      savedScroll.container.scrollTop = savedScroll.scrollTop
      contentScrollRef.current = null
    }
  }, [editingField])

  useLayoutEffect(() => {
    const element = contentDisplayRef.current
    if (!element || editingField === 'content' || contentExpanded) {
      setContentTruncated(false)
      return
    }
    const measure = (): void => setContentTruncated(element.scrollHeight > element.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [card.content, contentExpanded, editingField])

  function startContentEdit(source: HTMLElement): void {
    const scrollContainer = source.closest<HTMLElement>('.cards-list')
    if (scrollContainer) contentScrollRef.current = { container: scrollContainer, scrollTop: scrollContainer.scrollTop }
    setEditingField('content')
  }

  function finishTitleEdit(): void {
    const title = titleDraft.trim()
    if (title && title !== card.title) props.onUpdateText({ title })
    else setTitleDraft(card.title)
    setEditingField(null)
    if (props.autoEditTitle) props.onAutoEditComplete()
  }

  function finishContentEdit(): void {
    const content = contentDraft.trim()
    if (content !== card.content) props.onUpdateText({ content })
    setEditingField(null)
  }

  return <article data-search-key={`card:${card.id}`} className={`card-item status-${card.status}${props.embedded ? ' embedded-child' : ''}${props.focus ? ' focusing' : ''}${props.dragging ? ' dragging' : ''}${props.dragTarget ? ' drag-target' : ''}`}
    draggable={!editingField && !props.disableDrag} onDragStart={(event) => {
      if (props.disableDrag) { event.preventDefault(); return }
      event.stopPropagation()
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/x-vistask-card', card.id)
      setScaledDragPreview(event, event.currentTarget)
      props.onDragStart()
    }} onDragEnd={(event) => { event.stopPropagation(); props.onDragEnd() }}
    onDragEnter={(event) => { event.preventDefault(); event.stopPropagation(); props.onDragEnter() }}
    onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move' }}
    onDrop={(event) => { event.preventDefault(); event.stopPropagation(); props.onDrop() }}>
    <div className="card-main-row">
      <button className={`status-check ${card.status}`} onClick={props.onCycle} title="切换完成状态" />
      <div className="card-copy">
        {editingField === 'title'
          ? <input ref={titleInputRef} className="card-inline-input title" autoFocus value={titleDraft} maxLength={100} aria-label="编辑卡片标题"
            onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}
            onChange={(event) => setTitleDraft(event.target.value)} onBlur={finishTitleEdit}
            onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setTitleDraft(card.title); setEditingField(null); if (props.autoEditTitle) props.onAutoEditComplete() } }} />
          : <button className="card-inline-display title" onClick={(event) => { event.stopPropagation(); setEditingField('title') }}
            onDoubleClick={(event) => event.stopPropagation()}>{card.title || '无标题'}</button>}
        {editingField === 'content'
          ? <textarea ref={contentInputRef} className="card-inline-input content" value={contentDraft} rows={1} aria-label="编辑卡片内容"
            onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}
            onChange={(event) => { setContentDraft(event.target.value); resizeInlineTextarea(event.currentTarget) }} onBlur={finishContentEdit}
            onKeyDown={(event) => { if (event.key === 'Escape') { setContentDraft(card.content); setEditingField(null) } }} />
          : card.content ? <div className="card-content-wrap" data-tooltip={contentTruncated ? '点击展开' : '点击编辑'}>
            <button ref={contentDisplayRef} className={contentExpanded ? 'card-inline-display content expanded' : 'card-inline-display content'}
              onClick={(event) => {
                event.stopPropagation()
                if (contentTruncated && !contentExpanded) { setContentExpanded(true); return }
                startContentEdit(event.currentTarget)
              }} onDoubleClick={(event) => event.stopPropagation()}>
              {card.content}
            </button>
          </div> : null}
      </div>
      <button className="icon-button card-edit-button" onClick={(event) => props.onEdit(event.currentTarget.getBoundingClientRect())} title="编辑卡片" aria-label="编辑卡片"><MoreIcon /></button>
      <button className={card.flagged ? 'flag-button active' : 'flag-button'} onClick={props.onFlag} title="重要" aria-label="重要"><FlagIcon filled={card.flagged} /></button>
    </div>
    <div className="card-meta">
      {props.showChildBadge && <span className="card-type-badge child">子卡片</span>}
      {props.showRepeatTaskBadge && <span className="card-type-badge repeat">重复任务</span>}
      {card.repeatEnabled && <span>↻ 每 {card.repeatInterval} {repeatUnitLabel}{repeatScheduleLabel}</span>}
      {props.childCount > 0 && <div className="child-summary">
        <button onClick={props.onToggleCollapse}>{props.collapsed ? '⌄' : '⌃'} 共 {props.childCount}</button>
        <span className="child-completed">完成 {props.completedChildCount}</span>
        <span className="child-overdue">过期 {props.overdueChildCount}</span>
        {!props.hideChildDisplayControl && <ChildDisplayAction value={props.childDisplay} mode={card.childMode} onChange={props.onSetChildDisplay} />}
      </div>}
    </div>
    {assignedTags.length > 0 && <div className="card-tags" aria-label="卡片 Tag">
      {assignedTags.map((tag) => <CardTagChip key={tag.id} tag={tag} tags={props.tags}
        onRemove={() => props.onSetTags(card.tagIds.filter((tagId) => tagId !== tag.id))}
        onReplace={(tagId) => props.onSetTags([...card.tagIds.filter((currentId) => currentId !== tag.id && currentId !== tagId), tagId])} />)}
    </div>}
    <div className="card-actions">
      <div className="card-actions-left">
        {!props.isChild && <button className="card-action-button icon-only" onClick={props.onAddChild} data-tooltip="添加子卡片" aria-label="添加子卡片"><CardActionIcon name="child" /></button>}
        {props.onAssign && props.assignmentProjects && props.assignmentBoards && <AssignmentAction
          projects={props.assignmentProjects} boards={props.assignmentBoards} onAssign={props.onAssign} />}
        <button className="card-action-button icon-only content-action" onClick={(event) => startContentEdit(event.currentTarget)} data-tooltip="编辑内容" aria-label="编辑内容"><CardTextIcon /></button>
        <button className={`card-action-button focus-action${hasFocusStats ? ' has-value' : ' icon-only'}`} onClick={props.onStartFocus}
          data-tooltip={focusTooltip} aria-label={focusTooltip}>
          <CardActionIcon name="focus" />
          {hasFocusStats && <span>{pomodoroCount.toFixed(1)}</span>}
        </button>
        <CardTagAction tags={props.tags} selectedIds={card.tagIds} onAdd={(tagId) => props.onSetTags([...card.tagIds, tagId])} />
      </div>
      <div className="card-actions-right">
        <button className="card-action-button icon-only danger" onClick={props.onDelete} data-tooltip="删除" aria-label="删除"><CardActionIcon name="delete" /></button>
        {!card.repeatEnabled && <DueDateAction value={card.dueAt} onChange={props.onSetDue} />}
      </div>
    </div>
    {props.children}
  </article>
}

export function QuickInboxWindow(): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [fontSize, setFontSize] = useState<'small' | 'medium' | 'large'>('medium')

  useEffect(() => {
    void window.api.loadBoards().then((stored) => {
      if (!isBoardState(stored)) return
      const size = stored.displaySettings?.fontSize
      if (size === 'small' || size === 'medium' || size === 'large') setFontSize(size)
    }).catch(() => undefined)
  }, [])

  async function submit(): Promise<void> {
    if (!title.trim() || saving) return
    setSaving(true)
    setError('')
    try {
      await window.api.quickAddInbox(title, content)
    } catch (reason) {
      setSaving(false)
      setError(reason instanceof Error ? reason.message : '添加失败')
    }
  }

  return <div className={`modal-backdrop quick-inbox-backdrop font-${fontSize}`}>
    <section className="quick-inbox-modal" onKeyDown={(event) => {
      if (event.key === 'Escape') void window.api.closeQuickInbox()
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && title.trim()) void submit()
    }}>
      <header><h2>快速添加到收件箱</h2></header>
      <div className="modal-body">
        <label>标题<input autoFocus maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="输入标题" /></label>
        <label>内容<textarea rows={5} value={content} onChange={(event) => setContent(event.target.value)} placeholder="输入内容（可选）" /></label>
        {error && <span className="quick-inbox-error">{error}</span>}
      </div>
      <footer><button className="secondary-button" onClick={() => void window.api.closeQuickInbox()}>取消</button><button className="primary-button" disabled={!title.trim() || saving} onClick={() => void submit()}>{saving ? '添加中…' : '添加'}</button></footer>
    </section>
  </div>
}

function TagManager({ tags, selectedTagId, onSelect, onAdd, onDelete, onReorder }: {
  tags: CardTag[]
  selectedTagId: string | null
  onSelect: (tagId: string) => void
  onAdd: (parentId: string | null, title: string) => void
  onDelete: (tagId: string) => void
  onReorder: (draggedId: string, targetId: string) => void
}): React.JSX.Element {
  const [adding, setAdding] = useState<{ parentId: string | null; depth: number } | null>(null)
  const [draft, setDraft] = useState('')
  const [draggedTagId, setDraggedTagId] = useState<string | null>(null)
  const [dragTargetTagId, setDragTargetTagId] = useState<string | null>(null)
  const childrenOf = (parentId: string | null): CardTag[] => tags.filter((tag) => tag.parentId === parentId).sort((a, b) => a.sort - b.sort)
  const beginAdd = (parentId: string | null, depth: number): void => {
    setDraft('')
    setAdding({ parentId, depth })
  }
  const submit = (): void => {
    const title = draft.trim()
    if (!adding || !title) return
    onAdd(adding.parentId, title)
    setAdding(null)
    setDraft('')
  }
  const renderEditor = (parentId: string | null, depth: number): React.ReactNode => adding?.parentId === parentId
    ? <div className="tag-tree-editor" style={{ '--tag-depth': depth } as React.CSSProperties}>
      <input autoFocus value={draft} maxLength={40} placeholder={parentId ? '子 Tag 名称' : 'Tag 名称'}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') submit(); if (event.key === 'Escape') setAdding(null) }} />
      <button className="confirm" disabled={!draft.trim()} onClick={submit}>添加</button>
      <button onClick={() => setAdding(null)}>取消</button>
    </div> : null
  const renderBranch = (parentId: string | null, depth: number): React.ReactNode => childrenOf(parentId).map((tag) => <div className="tag-tree-branch" key={tag.id}>
    <div draggable className={`tag-tree-row${selectedTagId === tag.id ? ' active' : ''}${draggedTagId === tag.id ? ' dragging' : ''}${dragTargetTagId === tag.id ? ' drag-target' : ''}`}
      style={{ '--tag-depth': depth } as React.CSSProperties}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/x-vistask-tag', tag.id)
        setScaledDragPreview(event, event.currentTarget)
        setDraggedTagId(tag.id)
        setDragTargetTagId(null)
      }}
      onDragEnter={(event) => {
        if (!draggedTagId || draggedTagId === tag.id) return
        const dragged = tags.find((item) => item.id === draggedTagId)
        if (!dragged || dragged.parentId !== tag.parentId) return
        event.preventDefault()
        if (dragTargetTagId !== tag.id) {
          setDragTargetTagId(tag.id)
          onReorder(draggedTagId, tag.id)
        }
      }}
      onDragOver={(event) => {
        const dragged = tags.find((item) => item.id === draggedTagId)
        if (dragged && dragged.parentId === tag.parentId) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
        }
      }}
      onDrop={(event) => { event.preventDefault(); setDraggedTagId(null); setDragTargetTagId(null) }}
      onDragEnd={() => { setDraggedTagId(null); setDragTargetTagId(null) }}>
      <button className="tag-tree-select" onClick={() => onSelect(tag.id)}>{childrenOf(tag.id).length ? <TagsOutlined /> : <TagOutlined />} <span>{tag.title}</span></button>
      <button className="tag-tree-delete" onClick={() => onDelete(tag.id)} title="删除 Tag" aria-label={`删除 ${tag.title}`}>×</button>
      {depth < 3 && <button className="tag-tree-add-child" onClick={() => beginAdd(tag.id, depth + 1)} title="新增子 Tag" aria-label={`为 ${tag.title} 新增子 Tag`}>＋</button>}
    </div>
    {renderEditor(tag.id, depth + 1)}
    {renderBranch(tag.id, depth + 1)}
  </div>)
  return <aside className="tag-manager">
    <header><div><h2>Tag 管理</h2></div><button className="tag-add-root" onClick={() => beginAdd(null, 1)} title="新增 Tag" aria-label="新增 Tag">＋</button></header>
    <div className="tag-tree">{renderEditor(null, 1)}{tags.length ? renderBranch(null, 1) : !adding && <div className="tag-tree-empty">暂无 Tag</div>}</div>
  </aside>
}

function CardModal({ card, anchor, parent, hasChildren, onChange, onClose, onSave }: { card: BoardCard; anchor: DOMRect; parent?: BoardCard; hasChildren: boolean; onChange: (card: BoardCard) => void; onClose: () => void; onSave: () => void }): React.JSX.Element {
  const repeatBaseDate = new Date(card.repeatStart || Date.now())
  const weekdayLabels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const popoverRef = useRef<HTMLElement | null>(null)
  const [position, setPosition] = useState({ left: Math.max(8, Math.min(window.innerWidth - 408, anchor.right - 400)), top: Math.min(window.innerHeight - 80, anchor.bottom + 6) })

  useLayoutEffect(() => {
    const popover = popoverRef.current
    if (!popover) return
    const updatePosition = (): void => {
      const rect = popover.getBoundingClientRect()
      const left = Math.min(window.innerWidth - rect.width - 8, Math.max(8, anchor.right - rect.width))
      const below = anchor.bottom + 6
      const top = below + rect.height <= window.innerHeight - 8
        ? below
        : Math.max(8, anchor.top - rect.height - 6)
      setPosition({ left, top })
    }
    const observer = new ResizeObserver(updatePosition)
    observer.observe(popover)
    updatePosition()
    window.addEventListener('resize', updatePosition)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updatePosition)
    }
  }, [anchor])

  useEffect(() => {
    const closeOnOutside = (event: PointerEvent): void => {
      if (!popoverRef.current?.contains(event.target as Node)) onClose()
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose])

  function changeRepeatUnit(repeatUnit: RepeatUnit): void {
    onChange({
      ...card,
      repeatUnit,
      repeatWeekdays: repeatUnit === 'week' && card.repeatWeekdays.length === 0 ? [repeatBaseDate.getDay()] : card.repeatWeekdays,
      repeatMonthDays: repeatUnit === 'month' && card.repeatMonthDays.length === 0 ? [repeatBaseDate.getDate()] : card.repeatMonthDays
    })
  }

  function toggleRepeatValue(field: 'repeatWeekdays' | 'repeatMonthDays', value: number): void {
    const current = card[field]
    const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value].sort((a, b) => a - b)
    if (next.length > 0) onChange({ ...card, [field]: next })
  }

  return createPortal(<section ref={popoverRef} className="card-modal card-editor-popover" style={position}>
      <header><h2>{card.title || (parent ? '新建子卡片' : '新建卡片')}</h2><button className="icon-button" onClick={onClose}>×</button></header>
      <div className="modal-body">
        <label>标题<input autoFocus maxLength={100} value={card.title} onChange={(event) => onChange({ ...card, title: event.target.value })} placeholder="卡片标题" /></label>
        <label>内容<textarea rows={7} value={card.content} onChange={(event) => onChange({ ...card, content: event.target.value })} placeholder="记录更多细节…" /></label>
        <div className="form-grid">
          <label>设置状态<select value={card.status} onChange={(event) => onChange({ ...card, status: event.target.value as CardStatus })}>{EDITABLE_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</select></label>
          <label>截止时间<input type="datetime-local" value={card.dueAt ?? ''} disabled={card.repeatEnabled}
            onFocus={() => { if (!card.dueAt) onChange({ ...card, dueAt: dateTimeInputValue() }) }}
            onChange={(event) => onChange({ ...card, dueAt: event.target.value || null })} /></label>
        </div>
        {!parent && <div className="repeat-row"><label className="check-label"><input type="checkbox" checked={card.repeatEnabled} onChange={(event) => onChange({
          ...card, repeatEnabled: event.target.checked, childMode: event.target.checked ? 'serial' : card.childMode,
          repeatStart: event.target.checked ? card.repeatStart || dateTimeInputValue() : card.repeatStart,
          repeatWeekdays: event.target.checked && card.repeatWeekdays.length === 0 ? [repeatBaseDate.getDay()] : card.repeatWeekdays,
          repeatMonthDays: event.target.checked && card.repeatMonthDays.length === 0 ? [repeatBaseDate.getDate()] : card.repeatMonthDays,
          dueAt: event.target.checked ? null : card.dueAt
        })} />重复</label>
          <input type="number" min="1" value={card.repeatInterval} disabled={!card.repeatEnabled} onChange={(event) => onChange({ ...card, repeatInterval: Math.max(1, Number(event.target.value)) })} />
          <select value={card.repeatUnit} disabled={!card.repeatEnabled} onChange={(event) => changeRepeatUnit(event.target.value as RepeatUnit)}><option value="minute">分钟</option><option value="hour">小时</option><option value="day">天</option><option value="week">周</option><option value="month">月</option></select></div>}
        {!parent && card.repeatEnabled && card.repeatUnit === 'week' && <div className="repeat-schedule-picker">
          <strong>每周的星期</strong>
          <div className="repeat-weekdays">{weekdayLabels.map((label, day) => <button type="button" key={label}
            className={card.repeatWeekdays.includes(day) ? 'selected' : ''} onClick={() => toggleRepeatValue('repeatWeekdays', day)}>{label}</button>)}</div>
        </div>}
        {!parent && card.repeatEnabled && card.repeatUnit === 'month' && <div className="repeat-schedule-picker">
          <strong>每月的日期</strong>
          <div className="repeat-month-days">{Array.from({ length: 31 }, (_, index) => index + 1).map((day) => <button type="button" key={day}
            className={card.repeatMonthDays.includes(day) ? 'selected' : ''} onClick={() => toggleRepeatValue('repeatMonthDays', day)}>{day}</button>)}</div>
          <small className="field-hint">当月不存在所选日期时，该日期不会生成任务</small>
        </div>}
        {!parent && (hasChildren || card.repeatEnabled) && <label>子任务执行方式
          <select value={card.childMode}
            onChange={(event) => {
              const childMode = event.target.value as ChildMode
              onChange({ ...card, childMode })
            }}>
            <option value="parallel">并行 · 显示全部未完成子任务</option>
            <option value="serial">顺序 · 依次显示一个子任务</option>
          </select>
          {card.repeatEnabled && <small className="field-hint">重复卡片默认顺序执行，可临时切换并行以调整子任务</small>}
        </label>}
      </div>
      <footer><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" onClick={onSave} disabled={!card.title.trim()}>保存</button></footer>
    </section>, document.body)
}

function BoardModal({ value, onChange, onClose, onSave }: {
  value: { id: string | null; title: string }
  onChange: (value: { id: string | null; title: string }) => void
  onClose: () => void
  onSave: () => void
}): React.JSX.Element {
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="board-modal" onKeyDown={(event) => { if (event.key === 'Enter' && value.title.trim()) onSave() }}>
      <header><h2>{value.id ? '重命名看板' : '新建看板'}</h2><button className="icon-button" onClick={onClose}>×</button></header>
      <div className="modal-body">
        <label>名称<input autoFocus maxLength={40} value={value.title} onChange={(event) => onChange({ ...value, title: event.target.value })} placeholder="输入看板名称" /></label>
      </div>
      <footer><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" onClick={onSave} disabled={!value.title.trim()}>确定</button></footer>
    </section>
  </div>
}

function ProjectManagerModal({ projects, onClose, onAdd, onRename, onReorder, onDelete, onRestore }: {
  projects: Project[]
  onClose: () => void
  onAdd: (title: string) => void
  onRename: (projectId: string, title: string) => void
  onReorder: (draggedId: string, targetId: string) => void
  onDelete: (project: Project) => void
  onRestore: (projectId: string) => void
}): React.JSX.Element {
  const [newTitle, setNewTitle] = useState('')
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const orderedProjects = projects.filter((project) => !project.archivedAt).sort((a, b) => a.sort - b.sort)

  function submitNewProject(): void {
    if (!newTitle.trim()) return
    onAdd(newTitle)
    setNewTitle('')
  }

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="project-manager-modal">
      <header><h2>项目管理</h2><button className="icon-button" onClick={onClose}>×</button></header>
      <div className="project-manager-body">
        <div className="project-create-row">
          <input autoFocus maxLength={40} value={newTitle} onChange={(event) => setNewTitle(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') submitNewProject() }} placeholder="输入新项目名称" />
          <button className="primary-button" disabled={!newTitle.trim()} onClick={submitNewProject}>添加</button>
        </div>
        <div className="project-list">
          {orderedProjects.map((project) => <div key={project.id} className={`project-list-row${project.deletedAt ? ' deleted' : ''}${draggedId === project.id ? ' dragging' : ''}`}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }}
            onDrop={(event) => { event.preventDefault(); if (draggedId) onReorder(draggedId, project.id); setDraggedId(null) }}>
            <span className="project-drag-handle" draggable onDragStart={(event) => {
              setDraggedId(project.id)
              event.dataTransfer.effectAllowed = 'move'
              setScaledDragPreview(event, event.currentTarget.closest('.project-list-row') as HTMLElement || event.currentTarget)
            }}
              onDragEnd={() => setDraggedId(null)} title="拖拽排序" aria-label="拖拽排序">☰</span>
            <span className="project-list-color" style={{ backgroundColor: project.color }} />
            <input key={`${project.id}-${project.title}`} defaultValue={project.title} maxLength={40} disabled={Boolean(project.deletedAt)}
              aria-label="项目名称" onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
              onBlur={(event) => { const title = event.currentTarget.value.trim(); if (title && title !== project.title) onRename(project.id, title); else event.currentTarget.value = project.title }} />
            {project.deletedAt
              ? <button className="project-restore-button" onClick={() => onRestore(project.id)}>恢复</button>
              : <button className="project-delete-button" onClick={() => onDelete(project)}>删除</button>}
          </div>)}
          {orderedProjects.length === 0 && <div className="project-list-empty">暂无项目</div>}
        </div>
      </div>
      <footer><button className="secondary-button" onClick={onClose}>完成</button></footer>
    </section>
  </div>
}

export default App

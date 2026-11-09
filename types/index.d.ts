// Switchboard's data shapes. hooks/collect.py produces Facts; a small model turns each session into a
// BoardText; hooks/logic.ts arranges them into a Board.

/** The desktop app's verdict after a session's turn (postTurnSummary), carried over unchanged. */
export type TurnSummary = {
  category: string | null
  detail: string
  needs: string
  fresh: boolean
}

export type Said = { at: string; text: string; kind?: 'ask' | 'plan' }

/** One session as the records on this machine describe it: facts only, nothing inferred. */
export type SessionFact = {
  id: string
  kind: 'desktop' | 'cli'
  title: string
  cwd?: string
  live: boolean
  status?: 'busy' | 'idle' | 'waiting' | null
  statusAt?: number
  createdAt?: number
  lastActivityAt?: number
  lastFocusedAt?: number
  parent?: string | null
  summary?: TurnSummary | null
  wrapUp?: string
  cards?: string[]
  cliId?: string | null
  tty?: string | null
  waitingFor?: string | null
  progress?: Said | null
  question?: Said | null
  readError?: string
}

export type CollectError = { kind: 'no-transcript'; title: string }

export type Facts = {
  generatedAt: number
  platform?: string
  sessions: SessionFact[]
  hiddenDormant: number
  errors: CollectError[]
}

/** What the small model wrote for one session. */
export type BoardText = {
  short: string
  project: string
  doing: string
  ask: string
  why: string
  needsUser: boolean
  forUser: boolean
  blocking: boolean
  relay: boolean
  closeable: boolean
}

export type TextEntry = { key: string; at: number; text: BoardText; status?: string | null }

export type WaitKind = 'block' | 'question' | 'decide' | 'card'

export type WaitItem = {
  id: string
  name: string
  ask: string
  why: string
  kind: WaitKind
  waitMs: number
  isHere: boolean
  isLive: boolean
}

export type LineState = 'run' | 'bg' | 'done' | 'wait' | 'gone'

export type Line = { id: string; name: string; state: LineState; doing: string }

export type Project = {
  id: string
  name: string
  isParentWaiting: boolean
  isActive: boolean
  note: string
  lines: Line[]
  done: number
}

export type Single = {
  id: string
  name: string
  doing: string
  isCloseable: boolean
  isLive: boolean
  isUnreadable: boolean
}

export type Board = {
  generatedAt: number
  waiting: WaitItem[]
  stale: WaitItem[]
  projects: Project[]
  running: Single[]
  resting: Single[]
  hiddenDormant: number
  liveCount: number
  units: number
  linesRunning: number
  errors: CollectError[]
}

declare module 'claude-code' {
  interface PluginState {
    switchboard: {
      facts: Shaped<Facts | null>
      texts: Shaped<Record<string, TextEntry>>
      note: string
      showResting: boolean
      demo: boolean
    }
  }
}

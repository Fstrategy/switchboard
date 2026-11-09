// Switchboard's pure logic: arranges the collected facts and the model's short lines into a board.
// Nothing here touches `$`, so the tests call it directly.
import type {
  Board,
  BoardText,
  Facts,
  Line,
  LineState,
  Project,
  SessionFact,
  Single,
  TextEntry,
  WaitItem,
  WaitKind,
} from '../types'
import { PROMPTS, STRINGS } from './i18n'
import type { Lang } from './i18n'

/** A busy session's line changes every minute; rewrite it at most this often. */
export const BUSY_TEXT_EVERY_MS = 5 * 60_000
/** Within this long after he focused a session, say "you were just here" instead of how long it has waited. */
export const HERE_MS = 3 * 60_000

// ---------- text ----------

/** A safety net: commit hashes, branch names, paths and backticks don't belong on the board. */
export const scrub = (s: string): string =>
  s
    .replace(/`+/g, '')
    .replace(/\b(?:claude|worktree|codex|origin)\/[\w./-]+/g, '')
    .replace(/(?:~|\/Users|\/home|\/private|\/tmp|[A-Za-z]:\\Users)[\\/][^\s，。；、）)]+/g, '')
    .replace(/\b[0-9a-f]{7,40}\b/g, '')
    .replace(/[（(]\s*[)）]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([，。；：、,.;:])/g, '$1')
    .trim()

/** Cut by characters (not bytes), ending with "…" when cut. */
export const clip = (s: string, n: number): string => {
  const chars = Array.from(s.trim())
  return chars.length <= n ? chars.join('') : `${chars.slice(0, Math.max(1, n - 1)).join('')}…`
}

/** The first sentence of a progress message, without a leading "Progress:" style label. */
export const firstSentence = (s: string): string =>
  (s
    .replace(/^\s*(?:先说一句进度|先说一句|进度|progress|status|update)\s*[：:]\s*/i, '')
    .split(/[。！？\n]|\.\s/)[0] ?? ''
  ).trim()

/** One-off sessions that scripts start in a temp folder (`claude -p` evals) are not the person's: no board there. */
export const isTemp = (cwd: string): boolean =>
  /^(?:\/(?:private\/)?(?:var\/folders|tmp)\/|[A-Za-z]:\\Users\\[^\\]+\\AppData\\Local\\Temp\\)/i.test(
    `${cwd}${cwd.includes('\\') ? '\\' : '/'}`,
  )

// ---------- is it waiting on him? ----------

export type WaitSignal = { kind: 'question' | 'decide' | 'card'; raw: string; isPlan?: boolean } | null

/** Only signals already on record: the process says it waits for input, the desktop app says a person must act,
 *  or a proposed session card is still unclicked. */
export const waitSignal = (s: SessionFact): WaitSignal => {
  if (s.readError) return null
  if (s.live && s.status === 'busy') return null
  if (s.live && s.status === 'waiting')
    return { kind: 'question', raw: s.question?.text || s.waitingFor || '', isPlan: s.question?.kind === 'plan' }
  const sum = s.summary
  if (sum && (sum.needs || sum.category === 'blocked')) return { kind: 'decide', raw: sum.needs || sum.detail }
  if (s.cards && s.cards.length > 0) return { kind: 'card', raw: s.cards[0] ?? '' }
  return null
}

/** A terminal session has no desktop-app verdict; there the model's reading of its last reply decides. */
const terminalNeedsUser = (s: SessionFact, t: TextEntry | undefined): boolean =>
  !s.summary && s.live && s.status === 'idle' && !!t?.text.needsUser

// ---------- who started whom ----------

export const childrenOf = (facts: Facts): Map<string, SessionFact[]> => {
  const ids = new Set(facts.sessions.map(s => s.id))
  const kids = new Map<string, SessionFact[]>()
  for (const s of facts.sessions) {
    if (!s.parent || !ids.has(s.parent)) continue
    kids.set(s.parent, [...(kids.get(s.parent) ?? []), s])
  }
  return kids
}

/** A coordinator has started at least one "line": a session that hasn't started any of its own. */
const isCoordinator = (id: string, kids: Map<string, SessionFact[]>): boolean =>
  (kids.get(id) ?? []).some(c => (kids.get(c.id) ?? []).length === 0)

export const roleOf = (
  s: SessionFact,
  byId: Map<string, SessionFact>,
  kids: Map<string, SessionFact[]>,
  lang: Lang,
): string => {
  const P = PROMPTS[lang]
  const mine = kids.get(s.id) ?? []
  if (mine.length > 0) return P.role.coordinator(mine.length, mine.map(c => clip(c.title, 40)).join(P.sep))
  const p = s.parent ? byId.get(s.parent) : undefined
  if (p) return P.role.line(clip(p.title, 40))
  return P.role.single
}

// ---------- the small model's prompt ----------

// No minutes in the prompt: text that changes with time would make every session look new every minute.
const stateText = (s: SessionFact, lang: Lang): string => {
  const st = PROMPTS[lang].state
  if (!s.live) return st.gone
  if (s.status === 'busy') return st.busy
  if (s.status === 'waiting') return st.waiting
  return st.idle
}

export const promptFor = (s: SessionFact, role: string, lang: Lang): string => {
  const P = PROMPTS[lang]
  const L = P.label
  const sum = s.summary
  const lines = [`${L.title}${s.title || L.untitled}`, `${L.role}${role}`, `${L.now}${stateText(s, lang)}`]
  if (sum)
    lines.push(
      L.verdict(P.category[sum.category ?? ''] ?? P.noVerdict, sum.detail || L.none, sum.needs || L.none),
    )
  if (s.question?.text) lines.push(`${L.asking}${clip(s.question.text, 300)}`)
  if (s.cards && s.cards.length > 0) lines.push(`${L.cards}${s.cards.join(P.sep)}`)
  if (s.wrapUp) lines.push(`${L.wrapUp}${clip(s.wrapUp, 400)}`)
  if (s.progress) {
    if (s.status === 'busy') lines.push(`${L.progress}${clip(s.progress.text, 400)}`)
    else if (!sum) lines.push(`${L.lastReply}${clip(s.progress.text, 600)}`)
  }
  lines.push('', P.format)
  return lines.join('\n')
}

/** The model's answer as a BoardText; anything but a JSON object counts as no answer. Limits leave a little slack. */
export const parseText = (raw: string, lang: Lang): BoardText | null => {
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return null
  let j: Record<string, unknown>
  try {
    j = JSON.parse(m[0]) as Record<string, unknown>
  } catch {
    return null
  }
  const lim = PROMPTS[lang].limits
  const str = (v: unknown, n: number) => clip(scrub(typeof v === 'string' ? v : ''), n)
  const short = str(j.short, lim.short)
  if (!short) return null
  return {
    short,
    project: str(j.project, lim.project),
    doing: str(j.doing, lim.doing),
    ask: str(j.ask, lim.ask),
    why: str(j.why, lim.why),
    needsUser: j.needs_user === true,
    forUser: j.for_user === true,
    blocking: j.blocking === true,
    relay: j.relay === true,
    closeable: j.closeable === true,
  }
}

/** Before the model answers (or when summaries are off): the record's own words, cut short. */
export const fallbackText = (s: SessionFact, lang: Lang): BoardText => {
  const F = STRINGS[lang].fallback
  const lim = PROMPTS[lang].limits
  const sig = waitSignal(s)
  const name = clip(scrub(s.title) || F.untitled, lim.short - 1)
  const doing =
    s.live && s.status === 'busy'
      ? clip(scrub(firstSentence(s.progress?.text ?? '')) || F.busy, lim.doing - 2)
      : s.live && s.status === 'waiting'
        ? F.waitingQ
        : clip(scrub(s.summary?.detail ?? '') || (s.live ? F.idle : F.gone), lim.doing - 2)
  const ask = !sig
    ? ''
    : sig.kind === 'question'
      ? clip(scrub(sig.raw) || (sig.isPlan ? F.plan : F.answer), lim.ask - 2)
      : sig.kind === 'card'
        ? clip(F.card(sig.raw), lim.ask - 2)
        : clip(scrub(sig.raw) || F.look, lim.ask - 2)
  return {
    short: name,
    project: '',
    doing,
    ask,
    why: '',
    needsUser: false,
    forUser: true,
    blocking: false,
    relay: false,
    closeable: false,
  }
}

// ---------- the board ----------

const RANK: Record<WaitKind, number> = { block: 0, question: 1, decide: 2, card: 3 }
const LINE_ORDER: Record<LineState, number> = { wait: 0, run: 1, bg: 2, done: 3, gone: 4 }

export const buildBoard = (facts: Facts, texts: Record<string, TextEntry>, now: number, lang: Lang): Board => {
  const byId = new Map(facts.sessions.map(s => [s.id, s]))
  const kids = childrenOf(facts)
  const textOf = (s: SessionFact): BoardText => texts[s.id]?.text ?? fallbackText(s, lang)
  const descendants = (id: string): string[] => (kids.get(id) ?? []).flatMap(c => [c.id, ...descendants(c.id)])
  // "Blocking others" only where someone is really held up: the session is open and has an open session under it.
  const hasLiveDescendant = (id: string) => descendants(id).some(d => byId.get(d)?.live)

  // which sessions are lines under a coordinator
  const lineOf = new Map<string, string>()
  for (const [pid, cs] of kids) {
    if (!isCoordinator(pid, kids)) continue
    for (const c of cs) if (!isCoordinator(c.id, kids)) lineOf.set(c.id, pid)
  }

  // Waiting on you: a recorded signal, plus the model's call on whether it is for him personally.
  // A relay ("go to that session and…") isn't listed on its own: that session lists itself.
  const asks = facts.sessions.flatMap(s => {
    const sig = waitSignal(s) ?? (terminalNeedsUser(s, texts[s.id]) ? { kind: 'decide' as const, raw: '' } : null)
    if (!sig) return []
    const t = textOf(s)
    // only he can click a card or answer a question; for the rest the model judges whether it is his to do
    if (sig.kind === 'decide' && !t.forUser) return []
    if (sig.kind === 'decide' && t.relay && descendants(s.id).length > 0) return []
    const kind: WaitKind =
      sig.kind === 'question'
        ? 'question'
        : t.blocking && s.live && hasLiveDescendant(s.id)
          ? 'block'
          : sig.kind === 'card'
            ? 'card'
            : 'decide'
    const item: WaitItem = {
      id: s.id,
      name: t.short,
      ask: t.ask || fallbackText(s, lang).ask,
      why: t.why,
      kind,
      waitMs: Math.max(0, now - ((s.live ? s.statusAt : s.lastActivityAt) ?? now)),
      isHere: !!s.lastFocusedAt && s.lastFocusedAt <= now && now - s.lastFocusedAt < HERE_MS,
      isLive: s.live,
    }
    return [item]
  })
  const waiting = asks.filter(a => a.isLive).sort((a, b) => RANK[a.kind] - RANK[b.kind] || b.waitMs - a.waitMs)
  const stale = asks.filter(a => !a.isLive).sort((a, b) => a.waitMs - b.waitMs)
  const waitingIds = new Set(asks.map(a => a.id))

  const lineState = (c: SessionFact): LineState => {
    if (waitingIds.has(c.id)) return 'wait'
    if (!c.live) return 'gone'
    if (c.status === 'busy' || c.status === 'waiting') return 'run'
    if (c.summary?.category === 'review_ready') return 'bg'
    return 'done'
  }

  const projects: Project[] = [...kids.keys()]
    .filter(pid => isCoordinator(pid, kids))
    .map(pid => byId.get(pid))
    .filter((p): p is SessionFact => p !== undefined)
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
    .map(p => {
      const pt = textOf(p)
      const lines: Line[] = (kids.get(p.id) ?? [])
        .filter(c => lineOf.get(c.id) === p.id)
        .map(c => ({ id: c.id, name: textOf(c).short, state: lineState(c), doing: textOf(c).doing }))
        .sort((a, b) => LINE_ORDER[a.state] - LINE_ORDER[b.state])
      const isParentWaiting = waitingIds.has(p.id)
      return {
        id: p.id,
        name: pt.project || pt.short,
        isParentWaiting,
        isActive:
          isParentWaiting ||
          (p.live && p.status !== 'idle') ||
          lines.some(l => l.state === 'run' || l.state === 'bg' || l.state === 'wait'),
        note: pt.doing,
        lines,
        done: lines.filter(l => l.state === 'done' || l.state === 'gone').length,
      }
    })

  const S = STRINGS[lang]
  const running: Single[] = []
  const resting: Single[] = []
  const singles = facts.sessions.filter(s => !lineOf.has(s.id) && !isCoordinator(s.id, kids))
  for (const s of singles) {
    if (waitingIds.has(s.id)) continue
    const t = textOf(s)
    const one: Single = {
      id: s.id,
      name: s.readError ? S.unreadableName : t.short,
      doing: s.readError ? S.unreadable : t.doing,
      isCloseable: t.closeable,
      isLive: s.live,
      isUnreadable: !!s.readError,
    }
    if (s.live && (s.status === 'busy' || s.status === 'waiting')) running.push(one)
    else resting.push(one)
  }
  resting.sort((a, b) => Number(b.isLive) - Number(a.isLive))

  return {
    generatedAt: facts.generatedAt,
    waiting,
    stale,
    projects,
    running,
    resting,
    hiddenDormant: facts.hiddenDormant,
    liveCount: facts.sessions.filter(s => s.live).length,
    units: projects.length + singles.length,
    linesRunning: projects.reduce((n, p) => n + p.lines.filter(l => l.state === 'run' || l.state === 'bg').length, 0),
    errors: facts.errors,
  }
}

/** Ask the model again only when the content changed, or the session just flipped between busy and idle
 *  (so "reply to it" doesn't linger after he replied); a busy session at most every five minutes. */
export const needsText = (s: SessionFact, key: string, have: TextEntry | undefined, now: number): boolean => {
  if (!have) return true
  if (have.key === key) return false
  if ((have.status ?? null) !== (s.status ?? null) || have.status === undefined) return true
  if (s.live && s.status === 'busy') return now - have.at > BUSY_TEXT_EVERY_MS
  return true
}

/** A content fingerprint: the cache file name, so the same input written up by one session is reused by all. */
export const fingerprint = (text: string): string => {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193)
    h2 = Math.imul(h2 ^ c, 0x5bd1e995)
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
}

/** How to bring a session to the front: the desktop app by its claude:// link, a macOS Terminal tab by its tty. */
export const jumpArgv = (s: Pick<SessionFact, 'id' | 'kind' | 'tty'>, platform: string | undefined): string[] | undefined => {
  if (s.kind === 'desktop' && /^local_[A-Za-z0-9-]+$/.test(s.id)) {
    const url = `claude://code/continue?session=${s.id}&source=url_external`
    if (platform === 'win32') return ['cmd', '/c', 'start', '', url]
    if (platform === 'darwin' || platform === undefined) return ['open', url]
    return ['xdg-open', url]
  }
  if (s.kind === 'cli' && platform === 'darwin' && s.tty && /^\/dev\/ttys\d+$/.test(s.tty))
    return [
      'osascript',
      '-e',
      `tell application "Terminal"
  repeat with w in windows
    repeat with t in tabs of w
      if tty of t is "${s.tty}" then
        set selected of t to true
        set index of w to 1
        activate
        return "ok"
      end if
    end repeat
  end repeat
end tell
return "not found"`,
    ]
  return undefined
}

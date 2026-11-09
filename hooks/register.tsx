import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, RenderChildren } from 'claude-code'

import type { Board, BoardText, Facts, Line, LineState, Project, Single, TextEntry, WaitItem, WaitKind } from '../types'
import { PROMPTS, STRINGS, pickLang } from './i18n'
import type { Lang, Strings } from './i18n'
import { demoFacts, demoTexts } from './demo'
import {
  buildBoard,
  childrenOf,
  fingerprint,
  isTemp,
  jumpArgv,
  needsText,
  parseText,
  promptFor,
  roleOf,
  waitSignal,
} from './logic'

// Switchboard: which of your Claude Code sessions are waiting on you and what they need; coordinators and the
// sessions they started grouped together; one click to jump there. hooks/collect.py gathers the facts from records
// already on this machine; a small model only writes them up as short lines. Every session shares the results in
// ~/.claude/switchboard/, so the same content is written up once.
const PANE = 'switchboard'
const TITLE: Record<Lang, string> = { en: 'Switchboard', zh: '会话看板' }

const facts = atom({ plugin: 'switchboard', key: 'facts' } as const, null, { shape: 'facts-1' })
const texts = atom({ plugin: 'switchboard', key: 'texts' } as const, {}, { shape: 'texts-1' })
const note = atom({ plugin: 'switchboard', key: 'note' } as const, '')
const showResting = atom({ plugin: 'switchboard', key: 'showResting' } as const, false)
const demo = atom({ plugin: 'switchboard', key: 'demo' } as const, false)

const TICK_MS = 20_000
const FACTS_FRESH_MS = 15_000 // another session collected less than 15 s ago: use its file
const IDLE_STOP_MS = 120_000 // nothing drawn for this long (no screen: -p runs, eval scripts): do nothing
const ASKS_PER_TICK = 8
const ASK_BATCH = 4
const CLAIM_MS = 90_000 // another session is already asking the model about this content: wait for it
const RESTING_ROWS = 6
const PYTHONS: readonly (readonly string[])[] = [['python3'], ['python'], ['py', '-3']]

type Config = {
  language: unknown
  summaries: boolean
  openPane: string
  footerCommand: string
  footerLabel: string
}

const configOf = (options: PluginOptions): Config => ({
  language: options.language ?? 'auto',
  summaries: options.summaries !== false,
  openPane: String(options.openPane ?? 'auto'),
  footerCommand: String(options.footerCommand ?? '').replace(/^\//, '').trim(),
  footerLabel: String(options.footerLabel ?? '').trim(),
})

let cfg: Config = configOf({})
let lang: Lang = 'en'
let lastDrawAt = 0
let ticking = false
let everTicked = false
let myCliId: string | undefined
let home: string | undefined
let python: readonly string[] | undefined

const dataDir = async ($: EngineInterface): Promise<string> => {
  home ??= (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || $.plugin.root.split('/.claude/')[0] || ''
  return `${home}/.claude/switchboard`
}

/** Windows answers a Python name it doesn't have with a stand-in that exits 9009 ("install it from the Store"). */
const NOT_INSTALLED_EXIT = 9009

/** Run the collector with the first Python that starts. Only "can't start" moves on to the next name: a script
 *  that ran and failed is reported as is, so its own error isn't hidden behind "python not found". */
const runCollector = async ($: EngineInterface, out: string, cache: string) => {
  const script = `${$.plugin.root}/hooks/collect.py`
  let firstErr = ''
  for (const py of python ? [python] : PYTHONS) {
    let r: Awaited<ReturnType<EngineInterface['process']['run']>>
    try {
      r = await $.process.run([...py, script, '--out', out, '--prune', cache], { timeoutMs: 25_000 })
    } catch (err) {
      firstErr ||= err instanceof Error ? err.message : String(err)
      continue
    }
    if (r.exitCode === 0) {
      python = py
      return
    }
    if (r.exitCode === NOT_INSTALLED_EXIT) {
      firstErr ||= `${py.join(' ')}: not installed`
      continue
    }
    throw new Error((r.stderr || r.stdout).trim().split('\n').pop() || `exit ${r.exitCode}`)
  }
  throw new Error(`Python 3 not found (${firstErr})`)
}

const loadFacts = async ($: EngineInterface): Promise<Facts> => {
  const dir = await dataDir($)
  const path = `${dir}/facts.json`
  try {
    const st = await $.fs.stat(path)
    if (Date.now() - st.mtimeMs < FACTS_FRESH_MS) return JSON.parse(await $.fs.read(path)) as Facts
  } catch {
    // no file yet: collect below
  }
  await runCollector($, path, `${dir}/text`)
  return JSON.parse(await $.fs.read(path)) as Facts
}

const readCache = async ($: EngineInterface, path: string): Promise<BoardText | null> => {
  try {
    if (!(await $.fs.exists(path))) return null
    const t = JSON.parse(await $.fs.read(path)) as BoardText
    return typeof t.short === 'string' && t.short ? t : null
  } catch {
    return null
  }
}

const isClaimed = async ($: EngineInterface, path: string): Promise<boolean> => {
  try {
    return Date.now() - (await $.fs.stat(path)).mtimeMs < CLAIM_MS
  } catch {
    return false
  }
}

/** Have the model write up sessions that are new or changed; reuse what another session already wrote up. */
const fillTexts = async ($: EngineInterface, f: Facts) => {
  const now = await $.clock.now()
  const have = await read($, texts)
  const byId = new Map(f.sessions.map(s => [s.id, s]))
  const kids = childrenOf(f)
  const dir = `${await dataDir($)}/text`
  const todo = f.sessions
    .filter(s => !s.readError)
    .map(s => {
      const prompt = promptFor(s, roleOf(s, byId, kids, lang), lang)
      return { s, prompt, key: fingerprint(`${lang}\n${prompt}`) }
    })
    .filter(x => needsText(x.s, x.key, have[x.s.id], now))
    // the ones waiting on him first, so the top of the board is readable soonest
    .sort((a, b) => Number(!!waitSignal(b.s)) - Number(!!waitSignal(a.s)))

  const toAsk: typeof todo = []
  for (const x of todo) {
    const cached = await readCache($, `${dir}/${x.key}.json`)
    if (cached) {
      await update($, texts, t => ({ ...t, [x.s.id]: { key: x.key, at: now, text: cached, status: x.s.status ?? null } }))
    } else if (toAsk.length < ASKS_PER_TICK && !(await isClaimed($, `${dir}/${x.key}.claim`))) {
      toAsk.push(x)
    }
  }
  for (let i = 0; i < toAsk.length; i += ASK_BATCH) {
    await Promise.all(
      toAsk.slice(i, i + ASK_BATCH).map(async x => {
        await $.fs.write(`${dir}/${x.key}.claim`, String(now))
        const r = await $.model.complete({
          model: 'haiku',
          system: PROMPTS[lang].system,
          prompt: x.prompt,
          maxTokens: 600,
          timeoutMs: 30_000,
        })
        const text = r.isAnswered ? parseText(r.text, lang) : null
        if (!text) return // try again next round; the board shows the record's own words meanwhile
        await $.fs.write(`${dir}/${x.key}.json`, JSON.stringify(text))
        const at = await $.clock.now()
        await update($, texts, t => ({ ...t, [x.s.id]: { key: x.key, at, text, status: x.s.status ?? null } }))
      }),
    )
  }
}

const tick = async ($: EngineInterface) => {
  if (ticking || Date.now() - lastDrawAt > IDLE_STOP_MS) return
  ticking = true
  everTicked = true
  try {
    if (await read($, demo)) {
      const now = await $.clock.now()
      await update($, facts, () => demoFacts(now, lang))
      await update($, texts, () => demoTexts(now, lang))
      return
    }
    const f = await loadFacts($)
    await update($, facts, () => f)
    if (cfg.summaries) await fillTexts($, f)
  } catch (err) {
    const why = String(err instanceof Error ? err.message : err).slice(0, 100)
    await update($, note, () => STRINGS[lang].refreshFailed(why))
  } finally {
    ticking = false
  }
}

/** Refresh right away the first time anything is drawn, instead of waiting 20 s. */
const drew = ($: EngineInterface) => {
  lastDrawAt = Date.now()
  if (!everTicked) {
    everTicked = true
    $.clock.after(10, () => void tick($))
  }
}

const jump = async ($: EngineInterface, id: string) => {
  const S = STRINGS[lang]
  if (await read($, demo)) {
    await update($, note, () => S.demoJump)
    return
  }
  const f = await read($, facts)
  const s = f?.sessions.find(x => x.id === id)
  const argv = s ? jumpArgv(s, f?.platform) : undefined
  if (!argv) {
    await update($, note, () => S.cannotJump)
    return
  }
  const r = await $.process.run(argv, { timeoutMs: 10_000 })
  const ok = r.exitCode === 0 && !r.stdout.includes('not found')
  await update($, note, () => (ok ? '' : S.jumpFailed))
}

const openBoard = async ($: EngineInterface) => {
  await $.ui.open({ id: PANE, title: TITLE[lang] })
  void tick($)
}

// ---------- drawing ----------

const CHIP_COLOR: Record<WaitKind, string> = { block: 'error', question: 'warning', decide: 'warning', card: 'warning' }
const DOT: Record<LineState, string> = { wait: '!', run: '●', bg: '◐', done: '✓', gone: '✓' }
const DOT_COLOR: Record<LineState, string> = {
  wait: 'error',
  run: 'suggestion',
  bg: 'suggestion',
  done: 'success',
  gone: 'inactive',
}

const hhmm = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

type El = ReturnType<EngineInterface['ui']['resolve']>

const Section = (el: El, title: string, body: RenderChildren[]) => {
  const { Box, Text } = el
  return (
    <Box key={`sec-${title}`} flexDirection="column">
      <Text bold dimColor>
        {title}
      </Text>
      {body}
    </Box>
  )
}

const WaitCard = ($: EngineInterface, el: El, S: Strings, w: WaitItem) => {
  const { Box, Text, Button } = el
  const when = w.isHere ? S.isHere : w.isLive ? S.waited(w.waitMs) : S.idleFor(w.waitMs)
  return (
    <Box key={`wait-${w.id}`} flexDirection="column" marginTop={1}>
      <Text wrap="wrap">
        <Text bold color={CHIP_COLOR[w.kind]}>
          {S.chip[w.kind]}
        </Text>
        <Text> {w.name}</Text>
        <Text dimColor> · {when}</Text>
      </Text>
      <Text bold wrap="wrap">
        {w.ask}
      </Text>
      {w.why ? (
        <Text dimColor wrap="wrap">
          {w.why}
        </Text>
      ) : null}
      <Box>
        <Button
          key={`go-${w.id}`}
          label={S.go[w.kind]}
          variant={w.isLive ? 'primary' : 'secondary'}
          onPress={() => void jump($, w.id)}
        />
      </Box>
    </Box>
  )
}

const LineRow = ($: EngineInterface, el: El, l: Line) => {
  const { Text, Button } = el
  return (
    <Button key={`line-${l.id}`} plain onPress={() => void jump($, l.id)}>
      {'  '}
      <Text color={DOT_COLOR[l.state]}>{DOT[l.state]}</Text> {l.name} <Text dimColor>{l.doing}</Text>
    </Button>
  )
}

const ProjectBlock = ($: EngineInterface, el: El, S: Strings, p: Project) => {
  const { Box, Text, Button } = el
  return (
    <Box key={`proj-${p.id}`} flexDirection="column" marginTop={1}>
      <Button key={`proj-go-${p.id}`} plain onPress={() => void jump($, p.id)}>
        <Text bold>{p.name}</Text>
        <Text dimColor>{` · ${S.delivered(p.done, p.lines.length)}`}</Text>
        {p.isParentWaiting ? <Text color="error">{` · ${S.parentWaiting}`}</Text> : ''}
      </Button>
      {p.note ? (
        <Text dimColor wrap="wrap">
          {'  '}
          {p.note}
        </Text>
      ) : null}
      {p.lines.map(l => LineRow($, el, l))}
    </Box>
  )
}

const SingleRow = ($: EngineInterface, el: El, S: Strings, s: Single) => {
  const { Text, Button } = el
  return (
    <Button key={`one-${s.id}`} plain onPress={() => void jump($, s.id)}>
      {s.name} <Text dimColor>{s.doing}</Text>
      {s.isCloseable ? <Text color="success">{` · ${S.closeable}`}</Text> : ''}
    </Button>
  )
}

const BoardView = ($: EngineInterface, el: El, b: Board, said: string, isMore: boolean, isDemo: boolean) => {
  const { Box, Text, Button } = el
  const S = STRINGS[lang]
  // The headline counts the ones left for a while too: those are the easiest to forget.
  // The line above the prompt only reports sessions still open.
  const n = b.waiting.length + b.stale.length
  const heroColor =
    n === 0 ? 'success' : b.waiting.some(w => w.kind === 'block') ? 'error' : b.waiting.length > 0 ? 'warning' : 'text'
  const active = b.projects.filter(p => p.isActive)
  const finished = b.projects.filter(p => !p.isActive)
  const resting = isMore ? b.resting : b.resting.slice(0, RESTING_ROWS)
  const working: RenderChildren[] = [
    ...active.map(p => ProjectBlock($, el, S, p)),
    ...(b.running.length > 0
      ? [
          <Box key="running" flexDirection="column" marginTop={1}>
            {b.running.map(s => SingleRow($, el, S, s))}
          </Box>,
        ]
      : []),
  ]
  const restRows: RenderChildren[] = [
    ...finished.map(p => (
      <Button key={`done-${p.id}`} plain onPress={() => void jump($, p.id)}>
        {p.name} <Text dimColor>{S.allDelivered(p.lines.length)}</Text>
      </Button>
    )),
    ...resting.map(s => SingleRow($, el, S, s)),
  ]
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Box justifyContent="space-between">
          <Text>
            <Text size="title" weight="bold" bold color={heroColor}>
              {String(n)}
            </Text>
            <Text weight="semibold" bold>
              {S.heroTail}
            </Text>
            {b.stale.length > 0 ? <Text dimColor>{S.staleTail(b.stale.length)}</Text> : ''}
          </Text>
          <Text dimColor>{isDemo ? S.demoTag : hhmm(b.generatedAt)}</Text>
        </Box>
        <Text dimColor wrap="wrap">
          {S.counts(b.liveCount, b.units, b.linesRunning)}
        </Text>
      </Box>
      {b.waiting.length > 0 ? Section(el, S.sections.waiting, b.waiting.map(w => WaitCard($, el, S, w))) : null}
      {b.stale.length > 0 ? Section(el, S.sections.stale, b.stale.map(w => WaitCard($, el, S, w))) : null}
      {working.length > 0 ? Section(el, S.sections.working, working) : null}
      {restRows.length > 0 ? Section(el, S.sections.resting, restRows) : null}
      {b.resting.length > RESTING_ROWS ? (
        <Box>
          <Button
            key="more"
            plain
            label={isMore ? S.less : S.more(b.resting.length - RESTING_ROWS)}
            onPress={() => void update($, showResting, v => !v)}
          />
        </Box>
      ) : null}
      {b.hiddenDormant > 0 ? <Text dimColor>{S.hidden(b.hiddenDormant)}</Text> : null}
      {b.errors.length > 0 ? (
        <Text color="warning" wrap="wrap">
          {b.errors
            .slice(0, 2)
            .map(e => S.noTranscript(e.title))
            .join(' · ')}
        </Text>
      ) : null}
      {said ? (
        <Text color="warning" wrap="wrap">
          {said}
        </Text>
      ) : null}
      {cfg.footerCommand ? (
        <Box>
          <Button
            key="footer"
            label={cfg.footerLabel || `/${cfg.footerCommand}`}
            onPress={() => void $.command.run({ command: cfg.footerCommand }).catch(() => undefined)}
          />
        </Box>
      ) : null}
    </Box>
  )
}

export const register: Register = (on, options) => {
  // a reload runs register again: everything this module keeps starts over with the new options
  cfg = configOf(options)
  lang = 'en'
  lastDrawAt = 0
  ticking = false
  everTicked = false
  myCliId = undefined
  home = undefined
  python = undefined

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    if (isTemp(e.cwd)) return started // a one-off session a script started in a temp folder: no board there
    lang = pickLang(
      cfg.language,
      (await $.env.get('LC_ALL')) || (await $.env.get('LC_MESSAGES')) || (await $.env.get('LANG')),
    )
    try {
      myCliId = await $.session.id()
    } catch {
      myCliId = undefined
    }
    await $.command.register({
      name: 'switchboard',
      description:
        lang === 'zh'
          ? '打开会话看板：哪几个会话在等你、要你做什么（/switchboard demo 换成演示数据）'
          : 'Open the board: which sessions are waiting on you and what they need (/switchboard demo shows made-up data)',
    })
    if (cfg.openPane === 'auto') void $.ui.open({ id: PANE, title: TITLE[lang] })
    $.clock.every(TICK_MS, () => void tick($))
    return started
  })

  on('command.run', { command: 'switchboard' }, async ($, e) => {
    if ((e.args ?? '').trim() === 'demo') {
      const isOn = !(await read($, demo))
      await update($, demo, () => isOn)
      await update($, texts, () => ({}))
      await update($, facts, () => null)
      await openBoard($)
      return { text: isOn ? STRINGS[lang].demoOn : STRINGS[lang].demoOff }
    }
    await openBoard($)
    return { text: STRINGS[lang].opened }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    drew($)
    const el = $.ui.resolve(e)
    const f = await read($, facts)
    const t = await read($, texts)
    const said = await read($, note)
    const isMore = await read($, showResting)
    const isDemo = await read($, demo)
    if (!f) {
      const { Box, Text } = el
      return (
        <Box flexDirection="column">
          <Text dimColor>{STRINGS[lang].loading}</Text>
          {said ? <Text color="warning">{said}</Text> : null}
        </Box>
      )
    }
    return BoardView($, el, buildBoard(f, t, await $.clock.now(), lang), said, isMore, isDemo)
  })

  // The line above the prompt, always there: how many other sessions wait on him and which is most urgent;
  // with none, it says so, still with the Board button. When the window is too narrow for the pane to open on
  // its own, this line is the way in.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    drew($)
    if (e.props.hasSurvey) return next(e)
    const f = await read($, facts)
    if (!f) return next(e)
    const S = STRINGS[lang]
    const board = buildBoard(f, await read($, texts), await $.clock.now(), lang)
    const mine = f.sessions.find(s => !!myCliId && s.cliId === myCliId)?.id
    const others = board.waiting.filter(w => w.id !== mine)
    const top = others[0]
    const { Box, Text, Button } = $.ui.resolve(e)
    const what = top ? (top.kind === 'block' ? S.band.what.block : top.kind === 'question' ? S.band.what.question : S.band.what.other) : ''
    const nobody = others.length < board.waiting.length ? S.band.noneOthers : S.band.none
    const line = top
      ? S.band.waiting(others.length, top.name, what, top.waitMs)
      : `${nobody}${board.stale.length > 0 ? S.band.staleTail(board.stale.length) : ''} `
    return (
      <Box>
        <Text color={top ? CHIP_COLOR[top.kind] : board.stale.length > 0 ? 'warning' : 'success'}>● </Text>
        <Text wrap="truncate-end">{line}</Text>
        <Button key="board-open" label={S.band.open} onPress={() => void openBoard($)} />
      </Box>
    )
  })
}

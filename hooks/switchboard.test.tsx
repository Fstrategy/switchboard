import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Facts, SessionFact } from '../types'
import { DEMO_SESSIONS, DEMO_TEXTS, asModelReply, demoFacts } from './demo'
import { isTemp, jumpArgv } from './logic'
import { pickLang } from './i18n'

// The demo scenario doubles as the main fixture: the collector "reports" the demo sessions and the model
// "answers" with the demo lines, so these tests walk the real path (collect, ask, arrange, draw) on data that
// is also what /switchboard demo shows.
const NOW = Date.UTC(2026, 10, 9, 15, 0)

type World = {
  facts: Facts | null
  lang?: string
  myCliId?: string
  collectFails?: string
  missing?: string[]
  opened?: number
  modelCalls?: number
  prompts?: string[]
  runs?: string[][]
  ran?: string[]
  extraReplies?: Record<string, object>
}

const titleToId = new Map(DEMO_SESSIONS.flatMap(s => [[s.title.en, s.id] as const, [s.title.zh, s.id] as const]))

/** The model's answer, chosen by the session title the prompt names. */
const reply = (prompt: string, state: World): string => {
  const isZh = prompt.includes('【会话标题】')
  const title = (isZh ? prompt.match(/【会话标题】(.*)/) : prompt.match(/\[Session title\](.*)/))?.[1] ?? ''
  const extra = state.extraReplies?.[title]
  if (extra) return JSON.stringify({ project: '', ask: '', why: '', ...extra })
  const id = titleToId.get(title)
  const t = id ? DEMO_TEXTS[isZh ? 'zh' : 'en'][id] : undefined
  return t ? asModelReply(t) : JSON.stringify({ short: title, doing: '' })
}

const PANE = {
  plugin: 'switchboard',
  component: 'Pane',
  requestId: 'switchboard',
  props: { title: 'Switchboard', isFocused: false, bodyColumns: 48, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const
const BAND = {
  plugin: 'switchboard',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 80, scroll: { offset: 0, bodyRows: 3 }, view: {} },
} as const

/** The engine's side: the collector, files and the model answer as the test says; the test swaps `facts` at will. */
const world = (on: On, state: World) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/me', LANG: state.lang ?? 'en_US.UTF-8' })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // what the engine itself draws: the band hands over to it when it has nothing to show
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('session.id', () => ({ value: state.myCliId ?? 'cli-elsewhere' }))
  on('command.register', () => ({ value: { command: 'switchboard' } }))
  on('ui.open', () => {
    state.opened = (state.opened ?? 0) + 1
    return { value: { isPlaced: true } }
  })
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } }))
  on('fs.exists', () => ({ value: false }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.read', () => ({ value: JSON.stringify(state.facts) }))
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    state.runs = [...(state.runs ?? []), argv]
    if (state.missing?.includes(argv[0] ?? '')) throw new Error(`spawn ${argv[0]} ENOENT`)
    const ok = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    if (state.collectFails && argv.some(a => a.endsWith('collect.py')))
      return { value: { ...ok, exitCode: 1, stderr: `Traceback\n${state.collectFails}` } }
    return { value: ok }
  })
  on('model.complete', (_, e) => {
    state.modelCalls = (state.modelCalls ?? 0) + 1
    state.prompts = [...(state.prompts ?? []), String(e.prompt)]
    return {
      value: {
        isAnswered: true,
        text: reply(String(e.prompt), state),
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    }
  })
  on('command.run', (_, e) => {
    state.ran = [...(state.ran ?? []), e.command]
    return { text: '' }
  })
  return clock
}

/** Start the session, draw once (the first draw starts collecting), and let one refresh round finish. */
const settle = async ($: Engine, clock: ReturnType<typeof mock.clock>) => {
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await clock.advance(20_100)
  await band.unmount()
}

// every word on the drawing: Text, plus the whole-row Buttons (session names sit right inside them)
const textsOf = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) =>
  [...(await ui.findAll({ type: 'Text' })), ...(await ui.findAll({ type: 'Button' }))].map(t => t.text).join('\n')

const start = { cwd: '/home/me/proj', surface: 'desktop', isInteractive: false } as const
/** `/name args` as the person's Enter raises it. */
const typed = (command: string, args = '') =>
  ({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as const

test('a typical afternoon: the blocking coordinator first, then the question, then the card; the stopped one apart', async ($, on) => {
  const state: World = { facts: demoFacts(NOW, 'en') }
  const clock = world(on, state)
  await $.session.start(start)
  await settle($, clock)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const all = await textsOf(ui)
    const block = all.indexOf('Approve the refund rule')
    const question = all.indexOf('Pick a headline')
    const card = all.indexOf('Decide on the card')
    expect(block).toBeGreaterThan(-1)
    expect(question).toBeGreaterThan(block)
    expect(card).toBeGreaterThan(question)
    // count the chips themselves: nested Text repeats their words
    expect((await ui.findAll({ type: 'Text', text: /^Blocking others$/ })).length).toBe(1)
    expect((await ui.findAll({ type: 'Text', text: /^Asking you$/ })).length).toBe(1)
    expect(all).toContain('you were just here')
    // stopped two days ago, still waiting: its own group, below the live ones
    expect(all).toContain('Left for a while')
    expect(all.indexOf('Keep fuzzy matching on')).toBeGreaterThan(card)
    // the coordinator and its lines as one project
    expect(all).toContain('Checkout v2')
    expect(all).toContain('1/4 done')
    expect(all).toContain('testing 12 regions')
    // finished things sink; the long-idle ones are only counted
    expect(all).toContain('all 2 lines done')
    expect(all).toContain('can close')
    expect(all).toContain('7 more sessions idle for over a day')
    await ui.unmount()
  }
})

test('after he replies (the session goes back to work), it leaves "Waiting on you"', async ($, on) => {
  const state: World = { facts: demoFacts(NOW, 'en') }
  const clock = world(on, state)
  await $.session.start(start)
  await settle($, clock)

  const replied = demoFacts(NOW, 'en')
  const coordinator = replied.sessions.find(s => s.id === 'local_demo_checkout')
  if (coordinator) Object.assign(coordinator, { status: 'busy', progress: { at: '', text: 'Got it, applying the refund rule.' } })
  state.facts = replied
  await settle($, clock)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const all = await textsOf(ui)
  expect(all).not.toContain('Approve the refund rule')
  expect(all).not.toContain('Blocking others')
  expect(all).toContain('Pick a headline')
  await ui.unmount()
})

test('the line above the prompt reports only the other sessions', async ($, on) => {
  const facts = demoFacts(NOW, 'en')
  const landing = facts.sessions.find(s => s.id === 'local_demo_landing')
  if (landing) landing.cliId = 'cli-landing'
  const state: World = { facts, myCliId: 'cli-landing' }
  const clock = world(on, state)
  await $.session.start(start)
  await settle($, clock)

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ ...BAND, surface })
    const all = await textsOf(band)
    expect(all).toContain('2 waiting on you · Checkout coordinator is blocking others')
    expect(all).not.toContain('Landing page hero')
    await band.unmount()
  }
})

test('with nothing waiting, the line above the prompt is still there, with the Board button', async ($, on) => {
  const calm = demoFacts(NOW, 'en')
  calm.sessions = calm.sessions.filter(s => s.id === 'local_demo_tax' || s.id === 'local_demo_receipts')
  const state: World = { facts: calm }
  const clock = world(on, state)
  await $.session.start(start)
  await settle($, clock)

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await textsOf(band)).toContain('Nothing is waiting on you')
    const button = await band.find({ type: 'Button', key: 'board-open' })
    expect(button?.props.label).toBe('Board')
    await band.unmount()
  }
})

test('when the collector fails, the board says it did not refresh and why', async ($, on) => {
  const state: World = { facts: null, collectFails: 'boom: cannot read the sessions folder' }
  const clock = world(on, state)
  await $.session.start(start)
  await settle($, clock)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const all = await textsOf(ui)
  expect(all).toContain("The board didn't refresh this time")
  expect(all).toContain('boom')
  // python3 started and the script failed: that error is the answer, no hunting for another Python
  const collects = (state.runs ?? []).filter(r => r.some(a => a.endsWith('collect.py')))
  expect(collects.every(r => r[0] === 'python3')).toBe(true)
  await ui.unmount()
})

test('with no Python at all, the board says so', async ($, on) => {
  const state: World = { facts: demoFacts(NOW, 'en'), missing: ['python3', 'python', 'py'] }
  const clock = world(on, state)
  await $.session.start(start)
  await settle($, clock)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await textsOf(ui)).toContain('Python 3 not found')
  await ui.unmount()
})

test('a session a script starts in a temp folder gets no board', async ($, on) => {
  const state: World = { facts: demoFacts(NOW, 'en'), opened: 0 }
  world(on, state)
  await $.session.start({ cwd: '/private/var/folders/x_/abc/T', surface: null, isInteractive: false })
  expect(state.opened).toBe(0)
  expect(isTemp('/tmp/eval-1')).toBe(true)
  expect(isTemp('C:\\Users\\me\\AppData\\Local\\Temp\\eval')).toBe(true)
  expect(isTemp('/home/me/proj')).toBe(false)
  expect(isTemp('C:\\Users\\me\\code\\app')).toBe(false)
})

test('Chinese follows the system locale, prompt included', async ($, on) => {
  const state: World = { facts: demoFacts(NOW, 'zh'), lang: 'zh_CN.UTF-8' }
  const clock = world(on, state)
  await $.session.start(start)
  await settle($, clock)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const all = await textsOf(ui)
  expect(all).toContain('件事在等你')
  expect(all).toContain('批不批退款规则')
  expect((await ui.findAll({ type: 'Text', text: /^卡着别人$/ })).length).toBe(1)
  expect(all).toContain('结账改版')
  expect(state.prompts?.[0]).toContain('【会话标题】')
  await ui.unmount()
})

test('the language setting overrides the locale', { options: { language: 'en' } }, async ($, on) => {
  const state: World = { facts: demoFacts(NOW, 'en'), lang: 'zh_CN.UTF-8' }
  const clock = world(on, state)
  await $.session.start(start)
  await settle($, clock)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const all = await textsOf(ui)
  expect(all).toContain('waiting on you')
  expect(all).not.toContain('件事在等你')
  expect(state.prompts?.[0]).toContain('[Session title]')
  await ui.unmount()
})

test('with short lines off, no model is called and the records speak for themselves', { options: { summaries: false } }, async ($, on) => {
  const state: World = { facts: demoFacts(NOW, 'en') }
  const clock = world(on, state)
  await $.session.start(start)
  await settle($, clock)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const all = await textsOf(ui)
  expect(state.modelCalls ?? 0).toBe(0)
  expect(all).toContain('Landing page hero')
  expect(all).toContain('Which headline should the hero use?')
  expect(all).toContain('Decide on the card “Translate onboarding into Spanish”')
  await ui.unmount()
})

test('with "open the board" set to command, it opens only when asked', { options: { openPane: 'command' } }, async ($, on) => {
  const state: World = { facts: demoFacts(NOW, 'en'), opened: 0 }
  world(on, state)
  await $.session.start(start)
  expect(state.opened).toBe(0)
  await $.command.run(typed('switchboard'))
  expect(state.opened).toBe(1)
})

test('a terminal session counts as waiting when its last reply asks him something', async ($, on) => {
  const terminal = (id: string, title: string, text: string): SessionFact => ({
    id,
    kind: 'cli',
    title,
    live: true,
    status: 'idle',
    statusAt: NOW - 4 * 60_000,
    lastActivityAt: NOW - 4 * 60_000,
    createdAt: NOW - 60 * 60_000,
    cliId: id.slice(4),
    progress: { at: '', text },
  })
  const facts: Facts = {
    generatedAt: NOW,
    hiddenDormant: 0,
    errors: [],
    sessions: [
      terminal('cli:a1', 'Refactor auth', 'First pass done. Should I also rename the old tables, or leave them?'),
      terminal('cli:b2', 'Write migration', 'Migration written and tested; nothing else to do.'),
    ],
  }
  const state: World = {
    facts,
    extraReplies: {
      'Refactor auth': { short: 'Refactor auth', doing: 'first pass done', ask: 'Say whether to rename the old tables', needs_user: true, for_user: true },
      'Write migration': { short: 'Write migration', doing: 'written and tested', needs_user: false, closeable: true },
    },
  }
  const clock = world(on, state)
  await $.session.start(start)
  await settle($, clock)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const all = await textsOf(ui)
  expect(all).toContain('Say whether to rename the old tables')
  expect((await ui.findAll({ type: 'Text', text: /^Your call$/ })).length).toBe(1)
  expect(all).toContain('Idle · done')
  expect(all.indexOf('Write migration')).toBeGreaterThan(all.indexOf('Idle · done'))
  await ui.unmount()
})

test('the footer button runs the command set for it', { options: { footerCommand: '/cleanup', footerLabel: 'Clean up' } }, async ($, on) => {
  const state: World = { facts: demoFacts(NOW, 'en') }
  const clock = world(on, state)
  await $.session.start(start)
  await settle($, clock)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const button = await ui.find({ type: 'Button', key: 'footer' })
  expect(button?.props.label).toBe('Clean up')
  await ui.press({ key: 'footer' })
  expect(state.ran).toContain('cleanup')
  await ui.unmount()
})

test('/switchboard demo swaps in the made-up sessions, and back', async ($, on) => {
  const empty: Facts = { generatedAt: NOW, hiddenDormant: 0, errors: [], sessions: [] }
  const state: World = { facts: empty }
  const clock = world(on, state)
  await $.session.start(start)
  await settle($, clock)

  await $.command.run(typed('switchboard', 'demo'))
  await settle($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const all = await textsOf(ui)
  expect(all).toContain('Approve the refund rule')
  expect((await ui.findAll({ type: 'Text', text: /^demo$/ })).length).toBe(1)
  // the demo sessions aren't real: a jump says so instead of opening anything
  const runsBefore = state.runs?.length ?? 0
  await ui.press({ key: 'go-local_demo_checkout' })
  expect(state.runs?.length ?? 0).toBe(runsBefore)
  expect(await textsOf(ui)).toContain('This is demo data')
  await ui.unmount()

  await $.command.run(typed('switchboard', 'demo'))
  await settle($, clock)
  const back = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await textsOf(back)).not.toContain('Approve the refund rule')
  await back.unmount()
})

test('without python3 on the PATH it falls back to python, and keeps using what worked', async ($, on) => {
  const state: World = { facts: demoFacts(NOW, 'en'), missing: ['python3'] }
  const clock = world(on, state)
  await $.session.start(start)
  await settle($, clock)
  await settle($, clock)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const all = await textsOf(ui)
  expect(all).toContain('Approve the refund rule')
  expect(all).not.toContain("didn't refresh")
  const collects = (state.runs ?? []).filter(r => r.some(a => a.endsWith('collect.py')))
  expect(collects.filter(r => r[0] === 'python3').length).toBe(1)
  expect(collects.filter(r => r[0] === 'python').length).toBeGreaterThan(1)
  await ui.unmount()
})

test('how a jump opens each kind of session on each system', async () => {
  const desk = { id: 'local_abc-123', kind: 'desktop' as const, tty: null }
  const url = 'claude://code/continue?session=local_abc-123&source=url_external'
  expect(jumpArgv(desk, 'darwin')).toEqual(['open', url])
  expect(jumpArgv(desk, 'win32')).toEqual(['cmd', '/c', 'start', '', url])
  expect(jumpArgv(desk, 'linux')).toEqual(['xdg-open', url])
  const term = { id: 'cli:x', kind: 'cli' as const, tty: '/dev/ttys004' }
  expect(jumpArgv(term, 'darwin')?.[0]).toBe('osascript')
  expect(jumpArgv(term, 'linux')).toBeUndefined()
  expect(jumpArgv({ ...desk, id: 'local_$(rm -rf)' }, 'darwin')).toBeUndefined()
  expect(pickLang('auto', 'zh_TW.UTF-8')).toBe('zh')
  expect(pickLang('auto', 'en_GB.UTF-8')).toBe('en')
  expect(pickLang('auto', undefined)).toBe('en')
  expect(pickLang('zh', 'en_US.UTF-8')).toBe('zh')
})

test('a session that only relays ("go to that session and…") is not listed twice', async ($, on) => {
  const facts = demoFacts(NOW, 'en')
  facts.sessions.push({
    id: 'local_planning',
    kind: 'desktop',
    title: 'Weekly planning',
    live: true,
    status: 'idle',
    statusAt: NOW - 20 * 60_000,
    lastActivityAt: NOW - 20 * 60_000,
    createdAt: NOW - 400 * 60_000,
    summary: { category: 'blocked', detail: 'handed checkout off', needs: 'approve the refund rule in the checkout session', fresh: true },
  })
  const checkout = facts.sessions.find(s => s.id === 'local_demo_checkout')
  if (checkout) checkout.parent = 'local_planning'
  const state: World = {
    facts,
    extraReplies: {
      'Weekly planning': {
        short: 'Weekly planning',
        doing: 'checkout handed off',
        ask: 'Go to the checkout session and approve the refund rule',
        for_user: true,
        relay: true,
      },
    },
  }
  const clock = world(on, state)
  await $.session.start(start)
  await settle($, clock)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const all = await textsOf(ui)
  expect(all).toContain('Approve the refund rule')
  expect(all).not.toContain('Go to the checkout session')
  await ui.unmount()
})

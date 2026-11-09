// Made-up sessions for `/switchboard demo`: record a video or take a screenshot without showing your own
// sessions' names. A solo developer is shipping "Checkout v2" through a coordinator session and four lines,
// with a few standalone sessions on the side. Times are minutes before now, so the demo never goes stale.
import type { BoardText, Facts, SessionFact, TextEntry } from '../types'
import type { Lang } from './i18n'

type DemoSession = Omit<SessionFact, 'title' | 'statusAt' | 'createdAt' | 'lastActivityAt' | 'lastFocusedAt'> & {
  title: Record<Lang, string>
  statusAgoMin?: number
  createdAgoMin: number
  lastActivityAgoMin: number
  lastFocusedAgoMin?: number
}

type DemoText = Partial<BoardText> & Pick<BoardText, 'short' | 'doing'>

const base = {
  kind: 'desktop' as const,
  live: true,
  status: 'idle' as const,
  parent: null,
  summary: null,
  wrapUp: '',
  cards: [],
  cliId: null,
  tty: null,
}

const done = (detail: string) => ({ category: 'completed', detail, needs: '', fresh: true })

export const DEMO_SESSIONS: DemoSession[] = [
  {
    ...base,
    id: 'local_demo_checkout',
    title: { en: 'Checkout v2: plan and dispatch', zh: '结账改版：统筹派活' },
    statusAgoMin: 12,
    createdAgoMin: 300,
    lastActivityAgoMin: 12,
    summary: { category: 'blocked', detail: 'two lines paused for the refund rule', needs: 'approve the refund rule', fresh: true },
  },
  {
    ...base,
    id: 'local_demo_tax',
    title: { en: 'Tax rules by region', zh: '各地区税费规则' },
    parent: 'local_demo_checkout',
    status: 'busy',
    statusAgoMin: 3,
    createdAgoMin: 280,
    lastActivityAgoMin: 1,
  },
  {
    ...base,
    id: 'local_demo_ui',
    title: { en: 'Checkout UI polish', zh: '结账页细节打磨' },
    parent: 'local_demo_checkout',
    status: 'busy',
    statusAgoMin: 8,
    createdAgoMin: 279,
    lastActivityAgoMin: 1,
  },
  {
    ...base,
    id: 'local_demo_retries',
    title: { en: 'Payment retries', zh: '付款失败重试' },
    parent: 'local_demo_checkout',
    statusAgoMin: 30,
    createdAgoMin: 278,
    lastActivityAgoMin: 30,
    summary: { category: 'review_ready', detail: 'load test running in the background', needs: '', fresh: true },
  },
  {
    ...base,
    id: 'local_demo_receipts',
    title: { en: 'Receipt emails', zh: '收据邮件' },
    parent: 'local_demo_checkout',
    statusAgoMin: 45,
    createdAgoMin: 277,
    lastActivityAgoMin: 45,
    summary: done('three templates done'),
  },
  {
    ...base,
    id: 'local_demo_landing',
    title: { en: 'Landing page hero', zh: '落地页首屏' },
    status: 'waiting',
    statusAgoMin: 6,
    createdAgoMin: 200,
    lastActivityAgoMin: 6,
    lastFocusedAgoMin: 120,
    waitingFor: 'input needed',
    question: { at: '', text: 'Which headline should the hero use?', kind: 'ask' },
  },
  {
    ...base,
    id: 'local_demo_onboarding',
    title: { en: 'Onboarding copy', zh: '新手引导文案' },
    statusAgoMin: 25,
    createdAgoMin: 150,
    lastActivityAgoMin: 25,
    lastFocusedAgoMin: 1,
    cards: ['Translate onboarding into Spanish'],
    summary: done('copy rewritten'),
  },
  {
    ...base,
    id: 'local_demo_crash',
    title: { en: 'iOS crash on launch', zh: 'iOS 启动闪退' },
    status: 'busy',
    statusAgoMin: 2,
    createdAgoMin: 90,
    lastActivityAgoMin: 1,
  },
  {
    ...base,
    id: 'local_demo_analytics',
    title: { en: 'Weekly analytics report', zh: '每周数据报告' },
    statusAgoMin: 50,
    createdAgoMin: 120,
    lastActivityAgoMin: 50,
    summary: done('report sent'),
  },
  {
    ...base,
    id: 'local_demo_darkmode',
    title: { en: 'Dark mode colors', zh: '深色模式配色' },
    live: false,
    status: null,
    createdAgoMin: 600,
    lastActivityAgoMin: 300,
    summary: done('merged'),
  },
  {
    ...base,
    id: 'local_demo_search',
    title: { en: 'Search ranking', zh: '搜索排序' },
    live: false,
    status: null,
    createdAgoMin: 3000,
    lastActivityAgoMin: 2880,
    summary: { category: 'blocked', detail: 'measured both options', needs: 'decide whether to keep fuzzy matching', fresh: true },
  },
  {
    ...base,
    id: 'local_demo_docs',
    title: { en: 'Docs site: plan and dispatch', zh: '文档站：统筹派活' },
    statusAgoMin: 240,
    createdAgoMin: 900,
    lastActivityAgoMin: 240,
    summary: done('both lines delivered'),
  },
  {
    ...base,
    id: 'local_demo_docs_api',
    title: { en: 'API reference', zh: '接口文档' },
    parent: 'local_demo_docs',
    live: false,
    status: null,
    createdAgoMin: 880,
    lastActivityAgoMin: 400,
    summary: done('published'),
  },
  {
    ...base,
    id: 'local_demo_docs_guides',
    title: { en: 'Getting-started guides', zh: '入门指南' },
    parent: 'local_demo_docs',
    live: false,
    status: null,
    createdAgoMin: 870,
    lastActivityAgoMin: 380,
    summary: done('published'),
  },
]

export const DEMO_HIDDEN = 7

export const DEMO_TEXTS: Record<Lang, Record<string, DemoText>> = {
  en: {
    local_demo_checkout: {
      short: 'Checkout coordinator',
      project: 'Checkout v2',
      doing: 'two lines paused for your call',
      ask: 'Approve the refund rule: full refund within 14 days?',
      why: 'The tax and receipt lines both build on this rule; they stay paused until you decide.',
      forUser: true,
      blocking: true,
    },
    local_demo_tax: { short: 'Tax rules by region', doing: 'testing 12 regions, ~20 min' },
    local_demo_ui: { short: 'Checkout UI polish', doing: 'fixing button spacing on phones' },
    local_demo_retries: { short: 'Payment retries', doing: 'load test running in background' },
    local_demo_receipts: { short: 'Receipt emails', doing: 'three templates done' },
    local_demo_landing: {
      short: 'Landing page hero',
      doing: 'two headline options ready',
      ask: 'Pick a headline: “Track less, live more” or “Habits that stick”',
      why: 'The rest of the page copy follows the headline’s tone.',
      forUser: true,
    },
    local_demo_onboarding: {
      short: 'Onboarding copy',
      doing: 'copy rewritten',
      ask: 'Decide on the card: translate onboarding into Spanish',
      why: 'It drafted a follow-up session; it starts only when you click.',
      forUser: true,
    },
    local_demo_crash: { short: 'iOS crash on launch', doing: 'reproducing it on the simulator' },
    local_demo_analytics: { short: 'Weekly analytics', doing: 'report sent to the team', closeable: true },
    local_demo_darkmode: { short: 'Dark mode colors', doing: 'merged', closeable: true },
    local_demo_search: {
      short: 'Search ranking',
      doing: 'measured both options',
      ask: 'Keep fuzzy matching on, or turn it off?',
      why: 'Fuzzy matching finds more results but ranks typos too high.',
      forUser: true,
    },
    local_demo_docs: { short: 'Docs coordinator', project: 'Docs site', doing: 'both lines delivered' },
    local_demo_docs_api: { short: 'API reference', doing: 'published' },
    local_demo_docs_guides: { short: 'Getting-started guides', doing: 'published' },
  },
  zh: {
    local_demo_checkout: {
      short: '结账改版统筹',
      project: '结账改版',
      doing: '两条线停着等你定',
      ask: '批不批退款规则：14 天内全额退？',
      why: '税费和收据两条线都要用这条规则，你定了它们才能往下做。',
      forUser: true,
      blocking: true,
    },
    local_demo_tax: { short: '各地区税费规则', doing: '在测 12 个地区，约 20 分钟' },
    local_demo_ui: { short: '结账页细节打磨', doing: '在修手机上的按钮间距' },
    local_demo_retries: { short: '付款失败重试', doing: '后台在跑压力测试' },
    local_demo_receipts: { short: '收据邮件', doing: '三个模板做好了' },
    local_demo_landing: {
      short: '落地页首屏',
      doing: '两版标题做好了',
      ask: '选标题：「少记一点，多活一点」还是「好习惯留得住」',
      why: '页面其余文案都跟着标题的语气走。',
      forUser: true,
    },
    local_demo_onboarding: {
      short: '新手引导文案',
      doing: '文案改好了',
      ask: '定不定开新会话：把引导翻成西班牙语',
      why: '它拟好了一个后续会话，你点了才开始。',
      forUser: true,
    },
    local_demo_crash: { short: 'iOS 启动闪退', doing: '在模拟器上复现' },
    local_demo_analytics: { short: '每周数据报告', doing: '报告发给团队了', closeable: true },
    local_demo_darkmode: { short: '深色模式配色', doing: '已经合进主线', closeable: true },
    local_demo_search: {
      short: '搜索排序',
      doing: '两种都测过了',
      ask: '模糊匹配留着还是关掉？',
      why: '开着能搜到更多，但错字结果排得太靠前。',
      forUser: true,
    },
    local_demo_docs: { short: '文档站统筹', project: '文档站', doing: '两条线都交了' },
    local_demo_docs_api: { short: '接口文档', doing: '已上线' },
    local_demo_docs_guides: { short: '入门指南', doing: '已上线' },
  },
}

const full = (t: DemoText): BoardText => ({
  project: '',
  ask: '',
  why: '',
  needsUser: false,
  forUser: false,
  blocking: false,
  relay: false,
  closeable: false,
  ...t,
})

/** The demo sessions as the collector would report them `now`, titled in `lang`. */
export const demoFacts = (now: number, lang: Lang): Facts => {
  const at = (min: number | undefined) => (min === undefined ? undefined : now - min * 60_000)
  return {
    generatedAt: now,
    platform: 'demo',
    hiddenDormant: DEMO_HIDDEN,
    errors: [],
    sessions: DEMO_SESSIONS.map(({ title, statusAgoMin, createdAgoMin, lastActivityAgoMin, lastFocusedAgoMin, ...s }) => ({
      ...s,
      title: title[lang],
      statusAt: at(statusAgoMin ?? lastActivityAgoMin),
      createdAt: at(createdAgoMin),
      lastActivityAt: at(lastActivityAgoMin),
      lastFocusedAt: at(lastFocusedAgoMin) ?? 0,
    })),
  }
}

/** The short lines a model would have written for the demo sessions. */
export const demoTexts = (now: number, lang: Lang): Record<string, TextEntry> => {
  const status = new Map(DEMO_SESSIONS.map(s => [s.id, s.status ?? null]))
  return Object.fromEntries(
    Object.entries(DEMO_TEXTS[lang]).map(([id, t]) => [id, { key: 'demo', at: now, text: full(t), status: status.get(id) ?? null }]),
  )
}

/** A demo session's short lines in the model's own answer format (the tests stand them in for the model). */
export const asModelReply = (t: DemoText): string => {
  const f = full(t)
  return JSON.stringify({
    short: f.short,
    project: f.project,
    doing: f.doing,
    ask: f.ask,
    why: f.why,
    needs_user: f.needsUser,
    for_user: f.forUser,
    blocking: f.blocking,
    relay: f.relay,
    closeable: f.closeable,
  })
}

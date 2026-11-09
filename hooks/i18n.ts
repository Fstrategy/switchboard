// Every word the board shows, and the prompt the small model gets, in English and Chinese.
import type { WaitKind } from '../types'

export type Lang = 'en' | 'zh'

/** `auto` follows the locale (LC_ALL, LC_MESSAGES, LANG); anything starting with zh is Chinese. */
export const pickLang = (setting: unknown, locale: string | undefined): Lang =>
  setting === 'en' || setting === 'zh' ? setting : /^zh/i.test(locale ?? '') ? 'zh' : 'en'

const MIN = 60_000

const agoEn = (ms: number): string => {
  const min = Math.max(0, Math.round(ms / MIN))
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min`
  const h = Math.round(min / 60)
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`
}

const agoZh = (ms: number): string => {
  const min = Math.max(0, Math.round(ms / MIN))
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟`
  const h = Math.round(min / 60)
  return h < 48 ? `${h} 小时` : `${Math.round(h / 24)} 天`
}

export type Strings = {
  ago: (ms: number) => string
  loading: string
  heroTail: string
  staleTail: (n: number) => string
  counts: (live: number, units: number, running: number) => string
  sections: { waiting: string; stale: string; working: string; resting: string }
  chip: Record<WaitKind, string>
  go: Record<WaitKind, string>
  isHere: string
  waited: (ms: number) => string
  idleFor: (ms: number) => string
  parentWaiting: string
  delivered: (done: number, total: number) => string
  allDelivered: (n: number) => string
  closeable: string
  more: (n: number) => string
  less: string
  hidden: (n: number) => string
  unreadableName: string
  unreadable: string
  noTranscript: (title: string) => string
  refreshFailed: (why: string) => string
  cannotJump: string
  jumpFailed: string
  demoJump: string
  demoTag: string
  band: {
    waiting: (n: number, name: string, what: string, ms: number) => string
    what: { block: string; question: string; other: string }
    none: string
    noneOthers: string
    staleTail: (n: number) => string
    open: string
  }
  opened: string
  demoOn: string
  demoOff: string
  fallback: {
    untitled: string
    busy: string
    waitingQ: string
    idle: string
    gone: string
    answer: string
    plan: string
    card: (title: string) => string
    look: string
  }
}

export const STRINGS: Record<Lang, Strings> = {
  en: {
    ago: agoEn,
    loading: 'Reading your sessions…',
    heroTail: ' waiting on you',
    staleTail: n => ` · ${n} left for a while`,
    counts: (live, units, running) =>
      `${live} sessions open · ${units} things in all · ${running} line${running === 1 ? '' : 's'} at work`,
    sections: {
      waiting: 'Waiting on you',
      stale: 'Left for a while · the session has stopped',
      working: 'Claude is on it · nothing for you',
      resting: 'Idle · done',
    },
    chip: { block: 'Blocking others', question: 'Asking you', decide: 'Your call', card: 'Card to click' },
    go: { block: 'Reply', question: 'Answer', decide: 'Open', card: 'Open' },
    isHere: 'you were just here',
    waited: ms => (ms < MIN ? 'just now' : `waiting ${agoEn(ms)}`),
    idleFor: ms => `idle for ${agoEn(ms)}`,
    parentWaiting: 'coordinator waiting on you',
    delivered: (done, total) => `${done}/${total} done`,
    allDelivered: n => `all ${n} lines done`,
    closeable: 'can close',
    more: n => `${n} more, show`,
    less: 'show less',
    hidden: n => `${n} more session${n === 1 ? '' : 's'} idle for over a day, not waiting on you`,
    unreadableName: 'Unreadable session',
    unreadable: "couldn't read this session's record",
    noTranscript: title => `no transcript found for “${title}”`,
    refreshFailed: why => `The board didn't refresh this time: ${why}`,
    cannotJump: "This session can't be opened from here; find it in the sidebar.",
    jumpFailed: "Couldn't switch: that session's window may be closed.",
    demoJump: 'This is demo data: there is no real session to open.',
    demoTag: 'demo',
    band: {
      waiting: (n, name, what, ms) => `${n} waiting on you · ${name} ${what}, ${agoEn(ms)} `,
      what: { block: 'is blocking others', question: 'is asking you', other: 'is waiting' },
      none: 'Nothing is waiting on you',
      noneOthers: 'No other session is waiting on you',
      staleTail: n => ` · ${n} left for a while`,
      open: 'Board',
    },
    opened: 'Opened the board.',
    demoOn: 'Demo data on: the board shows made-up sessions. Run /switchboard demo again to go back.',
    demoOff: 'Demo data off: the board shows your sessions again.',
    fallback: {
      untitled: 'Untitled session',
      busy: 'working',
      waitingQ: 'asking you',
      idle: 'idle',
      gone: 'session stopped',
      answer: 'Answer its question',
      plan: 'Review its plan',
      card: title => `Decide on the card “${title}”`,
      look: 'Open it to see what it needs',
    },
  },
  zh: {
    ago: agoZh,
    loading: '正在读各个会话…',
    heroTail: ' 件事在等你',
    staleTail: n => ` · ${n} 件放了很久`,
    counts: (live, units, running) => `${live} 个会话开着 · 收成 ${units} 件事 · ${running} 条线在干`,
    sections: {
      waiting: '等你',
      stale: '放了很久 · 会话已经停了',
      working: 'Claude 在干 · 不用你管',
      resting: '停着 · 做完了',
    },
    chip: { block: '卡着别人', question: '在问你', decide: '等你定', card: '等你点卡片' },
    go: { block: '去回复', question: '去回答', decide: '去看看', card: '去看看' },
    isHere: '你刚在这儿',
    waited: ms => (ms < MIN ? '刚停下' : `等了 ${agoZh(ms)}`),
    idleFor: ms => `放了 ${agoZh(ms)}`,
    parentWaiting: '统筹在等你',
    delivered: (done, total) => `${done}/${total} 交了`,
    allDelivered: n => `${n} 条线都交了`,
    closeable: '可以关',
    more: n => `还有 ${n} 个，展开`,
    less: '收起',
    hidden: n => `另有 ${n} 个会话停了一天以上，没在等你`,
    unreadableName: '读不到的会话',
    unreadable: '读不到这个会话的记录',
    noTranscript: title => `没找到「${title}」的对话记录`,
    refreshFailed: why => `看板这次没刷新上：${why}`,
    cannotJump: '这个会话没法直接跳过去，去侧栏里找它。',
    jumpFailed: '没跳过去：那个会话的窗口可能已经关了。',
    demoJump: '这是演示数据，没有真的会话可以打开。',
    demoTag: '演示',
    band: {
      waiting: (n, name, what, ms) => `${n} 件事在等你 · ${name}${what}，${agoZh(ms)} `,
      what: { block: '卡着别人', question: '在问你', other: '在等你' },
      none: '此刻没有会话在等你',
      noneOthers: '别的会话没在等你',
      staleTail: n => ` · ${n} 件放了很久`,
      open: '看板',
    },
    opened: '已打开会话看板。',
    demoOn: '已换成演示数据：看板上是编的会话。再输入一次 /switchboard demo 换回来。',
    demoOff: '已换回你自己的会话。',
    fallback: {
      untitled: '没有标题的会话',
      busy: '在干活',
      waitingQ: '停下来问你',
      idle: '停着',
      gone: '会话已经停了',
      answer: '回答它的问题',
      plan: '看它的方案，批不批',
      card: title => `定不定开新会话「${title}」`,
      look: '去看看它要你做什么',
    },
  },
}

// ---------- the prompt the small model gets ----------

export type PromptText = {
  system: string
  format: string
  category: Record<string, string>
  noVerdict: string
  state: { gone: string; busy: string; waiting: string; idle: string }
  role: {
    coordinator: (n: number, titles: string) => string
    line: (parent: string) => string
    single: string
  }
  label: {
    title: string
    role: string
    now: string
    verdict: (category: string, detail: string, needs: string) => string
    asking: string
    cards: string
    wrapUp: string
    progress: string
    lastReply: string
    untitled: string
    none: string
  }
  limits: { short: number; project: number; doing: number; ask: number; why: number }
  sep: string
}

export const PROMPTS: Record<Lang, PromptText> = {
  en: {
    system:
      'You watch over the dozen-plus Claude Code sessions one developer runs at the same time, and turn each session into a few short lines for a board: what it is doing, whether the developer personally needs to act, and what to do. The developer reads plain English. Output one JSON object and nothing else.',
    format: `Answer in this format, with every field present:
{"short":"","project":"","doing":"","ask":"","why":"","needs_user":false,"for_user":false,"blocking":false,"relay":false,"closeable":false}
- short: what this session is working on, at most 6 words, like "Checkout tax rules" or "Landing page hero".
- project: only when [Where it sits] says coordinator: what it and the sessions it started are doing together, at most 4 words, like "Checkout v2"; otherwise empty.
- doing: where its own work stands, at most 8 words, like "merging the payment line's commits", "second batch delivered" or "re-checking 2,275 items, ~40 min". Leave out things it relayed to other sessions.
- ask: the one action he must take himself, at most 10 words, imperative and specific, like "Reply “send” to release the two held messages" or "Pick the shipping fee rule: flat or by weight". Empty when nothing is needed from him.
- why: why it needs him and what stays stuck otherwise, at most 25 words. Empty when ask is empty.
- needs_user: judge only [Its last reply]: true when it stops to have him decide, answer, confirm or do something before it can go on. False when there is no [Its last reply].
- for_user: true when the action is for him personally; false when it is for the coordinator or another session (like "coordinator to decide").
- blocking: true when other sessions or lines are paused until he takes this step.
- relay: true when the action is only "go to another session and do something there"; still fill in ask.
- closeable: true when the work is done, merged or shipped, and nothing is left.
Style: plain words; no commit hashes, branch names, file paths, unexplained abbreviations or internal code names; write every field in English, translating anything that is not.`,
    category: {
      completed: 'this turn is done',
      blocked: 'stuck, waiting on a person',
      review_ready: 'delivered part of it, waiting on the rest (a background job is running, or other lines are still working)',
    },
    noVerdict: 'no verdict yet',
    state: { gone: 'the session has stopped', busy: 'working', waiting: 'paused, waiting for his answer', idle: 'idle' },
    role: {
      coordinator: (n, titles) => `coordinator: started ${n} sessions (${titles})`,
      line: parent => `a line started by “${parent}”; it reports to that session, not to him directly`,
      single: 'a standalone session that talks to him directly',
    },
    label: {
      title: '[Session title]',
      role: '[Where it sits]',
      now: '[Now]',
      verdict: (category, detail, needs) =>
        `[The desktop app's verdict on its last turn] ${category}; in one line: ${detail}; what a person needs to do: ${needs}`,
      asking: '[It is paused, asking him]',
      cards: '[Sessions it proposed, waiting for him to click the card]',
      wrapUp: '[Wrap-up of its last turn]',
      progress: '[Latest progress]',
      lastReply: '[Its last reply]',
      untitled: '(untitled)',
      none: 'none',
    },
    limits: { short: 42, project: 30, doing: 56, ask: 80, why: 180 },
    sep: '; ',
  },
  zh: {
    system:
      '你替一位独立开发者看着他同时开着的十几个 Claude 会话，把每个会话写成看板上的几句短话：在干什么、要不要他本人动手、动手做什么。他只读中文大白话。只输出一个 JSON 对象，不要别的字。',
    format: `按这个格式回答，字段都要有：
{"short":"","project":"","doing":"","ask":"","why":"","needs_user":false,"for_user":false,"blocking":false,"relay":false,"closeable":false}
- short：这个会话在做的事，12 个字以内，像「结账税费规则」「落地页首屏」。
- project：只有位置写着「统筹」才填：它和派出去的会话合起来在做的事，8 个字以内，像「结账改版」；否则填空。
- doing：这个会话自己的活干到哪了，16 个字以内，像「在合付款那条线的提交」「第二批交了」「后台复查 2275 条，约 40 分钟」。不写它转达给别的会话的事。
- ask：要他本人亲手做的那一个动作，22 个字以内，祈使句、具体，像「回它一句「发」，放出两条暂存的消息」「定运费规则：统一价还是按重量」。不用他做就填空。
- why：为什么要他做、不做会卡住什么，60 个字以内。ask 为空就填空。
- needs_user：只看【最后一条回复】：它是不是停下来要他决定、回答、确认或亲手做某件事才能往下走，是就填 true。没有【最后一条回复】就填 false。
- for_user：要做的事是给他本人的填 true；是给统筹、给别的会话的（比如「统筹定」）填 false。
- blocking：别的会话或线正停着、等他这一步才能往下走，填 true。
- relay：要做的事只是「去另一个会话里做某件事」（转达），填 true；ask 照样写。
- closeable：活干完了、已经合进主线或上线、没剩下要做的，填 true。
写法：大白话；不要提交号、分支名、文件路径、英文缩写和内部代号；英文内容翻成中文。`,
    category: {
      completed: '这轮做完了',
      blocked: '卡住了，等人',
      review_ready: '交了一部分，在等后续（后台在跑，或在等别的线）',
    },
    noVerdict: '还没判断',
    state: { gone: '会话已经停了', busy: '正在干活', waiting: '停下来等他回答', idle: '停着' },
    role: {
      coordinator: (n, titles) => `统筹：派出去了 ${n} 个会话（${titles}）`,
      line: parent => `「${parent}」派出去的一条线，平时向它汇报，不直接找他本人`,
      single: '独立会话，直接跟他本人对话',
    },
    label: {
      title: '【会话标题】',
      role: '【在整件事里的位置】',
      now: '【现在】',
      verdict: (category, detail, needs) => `【桌面版对上一轮的判断】${category}；一句话：${detail}；要人做的事：${needs}`,
      asking: '【它正停下来问他】',
      cards: '【它提议开的新会话，等他点卡片决定】',
      wrapUp: '【上一轮的收尾小结】',
      progress: '【最新进度】',
      lastReply: '【最后一条回复】',
      untitled: '（没有标题）',
      none: '无',
    },
    limits: { short: 15, project: 10, doing: 20, ask: 28, why: 72 },
    sep: '；',
  },
}

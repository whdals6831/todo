import type { CalEvent, Data, DateStr, NormRule, Project, Rule, Todo } from '../types/domain.ts'
import { DEFAULT_KEYMAP, DEFAULT_STARTMAP, START_WHY, URGENT_PROJECTS, coversDay, kindOf } from './constants.ts'
import {
  addWorkdays, holidaysBetween, isWork, md, nextWork, nextWorkOrSame, prevWork, shift, todayStr,
} from './date.ts'
import { escapeRegExp, isFarSite, projShort, sameSite, siteCore, siteShort, stripProj } from './project.ts'

type RuleCtx = Pick<Data, 'rules' | 'holidays'>
type PlanCtx = Pick<Data, 'rules' | 'holidays' | 'events' | 'projects'>

/** 옛 규칙에 없는 key·start 를 기본값으로 채운다 */
export function normRule(r: Rule): NormRule {
  const x = { ...r } as NormRule
  if (x.key == null) x.key = DEFAULT_KEYMAP[x.id] || ''
  if (!x.start) {
    const m = DEFAULT_STARTMAP[x.id] || ['lead', 2]
    x.start = m[0]
    x.startN = m[1]
  }
  if (x.startN == null) x.startN = 0
  return x
}

/**
 * 외근에 적용할 규칙. 같은 key 끼리는 과제 지정(+2)·방문 종류 지정(+1)이 더 높은 규칙 하나만 남고,
 * 남은 규칙이 꺼져(off) 있으면 그 key 는 만들지 않는다. SKIP 규칙이 있으면 아무것도 만들지 않는다.
 */
export function rulesFor(ev: CalEvent, rules: Rule[]): NormRule[] {
  if (kindOf(ev) !== 'visit' || !ev.type || ev.type === '기타') return []
  const m = rules
    .map(normRule)
    .filter((r) => (r.type === '*' || r.type === ev.type) && (r.project === '*' || r.project === ev.project) && (!r.far || isFarSite(ev.site)))
  if (m.some((r) => r.key === 'SKIP')) return []
  const score = (r: NormRule) => (r.project !== '*' ? 2 : 0) + (r.type !== '*' ? 1 : 0)
  const best: Record<string, NormRule> = {}
  m.forEach((r) => {
    if (r.key && (!best[r.key] || score(r) > score(best[r.key]))) best[r.key] = r
  })
  return m.filter((r) => (!r.key || best[r.key] === r) && !r.off)
}

/** 규칙 하나의 마감일과 사람이 읽는 근거 */
export function computeDue(ev: CalEvent, r: Rule, { holidays: hol }: Pick<Data, 'holidays'>) {
  const v = ev.date
  const sign = r.dir === 'before' ? -1 : 1
  const side = r.dir === 'before' ? '전' : '후'
  let d: DateStr
  const parts: string[] = []
  if (r.unit === 'ADD') {
    const base = ev.createdDate || todayStr()
    d = addWorkdays(base, r.n | 0, hol)
    if (!isWork(d, hol)) d = nextWorkOrSame(d, hol)
    parts.push('외근 등록일 ' + md(base) + (r.n ? ' 후 WD' + r.n : ' 당일') + ' = ' + md(d))
  } else if (!r.n) {
    d = v
    parts.push('방문 당일 ' + md(v))
  } else if (r.unit === 'WD') {
    d = addWorkdays(v, sign * r.n, hol)
    const first = r.n > 0 ? addWorkdays(v, sign, hol) : null
    parts.push('방문 ' + md(v) + ' ' + side + ' WD' + r.n + ' = ' + md(d) + (r.dir === 'after' && first ? ' (WD1=' + md(first) + ')' : ''))
  } else {
    d = shift(v, sign * r.n)
    parts.push('방문 ' + md(v) + ' ' + side + ' ' + r.n + '일 = ' + md(d))
    if (!isWork(d, hol)) {
      const o = d
      d = prevWork(d, hol)
      parts.push(md(o) + ' 휴일 → ' + md(d))
    }
  }
  const hs = holidaysBetween(v, d, hol)
  if (hs.length && r.unit === 'WD') parts.push('공휴일 제외: ' + hs.join(', '))
  let due = d
  if (r.send) {
    due = prevWork(d, hol)
    parts.push('보내는 일 → 전 영업일 ' + md(due) + ' 마감')
  }
  if (r.dir === 'before' && URGENT_PROJECTS.includes(ev.project || '')) {
    const reg = nextWorkOrSame(ev.createdDate || todayStr(), hol)
    if (due < reg) {
      parts.push('급하게 잡힌 개시라 등록일 ' + md(reg) + '로 당김')
      due = reg
    }
    if (due >= v) {
      const c = prevWork(v, hol)
      if (c >= reg || c >= todayStr()) {
        parts.push('방문 전 영업일 ' + md(c) + '로 조정')
        due = c
      }
    }
  }
  return { due, basis: parts.join(' · ') + (r.basis ? ' [' + r.basis + ']' : '') }
}

/** 외근이 있거나 내가 휴가인 날 — 착수일을 이날에서 옮긴다 */
export const hasVisit = (d: DateStr, events: Data['events']) =>
  [...events.values()].some((e) => (kindOf(e) === 'visit' && e.date === d) || (kindOf(e) === 'leave' && coversDay(e, d)))

/** 착수일과 근거. 착수일이 다른 외근 날과 겹치면 하루 옮긴다 */
export function computeStart(ev: CalEvent, r: Rule, due: DateStr, { holidays: hol, events }: Pick<Data, 'holidays' | 'events'>) {
  const mode = r.start === 'reg' ? 'reg' : r.unit === 'ADD' ? 'due' : r.start || 'lead'
  let st: DateStr
  const parts: string[] = []
  if (mode === 'reg') {
    st = nextWorkOrSame(ev.createdDate || todayStr(), hol)
    parts.push('외근 등록한 날 ' + md(st) + ' 착수')
  } else if (mode === 'due') {
    st = due
    parts.push('마감일 당일 착수')
  } else if (mode === 'fresh' && r.dir === 'after') {
    st = nextWork(ev.date, hol)
    parts.push('방문 다음 영업일 ' + md(st) + ' 착수')
  } else {
    const k = mode === 'fresh' ? 2 : Math.max(0, (r.startN ?? 0) | 0)
    st = addWorkdays(due, -k, hol)
    parts.push('마감 ' + k + '영업일 전 ' + md(st) + ' 착수')
  }
  if (st > due) st = due
  if (mode !== 'reg' && st < due && hasVisit(st, events) && st !== ev.date) {
    const o = st
    const alt = mode === 'fresh' ? nextWork(st, hol) : prevWork(st, hol)
    if (alt <= due) {
      st = alt
      parts.push(md(o) + ' 다른 외근 → ' + md(st))
    }
  }
  return { start: st, startBasis: parts.join(' · ') + ' [' + START_WHY[mode] + ']' }
}

/** 묶음 하나에 들어간 규칙 하나 (하위 항목 이름과 그 규칙대로의 날짜) */
export interface PlannedPart {
  ruleId: string
  sub: string
  due: DateStr
  start: DateStr
  /** 외근 등록한 날 착수 — 예전 외근에는 넣지 않는다 */
  reg: boolean
}

export interface PlannedTodo {
  title: string
  due: DateStr
  basis: string
  start: DateStr
  startBasis: string
  ruleId: string
  verify: boolean
  time: string
  subs: string[]
  /** 묶음 할 일이면 들어간 규칙들 */
  parts?: PlannedPart[]
}

/**
 * 외근 할 일 묶음: 방문 전 일은 "{type} Preparation", 방문 후 자잘한 일은 "{type} 방문 후 정리" 하나에 하위 항목으로.
 * 하위 항목이 따로 있는 일(Pre-Checklist·FUL), 리포트, 서명문서 eTMF 업로드, [대기] 일은 따로 둔다. 둘 이상일 때만 묶는다.
 * 서명문서·eTMF 일이 들어가면 그 문서 체크 목록은 묶음에서 펼쳐 본다
 */
export const GROUPS = {
  prep: { id: 'g-prep', title: '{site} {type} Preparation', what: '방문 전 할 일' },
  post: { id: 'g-post', title: '{site} {type} 방문 후 정리', what: '방문 후 할 일' },
} as const

export const isGroupRule = (id?: string | null) => id === GROUPS.prep.id || id === GROUPS.post.id

export function groupOf(r: Rule): keyof typeof GROUPS | null {
  /* 서명문서 eTMF 업로드(key ETMF)는 따로 빼 달라고 한 일이라 묶지 않는다 */
  if (r.subs?.length || r.key === 'OWN' || r.key === 'ETMF' || /^\s*\[대기\]/.test(r.title)) return null
  if (r.dir === 'before' || r.unit === 'ADD') return 'prep'
  return r.n > 0 ? 'post' : null
}

/**
 * 규칙 글의 자리표시자를 이 외근으로 채운다.
 * {site} 기관 {type} 방문 종류 {proj} 과제 약칭, 그리고 과제의 담당 기관 목록("022. 기관명(PI 이름)")에서
 * {no} 기관번호(세 자리) {hosp} 기관명 {pi} PI 이름, {ymd} 방문일(20261023). 모르는 값은 그 이름 그대로 남긴다
 */
function filler(ev: CalEvent, projects: Project[]) {
  const sites = projects.find((p) => p.name === ev.project)?.sites || []
  const core = siteCore(ev.site)
  const full = sites.find((x) => siteCore(x) === core) || sites.find((x) => sameSite(siteCore(x), core)) || ev.site || ''
  const vals: Record<string, string> = {
    site: siteShort(ev.site),
    type: ev.type || '',
    proj: projShort(projects, ev.project),
    no: /^\s*(?:\(X\))?\s*(\d+)/.exec(full)?.[1].padStart(3, '0') || '기관번호',
    hosp: siteShort(full),
    pi: /\(\s*PI\s*([^)]*?)\s*\)\s*$/.exec(full)?.[1] || 'PI 이름',
    ymd: ev.date.replaceAll('-', ''),
  }
  return (s: string) =>
    s
      .replace(/\{(\w+)\}/g, (m, k: string) => vals[k] ?? m)
      .replace(/\s+/g, ' ')
      .trim()
}

/** 할 일에 띄워 복사할 결재 상신 제목 (규칙에 copy 가 있는 외근 할 일만) */
export function copyText(t: Pick<Todo, 'ruleId' | 'eventId'>, { rules, events, projects }: Pick<Data, 'rules' | 'events' | 'projects'>) {
  const r = rules.find((x) => x.id === t.ruleId)
  const ev = t.eventId ? events.get(t.eventId) : undefined
  return r?.copy && ev ? filler(ev, projects)(r.copy) : ''
}

/** 묶음의 하위 항목 이름: 규칙 글에서 과제·기관과 맨 앞 방문 종류를 뺀다 (묶음 제목에 있으니) */
export function subLabel(ev: CalEvent, title: string, projects: Project[]) {
  const lead = new RegExp('^' + escapeRegExp(ev.type || '') + '\\s+', 'i')
  return filler(ev, projects)(title.replace(/\{(site|proj)\}/g, ' ')).replace(lead, '')
}

/** 외근 하나가 만들 자동 할 일 목록 (외근에서 지운 규칙은 빼고, 방문 전·후 자잘한 일은 묶어서) */
export function planTodos(ev: CalEvent, ctx: PlanCtx): PlannedTodo[] {
  const fill = filler(ev, ctx.projects)
  const skip = new Set(ev.skip || [])
  const label = (r: Rule) => subLabel(ev, r.title, ctx.projects)
  const rs = rulesFor(ev, ctx.rules).filter((r) => !skip.has(r.id))
  const one = rs.map((r) => {
    const { due, basis } = computeDue(ev, r, ctx)
    const { start, startBasis } = computeStart(ev, r, due, ctx)
    const subs = [...new Set((r.subs || []).map(fill).filter(Boolean))]
    return { title: fill(r.title), due, basis, start, startBasis, ruleId: r.id, verify: !!r.verify, time: r.time || '', subs }
  })
  const out: PlannedTodo[] = []
  const bundled = new Set<number>()
  for (const g of ['prep', 'post'] as const) {
    const G = GROUPS[g]
    const idx = rs.map((r, i) => (groupOf(r) === g ? i : -1)).filter((i) => i >= 0)
    if (idx.length < 2) continue
    /* 묶음을 지웠으면 그 안의 일도 낱개로 되살리지 않는다 */
    if (skip.has(G.id)) {
      idx.forEach((i) => bundled.add(i))
      continue
    }
    /* 마감 순, 같으면 규칙 순서대로. 이름이 겹치면 하나만 */
    const parts = idx
      .map((i) => ({ ruleId: rs[i].id, sub: label(rs[i]), due: one[i].due, start: one[i].start, reg: rs[i].start === 'reg', verify: one[i].verify, i }))
      .sort((a, b) => a.due.localeCompare(b.due) || a.i - b.i)
      .filter((x, k, xs) => xs.findIndex((y) => y.sub === x.sub) === k)
    idx.forEach((i) => bundled.add(i))
    const due = parts.reduce((m, x) => (x.due > m ? x.due : m), parts[0].due)
    const start = parts.reduce((m, x) => (x.start < m ? x.start : m), parts[0].start)
    out.push({
      title: fill(G.title), due, start, ruleId: G.id, verify: parts.some((x) => x.verify), time: '',
      basis: G.what + ' 묶음 · 마지막 항목 마감 ' + md(due) + ' (항목별 날짜는 하위 항목 옆에)',
      startBasis: '가장 이른 항목 착수 ' + md(start),
      subs: parts.map((x) => x.sub),
      parts: parts.map(({ ruleId, sub, due, start, reg }) => ({ ruleId, sub, due, start, reg })),
    })
  }
  return [...one.filter((_, i) => !bundled.has(i)), ...out]
}

/** 묶음 할 일의 하위 항목별 날짜 (지금 규칙·외근 날짜대로) */
export function partDues(t: Pick<Todo, 'ruleId' | 'eventId'>, ctx: PlanCtx): Record<string, DateStr> {
  const ev = t.eventId && isGroupRule(t.ruleId) ? ctx.events.get(t.eventId) : undefined
  const p = ev ? planTodos(ev, ctx).find((x) => x.ruleId === t.ruleId) : undefined
  return Object.fromEntries((p?.parts || []).map((x) => [x.sub, x.due]))
}

const norm = (s: string) => s.toLowerCase().replace(/[\s_-]/g, '')

/** 제목에서 과제·기관·방문 종류·소요 시간을 뺀 나머지 (같은 일인지 비교용). 이 외근의 기관이 없거나 다른 방문 종류면 null */
function taskCore(title: string, ev: CalEvent, projects: Project[]): string | null {
  const site = siteCore(ev.site)
  let hasSite = false
  const rest: string[] = []
  for (const w of stripProj(projects, title.replace(/\(\s*\d+\s*분\s*\)/g, ' '), ev.project || '').split(/\s+/).filter(Boolean)) {
    if (/^(psv|siv|mv|cov|add-?on)$/i.test(w)) {
      if (norm(w) !== norm(ev.type || '')) return null
    } else if (siteCore(w).length >= 2 && sameSite(siteCore(w), site)) hasSite = true
    else rest.push(w)
  }
  return hasSite ? rest.join('').toLowerCase() : null
}

/** 규칙으로 만들 할 일과 같은 일을 직접 만들어 둔 할 일 (같은 과제·기관, 마감이 방문 전후 30일 안) */
export function manualTwin(ev: CalEvent, title: string, todos: Iterable<Todo>, projects: Project[]): Todo | undefined {
  const want = taskCore(title, ev, projects)
  if (!want) return undefined
  for (const t of todos) {
    if (t.eventId || t.parentId || t.followOf || t.fulId || t.prepKey || t.project !== ev.project) continue
    if (!t.due || t.due < shift(ev.date, -30) || t.due > shift(ev.date, 30)) continue
    const got = taskCore(t.title, ev, projects)
    if (got != null && (got === want || (want.length >= 4 && got.includes(want)))) return t
  }
  return undefined
}

/** 키를 정렬한 JSON — 저장소가 키 순서를 바꿔도(Firestore·Postgres jsonb) 같은 문자열이 나온다 */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']'
  if (v && typeof v === 'object')
    return '{' + Object.keys(v).sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => JSON.stringify(k) + ':' + stableStringify((v as Record<string, unknown>)[k]))
      .join(',') + '}'
  return JSON.stringify(v)
}

/** 자동 할 일을 만든 입력의 서명. 바뀌었을 때만 다시 만든다 */
export const genKey = (ev: CalEvent, { rules }: RuleCtx) =>
  ['v6', ev.date, ev.type, ev.project, ev.site, stableStringify(rulesFor(ev, rules))].join('|')

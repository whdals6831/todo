import {
  BRZ, BRZ_PSV_FUL, CLAIM_RULE, ENF, ENF_SS_RULES, IMJ, ISF_RULE, KTX_RULE, MV_SITE_RULE, PREP_RULES, PRE_SIV, SCAN_RULE, TARL_SIV_SCAN, WID_RULE, brzPsvFulRule,
  fulPackRules, kindOf,
} from '../domain/constants.ts'
import { addWorkdays, localDay, md, nextWorkOrSame, nowIso, prevWork, todayStr } from '../domain/date.ts'
import { fulMatch } from '../domain/ful.ts'
import { MONTHLY, isVisitSub, monthlyPlan, monthlyTitle, nextMonth, visitBase, visitList, visitSkip, visitSubs } from '../domain/monthly.ts'
import { projShort, safeId, sameSite, siteCore, siteCoreRaw, siteShort, stripProj } from '../domain/project.ts'
import { GROUPS, genKey, isGroupRule, manualTwin, normRule, planTodos, rulesFor, subLabel, type PlannedPart, type PlannedTodo } from '../domain/rules.ts'
import {
  ENF_PREP, FOLLOWUPS, FULS_ON_DONE, breztriApproved, companionsFor, enfSivPrep, newSiteMail, type FollowUp, type NewTodo,
} from '../domain/specials.ts'
import { ETMF_RE, SIGN_RE } from '../domain/signDocs.ts'
import { slotByTime } from '../domain/priority.ts'
import type { CalEvent, Config, DateStr, Ful, NoteItem, NoteSection, Notes, Rule, Todo } from '../types/domain.ts'
import { createMemoryRepository } from './localRepository.ts'
import { newId, type DocTable, type RemoteChange, type Repository, type Snapshot } from './repository.ts'
import {
  appStore, configOf, defaultConfig, getState as S, removeEvent, removeFul, removeTodo, setEvent, setFul, setTodo,
} from './store.ts'

/*
 * 데이터를 바꾸는 모든 동작. 원본(protocol.html)의 store·동기화 함수를 그대로 옮겼다.
 * 상태를 먼저 바꾸고 저장소에 쓴다. 저장에 실패하면 화면 위쪽에 알린다.
 */

let repo: Repository = createMemoryRepository()
let unsubscribe: (() => void) | null = null

/** 저장소를 바꾼다 (로그인·로그아웃). 이전 저장소의 구독은 끊는다 */
export const setRepository = (r: Repository) => {
  unsubscribe?.()
  unsubscribe = null
  repo.dispose?.()
  repo = r
  r.onStatus?.((sync) => appStore.setState({ sync }))
}

/** 쌓인 쓰기를 지금 보낸다 (로그아웃·다시 연결될 때) */
export const flushWrites = () => repo.flush?.() ?? Promise.resolve()

async function write(p: Promise<void>) {
  try {
    await p
  } catch (e) {
    appStore.setState({ notice: '저장하지 못했습니다: ' + (e instanceof Error ? e.message : String(e)) })
  }
}

/** 직접 고친 자동 할 일 표시. 규칙이 바뀌어도 덮어쓰지 않는다 */
export const manualId = (r?: string | null) => (r ? (r.endsWith('-manual') ? r : r + '-manual') : null)

/* ---------- 문서 저장 ---------- */

export async function putEvent(e: Omit<CalEvent, 'id'> & { id?: string }) {
  const n = { ...e, id: e.id || newId() } as CalEvent
  setEvent(n)
  await write(repo.putEvent(n))
  return n.id
}

export async function deleteEvent(id: string) {
  removeEvent(id)
  await write(repo.deleteEvent(id))
}

/** 끝낸 할 일의 하위 항목은 모두 체크 (체크 시각은 완료 시각) */
const checkAllSubs = <T extends Pick<Todo, 'subs' | 'checks' | 'checkAt' | 'doneAt'>>(t: T): T => {
  const add = (t.subs || []).filter((x) => !(t.checks || []).includes(x))
  if (!add.length) return t
  const at = t.doneAt || nowIso()
  return { ...t, checks: [...(t.checks || []), ...add], checkAt: { ...t.checkAt, ...Object.fromEntries(add.map((x) => [x, at])) } }
}

/** 체크 시각에서 지운 항목은 빼고, 이름을 바꾼 항목은 따라간다 */
const keepAt = (at: Todo['checkAt'], f: (name: string) => string | null) =>
  at && Object.fromEntries(Object.entries(at).flatMap(([k, v]) => (f(k) == null ? [] : [[f(k)!, v]])))

/** 할 일 저장. 완료하면 하위 항목을 모두 체크하고, 완료 상태가 바뀌면 이어지는 할 일(FOLLOWUPS)을 만들거나 지우거나 옮긴다 */
export async function putTodo(t0: NewTodo): Promise<string> {
  const prev = t0.id ? (S().todos.get(t0.id) ?? null) : null
  let t = slotByTime({ ...t0, id: t0.id || '' }, prev, S().todos)
  if (!t.id) t = { ...t, id: newId() }
  if (t.done && !prev?.done) t = checkAllSubs(t)
  setTodo(t)
  await write(repo.putTodo(t))
  if (t.done && !prev?.done) {
    await followUpsOnDone(t)
    await fulsOnDone(t)
  } else if (!t.done && prev?.done) {
    await followUpsUndo(t)
    await fulsUndo(t)
  }
  else if (t.done && prev?.done && localDay(t.doneAt) !== localDay(prev.doneAt)) await followUpsRedate(t)
  if (prev && isGroupRule(t.ruleId)) await skipGoneParts(prev, t)
  if (prev) await skipGoneVisits(prev, t)
  return t.id
}

/** 매월 외근 목록(비용청구) 할 일이면 그 매월 할 일과 달. 아니면 null */
function visitListOf(id: string) {
  for (const x of MONTHLY) {
    const pre = safeId('m_' + x.id + '_')
    if (x.visits && id.startsWith(pre) && /^\d{4}-\d{2}$/.test(id.slice(pre.length))) return { x, month: id.slice(pre.length) }
  }
  return null
}

/** 매월 외근 목록에서 외근 하위 항목을 지우면 그 외근의 skip 에 남겨 다시 넣지 않는다 */
async function skipGoneVisits(prev: Todo, t: Todo) {
  const l = visitListOf(t.id)
  const gone = (prev.subs || []).filter((y) => !(t.subs || []).includes(y))
  if (!l || !gone.length) return
  for (const v of visitList(l.month, S().events.values(), S().projects, l.x))
    if (gone.includes(v.sub)) await putEvent({ ...v.ev, skip: [...(v.ev.skip || []), visitSkip(l.x)] })
}

/** 외근 할 일 묶음에서 규칙대로의 하위 항목을 지우거나 이름을 바꾸면, 그 규칙을 외근의 skip 에 남겨 다시 끼우지 않는다 */
async function skipGoneParts(prev: Todo, t: Todo) {
  const gone = (prev.subs || []).filter((x) => !(t.subs || []).includes(x))
  const ev = gone.length && t.eventId ? S().events.get(t.eventId) : undefined
  if (!ev) return
  const parts = planTodos(ev, S()).find((p) => p.ruleId === t.ruleId)?.parts || []
  const add = parts.filter((x) => gone.includes(x.sub) && !(ev.skip || []).includes(x.ruleId)).map((x) => x.ruleId)
  if (add.length) await putEvent({ ...ev, skip: [...(ev.skip || []), ...add] })
}

export async function deleteTodo(id: string) {
  removeTodo(id)
  await write(repo.deleteTodo(id))
}

export async function putFul(f: Omit<Ful, 'id'> & { id?: string }) {
  const n = { ...f, id: f.id || newId() } as Ful
  setFul(n)
  await write(repo.putFul(n))
  return n.id
}

export async function deleteFul(id: string) {
  removeFul(id)
  await write(repo.deleteFul(id))
}

export async function putConfig() {
  await write(repo.putConfig(configOf(S())))
}

/** 사용자가 지운 할 일: 자동 할 일이면 그 규칙을 외근의 skip 에 남겨 다시 생기지 않게 하고, FUL 에서 온 것이면 메모를 완료로 */
export async function dismissTodo(id: string) {
  const t = S().todos.get(id)
  if (t && t.eventId && t.ruleId) {
    const base = t.ruleId.replace(/-manual$/, '')
    const ev = S().events.get(t.eventId)
    if (ev && !(ev.skip || []).includes(base)) await putEvent({ ...ev, skip: [...(ev.skip || []), base] })
  }
  if (t && t.fulId) {
    /* 하위 항목으로 모은 메모 모두 */
    for (const f of [...S().fuls.values()].filter((f) => f.id === t.fulId || f.todoId === id)) if (!f.done) await putFul({ ...f, done: true })
  }
  await deleteTodo(id)
}

const unlinkFul = (f: Ful): Ful => {
  const n = { ...f }
  delete n.todoId
  delete n.eventId
  delete n.linkedAt
  return n
}

/** 일정 삭제: 미완료 자동 할 일도 지우고(완료한 것은 기록으로 남김), 연결된 FUL 메모는 대기로 되돌린다 */
export async function deleteEventCascade(id: string) {
  for (const t of [...S().todos.values()].filter((t) => t.eventId === id && !t.done)) await deleteTodo(t.id)
  for (const f of [...S().fuls.values()].filter((f) => f.eventId === id)) {
    const t = f.todoId ? S().todos.get(f.todoId) : null
    if (t && t.done) continue
    if (t) await deleteTodo(t.id)
    await putFul(unlinkFul(f))
  }
  await deleteEvent(id)
  await syncVisitLists()
}

/* ---------- 완료하면 생기는 확인 할 일 ---------- */

const followId = (t: Todo, fid: string) => safeId('f_' + t.id + '_' + fid)

/** 완료일에서 이어지는 할 일의 착수·마감 */
function followDates(t: Todo, f: FollowUp) {
  const day = localDay(t.doneAt) || todayStr()
  const hol = S().holidays
  const visit = f.visitN && t.eventId ? S().events.get(t.eventId)?.date : undefined
  const due = visit ? addWorkdays(visit, f.visitN!, hol) : addWorkdays(day, f.n, hol)
  const start = f.startN ? [addWorkdays(day, f.startN, hol), due].sort()[0] : day
  return {
    start, due,
    basis: (visit ? '방문 ' + md(visit) + ' 후 WD' + f.visitN : '「' + t.title + '」 완료일 ' + md(day) + ' 후 WD' + f.n) + ' = ' + md(due) + ' [' + f.basis + ']',
    startBasis: f.startN ? '완료일 ' + md(day) + ' 후 WD' + f.startN + ' ' + md(start) + ' 착수' : '요청 완료한 당일 착수',
  }
}

async function followUpsOnDone(t: Todo, only?: string) {
  for (const f of FOLLOWUPS) {
    if ((t.followOf && !f.chain) || (only && f.id !== only) || (f.project && t.project !== f.project) || !f.match(t.title || '')) continue
    const id = followId(t, f.id)
    if (S().todos.has(id)) continue
    const subs = f.subs?.(t.title)
    await putTodo({
      id, title: f.title(t.title), project: t.project || '', ...followDates(t, f), time: '', tbd: false, autoDue: false, done: false, followOf: t.id,
      ...(subs?.length ? { subs } : {}), created: new Date().toISOString(),
    })
  }
}

async function followUpsUndo(t: Todo) {
  for (const x of [...S().todos.values()].filter((x) => x.followOf === t.id && !x.done)) await deleteTodo(x.id)
}

/** 완료일을 나중에 고치면 열린 확인 할 일도 따라 옮긴다 (직접 날짜를 바꾼 것은 그대로) */
async function followUpsRedate(t: Todo) {
  for (const x of [...S().todos.values()].filter((x) => x.followOf === t.id && !x.done && !/직접 변경|Claude가 변경/.test(x.basis || ''))) {
    const f = FOLLOWUPS.find((f) => followId(t, f.id) === x.id)
    if (!f) continue
    const d = followDates(t, f)
    if (x.due === d.due && x.start === d.start) continue
    await putTodo({ ...x, ...d })
  }
}

/* ---------- 완료하면 남기는 FUL 메모 ---------- */

const fulOnDoneId = (t: Todo, fid: string) => safeId('u_' + t.id + '_' + fid)

/** 이어진 할 일을 거슬러 올라가 외근의 기관을 찾고, 없으면 제목에서 (과제 목록의 기관 이름이 있으면 그것으로) */
function siteOfTodo(t: Todo, fromTitle: (x: string) => string) {
  for (let x: Todo | undefined = t, i = 0; x && i < 5; x = x.followOf ? S().todos.get(x.followOf) : undefined, i++) {
    const ev = x.eventId ? S().events.get(x.eventId) : undefined
    if (ev?.site) return ev.site
  }
  const name = fromTitle(stripProj(S().projects, t.title || '', t.project || '').replace(/\s+/g, ' ').trim())
  const c = siteCore(name)
  return S().projects.find((p) => p.name === t.project)?.sites.find((x) => sameSite(siteCore(x), c)) || name
}

/** 끝내면 그 기관 FUL 메모에 남긴다 (FULS_ON_DONE). 이미 잡아 둔 해당 외근이 있으면 바로 그 할 일로 넘어간다 */
async function fulsOnDone(t: Todo, only?: string) {
  for (const f of FULS_ON_DONE) {
    if ((only && f.id !== only) || (f.project && t.project !== f.project) || !f.match(t.title || '')) continue
    const id = fulOnDoneId(t, f.id)
    const site = siteOfTodo(t, f.site)
    if (S().fuls.has(id) || !site) continue
    await putFul({ id, project: t.project || '', site, type: f.type, text: f.text, created: t.doneAt || nowIso() })
    await applyFulsAll()
  }
}

/** 완료를 취소하면 남긴 메모도 지운다. 넘어간 할 일에서는 그 하위 항목만 빼고, 남은 항목이 없으면 할 일도 지운다 (이미 끝냈으면 그대로) */
async function fulsUndo(t: Todo) {
  for (const f of FULS_ON_DONE) {
    const x = S().fuls.get(fulOnDoneId(t, f.id))
    const linked = x?.todoId ? S().todos.get(x.todoId) : undefined
    if (!x || linked?.done || linked?.checks?.includes(x.text)) continue
    if (linked) {
      const subs = (linked.subs || []).filter((s) => s !== x.text)
      if (subs.length) await putTodo(withSubs(linked, subs))
      else await deleteTodo(linked.id)
    }
    await deleteFul(x.id)
  }
}

/* ---------- 외근 → 자동 할 일 동기화 ---------- */

const busy = new Set<string>()
const synced = new Map<string, string>()

/** 하위 항목 밑 문서 체크 이름 ("하위 항목 › 문서") */
const DOC_SEP = ' › '

/** 묶음 할 일의 지금 하위 항목·체크·메모 */
interface BundleState {
  subs: string[]
  checks: string[]
  checkAt: Record<string, string>
  note: string
}

const partOf = (x: PlannedPart, mine: Todo[]) => mine.filter((t) => t.ruleId === x.ruleId || t.ruleId === x.ruleId + '-manual')

/**
 * 묶음 할 일의 하위 항목을 맞춘다. 직접 고친 하위 항목은 그대로 두고, 없는 규칙의 일은 제자리(규칙 순서)에 끼운다.
 * 그 낱개 할 일을 끝냈으면 체크하고, 열린 낱개 할 일에 직접 단 하위 항목은 바로 뒤에, 체크(문서 체크 포함)는 그대로, 메모는 묶음 메모로
 */
function mergeBundle(cur: BundleState, parts: PlannedPart[], mine: Todo[]): BundleState {
  const subs = [...cur.subs]
  const checks = [...cur.checks]
  const checkAt = { ...cur.checkAt }
  const notes = cur.note ? [cur.note] : []
  const check = (x: string, at?: string) => {
    if (checks.includes(x)) return
    checks.push(x)
    if (at) checkAt[x] = at
  }
  const labels = parts.map((x) => x.sub)
  parts.forEach((x, k) => {
    if (!subs.includes(x.sub)) {
      const next = labels.slice(k + 1).find((l) => subs.includes(l))
      subs.splice(next ? subs.indexOf(next) : subs.length, 0, x.sub)
    }
    const of = partOf(x, mine)
    const done = of.find((t) => t.done)
    if (done) check(x.sub, done.doneAt || todayStr())
    let at = subs.indexOf(x.sub) + 1
    for (const t of of.filter((t) => !t.done)) {
      for (const y of t.subs || []) if (!subs.includes(y)) subs.splice(at++, 0, y)
      /* 하위 항목 체크는 그대로, 문서 체크(서명문서·eTMF)는 이 하위 항목 밑으로 */
      for (const c of t.checks || []) check(t.subs?.includes(c) ? c : x.sub + DOC_SEP + c, t.checkAt?.[c])
      if (t.note?.trim()) notes.push(t.title + ': ' + t.note.trim())
    }
  })
  return { subs, checks, checkAt, note: notes.join('\n') }
}

/**
 * 외근 할 일 묶음 하나를 맞추고, 그 안에 든 열린 낱개 할 일은 지운다(아래 할 일은 묶음으로).
 * 예전 외근에는 마감이 지난 일과 "외근 등록한 날 착수" 일은 새로 넣지 않는다 (낱개 할 일이 있던 것은 넣는다).
 * 끝낸 묶음은 그대로 둔다 (열린 낱개 할 일이 남아 있으면 다시 연다)
 */
async function syncBundle(ev: CalEvent, p: PlannedTodo, mine: Todo[], regen: boolean) {
  const id = safeId('a_' + ev.id + '_' + p.ruleId)
  const old = S().todos.get(id)
  const parts = p.parts || []
  const open = parts.flatMap((x) => partOf(x, mine)).filter((t) => !t.done)
  if (old?.done && !open.length) return
  if (!old && mine.some((t) => t.done && t.ruleId === p.ruleId) && !open.length) return
  const today = todayStr()
  const regOnly = new Set(rulesFor(ev, S().rules).filter((r) => r.start === 'reg').map((r) => r.id))
  const use = parts.filter((x) => partOf(x, mine).length || !regen || (!regOnly.has(x.ruleId) && x.due >= today))
  const b = mergeBundle({ subs: old?.subs || [], checks: old?.checks || [], checkAt: old?.checkAt || {}, note: old?.note || '' }, use, mine)
  if (!old && (!b.subs.length || b.subs.every((x) => b.checks.includes(x)))) return
  await putTodo({
    id, title: p.title, due: p.due, time: p.time || '', basis: p.basis, start: p.start, startBasis: p.startBasis,
    ruleId: p.ruleId, verify: p.verify, eventId: ev.id, project: ev.project || '', done: false, doneAt: null,
    rank: old?.rank, note: b.note || undefined, subs: b.subs.length ? b.subs : undefined, checks: b.checks, checkAt: b.checkAt,
    created: old?.created || new Date().toISOString(),
  })
  for (const t of open) {
    if (!S().todos.has(t.id)) continue
    for (const c of [...S().todos.values()].filter((x) => x.parentId === t.id)) await putTodo({ ...c, parentId: id })
    await deleteTodo(t.id)
  }
  await dropDoneParts(ev, p)
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * 묶음 하위 항목으로 이미 체크된, 따로 남은 끝낸 낱개 할 일을 지운다 (브리핑·외근 편집에 같은 일이 두 번 보이지 않게).
 * 제목을 손으로 바꾼 일(다른 일일 수 있다)·하위 항목이 있는 일·이어진 할 일이 있는 일은 그대로 둔다. 메모와 문서 체크는 묶음으로 옮긴다
 */
async function dropDoneParts(ev: CalEvent, p: PlannedTodo) {
  const id = safeId('a_' + ev.id + '_' + p.ruleId)
  const b0 = S().todos.get(id)
  if (!b0 || !p.parts) return
  const all = [...S().todos.values()]
  const mine = all.filter((t) => t.eventId === ev.id)
  let b = b0
  const drop: Todo[] = []
  for (const x of p.parts) {
    if (!b.subs?.includes(x.sub) || !b.checks?.includes(x.sub)) continue
    for (const t of partOf(x, mine)) {
      if (!t.done || t.subs?.length || oneLine(t.title) !== oneLine(x.title) || all.some((c) => c.parentId === t.id || c.followOf === t.id)) continue
      for (const c of t.checks || []) b = checkWith(b, x.sub + DOC_SEP + c, t.checkAt?.[c])
      const note = t.note?.trim()
      if (note && !(b.note || '').includes(note)) b = { ...b, note: [b.note, t.title + ': ' + note].filter(Boolean).join('\n') }
      drop.push(t)
    }
  }
  if (b !== b0) await putTodo(b)
  for (const t of drop) await deleteTodo(t.id)
}

/** 외근의 할 일 묶음을 모두 맞춘다 (이미 맞춘 외근을 손볼 때) */
async function syncBundles(ev: CalEvent) {
  const mine = [...S().todos.values()].filter((t) => t.eventId === ev.id)
  for (const p of planTodos(ev, S())) if (p.parts) await syncBundle(ev, p, mine, true)
}

/**
 * 외근의 자동 할 일을 규칙대로 맞춘다. 할 일 id 를 외근+규칙으로 고정해서
 * 두 창이 동시에 맞춰도 같은 문서를 쓰고 중복되지 않는다.
 */
export async function syncEvent(ev: CalEvent, force = false) {
  const key = genKey(ev, S())
  if (!force && (ev.genKey === key || synced.get(ev.id) === key)) return
  if (busy.has(ev.id)) return
  busy.add(ev.id)
  try {
    await applyFuls(ev)
    const detId = (r: string) => safeId('a_' + ev.id + '_' + r)
    const mine = [...S().todos.values()].filter((t) => t.eventId === ev.id)
    const plan = planTodos(ev, S())
    const want = new Set(plan.map((p) => detId(p.ruleId)))
    /* 묶음에 들어갈 낱개 할 일은 묶음을 맞출 때 옮기고 지운다 */
    const inBundle = new Set(plan.flatMap((p) => (p.parts || []).map((x) => x.ruleId)))
    /* "외근 등록한 날 착수" 규칙은 외근을 처음 등록할 때만 만든다 (규칙을 새로 넣어도 예전 외근에는 안 생긴다) */
    const regOnly = new Set(rulesFor(ev, S().rules).filter((r) => r.start === 'reg').map((r) => r.id))
    for (const t of mine) {
      if (!t.done && t.ruleId && !t.ruleId.endsWith('-manual') && !want.has(t.id) && !inBundle.has(t.ruleId)) await deleteTodo(t.id)
    }
    /* 이미 맞춘 외근을 다시 맞출 때(날짜·규칙·공휴일 변경): 완료한 할 일은 그대로, 열린 할 일은 날짜만 옮긴다.
       새로 생길 할 일의 마감이 이미 지났으면 손으로 처리한 일이라 보고 만들지 않는다 */
    const regen = !!ev.genKey
    const today = todayStr()
    for (const p of plan) {
      if (p.parts) {
        await syncBundle(ev, p, mine, regen)
        continue
      }
      const id = detId(p.ruleId)
      /* 이 외근에 이어 둔, 직접 만든 할 일 (자동 할 일과 id 가 다르다) */
      const linked = mine.find((t) => t.id !== id && t.ruleId === p.ruleId + '-manual')
      if (mine.some((t) => t !== linked && ((t.done && t.ruleId === p.ruleId) || t.ruleId === p.ruleId + '-manual'))) continue
      const old = S().todos.get(id)
      const twin = linked ?? manualTwin(ev, p.title, S().todos.values(), S().projects)
      if (twin?.done) {
        /* 같은 일을 직접 만들어 이미 끝냈으면 외근에 잇기만 하고 새로 만들지 않는다 */
        if (!linked) await putTodo({ ...twin, eventId: ev.id, ruleId: p.ruleId + '-manual' })
        if (old && !old.done) await deleteTodo(id)
        continue
      }
      if (!twin && regen && !old && ((p.due && p.due < today) || regOnly.has(p.ruleId))) continue
      /* 같은 일을 직접 만들어 둔 열린 할 일은 이 규칙의 할 일로 바꾼다.
         날짜는 규칙대로 바뀌므로 예전 날짜를 설명하던 메모는 버리고, 순서·체크는 그대로 */
      const base = twin ?? old
      /* 하위 항목은 처음 만들 때만 규칙대로. 그 뒤로는 직접 고치고 지운 대로 둔다 */
      const subs = base?.subs?.length ? base.subs : p.subs
      await putTodo({
        id, title: p.title, due: p.due, time: p.time || '', basis: p.basis, start: p.start, startBasis: p.startBasis,
        ruleId: p.ruleId, verify: p.verify, eventId: ev.id, project: ev.project || '', done: false,
        rank: base?.rank, note: old?.note, subs: subs.length ? subs : undefined, checks: base?.checks, checkAt: base?.checkAt, created: base?.created || new Date().toISOString(),
      })
      if (twin) {
        for (const c of [...S().todos.values()].filter((x) => x.parentId === twin.id)) await putTodo({ ...c, parentId: id })
        await deleteTodo(twin.id)
      }
    }
    /* 엔플론시아: "SIV 예정"으로 미리 만든 준비 할 일은 이 외근의 Preparation 으로 */
    await absorbEnfPrep(ev)
    synced.set(ev.id, key)
    await putEvent({ ...(S().events.get(ev.id) ?? ev), genKey: key })
    await syncVisitLists()
  } finally {
    busy.delete(ev.id)
  }
}

/** 일정이 사라진 자동 할 일·FUL 연결을 정리한다 (방금 만든 것은 2분 동안 둔다) */
async function cleanOrphans() {
  const { todos, events, fuls } = S()
  for (const t of [...todos.values()].filter(
    (t) => t.eventId && !t.done && !events.has(t.eventId) && !(t.created && Date.now() - Date.parse(t.created) < 120000),
  ))
    await deleteTodo(t.id)
  for (const f of [...fuls.values()].filter((f) => f.eventId && !events.has(f.eventId))) {
    const t = f.todoId ? S().todos.get(f.todoId) : null
    if (t && t.done) continue
    if (t) await deleteTodo(t.id)
    await putFul(unlinkFul(f))
  }
}

export async function syncAll(force = false) {
  await cleanOrphans()
  for (const ev of [...S().events.values()]) await syncEvent(ev, force)
  await syncVisitLists()
}

/** "SIV 예정"에 적은 기관이 이 외근의 기관인가 (앞 낱말만 맞아도: "금천 원장님께 …" → 금천연세로이…) */
const enfSiteOf = (prepSite: string, c: string) => {
  const k = siteCoreRaw(prepSite)
  const w = siteCoreRaw(prepSite.trim().split(/\s+/)[0])
  return (k.length >= 2 && (k.includes(c) || c.includes(k))) || (w.length >= 2 && c.includes(w))
}

/** 체크 하나를 그 시각으로 켠다 (이미 켜져 있으면 그대로) */
const checkWith = (t: Todo, name: string, at?: string | null): Todo =>
  t.checks?.includes(name) ? t : { ...t, checks: [...(t.checks || []), name], checkAt: { ...t.checkAt, [name]: at || nowIso() } }

/**
 * 엔플론시아 SIV 외근의 Preparation 에 "SIV 예정"으로 미리 만든 준비 할 일(Preparation 하나, 또는 예전 낱개)을 합친다.
 * 외근 규칙에 같은 일(key)이 있으면 그 하위 항목으로 체크·단계 체크를 옮기고, 없으면 하위 항목으로 덧붙인다. 메모도 옮기고 준비 할 일은 지운다
 */
async function absorbEnfPrep(ev: CalEvent) {
  if (ev.project !== ENF || ev.type !== 'SIV') return
  const c = siteCoreRaw(ev.site)
  const b0 = S().todos.get(safeId('a_' + ev.id + '_' + GROUPS.prep.id))
  if (c.length < 2 || !b0 || b0.done) return
  const preps = [...S().todos.values()].filter((t) => t.prepKey && !t.eventId && t.prepSite && enfSiteOf(t.prepSite, c))
  if (!preps.length) return
  const parts = planTodos(ev, S()).find((p) => p.ruleId === GROUPS.prep.id)?.parts || []
  const rs = rulesFor(ev, S().rules)
  const target = (key: string | undefined, label: string) => {
    const r = key ? rs.find((x) => x.key === key) : undefined
    return (r && parts.find((p) => p.ruleId === r.id)?.sub) || label
  }
  let b: Todo = { ...b0, subs: [...(b0.subs || [])] }
  const notes = b0.note ? [b0.note] : []
  for (const t of preps) {
    const items =
      t.prepKey === 'PREP'
        ? (t.subs || []).map((x) => ({ key: ENF_PREP.find((e) => e.sub === x)?.key, label: x, done: !!t.done || !!t.checks?.includes(x), at: t.checkAt?.[x] }))
        : [{ key: t.prepKey, label: t.title.replace('엔플론시아 ' + t.prepSite + ' ', '').replace(/^SIV\s+/, ''), done: !!t.done, at: t.doneAt || undefined }]
    for (const it of items) {
      const to = target(it.key, it.label)
      if (!b.subs!.includes(to)) b.subs!.push(to)
      if (it.done) b = checkWith(b, to, it.at)
      /* 단계 체크 ("하위 항목 › 단계") */
      for (const k of t.checks || []) if (k.startsWith(it.label + DOC_SEP)) b = checkWith(b, to + k.slice(it.label.length), t.checkAt?.[k])
    }
    if (t.note?.trim()) notes.push(t.title + ': ' + t.note.trim())
  }
  await putTodo({ ...b, note: notes.join('\n') || undefined })
  for (const t of preps) {
    for (const ch of [...S().todos.values()].filter((x) => x.parentId === t.id)) await putTodo({ ...ch, parentId: b.id })
    await deleteTodo(t.id)
  }
}

/**
 * FUL 메모를 가장 가까운 다가오는 해당 외근의 "{기관} {방문} 전 FUL" 할 일 하나에 하위 항목으로 모은다
 * (착수 = 외근 등록일, 마감 = 방문 WD1 전). 나중에 적은 메모는 그 할 일에 덧붙이고, 방문일이 바뀌면 마감도 따라간다
 */
async function applyFuls(ev: CalEvent) {
  if (kindOf(ev) !== 'visit' || !ev.date || ev.date < todayStr()) return
  const hol = S().holidays
  const earlier = (f: Ful) =>
    [...S().events.values()].some((o) => o.id !== ev.id && o.date && o.date >= todayStr() && o.date < ev.date && fulMatch(f, o))
  const id = safeId('fu_' + ev.id)
  const old = S().todos.get(id)
  const fuls = [...S().fuls.values()]
    .filter((f) => !f.done && (f.todoId === id || (!f.todoId && fulMatch(f, ev) && !earlier(f))))
    .sort((a, b) => Date.parse(a.created) - Date.parse(b.created))
  if (!fuls.length) return
  const add = [...new Set(fuls.filter((f) => !old || !f.todoId).map((f) => f.text))].filter((x) => !(old?.subs || []).includes(x))
  const reg = nextWorkOrSame(ev.createdDate || todayStr(), hol)
  let due = prevWork(ev.date, hol)
  if (due < reg) due = reg
  const dates = {
    start: reg, due,
    basis: 'FUL 메모 → ' + md(ev.date) + ' ' + ev.type + ' 등록 · 방문 WD1 전 = ' + md(due),
    startBasis: '외근 등록한 날 ' + md(reg) + ' 착수',
  }
  if (!old) {
    await putTodo({
      id, title: siteShort(ev.site) + ' ' + ev.type + ' 전 FUL', project: ev.project, subs: add, ...dates,
      time: '', tbd: false, autoDue: false, done: false, fulId: fuls[0].id, created: new Date().toISOString(),
    })
  } else {
    const redate = !old.done && old.due !== due && !/직접 변경|Claude가 변경/.test(old.basis || '')
    /* 끝낸 할 일에 새 메모가 붙으면 다시 연다 */
    if (add.length || redate)
      await putTodo({ ...withSubs(old, [...(old.subs || []), ...add]), ...(redate || old.done ? dates : {}), done: false, doneAt: null })
  }
  for (const f of fuls) if (!f.todoId) await putFul({ ...f, todoId: id, eventId: ev.id, linkedAt: todayStr() })
}

export async function applyFulsAll() {
  for (const ev of [...S().events.values()].sort((x, y) => (x.date || '').localeCompare(y.date || ''))) await applyFuls(ev)
}

/* ---------- 할 일 추가·이동 ---------- */

/** Breztri 승인: 같은 기관의 [대기] 선정 확인 할 일을 완료로 */
async function closeWaitingSsl(site: string) {
  const c = siteCore(site)
  for (const x of [...S().todos.values()].filter((x) => !x.done && x.ruleId && /^r-(b-)?ssl/.test(x.ruleId))) {
    const ev = x.eventId ? S().events.get(x.eventId) : null
    const k = siteCore(ev ? ev.site : x.title)
    if (sameSite(k, c))
      await putTodo({ ...x, done: true, doneAt: new Date().toISOString(), note: ((x.note || '') + ' 의뢰사 승인 → Site Selection CL 할 일로 넘김').trim() })
  }
}

/** 할 일 추가. 특수 키워드 흐름과 "함께 추가할 할 일" 규칙을 적용한다 */
export async function addTodo(t: NewTodo): Promise<string> {
  const ap = breztriApproved(t, S())
  if (ap) {
    const ids: string[] = []
    for (const x of ap) ids.push(await putTodo(x))
    await closeWaitingSsl(ap[0].approvedSite)
    return ids[0]
  }
  const prep = enfSivPrep(t, S())
  if (prep) {
    const ids: string[] = []
    for (const x of prep) ids.push(await putTodo(x))
    /* 그 기관 SIV 외근이 이미 있으면 바로 그 외근의 Preparation 으로 */
    for (const ev of [...S().events.values()]) if (kindOf(ev) === 'visit' && ev.date >= todayStr()) await absorbEnfPrep(ev)
    return ids[0]
  }
  const ns = newSiteMail(t, S())
  if (ns) {
    await putTodo(ns.ca)
    t = ns.main
  }
  const id = await putTodo(t)
  for (const c of companionsFor(t, S().companions)) {
    const i = t.title.toLowerCase().indexOf(c.keyword.toLowerCase())
    const lead = t.title.slice(0, i).trim() || projShort(S().projects, t.project)
    for (const item of c.items) {
      await putTodo({
        title: (lead ? lead + ' ' : '') + item, due: t.due || '', tbd: !!t.tbd, time: t.time || '', start: t.start || '', project: t.project || '',
        parentId: id, basis: '「' + t.title + '」와 함께 추가 · 마감 같이 이동', done: false, created: new Date().toISOString(),
      })
    }
  }
  return id
}

/** 원래 할 일의 마감이 바뀌면 함께 추가된 열린 할 일도 따라 옮긴다 (직접 날짜를 바꾼 것은 제외) */
export async function syncChildren(parent: Todo) {
  for (const c of [...S().todos.values()].filter((x) => x.parentId === parent.id && !x.done && !x.ownDate)) {
    if (c.due === parent.due && !!c.tbd === !!parent.tbd) continue
    await putTodo({ ...c, due: parent.due || '', tbd: !!parent.tbd, time: parent.time || c.time || '' })
  }
}

/** 마감일(또는 착수일)을 d 로 옮긴다. how 는 근거에 남길 말 ("드래그로 변경") */
export async function moveTodo(t: Todo | undefined, d: DateStr, how: string, field: 'due' | 'start' = 'due') {
  if (!t) return
  if (field === 'start') {
    if (t.start === d) return
    const nd = t.due && d && d > t.due ? d : t.due
    await putTodo({ ...t, start: d, due: nd, startBasis: (t.startBasis ? t.startBasis + ' · ' : '') + how + ' → ' + (d ? md(d) : '없음'), ruleId: manualId(t.ruleId) })
    return
  }
  if (t.due === d) return
  const n: Todo = { ...t, due: d, autoDue: false, basis: (t.basis ? t.basis + ' · ' : '') + how + ' → ' + (d ? md(d) : '날짜 없음'), ruleId: manualId(t.ruleId) }
  if (n.start && d && n.start > d) n.start = d
  if (t.parentId) n.ownDate = true
  await putTodo(n)
  await syncChildren(n)
}

/** 지연된 할 일을 다음 영업일로 한 번 미룬다 */
export async function rollOver(t: Todo) {
  const nd = addWorkdays(todayStr(), 1, S().holidays)
  const n: Todo = {
    ...t, rolled: (t.rolled || 0) + 1, origDue: t.origDue || t.due, due: nd, start: nd, ruleId: manualId(t.ruleId),
    basis: (t.basis ? t.basis + ' · ' : '') + '이월 ' + ((t.rolled || 0) + 1) + '회: ' + (t.due ? md(t.due) : '') + ' → ' + md(nd),
  }
  await putTodo(n)
  await syncChildren(n)
}

export async function toSomeday(t: Todo) {
  await putTodo({ ...t, due: '', start: '', someday: true, ruleId: manualId(t.ruleId), basis: (t.basis ? t.basis + ' · ' : '') + 'Someday로 이동' })
}

/** 끌어서 정한 순서를 저장 */
export async function setRanks(ids: string[]) {
  for (let i = 0; i < ids.length; i++) {
    const t = S().todos.get(ids[i])
    if (t && t.rank !== i) await putTodo({ ...t, rank: i })
  }
}

/** 직접 정한 순서를 지우고 마감순으로 */
export async function resetRanks(items: Todo[]) {
  for (const t of items) {
    if (t.rank != null) {
      const n = { ...t }
      delete n.rank
      await putTodo(n)
    }
  }
}

/** 완료 시각. 직접 한 체크와 시각이 겹치지 않게 한다 (완료하며 자동으로 체크한 하위 항목은 체크 시각 = 완료 시각) */
const doneStamp = (t: Todo) => {
  let at = nowIso()
  while (Object.values(t.checkAt || {}).includes(at)) at = new Date(Date.parse(at) + 1).toISOString()
  return at
}

/** 완료를 풀 때: 완료하면서 자동으로 체크한 하위 항목만 다시 풀어, 완료 전에 직접 체크해 둔 상태로 되돌린다 */
const reopen = (t: Todo): Todo => {
  const auto = (t.subs || []).filter((x) => !!t.doneAt && t.checkAt?.[x] === t.doneAt)
  const keep = (x: string) => !auto.includes(x)
  return { ...t, done: false, doneAt: null, checks: (t.checks || []).filter(keep), checkAt: keepAt(t.checkAt, (x) => (keep(x) ? x : null)) }
}

export async function toggleDone(t: Todo) {
  await putTodo(t.done ? reopen(t) : { ...t, done: true, doneAt: doneStamp(t) })
}

/** 체크 하나를 켜거나 끈다 (켤 때 시각을 남긴다) */
const setCheck = (t: Todo, name: string, on: boolean): Todo => {
  const cur = t.checks || []
  if (cur.includes(name) === on) return t
  const checkAt = keepAt(t.checkAt, (x) => (x === name ? null : x)) || {}
  if (on) checkAt[name] = nowIso()
  return { ...t, checks: on ? [...cur, name] : cur.filter((x) => x !== name), checkAt }
}

/** 하위 항목을 다 체크하면 할 일도 끝낸 것으로, 끝낸 할 일의 하위 항목을 풀면 다시 연다 */
const settleDone = (t: Todo): Todo => {
  const subs = t.subs || []
  if (!subs.length) return t
  const all = subs.every((x) => t.checks?.includes(x))
  if (all && !t.done) return { ...t, done: true, doneAt: doneStamp(t) }
  if (!all && t.done) return reopen(t)
  return t
}

/** 체크리스트(서명문서·하위 항목) 한 줄 체크·해제. 하위 항목이면 할 일 완료도 따라간다 */
export async function toggleCheck(id: string, name: string) {
  const t = S().todos.get(id)
  if (!t) return
  const n = setCheck(t, name, !(t.checks || []).includes(name))
  await putTodo((t.subs || []).includes(name) ? settleDone(n) : n)
}

/** 묶음 하위 항목 밑 단계 체크: 단계를 다 체크하면 그 하위 항목도 체크, 하나라도 풀면 하위 항목도 푼다 */
export async function toggleStep(id: string, sub: string, step: string, steps: string[]) {
  const t = S().todos.get(id)
  if (!t) return
  const key = (x: string) => sub + DOC_SEP + x
  const n = setCheck(t, key(step), !(t.checks || []).includes(key(step)))
  await putTodo(settleDone(setCheck(n, sub, steps.every((x) => n.checks?.includes(key(x))))))
}

const underSub = (name: string, sub: string) => name === sub || name.startsWith(sub + DOC_SEP)

/** 하위 항목을 고치면 지운 항목의 체크(그 밑 문서 체크 포함)도 같이 지운다 */
export const withSubs = (t: Todo, subs: string[]): Todo => {
  const gone = (t.subs || []).filter((x) => !subs.includes(x))
  const keep = (x: string) => !gone.some((g) => underSub(x, g))
  return { ...t, subs, checks: (t.checks || []).filter(keep), checkAt: keepAt(t.checkAt, (x) => (keep(x) ? x : null)) }
}

export async function addSub(id: string, text: string) {
  const t = S().todos.get(id)
  const v = text.trim()
  if (!t || !v || (t.subs || []).includes(v)) return
  await putTodo(withSubs(t, [...(t.subs || []), v]))
}

/** 하위 항목 글자 고치기: 체크도 따라가고, 비우면 지운다. 이미 있는 이름으로는 바꾸지 않는다 */
export async function renameSub(id: string, from: string, to: string) {
  const t = S().todos.get(id)
  const v = to.trim()
  const cur = t?.subs || []
  if (!t || v === from || cur.includes(v)) return
  if (!v) return putTodo(withSubs(t, cur.filter((x) => x !== from)))
  const ren = (x: string) => (underSub(x, from) ? v + x.slice(from.length) : x)
  await putTodo({ ...t, subs: cur.map(ren), checks: (t.checks || []).map(ren), checkAt: keepAt(t.checkAt, ren) })
}

/* ---------- 설정 ---------- */

export interface ProjectDraft {
  /** 저장 전 이름 (새 과제면 "") — 이름이 바뀌면 외근·할 일·규칙에 반영한다 */
  orig: string
  name: string
  short: string
  /** 한 줄에 하나 */
  sites: string
  /** 쉼표로 구분 */
  aliases: string
}

/** 과제 목록 저장. 결과 안내 문구를 돌려준다 (이름이 겹치면 저장하지 않음) */
export async function saveProjects(drafts: ProjectDraft[]): Promise<{ ok: boolean; message: string }> {
  const clean = drafts
    .map((p) => ({
      orig: p.orig,
      name: p.name.trim(),
      short: (p.short || '').trim() || p.name.trim(),
      sites: String(p.sites || '').split(/[\n,，]/).map((x) => x.trim()).filter(Boolean),
      aliases: (p.aliases || '').split(/[,，]/).map((x) => x.trim()).filter(Boolean),
    }))
    .filter((p) => p.name)
  const names = clean.map((p) => p.name)
  if (new Set(names).size !== names.length) return { ok: false, message: '같은 이름의 과제가 두 개 있습니다. 이름을 다르게 해 주세요.' }
  const renames = clean.filter((p) => p.orig && p.orig !== p.name)
  let rules = S().rules
  for (const rn of renames) rules = rules.map((r) => (r.project === rn.orig ? { ...r, project: rn.name } : r))
  appStore.setState({ projects: clean.map((p) => ({ name: p.name, short: p.short, sites: p.sites, aliases: p.aliases })), rules })
  await putConfig()
  for (const rn of renames) {
    for (const e of [...S().events.values()].filter((e) => e.project === rn.orig)) {
      const n = { ...e, project: rn.name }
      n.genKey = genKey(n, S())
      await putEvent(n)
    }
    for (const t of [...S().todos.values()].filter((t) => t.project === rn.orig)) await putTodo({ ...t, project: rn.name })
  }
  return { ok: true, message: '저장했습니다 (' + clean.length + '개 과제)' + (renames.length ? ' · 이름 변경 ' + renames.length + '건 반영' : '') + '.' }
}

export async function saveCompanions(list: { project: string; keyword: string; items: string }[]) {
  appStore.setState({
    companions: list
      .map((c) => ({ project: c.project, keyword: c.keyword.trim(), items: c.items.split(/[,，]/).map((x) => x.trim()).filter(Boolean) }))
      .filter((c) => c.keyword && c.items.length),
  })
  await putConfig()
}

/** 규칙 저장 후 기존 외근의 미완료 자동 할 일에도 반영 */
export async function saveRules(rules: Rule[]) {
  appStore.setState({ rules: rules.map((r) => ({ ...r })) })
  await putConfig()
  await syncAll(false)
}

/** "YYYY-MM-DD 이름" 줄들을 공휴일로 저장하고 자동 할 일 기한을 다시 계산한다. 저장한 날 수를 돌려준다 */
export async function saveHolidays(text: string) {
  const h: Record<string, string> = {}
  text.split('\n').forEach((l) => {
    const m = l.trim().match(/^(\d{4}-\d{2}-\d{2})\s*(.*)$/)
    if (m) h[m[1]] = m[2] || '휴일'
  })
  appStore.setState({ holidays: h })
  await putConfig()
  await syncAll(true)
  return Object.keys(h).length
}

export async function saveNotes(notes: Notes) {
  appStore.setState({ notes })
  await putConfig()
}

/* ---------- FUL 메모 ---------- */

export async function addFul(f: Omit<Ful, 'id'>) {
  await putFul(f)
  await applyFulsAll()
}

export async function updateFul(f: Ful, patch: Partial<Ful>) {
  await putFul({ ...f, ...patch })
  await applyFulsAll()
}

/* ---------- 불러오기 ---------- */

/** 설정을 상태로. 원본처럼 규칙을 정규화하고 비어 있는 항목은 기본값을 쓴다 */
function configState(c: Config | null) {
  const def = defaultConfig()
  return {
    rules: (c?.rules ?? def.rules).map(normRule),
    projects: c?.projects?.length ? c.projects.map((p) => ({ ...p, sites: [...(p.sites || [])] })) : def.projects,
    companions: (c?.companions ?? def.companions).map((x) => ({ ...x, items: [...(x.items || [])] })),
    holidays: c?.holidays ? { ...c.holidays } : def.holidays,
    notes: c?.notes ?? null,
    mig: c?.mig ? [...c.mig] : [],
  }
}

/** 저장소의 데이터를 상태로 */
export function applySnapshot(snap: Snapshot) {
  appStore.setState({
    events: new Map(snap.events.map((e) => [e.id, e])),
    todos: new Map(snap.todos.map((t) => [t.id, t])),
    fuls: new Map(snap.fuls.map((f) => [f.id, f])),
    ...configState(snap.config),
    loading: false,
  })
}

/** 다른 기기·탭에서 온 변경을 상태에 반영한다 (저장소에는 다시 쓰지 않는다) */
export function applyRemote(c: RemoteChange) {
  if (c.table === 'settings') appStore.setState(configState(c.config))
  else if (c.type === 'delete') (c.table === 'events' ? removeEvent : c.table === 'todos' ? removeTodo : removeFul)(c.id)
  else if (c.table === 'events') setEvent(c.doc)
  else if (c.table === 'todos') setTodo(c.doc)
  else setFul(c.doc)
}

/** 연결이 끊긴 사이 놓친 변경을 맞춘다. 아직 보내지 못한 내 변경(있음·지움)은 그대로 둔다 */
export async function resync() {
  let snap: Snapshot
  try {
    snap = await repo.load()
  } catch {
    return
  }
  const pending = (t: DocTable | 'settings', id: string) => repo.isPending?.(t, id) ?? false
  const merge = <T extends { id: string }>(table: DocTable, local: Map<string, T>, remote: T[]) => {
    const m = new Map<string, T>()
    for (const d of remote) if (!pending(table, d.id)) m.set(d.id, d)
    for (const [id, d] of local) if (pending(table, id)) m.set(id, d)
    return m
  }
  const s = S()
  appStore.setState({
    events: merge('events', s.events, snap.events),
    todos: merge('todos', s.todos, snap.todos),
    fuls: merge('fuls', s.fuls, snap.fuls),
    ...(pending('settings', '') ? {} : configState(snap.config)),
  })
}

/** 한 번만 실행하는 데이터 보정 */
async function migrate() {
  if (!S().mig.includes('scan1')) {
    /* 방문 다음 영업일 서명문서 스캔 규칙을 저장된 규칙에 추가 (나중에 지우면 다시 넣지 않는다) */
    const s = S()
    const rules = s.rules.some((r) => r.id === 'r-scan') ? s.rules : [normRule(SCAN_RULE), ...s.rules]
    appStore.setState({ rules, mig: [...s.mig, 'scan1'] })
    await putConfig()
  }
  if (!S().mig.includes('prep1')) {
    /* 서명문서 준비·인쇄 규칙 추가. 마감이 지난 외근에는 syncEvent 가 새로 만들지 않는다 */
    const s = S()
    const have = new Set(s.rules.map((r) => r.id))
    const rules = [...s.rules, ...PREP_RULES.filter((r) => !have.has(r.id)).map(normRule)]
    appStore.setState({ rules, mig: [...s.mig, 'prep1'] })
    await putConfig()
  }
  if (!S().mig.includes('ful5')) {
    /* Follow-up Letter: 방문 후 WD5 마감(보내는 일로 당기지 않음), 착수는 마감 2영업일 전. 미완료 자동 할 일은 이어지는 syncAll 이 맞춘다 */
    const s = S()
    const ful = { dir: 'after', n: 5, unit: 'WD', send: false, start: 'lead', startN: 2, basis: '방문 후 WD5 송부 (PMP: WD5 이내)' } as const
    appStore.setState({ rules: s.rules.map((r) => (r.id === 'r-ful' ? { ...r, ...ful } : r)), mig: [...s.mig, 'ful5'] })
    await putConfig()
  }
  if (!S().mig.includes('isf1')) {
    /* Imjudo MV 후 ISF checklist 규칙 추가. 마감이 지난 외근에는 syncEvent 가 새로 만들지 않는다 */
    const s = S()
    const rules = s.rules.some((r) => r.id === ISF_RULE.id) ? s.rules : [...s.rules, normRule(ISF_RULE)]
    appStore.setState({ rules, mig: [...s.mig, 'isf1'] })
    await putConfig()
  }
  if (!S().mig.includes('etmf10')) {
    /* eTMF 업로드: PMP 는 30일 내지만 Approve 기간을 두고 방문 후 WD10 마감, 착수는 방문 다음 영업일 */
    const s = S()
    const etmf = { dir: 'after', n: 10, unit: 'WD', start: 'fresh', startN: 0 } as const
    const why = ' · 본인 기준: Approve 기간 고려해 방문 후 WD10'
    const rules = s.rules.map((r) => (r.key === 'ETMF' ? { ...r, ...etmf, basis: (r.basis || '').replace(why, '') + why } : r))
    appStore.setState({ rules, mig: [...s.mig, 'etmf10'] })
    await putConfig()
  }
  if (!S().mig.includes('brzss1')) {
    /* Breztri 업무 노트 PSV 서명 문서에 Study Summary 추가 (이미 있으면 그대로) */
    const s = S()
    const secs = s.notes?.[BRZ]
    const add = (x: NoteSection) =>
      x.v.trim().toUpperCase() !== 'PSV' || (x.docs || []).some((d) => /study\s*summary/i.test(d.t)) ? x : { ...x, docs: [...(x.docs || []), { t: 'Study Summary', w: '' }] }
    const notes = s.notes && secs ? { ...s.notes, [BRZ]: secs.map(add) } : s.notes
    appStore.setState({ notes, mig: [...s.mig, 'brzss1'] })
    await putConfig()
  }
  if (!S().mig.includes('fulpack1')) {
    /* PSV·SIV·MV 는 리포트 작성 대신 "FUL" 할 일 하나에 하위 항목으로 (기한은 리포트 작성 규칙 그대로).
       미완료 자동 할 일은 이어지는 syncAll 이 바꾼다 */
    const s = S()
    /* 리포트 작성 규칙을 지워 두었으면 그대로 */
    const rpt = s.rules.find((r) => r.id === 'r-rpt')
    const have = new Set(s.rules.map((r) => r.id))
    const rules = rpt
      ? [...s.rules.map((r) => (r === rpt && !normRule(r).key ? { ...r, key: 'OWN' } : r)), ...fulPackRules(rpt).filter((r) => !have.has(r.id))]
      : s.rules
    appStore.setState({ rules, mig: [...s.mig, 'fulpack1'] })
    await putConfig()
  }
  if (!S().mig.includes('fulpack2')) {
    /* 결재 상신은 리포트 결재 상신(PSVR·SIVR), MV 도 맨 끝에 MVR 결재 상신. FUL 규칙과 열린 FUL 할 일 모두 (체크도 따라감) */
    const rename: Record<string, string> = { 'PSV 결재상신': 'PSVR 결재 상신', 'SIV 결재 상신': 'SIVR 결재 상신' }
    const fix = (type: string, subs: string[]) => {
      const n = subs.map((x) => rename[x] ?? x)
      return type === 'MV' && !n.includes('MVR 결재 상신') ? [...n, 'MVR 결재 상신'] : n
    }
    const typeOf = (ruleId?: string | null) => /^r-rpt-(psv|siv|mv)\b/.exec(ruleId || '')?.[1].toUpperCase()
    const s = S()
    const rules = s.rules.map((r) => (typeOf(r.id) && r.subs ? { ...r, subs: fix(r.type, r.subs) } : r))
    for (const t of [...s.todos.values()]) {
      const type = typeOf(t.ruleId)
      if (!type || t.done || !t.subs?.length) continue
      const subs = fix(type, t.subs)
      if (subs.join('\n') !== t.subs.join('\n')) await putTodo({ ...t, subs, checks: (t.checks || []).map((x) => rename[x] ?? x) })
    }
    appStore.setState({ rules, mig: [...S().mig, 'fulpack2'] })
    await putConfig()
  }
  if (!S().mig.includes('fulpack3')) {
    /* MV FUL 에 ISF Checklist 첨부(Pre checklist 다음)·ICF Tracking Log(Discrepancy List 앞)를 더하고, MV 당일 "현장에서 써 올 것" 규칙 추가.
       이미 비슷한 항목이 있으면 그대로. FUL 규칙과 열린 MV FUL 할 일 모두 */
    /* at 항목 앞(before)이나 뒤에. 그 항목이 없으면 결재 상신 앞, 그것도 없으면 맨 끝 */
    const ins = (list: string[], item: string, has: RegExp, at: RegExp, before: boolean) => {
      if (list.some((x) => has.test(x))) return list
      let j = list.findIndex((x) => at.test(x))
      if (j >= 0 && !before) j++
      if (j < 0) j = list.findIndex((x) => /결재/.test(x))
      if (j < 0) j = list.length
      return [...list.slice(0, j), item, ...list.slice(j)]
    }
    const fix = (subs: string[]) =>
      ins(ins(subs, 'ISF Checklist 첨부', /isf/i, /pre[\s-]*check\s*list/i, false), 'ICF Tracking Log', /icf/i, /discrepancy/i, true)
    const s = S()
    const rules = s.rules.map((r) => (r.id === 'r-rpt-mv' && r.subs ? { ...r, subs: fix(r.subs) } : r))
    if (!rules.some((r) => r.id === MV_SITE_RULE.id)) rules.push(normRule(MV_SITE_RULE))
    for (const t of [...s.todos.values()]) {
      if (t.ruleId !== 'r-rpt-mv' || t.done || !t.subs?.length) continue
      const subs = fix(t.subs)
      if (subs.join('\n') !== t.subs.join('\n')) await putTodo({ ...t, subs })
    }
    appStore.setState({ rules, mig: [...S().mig, 'fulpack3'] })
    await putConfig()
  }
  if (!S().mig.includes('imjmv1')) {
    /* Imjudo 업무 노트 MV: Pre-Checklist 단계 앞에 방문 전 할 일 셋, Pre-Checklist 에 ISF Checklist 작성·상신,
       MV 진행에 현장에서 써 올 ICF Tracking Log·Discrepancy List (EMR 단계가 이미 있으면 그대로) */
    const before = ['EMR ID 발급', '모니터링룸 예약', 'EDC 입력 현황 파악하여 Query 작성'].map((t) => ({ t, w: '방문 전' }))
    const fixItem = (i: NoteItem): NoteItem =>
      /pre-?\s*checklist/i.test(i.t) && !/isf/i.test(i.t)
        ? { ...i, t: i.t.replace(/(pre-?\s*checklist)\s*작성/i, '$1 · ISF Checklist 작성 및 상신') }
        : /MV\s*진행/.test(i.t) && !/icf/i.test(i.t)
          ? { ...i, t: i.t + ' · ICF Tracking Log · Discrepancy List 작성' }
          : i
    const fix = (x: NoteSection): NoteSection => {
      if (x.v.trim().toUpperCase() !== 'MV' || x.items.some((i) => /EMR/i.test(i.t))) return x
      const items = x.items.map(fixItem)
      const j = Math.max(0, items.findIndex((i) => /pre-?\s*checklist/i.test(i.t)))
      return { ...x, items: [...items.slice(0, j), ...before, ...items.slice(j)] }
    }
    const s = S()
    const secs = s.notes?.[IMJ]
    const notes = s.notes && secs ? { ...s.notes, [IMJ]: secs.map(fix) } : s.notes
    appStore.setState({ notes, mig: [...s.mig, 'imjmv1'] })
    await putConfig()
  }
  if (!S().mig.includes('brzful1')) {
    /* Breztri PSV FUL: 실제 결재 상신 순서의 하위 항목과 상신 제목 (기한은 PSV FUL 규칙 그대로, 지워 두었으면 그대로).
       열린 Breztri PSV FUL 할 일은 새 규칙의 할 일로 옮긴다: 체크·메모 그대로, 직접 단 하위 항목은 결재 상신 앞에 */
    const s = S()
    const psv = s.rules.find((r) => r.id === 'r-rpt-psv')
    let rules = s.rules
    if (psv && !rules.some((r) => r.id === BRZ_PSV_FUL.id)) {
      const i = rules.indexOf(psv) + 1
      rules = [...rules.slice(0, i), brzPsvFulRule(psv), ...rules.slice(i)]
      const known = new Set([...(psv.subs || []), ...BRZ_PSV_FUL.subs])
      for (const t of [...s.todos.values()]) {
        if (t.ruleId !== psv.id || t.project !== BRZ || t.done || !t.eventId) continue
        const own = (t.subs || []).filter((x) => !known.has(x))
        const subs = [...BRZ_PSV_FUL.subs.slice(0, -1), ...own, ...BRZ_PSV_FUL.subs.slice(-1)]
        await putTodo({ ...t, id: safeId('a_' + t.eventId + '_' + BRZ_PSV_FUL.id), ruleId: BRZ_PSV_FUL.id, subs })
        await deleteTodo(t.id)
      }
    }
    appStore.setState({ rules, mig: [...S().mig, 'brzful1'] })
    await putConfig()
  }
  if (!S().mig.includes('rptfix1')) {
    /* 이미 끝낸 할 일의 하위 항목도 모두 체크. 이번 주(10/26~)에 끝낸 리포트 FUL 은 리포트 수정·T-Sign 할 일을 지금 만든다 */
    for (const t of [...S().todos.values()]) {
      if (!t.done) continue
      const c = checkAllSubs(t)
      if (c !== t) await putTodo(c)
      if (localDay(t.doneAt) >= '2026-10-26') await followUpsOnDone(c, 'rpt-fix')
    }
    appStore.setState({ mig: [...S().mig, 'rptfix1'] })
    await putConfig()
  }
  if (!S().mig.includes('rptfix2')) {
    /* 리포트 R FUL 마감을 PM 마감(방문 후 WD10)으로. 이미 만든 열린 R FUL 도 옮긴다 (직접 날짜를 바꾼 것은 그대로) */
    for (const t of [...S().todos.values()]) if (t.done) await followUpsRedate(t)
    appStore.setState({ mig: [...S().mig, 'rptfix2'] })
    await putConfig()
  }
  if (!S().mig.includes('sivrsend1')) {
    /* Imjudo SIVR 송부: 이 기능이 생기기 전 오늘(10/28) 끝낸 SIVR FUL 에도 만든다 */
    for (const t of [...S().todos.values()]) if (t.done && localDay(t.doneAt) >= '2026-10-28') await followUpsOnDone(t, 'sivr-send')
    appStore.setState({ mig: [...S().mig, 'sivrsend1'] })
    await putConfig()
  }
  if (!S().mig.includes('chkat1')) {
    /* 체크한 시각은 이제부터 남는다. 오늘 만든 할 일의 체크는 오늘 한 것이라 시각 없이 날짜만 남긴다 */
    const today = todayStr()
    for (const t of [...S().todos.values()]) {
      if (t.done || t.checkAt || !t.checks?.length || localDay(t.created) !== today) continue
      await putTodo({ ...t, checkAt: Object.fromEntries(t.checks.map((x) => [x, today])) })
    }
    appStore.setState({ mig: [...S().mig, 'chkat1'] })
    await putConfig()
  }
  if (!S().mig.includes('enflunch1')) {
    /* 엔플론시아 SIV 는 도시락 예약이 필요 없다: 꺼 둔 엔플론시아 규칙으로 덮어써, 열린 도시락 예약 할 일은 다음 맞추기에서 지워진다 */
    const s = S()
    const lunch = s.rules.find((r) => r.key === 'LUNCH' && r.project === '*')
    let rules = s.rules
    if (lunch && !rules.some((r) => r.key === 'LUNCH' && r.project === ENF)) {
      const i = rules.indexOf(lunch) + 1
      const off: Rule = { ...lunch, id: 'r-e-lunch', project: ENF, off: true, basis: '엔플론시아는 SIV 도시락 예약 필요 없음' }
      rules = [...rules.slice(0, i), off, ...rules.slice(i)]
    }
    appStore.setState({ rules, mig: [...s.mig, 'enflunch1'] })
    await putConfig()
  }
  if (!S().mig.includes('wid1')) {
    /* 외근 등록하면 WID 외근 일정 등록 (앞으로 등록하는 외근부터) */
    const s = S()
    const rules = s.rules.some((r) => r.id === WID_RULE.id) ? s.rules : [...s.rules, { ...WID_RULE }]
    /* 엔플론시아는 SIV 도시락 예약이 필요 없어 업무 노트에서도 뺀다 */
    const secs = s.notes?.[ENF]
    const notes = s.notes && secs ? { ...s.notes, [ENF]: secs.map((x) => ({ ...x, items: x.items.filter((it) => it.t.trim() !== '도시락 예약') })) } : s.notes
    appStore.setState({ rules, notes, mig: [...s.mig, 'wid1'] })
    await putConfig()
  }
  if (!S().mig.includes('sivrprint1')) {
    /* SIVR 인쇄 FUL 메모: 이 기능이 생기기 전에 끝낸 SIVR 송부에도 남긴다 */
    for (const t of [...S().todos.values()]) if (t.done && localDay(t.doneAt) >= '2026-10-28') await fulsOnDone(t, 'sivr-print')
    appStore.setState({ mig: [...S().mig, 'sivrprint1'] })
    await putConfig()
  }
  /* 규칙을 고쳐도 이미 맞춘 외근은 다시 맞추지 않는다 (열린 할 일의 날짜·제목을 직접 바꾼 것이 되돌아가지 않게) */
  const inSync = () => new Set([...S().events.values()].filter((e) => e.genKey === genKey(e, S())).map((e) => e.id))
  const keepSynced = async (fresh: Set<string>) => {
    for (const e of [...S().events.values()]) if (fresh.has(e.id) && e.genKey !== genKey(e, S())) await putEvent({ ...e, genKey: genKey(e, S()) })
  }
  if (!S().mig.includes('presiv1')) {
    /* SIV Pre-Checklist 규칙을 짧은 제목·하위 항목으로 (엔플론시아는 결재 상신이라 그대로).
       열린 할 일은 제목만 바꾸고 하위 항목은 없을 때만 단다 */
    const s = S()
    const fresh = inSync()
    const hit = (r: Rule) => r.type === 'SIV' && r.project !== ENF && /pre-?\s*check\s*list/i.test(r.title)
    const ids = new Set(s.rules.filter(hit).map((r) => r.id))
    appStore.setState({ rules: s.rules.map((r) => (hit(r) ? { ...r, title: PRE_SIV.title, subs: [...PRE_SIV.subs] } : r)) })
    for (const t of [...S().todos.values()]) {
      const ev = t.eventId ? S().events.get(t.eventId) : undefined
      if (t.done || !ev || !ids.has(t.ruleId || '')) continue
      const p = planTodos(ev, S()).find((x) => x.ruleId === t.ruleId)
      if (p) await putTodo({ ...t, title: p.title, subs: t.subs?.length ? t.subs : p.subs })
    }
    await keepSynced(fresh)
    appStore.setState({ mig: [...S().mig, 'presiv1'] })
    await putConfig()
  }
  if (!S().mig.includes('enfss1')) {
    /* 엔플론시아 SIV 를 등록하면 제일 먼저 계약서·ICF Site specific 업데이트 (앞으로 등록하는 외근부터). 규칙 목록에서는 엔플론시아 CL 앞에 */
    const fresh = inSync()
    let rules = S().rules
    const add = ENF_SS_RULES.filter((r) => !rules.some((x) => x.id === r.id)).map((r) => ({ ...r }))
    if (add.length) {
      const i = rules.findIndex((r) => r.project === ENF && r.key === 'CL')
      rules = i < 0 ? [...rules, ...add] : [...rules.slice(0, i), ...add, ...rules.slice(i)]
    }
    appStore.setState({ rules })
    await keepSynced(fresh)
    appStore.setState({ mig: [...S().mig, 'enfss1'] })
    await putConfig()
  }
  if (!S().mig.includes('group1')) {
    /* 방문 전 일은 "{type} Preparation", 방문 후 자잘한 일은 "{type} 방문 후 정리" 하나로 묶는다 (엔플론시아 계약서·ICF 는 등록 당일, 맨 위).
       열린 낱개 할 일은 묶음의 하위 항목으로 옮기고(메모는 묶음 메모에), 끝낸 것은 체크해 둔다.
       지난 외근은 열린 일이 있을 때만, 다가오는 외근은 아직 없는 일도 넣는다 ("외근 등록한 날 착수" 일은 빼고).
       아직 한 번도 맞추지 않은 외근은 맞출 때 묶음이 생긴다 */
    const fresh = inSync()
    const ss = new Map(ENF_SS_RULES.map((r) => [r.id, r]))
    appStore.setState({ rules: S().rules.map((r) => (ss.has(r.id) ? { ...r, n: ss.get(r.id)!.n, basis: ss.get(r.id)!.basis } : r)) })
    for (const ev of [...S().events.values()]) if (kindOf(ev) === 'visit' && ev.genKey) await syncBundles(ev)
    await keepSynced(fresh)
    appStore.setState({ mig: [...S().mig, 'group1'] })
    await putConfig()
  }
  if (!S().mig.includes('group2')) {
    /* 서명문서·eTMF 할 일도 묶음에 (문서 체크 목록은 묶음에서 펼쳐 본다). 열린 낱개 할 일은 문서 체크째 묶음으로 옮긴다 */
    for (const ev of [...S().events.values()]) if (kindOf(ev) === 'visit' && ev.genKey) await syncBundles(ev)
    appStore.setState({ mig: [...S().mig, 'group2'] })
    await putConfig()
  }
  if (!S().mig.includes('docs1')) {
    /* 묶음의 문서 체크를 그 하위 항목 밑으로: 서명문서는 첫 서명문서 일, eTMF 문서는 마지막 eTMF 일 밑 */
    for (const t of [...S().todos.values()]) {
      if (!isGroupRule(t.ruleId) || !t.checks?.length) continue
      const subs = t.subs || []
      const sign = subs.find((x) => SIGN_RE.test(x))
      const etmf = [...subs].reverse().find((x) => ETMF_RE.test(x))
      const ren = (x: string) => {
        if (subs.includes(x) || x.includes(DOC_SEP)) return x
        const to = x.startsWith('eTMF:') ? etmf : sign
        return to ? to + DOC_SEP + x : x
      }
      const checks = t.checks.map(ren)
      if (checks.some((x, i) => x !== t.checks![i])) await putTodo({ ...t, checks, checkAt: keepAt(t.checkAt, ren) })
    }
    appStore.setState({ mig: [...S().mig, 'docs1'] })
    await putConfig()
  }
  if (!S().mig.includes('enfbeta1')) {
    /* 엔플론시아는 Beta site 예시 Case 작성이 필요 없다: 규칙을 지우고, 열린 묶음의 하위 항목과 업무 노트에서도 뺀다 */
    const fresh = inSync()
    const beta = /beta\s*site/i
    const s = S()
    const secs = s.notes?.[ENF]
    const cut = (t: string) => t.replace(/\s*beta\s*site[^·]*(·\s*|$)/i, '').trim()
    const notes = s.notes && secs
      ? { ...s.notes, [ENF]: secs.map((x) => ({ ...x, items: x.items.map((it) => ({ ...it, t: cut(it.t) })).filter((it) => it.t) })) }
      : s.notes
    appStore.setState({ rules: s.rules.filter((r) => !(r.project === ENF && beta.test(r.title))), notes })
    for (const t of [...S().todos.values()]) {
      if (t.done || t.project !== ENF || !isGroupRule(t.ruleId) || !t.subs?.some((x) => beta.test(x))) continue
      await putTodo(withSubs(t, t.subs.filter((x) => !beta.test(x))))
    }
    await keepSynced(fresh)
    appStore.setState({ mig: [...S().mig, 'enfbeta1'] })
    await putConfig()
  }
  if (!S().mig.includes('ktx1')) {
    /* 지방 기관 외근을 등록하면 KTX 예매 (앞으로 등록하는 외근부터, WID 규칙 다음에) */
    const fresh = inSync()
    const s = S()
    let rules = s.rules
    if (!rules.some((r) => r.id === KTX_RULE.id)) {
      const i = rules.findIndex((r) => r.id === WID_RULE.id)
      rules = i < 0 ? [...rules, { ...KTX_RULE }] : [...rules.slice(0, i + 1), { ...KTX_RULE }, ...rules.slice(i + 1)]
    }
    appStore.setState({ rules })
    await keepSynced(fresh)
    appStore.setState({ mig: [...S().mig, 'ktx1'] })
    await putConfig()
  }
  if (!S().mig.includes('ktx2')) {
    /* 이미 등록한 지방 외근도 오늘 이후 것은 Preparation 에 KTX 예매를 제자리(날짜 순)에 넣는다 */
    const today = todayStr()
    for (const ev of [...S().events.values()]) {
      if (kindOf(ev) !== 'visit' || ev.date < today) continue
      const p = planTodos(ev, S()).find((x) => x.ruleId === GROUPS.prep.id)
      const old = p && S().todos.get(safeId('a_' + ev.id + '_' + p.ruleId))
      const ktx = p?.parts?.find((x) => x.ruleId === KTX_RULE.id)
      if (!p || !old || old.done || !ktx || old.subs?.includes(ktx.sub)) continue
      const cur = { subs: old.subs || [], checks: old.checks || [], checkAt: old.checkAt || {}, note: old.note || '' }
      const b = mergeBundle(cur, (p.parts || []).filter((x) => x === ktx || cur.subs.includes(x.sub)), [])
      await putTodo({ ...old, subs: b.subs })
    }
    appStore.setState({ mig: [...S().mig, 'ktx2'] })
    await putConfig()
  }
  if (!S().mig.includes('etmfsolo1')) {
    /* 서명문서 eTMF 업로드는 다시 따로: 방문 후 정리에 들어간 것을 낱개 할 일로 되돌린다 (끝냈으면 끝낸 채로, 문서 체크째) */
    for (const ev of [...S().events.values()]) {
      const id = safeId('a_' + ev.id + '_' + GROUPS.post.id)
      if (kindOf(ev) !== 'visit' || !S().todos.get(id)?.subs?.length) continue
      for (const r of rulesFor(ev, S().rules).filter((x) => x.key === 'ETMF')) {
        const b = S().todos.get(id)!
        const label = subLabel(ev, r.title, S().projects)
        if (!b.subs?.includes(label)) continue
        const pre = label + DOC_SEP
        const own = (k: string) => (k.startsWith(pre) ? k.slice(pre.length) : null)
        const tid = safeId('a_' + ev.id + '_' + r.id)
        const p = planTodos(ev, S()).find((x) => x.ruleId === r.id)
        if (p && !S().todos.has(tid)) {
          const done = !!b.done || !!b.checks?.includes(label)
          await putTodo({
            id: tid, title: p.title, due: p.due, time: p.time || '', basis: p.basis, start: p.start, startBasis: p.startBasis, ruleId: r.id, verify: p.verify,
            eventId: ev.id, project: ev.project || '', done, doneAt: done ? b.checkAt?.[label] || b.doneAt || nowIso() : null,
            checks: (b.checks || []).map(own).filter((x): x is string => x != null), checkAt: keepAt(b.checkAt, own), created: nowIso(),
          })
        }
        await putTodo(withSubs(b, b.subs.filter((x) => x !== label)))
      }
    }
    appStore.setState({ mig: [...S().mig, 'etmfsolo1'] })
    await putConfig()
  }
  if (!S().mig.includes('scant1')) {
    /* Tarlatamab SIV 는 eTMF 업로드가 따로 있으니 "서명문서 스캔"만. 열린 방문 후 정리의 하위 항목 이름도 바꾼다 (체크·문서 체크는 따라간다) */
    const fresh = inSync()
    const base = S().rules.find((r) => r.id === SCAN_RULE.id) ?? SCAN_RULE
    let rules = S().rules
    if (!rules.some((r) => r.id === TARL_SIV_SCAN.id)) {
      const i = rules.indexOf(base)
      const add = { ...base, ...TARL_SIV_SCAN }
      rules = i < 0 ? [...rules, add] : [...rules.slice(0, i + 1), add, ...rules.slice(i + 1)]
    }
    appStore.setState({ rules })
    for (const ev of [...S().events.values()]) {
      if (kindOf(ev) !== 'visit' || ev.project !== TARL_SIV_SCAN.project || ev.type !== TARL_SIV_SCAN.type) continue
      const b = S().todos.get(safeId('a_' + ev.id + '_' + GROUPS.post.id))
      const from = subLabel(ev, base.title, S().projects)
      if (b && !b.done && b.subs?.includes(from)) await renameSub(b.id, from, subLabel(ev, TARL_SIV_SCAN.title, S().projects))
    }
    await keepSynced(fresh)
    appStore.setState({ mig: [...S().mig, 'scant1'] })
    await putConfig()
  }
  if (!S().mig.includes('enfsteps1')) {
    /* 엔플론시아 계약서·ICF Site specific 업데이트에 단계 (Preparation 에서 그 항목 밑에 보인다).
       오늘 이후 엔플론시아 SIV 의 열린 Preparation 에 없으면 맨 위(날짜 순 자리)에 넣는다 */
    const fresh = inSync()
    const ss = new Map(ENF_SS_RULES.map((r) => [r.id, r]))
    appStore.setState({ rules: S().rules.map((r) => (ss.has(r.id) ? { ...r, steps: [...(ss.get(r.id)!.steps || [])] } : r)) })
    const today = todayStr()
    for (const ev of [...S().events.values()]) {
      if (kindOf(ev) !== 'visit' || ev.project !== ENF || ev.type !== 'SIV' || ev.date < today) continue
      if (ev.skip?.some((x) => ss.has(x))) await putEvent({ ...ev, skip: ev.skip.filter((x) => !ss.has(x)) })
      const p = planTodos(S().events.get(ev.id)!, S()).find((x) => x.ruleId === GROUPS.prep.id)
      const old = p && S().todos.get(safeId('a_' + ev.id + '_' + p.ruleId))
      const add = (p?.parts || []).filter((x) => ss.has(x.ruleId) && !old?.subs?.includes(x.sub))
      if (!p || !old || old.done || !add.length) continue
      const cur = { subs: old.subs || [], checks: old.checks || [], checkAt: old.checkAt || {}, note: old.note || '' }
      const b = mergeBundle(cur, (p.parts || []).filter((x) => add.includes(x) || cur.subs.includes(x.sub)), [])
      await putTodo({ ...old, subs: b.subs })
    }
    await keepSynced(fresh)
    appStore.setState({ mig: [...S().mig, 'enfsteps1'] })
    await putConfig()
  }
  if (!S().mig.includes('subdone1')) {
    /* 하위 항목을 다 체크한 열린 묶음은 끝낸 것으로 (끝낸 시각은 마지막 체크) */
    for (const t of [...S().todos.values()]) {
      if (t.done || !isGroupRule(t.ruleId) || !t.subs?.length || !t.subs.every((x) => t.checks?.includes(x))) continue
      const last = t.subs.map((x) => t.checkAt?.[x] || '').sort().at(-1)
      await putTodo({ ...t, done: true, doneAt: last && last.length > 10 ? last : last ? last + 'T09:00:00+09:00' : nowIso() })
    }
    appStore.setState({ mig: [...S().mig, 'subdone1'] })
    await putConfig()
  }
  if (!S().mig.includes('enfprep2')) {
    /* 엔플론시아 SIV Preparation 에 PPT·서명서류 Site specific 업데이트·바인더 제작 요청도 늘 넣는다 (꺼 둔 덮어쓰기 규칙을 지운다).
       오늘 이후 엔플론시아 SIV 의 열린 Preparation 에 없으면 날짜 순 자리에 넣고, 같은 일을 따로 만들어 둔 열린 할 일과
       "SIV 예정"으로 만든 준비 할 일은 그 Preparation 으로 합친다 */
    const fresh = inSync()
    const keys = ['SSPPT', 'SSSIGN', 'BINDER']
    appStore.setState({ rules: S().rules.filter((r) => !(r.project === ENF && r.off && keys.includes(r.key || ''))) })
    const today = todayStr()
    for (const ev of [...S().events.values()]) {
      if (kindOf(ev) !== 'visit' || ev.project !== ENF || ev.type !== 'SIV' || ev.date < today || !ev.genKey) continue
      const p = planTodos(ev, S()).find((x) => x.ruleId === GROUPS.prep.id)
      const old = p && S().todos.get(safeId('a_' + ev.id + '_' + p.ruleId))
      if (!p || !old || old.done) continue
      const ids = new Set(rulesFor(ev, S().rules).filter((r) => keys.includes(r.key || '')).map((r) => r.id))
      const add = (p.parts || []).filter((x) => ids.has(x.ruleId) && !old.subs?.includes(x.sub))
      const cur = { subs: old.subs || [], checks: old.checks || [], checkAt: old.checkAt || {}, note: old.note || '' }
      const b = mergeBundle(cur, (p.parts || []).filter((x) => add.includes(x) || cur.subs.includes(x.sub)), [])
      /* 같은 일을 따로 만들어 둔 열린 할 일 (예: "엔플론시아 SC제일산부인과 SIV 바인더 제작 요청 …") */
      const site = siteShort(ev.site)
      const twins = [...S().todos.values()].filter(
        (t) => !t.done && !t.eventId && !t.prepKey && t.project === ENF && t.title.includes(site) && add.some((x) => t.title.endsWith(' ' + x.sub)),
      )
      const notes = [b.note, ...twins.filter((t) => t.note?.trim()).map((t) => t.title + ': ' + t.note!.trim())].filter(Boolean)
      await putTodo({ ...old, subs: b.subs, note: notes.join('\n') || undefined })
      for (const t of twins) await deleteTodo(t.id)
      await absorbEnfPrep(S().events.get(ev.id)!)
    }
    await keepSynced(fresh)
    appStore.setState({ mig: [...S().mig, 'enfprep2'] })
    await putConfig()
  }
  if (!S().mig.includes('dedup1')) {
    /* 묶음 하위 항목으로 체크까지 옮겨졌는데 따로 남아 있던 끝낸 낱개 할 일을 지운다 */
    for (const ev of [...S().events.values()]) {
      if (kindOf(ev) !== 'visit' || !ev.genKey) continue
      for (const p of planTodos(ev, S())) if (p.parts) await dropDoneParts(ev, p)
    }
    appStore.setState({ mig: [...S().mig, 'dedup1'] })
    await putConfig()
  }
  if (!S().mig.includes('claim1')) {
    /* 외근 다녀와서 WD3 비용청구 (KTX 예매 다음에). 이미 등록한 외근도 WD3 이 오늘 이후면 방문 후 정리에 들어간다 */
    const s = S()
    let rules = s.rules
    if (!rules.some((r) => r.id === CLAIM_RULE.id)) {
      const i = rules.findIndex((r) => r.id === KTX_RULE.id)
      rules = i < 0 ? [...rules, { ...CLAIM_RULE }] : [...rules.slice(0, i + 1), { ...CLAIM_RULE }, ...rules.slice(i + 1)]
    }
    appStore.setState({ rules, mig: [...s.mig, 'claim1'] })
    await putConfig()
  }
}

/**
 * 이번 달·다음 달의 매월 할 일을 만든다. 달마다 한 번만 만들어 mig 에 남긴다 (지워도 다시 만들지 않는다).
 * id 를 달로 고정해서 두 창이 동시에 만들어도 중복되지 않는다. 이번 달 마감이 이미 지났으면 만들지 않는다
 */
async function syncMonthly() {
  const today = todayStr()
  const months = [today.slice(0, 7), nextMonth(today.slice(0, 7))]
  const made: string[] = []
  for (const month of months) {
    for (const x of MONTHLY) {
      const key = 'monthly:' + x.id + ':' + month
      if (S().mig.includes(key)) continue
      made.push(key)
      const p = monthlyPlan(month, x, S().holidays)
      const id = safeId('m_' + x.id + '_' + month)
      if (p.due < today || S().todos.has(id)) continue
      const subs = x.visits ? visitSubs(month, S().events.values(), S().projects, x) : []
      await putTodo({
        id, title: monthlyTitle(x, month), project: x.project || '', start: p.start, due: p.due, time: '', tbd: false, autoDue: false, done: false,
        basis: p.basis, startBasis: p.startBasis, subs: subs.length ? subs : undefined, created: new Date().toISOString(),
      })
    }
  }
  if (!made.length) return
  appStore.setState({ mig: [...S().mig, ...made] })
  await putConfig()
}

/**
 * 매월 외근 목록 할 일(비용청구)의 하위 항목을 그달 외근에 맞춘다. 새 외근은 방문일 순 자리에 끼우고,
 * 없어진 외근은 체크하지 않았을 때만 뺀다. 직접 단 하위 항목은 그대로. 끝낸 목록에 새 외근이 생기면 다시 연다
 */
async function syncVisitLists() {
  for (const t of [...S().todos.values()]) {
    const l = visitListOf(t.id)
    if (!l) continue
    const want = visitSubs(l.month, S().events.values(), S().projects, l.x)
    /* 이름이 바뀐 외근(예전 날짜 없는 이름·방문일 변경)은 체크째 새 이름으로: 같은 외근 이름이 하나만 비어 있을 때 */
    const ren = new Map<string, string>()
    for (const y of t.subs || []) {
      if (want.includes(y) || !isVisitSub(y)) continue
      const to = want.filter((w) => visitBase(w) === visitBase(y) && !(t.subs || []).includes(w) && ![...ren.values()].includes(w))
      if (to.length === 1) ren.set(y, to[0])
    }
    const rn = (x: string) => {
      const k = [...ren.keys()].find((y) => x === y || x.startsWith(y + DOC_SEP))
      return k ? ren.get(k)! + x.slice(k.length) : x
    }
    const t0 = t.subs?.length ? { ...t, subs: t.subs.map(rn), checks: (t.checks || []).map(rn), checkAt: keepAt(t.checkAt, rn) } : t
    const cur = t.subs || []
    const subs = (t0.subs || []).filter((y) => want.includes(y) || (t0.checks || []).includes(y) || !isVisitSub(y))
    want.forEach((w, k) => {
      if (subs.includes(w)) return
      const prev = want.slice(0, k).reverse().find((y) => subs.includes(y))
      const next = want.slice(k + 1).find((y) => subs.includes(y))
      /* 앞뒤 외근이 없으면 외근 줄 맨 끝 (직접 단 항목 앞) */
      const tail = subs.reduce((at, y, i) => (isVisitSub(y) ? i + 1 : at), 0)
      subs.splice(prev ? subs.indexOf(prev) + 1 : next ? subs.indexOf(next) : tail, 0, w)
    })
    if (subs.length === cur.length && subs.every((y, i) => y === cur[i])) continue
    let n = withSubs(t0, subs)
    if (n.done && subs.some((y) => !n.checks?.includes(y))) n = { ...n, done: false, doneAt: null }
    await putTodo(n)
  }
}

export async function loadAll() {
  unsubscribe?.()
  try {
    applySnapshot(await repo.load())
  } catch (e) {
    appStore.setState({ loading: false, notice: '불러오지 못했습니다: ' + (e instanceof Error ? e.message : String(e)) })
    return
  }
  unsubscribe = repo.subscribe?.({ change: applyRemote, reconnected: () => void resync() }) ?? null
  await migrate()
  await syncAll(false)
  await syncMonthly()
}

/** 구독을 끊는다 (로그아웃) */
export function stopSync() {
  unsubscribe?.()
  unsubscribe = null
}

/** 가져오기: 전체 데이터를 바꾸고 자동 할 일을 맞춘다. 저장소가 거부하면 Error 를 던진다 */
export async function replaceAll(snap: Snapshot) {
  await repo.replaceAll(snap)
  synced.clear()
  applySnapshot(snap)
  await migrate()
  await syncAll(false)
}

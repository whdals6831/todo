import { BRZ, BRZ_PSV_FUL, IMJ, ISF_RULE, MV_SITE_RULE, PREP_RULES, SCAN_RULE, brzPsvFulRule, fulPackRules, kindOf } from '../domain/constants.ts'
import { addWorkdays, localDay, md, nextWorkOrSame, prevWork, todayStr } from '../domain/date.ts'
import { fulMatch } from '../domain/ful.ts'
import { MONTHLY, monthlyPlan, nextMonth } from '../domain/monthly.ts'
import { projShort, safeId, sameSite, siteCore, siteCoreRaw, siteShort } from '../domain/project.ts'
import { genKey, manualTwin, normRule, planTodos, rulesFor } from '../domain/rules.ts'
import {
  FOLLOWUPS, breztriApproved, companionsFor, enfSivPrep, newSiteMail, type FollowUp, type NewTodo,
} from '../domain/specials.ts'
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

/** 끝낸 할 일의 하위 항목은 모두 체크 */
const checkAllSubs = <T extends Pick<Todo, 'subs' | 'checks'>>(t: T): T =>
  t.subs?.some((x) => !(t.checks || []).includes(x)) ? { ...t, checks: [...new Set([...(t.checks || []), ...t.subs])] } : t

/** 할 일 저장. 완료하면 하위 항목을 모두 체크하고, 완료 상태가 바뀌면 이어지는 할 일(FOLLOWUPS)을 만들거나 지우거나 옮긴다 */
export async function putTodo(t0: NewTodo): Promise<string> {
  const prev = t0.id ? (S().todos.get(t0.id) ?? null) : null
  let t = slotByTime({ ...t0, id: t0.id || '' }, prev, S().todos)
  if (!t.id) t = { ...t, id: newId() }
  if (t.done && !prev?.done) t = checkAllSubs(t)
  setTodo(t)
  await write(repo.putTodo(t))
  if (t.done && !prev?.done) await followUpsOnDone(t)
  else if (!t.done && prev?.done) await followUpsUndo(t)
  else if (t.done && prev?.done && localDay(t.doneAt) !== localDay(prev.doneAt)) await followUpsRedate(t)
  return t.id
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
    const f = S().fuls.get(t.fulId)
    if (f && !f.done) await putFul({ ...f, done: true })
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
}

/* ---------- 완료하면 생기는 확인 할 일 ---------- */

const followId = (t: Todo, fid: string) => safeId('f_' + t.id + '_' + fid)

/** 완료일에서 이어지는 할 일의 착수·마감 */
function followDates(t: Todo, f: FollowUp) {
  const day = localDay(t.doneAt) || todayStr()
  const hol = S().holidays
  const start = f.startN ? addWorkdays(day, f.startN, hol) : day
  const due = addWorkdays(day, f.n, hol)
  return {
    start, due,
    basis: '「' + t.title + '」 완료일 ' + md(day) + ' 후 WD' + f.n + ' = ' + md(due) + ' [' + f.basis + ']',
    startBasis: f.startN ? '완료일 ' + md(day) + ' 후 WD' + f.startN + ' ' + md(start) + ' 착수' : '요청 완료한 당일 착수',
  }
}

async function followUpsOnDone(t: Todo, only?: string) {
  for (const f of FOLLOWUPS) {
    if (t.followOf || (only && f.id !== only) || !f.match(t.title || '')) continue
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

/* ---------- 외근 → 자동 할 일 동기화 ---------- */

const busy = new Set<string>()
const synced = new Map<string, string>()

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
    await linkEnfPrep(ev)
    await applyFuls(ev)
    const detId = (r: string) => safeId('a_' + ev.id + '_' + r)
    const mine = [...S().todos.values()].filter((t) => t.eventId === ev.id)
    const skip = new Set(ev.skip || [])
    const plan = planTodos(ev, S()).filter((p) => !skip.has(p.ruleId))
    const want = new Set(plan.map((p) => detId(p.ruleId)))
    for (const t of mine) {
      if (!t.done && t.ruleId && !t.ruleId.endsWith('-manual') && !want.has(t.id)) await deleteTodo(t.id)
    }
    /* 이미 맞춘 외근을 다시 맞출 때(날짜·규칙·공휴일 변경): 완료한 할 일은 그대로, 열린 할 일은 날짜만 옮긴다.
       새로 생길 할 일의 마감이 이미 지났으면 손으로 처리한 일이라 보고 만들지 않는다 */
    const regen = !!ev.genKey
    const today = todayStr()
    for (const p of plan) {
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
      if (!twin && regen && !old && p.due && p.due < today) continue
      /* 같은 일을 직접 만들어 둔 열린 할 일은 이 규칙의 할 일로 바꾼다.
         날짜는 규칙대로 바뀌므로 예전 날짜를 설명하던 메모는 버리고, 순서·체크는 그대로 */
      const base = twin ?? old
      /* 하위 항목은 처음 만들 때만 규칙대로. 그 뒤로는 직접 고치고 지운 대로 둔다 */
      const subs = base?.subs?.length ? base.subs : p.subs
      await putTodo({
        id, title: p.title, due: p.due, time: p.time || '', basis: p.basis, start: p.start, startBasis: p.startBasis,
        ruleId: p.ruleId, verify: p.verify, eventId: ev.id, project: ev.project || '', done: false,
        rank: base?.rank, note: old?.note, subs: subs.length ? subs : undefined, checks: base?.checks, created: base?.created || new Date().toISOString(),
      })
      if (twin) {
        for (const c of [...S().todos.values()].filter((x) => x.parentId === twin.id)) await putTodo({ ...c, parentId: id })
        await deleteTodo(twin.id)
      }
    }
    synced.set(ev.id, key)
    await putEvent({ ...(S().events.get(ev.id) ?? ev), genKey: key })
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
}

/** 엔플론시아 SIV 외근이 등록되면 준비 할 일의 CL·EDC(와 완료한 것)는 외근 규칙에 넘긴다 */
async function linkEnfPrep(ev: CalEvent) {
  if (ev.project !== 'MSD - 엔플론시아' || ev.type !== 'SIV') return
  const c = siteCoreRaw(ev.site)
  if (c.length < 2) return
  const rs = rulesFor(ev, S().rules)
  for (const t of [...S().todos.values()].filter((x) => x.prepKey && !x.eventId && x.prepSite)) {
    const k = siteCoreRaw(t.prepSite)
    if (!(k.includes(c) || c.includes(k))) continue
    const r = rs.find((x) => x.key === t.prepKey)
    if (!r) await putTodo({ ...t, eventId: ev.id })
    else if (t.done) await putTodo({ ...t, eventId: ev.id, ruleId: r.id })
    else await deleteTodo(t.id)
  }
}

/** FUL 메모를 가장 가까운 다가오는 해당 외근의 할 일로 (착수 = 등록일, 마감 = 방문 전 영업일) */
async function applyFuls(ev: CalEvent) {
  if (kindOf(ev) !== 'visit' || !ev.date || ev.date < todayStr()) return
  const hol = S().holidays
  const earlier = (f: Ful) =>
    [...S().events.values()].some((o) => o.id !== ev.id && o.date && o.date >= todayStr() && o.date < ev.date && fulMatch(f, o))
  for (const f of [...S().fuls.values()].filter((f) => !f.todoId && !f.done && fulMatch(f, ev) && !earlier(f))) {
    const id = safeId('fu_' + f.id)
    if (S().todos.has(id)) continue
    const reg = nextWorkOrSame(ev.createdDate || todayStr(), hol)
    let due = prevWork(ev.date, hol)
    if (due < reg) due = reg
    await putTodo({
      id, title: projShort(S().projects, f.project) + ' ' + siteShort(ev.site) + ' ' + ev.type + ' FUL: ' + f.text,
      project: f.project, start: reg, due, time: '', tbd: false, autoDue: false, done: false, fulId: f.id,
      basis: 'FUL 메모(' + md(f.created.slice(0, 10)) + ') → ' + md(ev.date) + ' ' + ev.type + ' 등록 · 방문 WD1 전 = ' + md(due),
      startBasis: '외근 등록한 날 착수', created: new Date().toISOString(),
    })
    await putFul({ ...f, todoId: id, eventId: ev.id, linkedAt: todayStr() })
  }
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

export async function toggleDone(t: Todo) {
  await putTodo({ ...t, done: !t.done, doneAt: !t.done ? new Date().toISOString() : null })
}

/** 서명문서 체크리스트에서 문서 하나를 체크하거나 푼다 */
/** 체크리스트(서명문서·하위 항목) 한 줄 체크·해제 */
export async function toggleCheck(id: string, name: string) {
  const t = S().todos.get(id)
  if (!t) return
  const cur = t.checks || []
  await putTodo({ ...t, checks: cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name] })
}

/** 하위 항목을 고치면 지운 항목의 체크도 같이 지운다 */
export const withSubs = (t: Todo, subs: string[]): Todo => {
  const gone = (t.subs || []).filter((x) => !subs.includes(x))
  return { ...t, subs, checks: (t.checks || []).filter((x) => !gone.includes(x)) }
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
  await putTodo({ ...t, subs: cur.map((x) => (x === from ? v : x)), checks: (t.checks || []).map((x) => (x === from ? v : x)) })
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
      await putTodo({
        id, title: x.title, project: '', start: p.start, due: p.due, time: '', tbd: false, autoDue: false, done: false,
        basis: p.basis, startBasis: p.startBasis, created: new Date().toISOString(),
      })
    }
  }
  if (!made.length) return
  appStore.setState({ mig: [...S().mig, ...made] })
  await putConfig()
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

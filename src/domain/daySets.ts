import type { CalEvent, Data, DateStr, Todo } from '../types/domain.ts'
import { BUNNY_SINCE, byTimeKind, coversDay, kindOf } from './constants.ts'
import { localDay, nextWork, shift, todayStr } from './date.ts'
import { byDueSend, candidates, inToday, isAuto, planItems, type PlanCtx, type PlanItem } from './plan.ts'
import { sortTodos } from './priority.ts'
import { siteCore } from './project.ts'

const uniq = <T,>(xs: T[]) => [...new Set(xs)]
const after = (a: DateStr | undefined, b: DateStr) => (a || '') > b

/** 실제로 끝낸 날 (완료 시각이 없는 옛 기록은 마감일) */
export const doneDay = (x: Todo): DateStr => localDay(x.doneAt) || x.due || ''

/** 그날에 걸친 일정 (종류·시간 순) */
export const eventsOn = (d: DateStr, events: Data['events']): CalEvent[] =>
  [...events.values()].filter((e) => coversDay(e, d)).sort(byTimeKind)

/** 오늘 화면에 보이는 줄: 마감이 오늘이거나 지난 일(자동) + 오늘로 고른 일. 묶음은 한 줄 (남은 하위 항목 중 가장 이른 날짜로) */
export const todayItems = (t: DateStr, todos: Data['todos'], ctx?: PlanCtx): PlanItem[] => planItems(todos, ctx).filter((x) => inToday(x, t))

/**
 * 오늘 할 일 화면의 묶음: 지연 · 오늘 마감 · 오늘로 고른 일 · 오늘 완료. 끝낸 일은 실제로 끝낸 날에만 보인다.
 * 착수일만 지난 일은 고르기 전에는 들어가지 않는다 (후보 목록에 있다)
 */
export function todaySet(t: DateStr, todos: Data['todos'], ctx?: PlanCtx) {
  const items = todayItems(t, todos, ctx)
  const of = (f: (x: PlanItem) => boolean) => uniq(items.filter(f).map((x) => x.todo))
  const late = of((x) => !!x.due && x.due < t)
  const today = of((x) => x.due === t).filter((x) => !late.includes(x))
  const doing = of((x) => !isAuto(x, t)).filter((x) => !late.includes(x) && !today.includes(x))
  const doneT = [...todos.values()].filter((x) => x.done && doneDay(x) === t)
  return { today, doing, late, doneT, openN: today.length + doing.length, items }
}

/** 다른 날의 목록: 그날 마감인 열린 일 · 그날 끝낸 일 · (미래면) 그날 하려고 고른 일("내일로")과 그날 마감인 묶음 하위 항목 */
export function daySet(d: DateStr, todos: Data['todos'], ctx?: PlanCtx) {
  const fut = d > todayStr()
  const picked = new Set(fut ? planItems(todos, ctx, true).filter((x) => x.due === d || x.today === d || x.todo.today === d).map((x) => x.todo.id) : [])
  const items = uniq(
    [...todos.values()].filter(
      (x) => !x.someday && ((!x.done && x.due === d) || (x.done && doneDay(x) === d) || (!x.done && picked.has(x.id))),
    ),
  )
  return { items, done: items.filter((x) => x.done), open: items.filter((x) => !x.done) }
}

/**
 * 그날 외근과 이어진 할 일인가: 그 외근의 자동 할 일, 또는 외근과 이어지지 않은 할 일 중 제목에 그 기관 이름(앞 4자)이 든 것.
 * 과제가 다른 할 일은 뺀다
 */
export function atVisitOn(d: DateStr, events: Data['events']): (t: Todo) => boolean {
  const vs = eventsOn(d, events).filter((e) => kindOf(e) === 'visit')
  if (!vs.length) return () => false
  const ids = new Set(vs.map((e) => e.id))
  const names = vs.map((e) => ({ key: siteCore(e.site).slice(0, 4), project: e.project || '' })).filter((x) => x.key.length >= 2)
  return (t) => {
    if (t.eventId) return ids.has(t.eventId)
    const title = t.title.replace(/\s+/g, '').replace(/대학교/g, '대')
    return names.some((x) => title.includes(x.key) && (!t.project || !x.project || t.project === x.project))
  }
}

/** 그날 외근과 이어진 할 일을 맨 위로 (나머지 순서는 그대로) */
export function visitFirst(list: Todo[], d: DateStr, events: Data['events']): Todo[] {
  const at = atVisitOn(d, events)
  return [...list.filter(at), ...list.filter((x) => !at(x))]
}

/** 오늘 할 일과 캘린더 날짜 패널이 함께 쓰는 그날의 할 일 목록 */
export function dayTodos(d: DateStr, todos: Data['todos'], ctx?: PlanCtx): Todo[] {
  if (d === todayStr()) {
    const s = todaySet(d, todos, ctx)
    return uniq([...s.late, ...s.today, ...s.doing, ...s.doneT])
  }
  return daySet(d, todos, ctx).items
}

/** 할 일이 하나 이상 있었고 남은 것이 없는 날 (토끼를 붙인다) */
export function dayComplete(d: DateStr, todos: Data['todos'], ctx?: PlanCtx) {
  const t = todayStr()
  if (d === t) {
    const s = todaySet(t, todos, ctx)
    return s.doneT.length > 0 && s.items.length === 0
  }
  if (d > t || d < BUNNY_SINCE) return false
  /* 그날 마감인 일을 모두 그날까지 끝냈다 */
  const set = [...todos.values()].filter((x) => !x.someday && (x.due === d || (x.done && doneDay(x) === d)))
  return set.length > 0 && set.every((x) => x.done && doneDay(x) <= d)
}

/** 사이드바 "오늘 할 일" 숫자: 오늘 화면에 보이는 줄 (지연 · 오늘 마감 · 오늘로 고른 일) */
export const todayCount = (t: DateStr, todos: Data['todos'], ctx?: PlanCtx) => todayItems(t, todos, ctx).length

/** 아직 다녀오지 않은 외근의 방문 후 일 (방문 다음에 착수) — 방문 전에는 "7일 안에 착수할 일"에 띄우지 않는다 */
const afterComingVisit = (x: PlanItem, t: DateStr, events?: Data['events']) => {
  const ev = x.todo.eventId ? events?.get(x.todo.eventId) : undefined
  const last = ev ? ev.endDate || ev.date : ''
  return !!last && last >= t && !!x.start && x.start > last
}

/**
 * 오늘 할 일 화면 구성. 줄은 할 일 하나 (묶음도 한 줄, 하위 항목은 그 밑에서 펼쳐 본다).
 * 오늘 화면 = 마감이 오늘이거나 지난 일 + 오늘로 고른 일. 나머지 착수한 일은 후보 목록(cands)에서 고른다
 */
export function todayBuckets(t: DateStr, data: Pick<Data, 'todos' | 'events'> & { ctx?: PlanCtx }) {
  const { todos, events, ctx } = data
  const items = planItems(todos, ctx)
  const shown = items.filter((x) => inToday(x, t))
  /* 오늘 외근과 이어진 일 중 오늘 화면에 보일 것은 맨 위 묶음으로 빼 둔다 */
  const at = atVisitOn(t, events)
  const visit = shown.filter((x) => at(x.todo)).sort(byDueSend)
  const rest = shown.filter((x) => !visit.includes(x))
  const late = rest.filter((x) => x.due && x.due < t).sort(byDueSend)
  const rolled = (x: PlanItem) => !x.sub && (x.todo.rolled || 0) >= 1
  const doneT = [...todos.values()].filter((x) => x.done && doneDay(x) === t)
  const open = rest.filter((x) => !(x.due && x.due < t)).sort(byDueSend)
  return {
    /** 오늘 외근과 이어진 일 (맨 위) */
    visit,
    /** 한 번 미룬 일이 또 밀림 */
    judge: late.filter(rolled),
    /** 처음 밀린 일 (날짜가 지난 묶음 하위 항목 포함) */
    late1: late.filter((x) => !rolled(x)),
    late,
    /** 오늘 마감 + 오늘로 고른 일 */
    open,
    done: sortTodos(doneT),
    /** 후보: 착수일이 오늘 이전이거나 없는 열린 일 중 오늘 화면에 없는 것 */
    cands: candidates(items, t),
    /** 7일 안에 착수할 일 (아직 안 다녀온 외근의 방문 후 일은 빼고) */
    soon: items
      .filter((x) => x.start > t && x.start <= shift(t, 7) && !inToday(x, t) && !x.todo.someday && !afterComingVisit(x, t, events))
      .sort((a, b) => a.start.localeCompare(b.start)),
  }
}

/** 전체 할 일 화면의 묶음 */
export function todoGroups(todos: Todo[], t: DateStr) {
  const wk = shift(t, 7)
  const open = sortTodos(todos.filter((x) => !x.done))
  const groups: { name: string; over: boolean; items: Todo[] }[] = [
    { name: '지연', over: true, items: open.filter((x) => x.due && x.due < t) },
    { name: '오늘', over: false, items: open.filter((x) => x.due === t) },
    { name: '7일 안', over: false, items: open.filter((x) => after(x.due, t) && x.due! <= wk) },
    { name: '그 이후', over: false, items: open.filter((x) => after(x.due, wk)) },
    { name: 'TBD · 마감 미정', over: false, items: open.filter((x) => !x.due) },
  ]
  const done = todos.filter((x) => x.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''))
  return { open, groups: groups.filter((g) => g.items.length), done }
}

/** 체크한 날 (시각을 모르는 옛 체크는 날짜만 있다) */
const atDay = (at: string) => (at.length === 10 ? at : localDay(at))

/** 그날 체크한 하위 항목. 그날 끝낸 할 일의 것은 할 일로 보이므로 뺀다 */
export function checkedOn(d: DateStr, todos: Data['todos'], skip: Set<string>) {
  return [...todos.values()]
    .filter((x) => !skip.has(x.id))
    .flatMap((x) =>
      Object.entries(x.checkAt || {})
        .filter(([name, at]) => (x.checks || []).includes(name) && atDay(at) === d)
        .map(([name, at]) => ({ key: x.id + '|' + name, title: x.title, project: x.project || '', name: name.replace(/^eTMF:/, ''), at })),
    )
}

/** 퇴근 무렵 (17:50 이후): 오늘 브리핑의 남은 일에 "내일로 넘길지 확인"을 붙인다 */
export const BRIEF_FROM_MIN = 17 * 60 + 50

/** 브리핑의 남은 일 한 줄 */
export interface BriefLeft {
  id: string
  due: DateStr
  project: string
  title: string
}

/** 브리핑 카드 내용. 오늘도 하루 종일 보인다 (퇴근 무렵이면 evening). 오늘의 목표는 오늘 화면에 보이는 줄(자동 + 고른 일) */
export function briefData(t: DateStr, now: Date, data: Pick<Data, 'todos' | 'holidays'> & { ctx?: PlanCtx }) {
  const past = t < todayStr()
  const evening = !past && now.getHours() * 60 + now.getMinutes() >= BRIEF_FROM_MIN
  const row = (x: Todo): BriefLeft => ({ id: x.id, due: x.due || '', project: x.project || '', title: x.title })
  let done: Todo[]
  let left: BriefLeft[]
  if (past) {
    const s = daySet(t, data.todos)
    done = s.done
    /* 그날 마감이었지만 다음 날 이후에 끝낸 일도 그날은 못 끝낸 일 */
    left = [...s.open, ...[...data.todos.values()].filter((x) => x.done && !x.someday && x.due === t && doneDay(x) > t)].map(row)
  } else {
    const s = todaySet(t, data.todos, data.ctx)
    done = s.doneT
    left = [...s.items].sort(byDueSend).map((x) => ({ id: x.key, due: x.due, project: x.project, title: x.title }))
  }
  const goal = done.length + left.length
  if (!goal) return null
  return {
    past,
    evening,
    rate: Math.round((done.length / goal) * 100),
    goal,
    done: [...done].sort((a, b) => (a.doneAt || '').localeCompare(b.doneAt || '')),
    subs: checkedOn(t, data.todos, new Set(done.map((x) => x.id))),
    left,
    next: nextWork(t, data.holidays),
  }
}

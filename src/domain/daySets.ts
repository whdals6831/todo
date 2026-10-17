import type { CalEvent, Data, DateStr, Todo } from '../types/domain.ts'
import { BUNNY_SINCE, byKindTime, coversDay } from './constants.ts'
import { localDay, nextWork, shift, todayStr } from './date.ts'
import { byPriority } from './priority.ts'

const uniq = <T,>(xs: T[]) => [...new Set(xs)]
const after = (a: DateStr | undefined, b: DateStr) => (a || '') > b

/** 그날에 걸친 일정 (종류·시간 순) */
export const eventsOn = (d: DateStr, events: Data['events']): CalEvent[] =>
  [...events.values()].filter((e) => coversDay(e, d)).sort(byKindTime)

/** 캘린더 칸의 마감 점: 외근에서 생긴 PMP 마감만 (개인 할 일은 넣지 않는다) */
export const calendarDeadlines = (d: DateStr, todos: Data['todos']) =>
  [...todos.values()].filter((t) => t.due === d && t.eventId && t.ruleId).sort(byPriority)

/** 오늘 할 일 화면의 묶음: 지연 · 오늘 마감 · 착수한 일 · TBD · 오늘 완료 */
export function todaySet(t: DateStr, todos: Data['todos']) {
  const all = [...todos.values()]
  const open = all.filter((x) => !x.done)
  const today = open.filter((x) => x.due === t)
  const doing = open.filter((x) => after(x.due, t) && x.start && x.start <= t)
  const tbd = open.filter((x) => !x.due && !x.someday)
  const late = open.filter((x) => x.due && x.due < t)
  const doneT = uniq(all.filter((x) => x.done && (localDay(x.doneAt) === t || x.due === t)))
  return { today, doing, tbd, late, doneT, openN: today.length + doing.length + tbd.length }
}

/** 다른 날의 목록: 그날 마감 · 그날 완료 · (미래면) 그날 진행 중이어야 할 일 */
export function daySet(d: DateStr, todos: Data['todos']) {
  const fut = d > todayStr()
  const items = uniq(
    [...todos.values()].filter(
      (x) =>
        !x.someday &&
        (x.due === d ||
          (x.done && localDay(x.doneAt) === d) ||
          (fut && !x.done && x.start && x.start <= d && after(x.due, d))),
    ),
  )
  return { items, done: items.filter((x) => x.done), open: items.filter((x) => !x.done) }
}

/** 오늘 할 일과 캘린더 날짜 패널이 함께 쓰는 그날의 할 일 목록 */
export function dayTodos(d: DateStr, todos: Data['todos']): Todo[] {
  if (d === todayStr()) {
    const s = todaySet(d, todos)
    return uniq([...s.late, ...s.today, ...s.doing, ...s.tbd, ...s.doneT])
  }
  return daySet(d, todos).items
}

/** 할 일이 하나 이상 있었고 남은 것이 없는 날 (토끼를 붙인다) */
export function dayComplete(d: DateStr, todos: Data['todos']) {
  const t = todayStr()
  if (d === t) {
    const s = todaySet(t, todos)
    return s.doneT.length > 0 && s.openN === 0 && s.late.length === 0
  }
  if (d > t || d < BUNNY_SINCE) return false
  const set = [...todos.values()].filter((x) => !x.someday && (x.due === d || (x.done && localDay(x.doneAt) === d)))
  return set.length > 0 && set.every((x) => x.done)
}

/** 사이드바 "오늘 할 일" 숫자: 지연 · 오늘 마감 · 착수한 일 · TBD (Someday 제외) */
export function todayCount(t: DateStr, todos: Data['todos']) {
  return [...todos.values()].filter((x) => !x.done).filter((x) => (x.due ? x.due <= t || (!!x.start && x.start <= t) : !x.someday)).length
}

/** 오늘 할 일 화면 구성 */
export function todayBuckets(t: DateStr, todos: Data['todos']) {
  const all = [...todos.values()]
  const open = all.filter((x) => !x.done)
  const late = open.filter((x) => x.due && x.due < t).sort((a, b) => a.due!.localeCompare(b.due!))
  const today = open.filter((x) => x.due === t)
  const doing = open.filter((x) => after(x.due, t) && x.start && x.start <= t).sort((a, b) => a.due!.localeCompare(b.due!))
  const doneT = uniq(all.filter((x) => (x.done && localDay(x.doneAt) === t) || (x.done && x.due === t)))
  const tbdOpen = open.filter((x) => !x.due && !x.someday)
  return {
    /** 한 번 미룬 일이 또 밀림 */
    judge: late.filter((x) => (x.rolled || 0) >= 1),
    /** 처음 밀린 일 */
    late1: late.filter((x) => !(x.rolled || 0)),
    late,
    list: [...today, ...doing, ...tbdOpen, ...doneT].sort(byPriority),
    openN: today.length + doing.length + tbdOpen.length,
    doneN: doneT.length,
    /** 7일 안에 착수할 일 */
    soon: open.filter((x) => x.start && x.start > t && x.start <= shift(t, 7)).sort((a, b) => a.start!.localeCompare(b.start!)),
  }
}

/** 전체 할 일 화면의 묶음 */
export function todoGroups(todos: Todo[], t: DateStr) {
  const wk = shift(t, 7)
  const open = todos.filter((x) => !x.done).sort(byPriority)
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

/** 브리핑을 보여 주는 시각 (17:50 이후, 또는 지난 날) */
export const BRIEF_FROM_MIN = 17 * 60 + 50

/** 브리핑 카드 내용. 오늘은 17:50 전이면 보이지 않는다 */
export function briefData(t: DateStr, now: Date, data: Pick<Data, 'todos' | 'holidays'>) {
  const past = t < todayStr()
  if (!past && now.getHours() * 60 + now.getMinutes() < BRIEF_FROM_MIN) return null
  let done: Todo[]
  let left: Todo[]
  if (past) {
    const s = daySet(t, data.todos)
    done = s.done
    left = s.open
  } else {
    const s = todaySet(t, data.todos)
    done = s.doneT
    left = [...s.late, ...s.today, ...s.doing, ...s.tbd]
  }
  const goal = done.length + left.length
  if (!goal) return null
  return {
    past,
    rate: Math.round((done.length / goal) * 100),
    goal,
    done: [...done].sort((a, b) => (a.doneAt || '').localeCompare(b.doneAt || '')),
    left,
    next: nextWork(t, data.holidays),
  }
}

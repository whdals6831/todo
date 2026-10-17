import type { Todo } from '../types/domain.ts'
import { diffDays, todayStr } from './date.ts'

/**
 * 할 일 순서: 미완료가 먼저, 완료는 끝낸 순서대로.
 * 직접 정한 순서(rank)가 있는 것이 먼저 오고, 나머지는 마감 → 시간 → 착수 → 제목 순.
 */
export function byPriority(a: Todo, b: Todo) {
  if (!!a.done !== !!b.done) return a.done ? 1 : -1
  if (a.done && b.done) {
    const c = (a.doneAt || '').localeCompare(b.doneAt || '')
    if (c) return c
  }
  const ra = a.rank != null
  const rb = b.rank != null
  if (ra && rb && a.rank !== b.rank) return a.rank! - b.rank!
  if (ra !== rb) return ra ? -1 : 1
  return (
    (a.due || '9999').localeCompare(b.due || '9999') ||
    (a.time || '99').localeCompare(b.time || '99') ||
    (a.start || '').localeCompare(b.start || '') ||
    a.title.localeCompare(b.title)
  )
}

/**
 * 직접 순서를 정한 목록에서, 마감 시간이 생기거나 바뀐 할 일은 그 시간 자리로 옮긴다:
 * 같은 날짜의 미완료 중 더 늦거나 시간이 없는 첫 할 일 바로 위. 나머지 순서는 그대로 둔다.
 */
export function slotByTime(t: Todo, prev: Todo | null | undefined, todos: Map<string, Todo>): Todo {
  if (!t.time || t.done || !t.due) return t
  if (prev && prev.time === t.time && prev.due === t.due) return t
  const same = [...todos.values()]
    .filter((x) => x.id !== t.id && !x.done && x.rank != null && x.due === t.due)
    .sort((a, b) => a.rank! - b.rank!)
  if (!same.length) {
    if (prev && prev.rank != null && prev.due !== t.due) {
      const n = { ...t }
      delete n.rank
      return n
    }
    return t
  }
  const between = (lo: number | null, hi: number | null) =>
    lo == null ? (hi == null ? 0 : hi - 1) : hi == null ? lo + 1 : (lo + hi) / 2
  const timed = same.filter((x) => x.time)
  if (!timed.length) return t
  const later = timed.find((x) => x.time! > t.time!)
  if (later) {
    const k = same.indexOf(later)
    return { ...t, rank: between(k > 0 ? same[k - 1].rank! : null, later.rank!) }
  }
  const last = timed[timed.length - 1]
  const k = same.indexOf(last)
  return { ...t, rank: between(last.rank!, k + 1 < same.length ? same[k + 1].rank! : null) }
}

/** 오늘·내일(D-1) 마감이거나 지난 미완료. 날짜 없이 추가해 자동으로 잡힌 마감은 제외 */
export function isUrgent(t: Todo) {
  if (t.done || !t.due || t.autoDue) return false
  return diffDays(todayStr(), t.due) <= 1
}

/** 마감까지 남은 날 표시: "오늘", "D-3", "2일 지남" */
export function dLabel(due: string) {
  const n = diffDays(todayStr(), due)
  if (n === 0) return { t: '오늘', late: false, soon: true }
  if (n < 0) return { t: -n + '일 지남', late: true, soon: false }
  return { t: 'D-' + n, late: false, soon: n === 1 }
}

import type { CalEvent, Data, DateStr, Project, Todo } from '../types/domain.ts'
import { BUILTIN_ALIASES, kindLabel, kindOf } from './constants.ts'

/** 검색 대상 문자열: 제목, 기관, 과제(약칭·별칭 포함), 방문 종류, 메모, 날짜 */
function hayFor(x: Partial<CalEvent & Todo>, isEv: boolean, projects: Project[]) {
  const p = projects.find((q) => q.name === x.project)
  return [
    x.title, x.site, x.project, p?.short, ...(BUILTIN_ALIASES[x.project || ''] || []), ...(p?.aliases || []),
    x.type, x.memo, x.note, isEv ? kindLabel(kindOf(x)) : '', x.date, x.due,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export const searchWords = (q: string) => q.trim().toLowerCase().split(/\s+/).filter(Boolean)

/** 모든 단어가 어딘가에 들어 있는 일정·할 일 */
export function search(words: string[], data: Pick<Data, 'events' | 'todos' | 'projects'>, today: DateStr) {
  const hit = (x: Partial<CalEvent & Todo>, ev: boolean) => {
    const h = hayFor(x, ev, data.projects)
    return words.every((w) => h.includes(w))
  }
  /* 다가오는 일정이 먼저(가까운 순), 지난 일정은 최근 순 */
  const events = [...data.events.values()]
    .filter((e) => hit(e, true))
    .sort((a, b) => {
      const fa = a.date >= today
      const fb = b.date >= today
      if (fa !== fb) return fa ? -1 : 1
      return fa ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)
    })
  const todos = [...data.todos.values()].filter((x) => hit(x, false))
  return {
    events,
    open: todos.filter((x) => !x.done).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (a.time || '99').localeCompare(b.time || '99')),
    done: todos.filter((x) => x.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')),
    count: todos.length,
  }
}

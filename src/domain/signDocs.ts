import type { CalEvent, NoteItem, Notes, Todo } from '../types/domain.ts'

/** 제목에 "서명문서"·"서명 서류" 같은 말이 든 할 일에 서명문서 체크리스트를 붙인다 */
const SIGN_RE = /서명\s*(문서|서류)/
/** 제목에서 방문 종류 (PSVR·SIVR 같은 보고서 이름은 빼고) */
const TYPE_RE = /(?:^|[^a-z])(psv|siv|mv|cov|add-?on)(?![a-z])/i

const norm = (s: string) => s.toLowerCase().replace(/[\s_-]/g, '')

/** 서명 문서 순서: PSV 미참석 연구진(해당 인력) → PI만 → 그 외. 같은 묶음 안은 원래 순서 */
function docGroup(it: NoteItem) {
  const t = String(it.t || '')
  const w = String(it.w || '').trim()
  if (/미참석|해당\s*(연구진|인력)|PSV 때 못 받았|추가 인력/.test(t + ' ' + w)) return 0
  if (/^PI(만)?(\s*[·(]|$)/.test(w)) return 1
  return 2
}
export const sortDocs = (arr: NoteItem[]) =>
  arr.map((it, i) => [it, i] as const).sort((a, b) => docGroup(a[0]) - docGroup(b[0]) || a[1] - b[1]).map((x) => x[0])

/**
 * 할 일의 서명문서 목록: 업무 노트에서 그 과제·방문 종류의 서명 문서.
 * 과제·방문 종류는 외근에서 만든 할 일이면 그 외근에서, 아니면 할 일의 과제와 제목에서 찾는다. 없으면 []
 */
export function signDocsFor(t: Pick<Todo, 'title' | 'project' | 'eventId'>, notes: Notes | null, events: Map<string, CalEvent>): NoteItem[] {
  if (!SIGN_RE.test(t.title)) return []
  const ev = t.eventId ? events.get(t.eventId) : undefined
  const project = ev?.project || t.project || ''
  const type = ev?.type || t.title.match(TYPE_RE)?.[1] || ''
  const secs = (project && notes?.[project]) || []
  if (!type || !secs.length) return []
  const k = norm(type)
  const sec = secs.find((x) => norm(x.v) === k) ?? secs.find((x) => norm(x.v).startsWith(k))
  return sortDocs((sec?.docs || []).filter((d) => d.t.trim()))
}

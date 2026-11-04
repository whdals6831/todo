import type { CalEvent, NoteItem, Notes, Todo } from '../types/domain.ts'

/** 제목에 "서명문서"·"서명 서류" 같은 말이 든 할 일에 서명문서 체크리스트를 붙인다 */
export const SIGN_RE = /서명\s*(문서|서류)/
export const ETMF_RE = /etmf/i

type DocTodo = Pick<Todo, 'title' | 'project' | 'eventId'>

/** 이 글(할 일 제목, 또는 외근 할 일 묶음의 하위 항목)에 붙는 문서 체크 목록. 체크는 pre 를 붙인 이름으로 */
export function docListsFor(text: string, t: DocTodo, notes: Notes | null, events: Map<string, CalEvent>) {
  const x = { ...t, title: text }
  return [
    { key: 'docs', name: '서명문서', pre: '', items: signDocsFor(x, notes, events) },
    { key: 'etmf', name: 'eTMF 문서', pre: 'eTMF:', items: etmfDocsFor(x, events) },
  ].filter((l) => l.items.length)
}
/** 제목에서 방문 종류 (PSVR·SIVR 같은 보고서 이름은 빼고) */
const TYPE_RE = /(?:^|[^a-z])(psv|siv|mv|cov|add-?on)(?![a-z])/i

const norm = (s: string) => s.toLowerCase().replace(/[\s_-]/g, '')

/**
 * 서명 문서 순서: 개인정보처리동의서(Privacy Notice) → Signed CV → GCP 이수증 → 그 밖의 PSV 미참석 연구진(해당 인력) 서류
 * → PI만 → 그 외. 같은 묶음 안은 원래 순서
 */
function docGroup(it: NoteItem) {
  const t = String(it.t || '')
  const w = String(it.w || '').trim()
  if (/개인정보|privacy/i.test(t)) return 0
  if (/(^|[^a-z])cv([^a-z]|$)/i.test(t)) return 1
  if (/gcp|이수증/i.test(t)) return 2
  if (/미참석|해당\s*(연구진|인력)|PSV 때 못 받았|추가 인력/.test(t + ' ' + w)) return 3
  if (/^PI(만)?(\s*[·(]|$)/.test(w)) return 4
  return 5
}
export const sortDocs = (arr: NoteItem[]) =>
  arr.map((it, i) => [it, i] as const).sort((a, b) => docGroup(a[0]) - docGroup(b[0]) || a[1] - b[1]).map((x) => x[0])

/** 할 일의 서명문서 목록: 업무 노트에서 그 과제·방문 종류의 서명 문서. 없으면 [] */
export function signDocsFor(t: DocTodo, notes: Notes | null, events: Map<string, CalEvent>): NoteItem[] {
  if (!SIGN_RE.test(t.title)) return []
  const { project, type } = visitOf(t, events)
  const secs = (project && notes?.[project]) || []
  if (!type || !secs.length) return []
  const k = norm(type)
  const sec = secs.find((x) => norm(x.v) === k) ?? secs.find((x) => norm(x.v).startsWith(k))
  return sortDocs((sec?.docs || []).filter((d) => d.t.trim()))
}

/** 할 일의 과제·방문 종류: 외근에서 만든 할 일이면 그 외근에서, 아니면 할 일의 과제와 제목에서 */
function visitOf(t: Pick<Todo, 'title' | 'project' | 'eventId'>, events: Map<string, CalEvent>) {
  const ev = t.eventId ? events.get(t.eventId) : undefined
  return { project: ev?.project || t.project || '', type: ev?.type || t.title.match(TYPE_RE)?.[1] || '' }
}

/** 방문 뒤 eTMF 에 올릴 문서 (과제 → 방문 종류 → 문서 이름) */
const ETMF_DOCS: Record<string, Record<string, string[]>> = {
  'Amgen - Tarlatamab': {
    SIV: [
      'SIV pre-Checklist', 'SIV Confirmation Letter', 'Delegation log', 'Training signature form', 'Attendee List',
      'Site visit record', 'Source Document agreement form', 'Study Material receipt form', 'SIV Report', 'SIV Follow-up Letter',
    ],
  },
}

/** 제목에 eTMF 가 든 할 일의 올릴 문서 목록. 그 과제·방문 종류 목록이 없으면 [] */
export function etmfDocsFor(t: DocTodo, events: Map<string, CalEvent>): NoteItem[] {
  if (!ETMF_RE.test(t.title)) return []
  const { project, type } = visitOf(t, events)
  return (ETMF_DOCS[project]?.[type.toUpperCase()] || []).map((x) => ({ t: x }))
}

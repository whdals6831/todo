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
/** w 는 문서 옆에 붙는 짧은 안내 */
const ETMF_DOCS: Record<string, Record<string, (string | NoteItem)[]>> = {
  /* Breztri PMP v1.0 (13.1~13.4 방문별 취득 문서 · 9.4.2 Document date 기준 30일 이내 업로드) */
  'AZ - Breztri': {
    PSV: [
      { t: 'Confidentiality Agreement', w: '방문 전에 서명받았으면 서명일부터 30일' },
      'PSV Confirmation Letter', 'PSV Checklist', '개인정보처리동의서', 'Signed CV', 'GCP 교육 이수증',
      '의뢰사 기관선정 승인 메일', 'DD (HCP/HCO Due Diligence)', 'Site Selection Confirmation Letter', 'PSV Follow-up Letter',
      { t: 'PSV Report', w: 'PM 승인본' },
    ],
    SIV: [
      'SIV Pre-Checklist', 'SIV Confirmation Letter',
      { t: '개인정보처리동의서 · CV · GCP 교육 이수증', w: 'PSV 때 못 받았거나 추가된 인력 · GCP 는 2년 이내' },
      'Delegation log', 'Site Visit Record', 'Attendee List', 'Training Signature Form', 'Source Document Agreement', 'Study Material Receipt',
      { t: '기관 계약서 · 조사비 지급 문서 (통장·신분증 사본)', w: 'Non-IRB 기관만' },
      'SIV Follow-up Letter', { t: 'SIV Report', w: 'PM 승인본' },
    ],
    MV: [
      'MV Pre-Checklist', 'MV Confirmation Letter', 'Site Visit Record',
      { t: '개인정보처리동의서 · CV · GCP · Delegation log · Training Signature Form', w: '인력이 바뀌었을 때만' },
      'MV Follow-up Letter', { t: 'MV Report', w: 'PM 승인본' },
    ],
    COV: [
      'COV Confirmation Letter', 'Site Visit Record', 'Delegation log', 'Subject Screening/Enrollment Log', 'Study Material Receipt', 'ISF Checklist',
      'COV Follow-up Letter', { t: 'COV Report', w: 'PM 승인본' },
    ],
  },
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
  return (ETMF_DOCS[project]?.[type.toUpperCase()] || []).map((x) => (typeof x === 'string' ? { t: x } : x))
}

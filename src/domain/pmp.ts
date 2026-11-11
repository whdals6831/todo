import type { CalEvent, Data, DateStr, Holidays, RuleDir, Todo } from '../types/domain.ts'
import { kindOf } from './constants.ts'
import { addWorkdays, isWork, localDay, prevWork, shift, todayStr } from './date.ts'
import { chipSite, siteShort, stripProj } from './project.ts'
import { isGroupRule } from './rules.ts'

/** PMP 표의 기한 하나. 할 일의 마감(본인 기준일 수 있다)과 따로, PMP 원문 기한을 외근 날짜에서 센다 */
interface PmpItem {
  item: string
  /** 비면 모든 방문 종류 */
  types?: string[]
  dir: RuleDir
  n: number
  /** WD 영업일 · CD 달력일 (휴일이면 직전 영업일) */
  unit: 'WD' | 'CD'
  /** 끝냈는지 볼 그 외근의 자동 할 일 제목 */
  todo?: RegExp
  /** 이 항목을 끝낸 날(아직이면 그 PMP 마감)부터 센다 */
  from?: string
  /** 내 일이 아니라(PM 업무) 마감일이 지나면 저절로 끝낸 것으로 본다 */
  auto?: boolean
}

const CL = /Confirmation Letter/i
const ETMF = /eTMF/i

/** 방문·보고서 공통 */
const REPORTS: PmpItem[] = [
  { item: 'Follow-up Letter', dir: 'after', n: 5, unit: 'WD', todo: /Follow-up Letter/i },
  { item: 'Visit Report 작성', dir: 'after', n: 5, unit: 'WD', todo: /(PSV|SIV|MV|COV)R 작성|Report 작성|(PSV|SIV|MV|COV) FUL$/i },
  { item: 'PM 승인', dir: 'after', n: 10, unit: 'WD', todo: /^PM - / },
]

const AZ: PmpItem[] = [
  { item: 'Confirmation Letter', dir: 'before', n: 1, unit: 'WD', todo: CL },
  ...REPORTS,
  { item: 'Sponsor 송부', dir: 'after', n: 15, unit: 'WD', auto: true },
  { item: 'eTMF 문서 보관', dir: 'after', n: 30, unit: 'CD', todo: ETMF },
]

/** 과제별 PMP 기한 (공통 비교표: 방문·보고서·문서) */
export const PMP_DEADLINES: Record<string, PmpItem[]> = {
  'AZ - Imjudo': AZ,
  'AZ - Breztri': AZ,
  'MSD - 엔플론시아': [
    { item: 'Confirmation Letter', types: ['SIV'], dir: 'before', n: 1, unit: 'CD', todo: CL },
    { item: 'Confirmation Letter', types: ['MV', 'COV'], dir: 'before', n: 0, unit: 'CD', todo: CL },
    ...REPORTS,
    { item: 'Sponsor 송부', dir: 'after', n: 15, unit: 'WD', auto: true },
    { item: '종이 바인더 filing', dir: 'after', n: 10, unit: 'WD', todo: /binder/i },
  ],
  'Amgen - Tarlatamab': [
    { item: 'Confirmation Letter', dir: 'before', n: 1, unit: 'CD', todo: CL },
    ...REPORTS,
    { item: 'Amgen 승인 (첫 기관만)', dir: 'after', n: 15, unit: 'WD' },
    { item: 'eTMF 문서 보관 (넘기면 SDM에 지연 사유 통보)', dir: 'after', n: 30, unit: 'CD', todo: ETMF },
    { item: 'Visit Report eTMF 업로드·2-step 승인 (PM 승인 후 5일)', dir: 'after', n: 5, unit: 'CD', from: 'PM 승인' },
  ],
}

export interface PmpDue {
  key: string
  project: string
  item: string
  /** 마감 줄에 보이는 이름 */
  label: string
  /** 캘린더 칸에 보이는 짧은 이름 */
  chip: string
  /** 마감 시간 (할 일에서 온 마감) */
  time?: string
  date: DateStr
  /** 이어진 할 일을 모두 끝낸 날 (마지막 날). 아직이면 "" */
  doneDay: DateStr
  /** 끝냈는지 볼 할 일이 있는가 */
  linked: boolean
}

function countFrom(base: DateStr, x: PmpItem, hol: Holidays): DateStr {
  if (x.unit === 'WD') return addWorkdays(base, x.dir === 'before' ? -x.n : x.n, hol)
  const d = shift(base, x.dir === 'before' ? -x.n : x.n)
  return isWork(d, hol) ? d : prevWork(d, hol)
}

/** 캘린더 칸에 넣을 짧은 항목 이름: 괄호 설명은 빼고 긴 이름은 약어로 */
const chipItem = (item: string) =>
  item
    .replace(/\s*\(.*\)$/, '')
    .replace('Confirmation Letter', 'CL')
    .replace('Follow-up Letter', 'FUL')
    .replace(/^Visit Report/, 'Report')
    .replace(/ 작성$/, '')
    .replace('eTMF 문서 보관', 'eTMF 보관')
    .replace('업로드·2-step 승인', '승인')

/** 외근 하나의 PMP 마감들 */
export function pmpFor(ev: CalEvent, { todos, holidays }: Pick<Data, 'todos' | 'holidays'>): PmpDue[] {
  if (kindOf(ev) !== 'visit' || !ev.type || ev.type === '기타') return []
  const items = (PMP_DEADLINES[ev.project || ''] || []).filter((x) => !x.types || x.types.includes(ev.type || ''))
  /* 끝냈는지 볼 일: 그 외근의 할 일, 묶음(Preparation·방문 후 정리)이면 그 하위 항목 하나하나 (체크한 날이 끝낸 날) */
  const day = (at?: string) => (at && at.length === 10 ? at : localDay(at))
  const mine = [...todos.values()]
    .filter((t) => t.eventId === ev.id)
    .flatMap((t) =>
      isGroupRule(t.ruleId)
        ? (t.subs || []).map((x) => ({ title: x, done: !!t.done || !!t.checks?.includes(x), day: day(t.checkAt?.[x]) || localDay(t.doneAt) }))
        : [{ title: t.title, done: !!t.done, day: localDay(t.doneAt) }],
    )
  const out: PmpDue[] = []
  items.forEach((x, i) => {
    const linked = x.todo ? mine.filter((t) => x.todo!.test(t.title)) : []
    const prev = x.from ? out.find((o) => o.item === x.from) : undefined
    const base = prev ? prev.doneDay || prev.date : ev.date
    const date = countFrom(base, x, holidays)
    /* PM 업무(Sponsor 송부)는 마감일이 지나면 그날 끝낸 것으로 */
    const doneDay = x.auto
      ? date < todayStr() ? date : ''
      : linked.length && linked.every((t) => t.done) ? linked.map((t) => t.day).sort().at(-1) || '' : ''
    out.push({
      key: ev.id + '|' + i, project: ev.project || '', item: x.item, label: siteShort(ev.site) + ' ' + ev.type + ' · ' + x.item,
      chip: chipSite(ev.site) + ' ' + ev.type + ' ' + chipItem(x.item), date, doneDay, linked: linked.length > 0,
    })
  })
  return out
}

/** 제목에 이 말이 든 할 일은 그 마감일에 마감 줄로도 보인다 (OMF, 비용청구, Monthly 업무 계획 보고, QC) */
const TODO_DEADLINE = /OMF|비용\s*청구|업무\s*계획\s*보고|\bQC\b/i

const todoDeadline = (t: Todo, projects: Data['projects']): PmpDue => {
  const name = stripProj(projects, t.title, t.project || '').replace(/\s+/g, ' ').trim()
  return {
    key: t.id, project: t.project || '', item: t.title, label: name + (t.time ? ' · ' + t.time + '까지' : ''), chip: name, time: t.time || undefined,
    date: t.due || '', doneDay: t.done ? localDay(t.doneAt) : '', linked: true,
  }
}

/**
 * 외근과 이어지지 않은 eTMF 업로드·승인 할 일 (받아 온 서명문서 업로드 등): PMP 의 eTMF 문서 보관 30일을
 * 할 일을 만든 날부터 센다 (휴일이면 직전 영업일). 외근 할 일은 그 외근의 PMP 마감 줄로 이미 보인다
 */
const LOOSE_ETMF = /업로드|approve|승인/i
/** "어떻게 업로드할지 PM님 확인" 처럼 묻는 일은 빼고 */
const ASKING = /확인|문의|할지/
const ETMF_30: PmpItem = { item: 'eTMF 문서 보관', dir: 'after', n: 30, unit: 'CD' }
const isLooseEtmf = (t: Todo) =>
  !t.eventId && !!t.created && !t.someday && ETMF.test(t.title) && LOOSE_ETMF.test(t.title) && !ASKING.test(t.title) && !TODO_DEADLINE.test(t.title)

function looseEtmf(t: Todo, { projects, holidays }: Pick<Data, 'projects' | 'holidays'>): PmpDue {
  const name = stripProj(projects, t.title, t.project || '').replace(/\s+/g, ' ').trim()
  return {
    key: t.id + '|etmf', project: t.project || '', item: ETMF_30.item, label: name + ' · 30일', chip: name,
    date: countFrom(localDay(t.created), ETMF_30, holidays), doneDay: t.done ? localDay(t.doneAt) : '', linked: true,
  }
}

type PmpData = Pick<Data, 'events' | 'todos' | 'holidays' | 'projects'>

/** 마감 줄 전체: PMP 마감, 그리고 OMF·비용청구처럼 마감 줄로 보는 할 일, 외근과 이어지지 않은 eTMF 할 일(만든 날부터 30일) */
export const pmpAll = (data: PmpData): PmpDue[] => [
  ...[...data.events.values()].flatMap((ev) => pmpFor(ev, data)),
  ...[...data.todos.values()].filter((t) => t.due && !t.someday && TODO_DEADLINE.test(t.title)).map((t) => todoDeadline(t, data.projects)),
  ...[...data.todos.values()].filter(isLooseEtmf).map((t) => looseEtmf(t, data)),
]

/** 그날이 마감인 것들 */
export const pmpOn = (d: DateStr, data: PmpData): PmpDue[] => pmpAll(data).filter((x) => x.date === d)

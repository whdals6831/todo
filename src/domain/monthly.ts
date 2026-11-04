import { IMJ, kindOf } from './constants.ts'
import { dow, isWork, md, nextWorkOrSame, pad, prevWork, shift } from './date.ts'
import { projShort, siteShort } from './project.ts'
import type { CalEvent, DateStr, Holidays, Project } from '../types/domain.ts'

/** 매월 할 일. 정한 날(start·due 일)에 착수·마감하거나, lastMon 이면 그달 마지막 주 월요일에 착수·마감 */
export interface Monthly {
  id: string
  /** {m} 은 그달 숫자 (11월이면 11) */
  title: string
  project?: string
  start?: number
  due?: number
  lastMon?: boolean
  /** 그달 외근을 하위 항목으로 단다 (과제 약칭 · 기관 · 방문 종류) */
  visits?: boolean
  basis: string
}

export const MONTHLY: Monthly[] = [
  { id: 'plan', title: 'Monthly 업무 계획 보고', start: 24, due: 28, basis: '본인 기준: 매월 24~28일 보고' },
  { id: 'imj-enroll', title: '이뮤도 등록 현황 메일 발송', project: IMJ, lastMon: true, basis: '본인 기준: 매월 마지막 주 월요일 발송' },
  { id: 'claim', title: '{m}월 비용청구', lastMon: true, visits: true, basis: '본인 기준: 매월 마지막 주 월요일, 그달 외근 비용청구' },
]

/** month(YYYY-MM)의 다음 달 */
export const nextMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return m === 12 ? y + 1 + '-01' : y + '-' + pad(m + 1)
}

/** 그달 마지막 월요일 */
export function lastMonday(month: string): DateStr {
  let d = shift(nextMonth(month) + '-01', -1)
  while (dow(d) !== 1) d = shift(d, -1)
  return d
}

/** 매월 할 일의 제목 (그달 숫자를 채운다) */
export const monthlyTitle = (x: Monthly, month: string) => x.title.replace('{m}', String(Number(month.slice(5))))

const VISIT_TAIL = '(PSV|SIV|MV|Add-on|COV)( \\(\\d{1,2}/\\d{1,2}\\))?$'
/** 외근 목록에서 만든 하위 항목 모양 ("Imjudo 가나대병원 MV (11/12)", 예전 것은 날짜 없이) */
/** 하위 항목에서 방문일을 뗀 이름 */
export const visitBase = (s: string) => s.replace(/ \(\d{1,2}\/\d{1,2}\)$/, '')
export const isVisitSub = (s: string) => new RegExp('\\s' + VISIT_TAIL).test(s)

/** 외근을 이 매월 목록에서 뺐다는 표시 (외근의 skip 에 남긴다) */
export const visitSkip = (x: Pick<Monthly, 'id'>) => 'm-' + x.id

/**
 * 그달 외근 목록(비용청구)의 하위 항목: 과제 약칭 · 기관 · 방문 종류 · (방문일), 방문일 순.
 * 자동 할 일이 없는 기타 외근과 목록에서 직접 뺀 외근은 넣지 않는다
 */
export function visitList(month: string, events: Iterable<CalEvent>, projects: Project[], x: Pick<Monthly, 'id'>) {
  const evs = [...events]
    .filter((e) => kindOf(e) === 'visit' && e.date.startsWith(month + '-') && !!e.type && e.type !== '기타' && !e.skip?.includes(visitSkip(x)))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''))
  const names = evs.map((e) => [projShort(projects, e.project), siteShort(e.site), e.type].filter(Boolean).join(' '))
  const day = (d: DateStr) => md(d).replace(/\(.\)$/, '')
  const subs = names.map((n, i) => n + ' (' + day(evs[i].date) + ')')
  return evs.map((ev, i) => ({ ev, sub: subs[i] })).filter((v, i) => subs.indexOf(v.sub) === i)
}
export const visitSubs = (...a: Parameters<typeof visitList>) => visitList(...a).map((v) => v.sub)

/**
 * 그달의 착수·마감. 정한 날: 착수일이 쉬는 날이면 다음 영업일, 마감일이 쉬는 날이면 앞 영업일.
 * 마지막 주 월요일: 그날 착수·마감, 쉬는 날이면 다음 영업일
 */
export function monthlyPlan(month: string, x: Monthly, hol: Holidays) {
  if (x.lastMon) {
    const d0 = lastMonday(month)
    const d = nextWorkOrSame(d0, hol)
    return {
      start: d, due: d,
      basis: '매월 마지막 주 월요일 ' + md(d0) + (d !== d0 ? ' (쉬는 날 → 다음 영업일 ' + md(d) + ')' : '') + ' [' + x.basis + ']',
      startBasis: '마감일 당일 착수',
    }
  }
  const due0: DateStr = month + '-' + pad(x.due ?? 28)
  const start0: DateStr = month + '-' + pad(x.start ?? x.due ?? 28)
  const due = isWork(due0, hol) ? due0 : prevWork(due0, hol)
  const s = nextWorkOrSame(start0, hol)
  const start = s > due ? due : s
  return {
    start, due,
    basis: '매월 ' + x.due + '일' + (due !== due0 ? ' (' + md(due0) + '은 쉬는 날 → 앞 영업일 ' + md(due) + ')' : '') + ' [' + x.basis + ']',
    startBasis: '매월 ' + x.start + '일' + (start !== start0 ? ' (' + md(start0) + '은 쉬는 날 → ' + md(start) + ')' : ''),
  }
}

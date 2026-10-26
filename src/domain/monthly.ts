import { isWork, md, nextWorkOrSame, pad, prevWork } from './date.ts'
import type { DateStr, Holidays } from '../types/domain.ts'

/** 매월 정해진 날에 착수·마감하는 할 일 */
export const MONTHLY = [{ id: 'plan', title: 'Monthly 업무 계획 보고', start: 24, due: 28, basis: '본인 기준: 매월 24~28일 보고' }] as const

export type Monthly = (typeof MONTHLY)[number]

/** month(YYYY-MM)의 다음 달 */
export const nextMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return m === 12 ? y + 1 + '-01' : y + '-' + pad(m + 1)
}

/** 그달의 착수·마감. 착수일이 쉬는 날이면 다음 영업일, 마감일이 쉬는 날이면 앞 영업일 */
export function monthlyPlan(month: string, x: Monthly, hol: Holidays) {
  const due0: DateStr = month + '-' + pad(x.due)
  const start0: DateStr = month + '-' + pad(x.start)
  const due = isWork(due0, hol) ? due0 : prevWork(due0, hol)
  const s = nextWorkOrSame(start0, hol)
  const start = s > due ? due : s
  return {
    start, due,
    basis: '매월 ' + x.due + '일' + (due !== due0 ? ' (' + md(due0) + '은 쉬는 날 → 앞 영업일 ' + md(due) + ')' : '') + ' [' + x.basis + ']',
    startBasis: '매월 ' + x.start + '일' + (start !== start0 ? ' (' + md(start0) + '은 쉬는 날 → ' + md(start) + ')' : ''),
  }
}

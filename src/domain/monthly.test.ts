import { describe, expect, it } from 'vitest'
import { DEFAULT_HOLIDAYS as holidays, IMJ } from './constants.ts'
import type { CalEvent } from '../types/domain.ts'
import { MONTHLY, isVisitSub, lastMonday, monthlyPlan, monthlyTitle, nextMonth, visitSkip, visitSubs } from './monthly.ts'

const plan = MONTHLY[0]

describe('매월 할 일', () => {
  it('24일 착수, 28일 마감', () => {
    expect(monthlyPlan('2026-12', plan, holidays)).toMatchObject({ start: '2026-12-24', due: '2026-12-28' })
  })

  it('착수일이 주말이면 다음 영업일, 마감일이 주말이면 앞 영업일', () => {
    expect(monthlyPlan('2026-10', plan, holidays)).toMatchObject({ start: '2026-10-26', due: '2026-10-28' }) // 10/24(토)
    expect(monthlyPlan('2026-11', plan, holidays)).toMatchObject({ start: '2026-11-24', due: '2026-11-27' }) // 11/28(토)
  })

  it('다음 달 (12월 다음은 이듬해 1월)', () => {
    expect(nextMonth('2026-10')).toBe('2026-11')
    expect(nextMonth('2026-12')).toBe('2027-01')
  })
})

describe('매월 마지막 주 월요일 할 일', () => {
  const imj = MONTHLY.find((x) => x.id === 'imj-enroll')!
  const claim = MONTHLY.find((x) => x.id === 'claim')!

  it('그달 마지막 월요일에 착수·마감, 쉬는 날이면 다음 영업일', () => {
    expect(lastMonday('2026-11')).toBe('2026-11-30')
    expect(lastMonday('2026-12')).toBe('2026-12-28')
    expect(monthlyPlan('2026-11', imj, holidays)).toMatchObject({ start: '2026-11-30', due: '2026-11-30' })
    expect(monthlyPlan('2026-05', claim, holidays)).toMatchObject({ start: '2026-05-26', due: '2026-05-26' }) // 5/25 부처님오신날 대체
    expect(imj.project).toBe(IMJ)
    expect(monthlyTitle(claim, '2026-11')).toBe('11월 비용청구')
  })

  it('비용청구 하위 항목: 그달 외근을 방문일 순으로 "과제 약칭 기관 방문 종류". 같은 이름은 날짜를 붙이고, 기타·뺀 외근은 넣지 않는다', () => {
    const projects = [{ name: IMJ, short: 'Imjudo', sites: [] }, { name: 'B', short: 'Breztri', sites: [] }]
    const v = (id: string, date: string, site: string, type: string, project = IMJ, more: Partial<CalEvent> = {}): CalEvent => ({ id, kind: 'visit', date, site, type, project, ...more })
    const evs = [
      v('a', '2026-11-20', '09. 가나대병원(PI 홍길동)', 'MV'),
      v('b', '2026-11-03', '다라의원', 'SIV', 'B'),
      v('c', '2026-11-25', '가나대병원', 'MV'),
      v('d', '2026-11-10', '마바병원', '기타'),
      v('e', '2026-12-01', '사아병원', 'PSV'),
      v('f', '2026-11-12', '자차병원', 'COV', IMJ, { skip: [visitSkip(claim)] }),
      { id: 'm', kind: 'meeting', date: '2026-11-05', title: '팀 회의' } as CalEvent,
    ]
    expect(visitSubs('2026-11', evs, projects, claim)).toEqual(['Breztri 다라의원 SIV', 'Imjudo 가나대병원 MV (11/20)', 'Imjudo 가나대병원 MV (11/25)'])
    expect(isVisitSub('Imjudo 가나대병원 MV (11/20)') && isVisitSub('Breztri 다라의원 Add-on')).toBe(true)
    expect(isVisitSub('영수증 정리')).toBe(false)
  })
})

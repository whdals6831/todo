import { describe, expect, it } from 'vitest'
import { DEFAULT_HOLIDAYS as holidays } from './constants.ts'
import { MONTHLY, monthlyPlan, nextMonth } from './monthly.ts'

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

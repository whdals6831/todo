import { describe, expect, it } from 'vitest'
import { DEFAULT_HOLIDAYS as H } from './constants.ts'
import { addWorkdays, diffDays, holidaysBetween, isWork, md, nextWork, nextWorkOrSame, prevWork, shift } from './date.ts'

describe('날짜 계산', () => {
  it('하루씩 움직이고 월·연도를 넘긴다', () => {
    expect(shift('2026-12-31', 1)).toBe('2027-01-01')
    expect(shift('2026-03-01', -1)).toBe('2026-02-28')
    expect(diffDays('2026-10-18', '2026-10-21')).toBe(3)
    expect(md('2026-10-09')).toBe('10/9(금)')
  })

  it('주말과 공휴일은 영업일이 아니다', () => {
    expect(isWork('2026-10-09', H)).toBe(false) // 한글날
    expect(isWork('2026-10-10', H)).toBe(false) // 토요일
    expect(isWork('2026-10-12', H)).toBe(true)
  })

  it('영업일을 센다 (2026년 10월: 개천절 대체 10/5, 한글날 10/9)', () => {
    expect(addWorkdays('2026-10-08', 1, H)).toBe('2026-10-12')
    expect(addWorkdays('2026-10-08', 3, H)).toBe('2026-10-14')
    expect(addWorkdays('2026-10-08', -3, H)).toBe('2026-10-02')
    expect(addWorkdays('2026-10-08', 0, H)).toBe('2026-10-08')
    expect(prevWork('2026-10-06', H)).toBe('2026-10-02')
    expect(nextWork('2026-10-08', H)).toBe('2026-10-12')
    expect(nextWorkOrSame('2026-10-10', H)).toBe('2026-10-12')
    expect(nextWorkOrSame('2026-10-12', H)).toBe('2026-10-12')
  })

  it('추석 연휴를 건너뛴다', () => {
    expect(addWorkdays('2026-09-23', 1, H)).toBe('2026-09-28')
  })

  it('사이의 평일 공휴일만 이름과 함께 돌려준다', () => {
    expect(holidaysBetween('2026-10-02', '2026-10-13', H)).toEqual(['10/5(월) 개천절 대체', '10/9(금) 한글날'])
    expect(holidaysBetween('2026-10-13', '2026-10-02', H)).toHaveLength(2)
  })
})

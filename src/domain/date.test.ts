import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_HOLIDAYS as H } from './constants.ts'
import {
  addWorkdays, diffDays, holidaysBetween, isWork, localDay, localHM, md, mkDoneAt, nextWork, nextWorkOrSame, prevWork, setTimeZone, shift,
} from './date.ts'

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

/* 테스트는 TZ=Asia/Seoul 로 돈다 (vite.config.ts). 서버처럼 시간대를 직접 정해도 결과가 같아야 한다 */
describe('시간대', () => {
  afterEach(() => setTimeZone(''))
  const instants = ['2026-10-18T14:59:00Z', '2026-10-18T15:00:00Z', '2026-12-31T23:30:00Z', '2026-03-01T00:00:00Z']

  it('Asia/Seoul 로 정하면 기기 시간대(한국)와 같다', () => {
    const local = instants.map((i) => [localDay(i), localHM(i)])
    setTimeZone('Asia/Seoul')
    expect(instants.map((i) => [localDay(i), localHM(i)])).toEqual(local)
    expect(mkDoneAt('2026-10-19', '08:30')).toBe('2026-10-18T23:30:00.000Z')
    expect(mkDoneAt('2026-10-19', '', '2026-10-01T00:05:00Z')).toBe('2026-10-19T00:05:00.000Z')
  })

  it('UTC 로 정하면 UTC 날짜·시각으로 센다', () => {
    setTimeZone('UTC')
    expect(localDay('2026-10-18T15:00:00Z')).toBe('2026-10-18')
    expect(localHM('2026-10-18T15:00:00Z')).toBe('15:00')
    expect(mkDoneAt('2026-10-19', '08:30')).toBe('2026-10-19T08:30:00.000Z')
  })
})

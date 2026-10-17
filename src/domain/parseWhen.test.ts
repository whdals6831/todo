import { describe, expect, it } from 'vitest'
import { parseWhen } from './parseWhen.ts'

/** 2026-10-14 수요일 */
const TODAY = '2026-10-14'
const p = (s: string, today = TODAY) => parseWhen(s, today)

describe('parseWhen', () => {
  it('월/일과 "까지"를 읽고 제목에서 뺀다', () => {
    expect(p('가나대 EDC 요청 ~10/15')).toEqual({ title: '가나대 EDC 요청', due: '2026-10-15', time: '', tbd: false })
    expect(p('11월 3일까지 회신')).toMatchObject({ title: '회신', due: '2026-11-03' })
    expect(p('2026.12.1 마감')).toMatchObject({ title: '마감', due: '2026-12-01' })
  })

  it('60일 넘게 지난 월/일은 내년으로 본다', () => {
    expect(p('1/5 신년 인사', '2026-12-28').due).toBe('2027-01-05')
    expect(p('10/1 정리').due).toBe('2026-10-01')
  })

  it('없는 날짜는 날짜로 읽지 않는다', () => {
    expect(p('2/30 확인').due).toBe('')
    expect(p('v1.2 문서 검토')).toMatchObject({ title: 'v1.2 문서 검토', due: '' })
  })

  it('요일과 상대 날짜', () => {
    expect(p('금요일 14시 TC')).toEqual({ title: 'TC', due: '2026-10-16', time: '14:00', tbd: false })
    expect(p('내일 정리').due).toBe('2026-10-15')
    expect(p('다음주 월 회의').due).toBe('2026-10-19')
    expect(p('이번주 금 마감').due).toBe('2026-10-16')
    expect(p('차주 수요일 SIV').due).toBe('2026-10-21')
  })

  it('시간: 오전·오후가 없으면 1~7시는 오후', () => {
    expect(p('3시 통화').time).toBe('15:00')
    expect(p('9시 반 회의').time).toBe('09:30')
    expect(p('오후 12시 반').time).toBe('12:30')
    expect(p('오전 12시').time).toBe('00:00')
    expect(p('16:30 TC').time).toBe('16:30')
    expect(p('3시간 교육')).toMatchObject({ title: '3시간 교육', time: '' })
  })

  it('"오전 중"은 그날 11:30', () => {
    expect(p('바인더 요청 오전 중')).toMatchObject({ title: '바인더 요청', due: TODAY, time: '11:30' })
    expect(p('내일 오전까지 보고')).toMatchObject({ title: '보고', due: '2026-10-15', time: '11:30' })
  })

  it('TBD·미정은 날짜를 비운다', () => {
    expect(p('계약 확인 TBD')).toEqual({ title: '계약 확인', due: '', time: '', tbd: true })
    expect(p('(미정) 10/20 서명')).toMatchObject({ due: '', tbd: true })
  })
})

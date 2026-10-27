import { describe, expect, it } from 'vitest'
import type { CalEvent, Todo } from '../types/domain.ts'
import { DEFAULT_HOLIDAYS as holidays } from './constants.ts'
import { pmpFor, pmpOn } from './pmp.ts'

/** 2026-10-08 목요일 외근 (다음 날 한글날) */
const visit = (o: Partial<CalEvent> = {}): CalEvent => ({ id: 'ev1', kind: 'visit', date: '2026-10-08', type: 'MV', project: 'AZ - Breztri', site: '가나대병원', ...o })
const todo = (id: string, title: string, o: Partial<Todo> = {}): Todo => ({ id, title, eventId: 'ev1', done: false, ...o })
const projects = [{ name: 'AZ - Breztri', short: 'Breztri', sites: [], aliases: ['브레즈트리'] }]
const data = (ev: CalEvent, list: Todo[] = []) => ({ events: new Map([[ev.id, ev]]), todos: new Map(list.map((t) => [t.id, t])), holidays, projects })
const dates = (ev: CalEvent, list: Todo[] = []) => Object.fromEntries(pmpFor(ev, data(ev, list)).map((x) => [x.item, x.date]))

describe('PMP 마감', () => {
  it('외근 날짜에서 PMP 표대로 센다 (WD 는 공휴일 제외, CD 가 휴일이면 직전 영업일)', () => {
    expect(dates(visit())).toEqual({
      'Confirmation Letter': '2026-10-07',
      'Follow-up Letter': '2026-10-16',
      'Visit Report 작성': '2026-10-16',
      'PM 승인': '2026-10-23',
      'Sponsor 송부': '2026-10-30',
      'eTMF 문서 보관': '2026-11-06', // 11/7(토) → 11/6(금)
    })
  })

  it('엔플론시아 CL 은 SIV 하루 전, MV·COV 는 방문일까지', () => {
    expect(dates(visit({ project: 'MSD - 엔플론시아', type: 'SIV' }))['Confirmation Letter']).toBe('2026-10-07')
    expect(dates(visit({ project: 'MSD - 엔플론시아', type: 'MV' }))['Confirmation Letter']).toBe('2026-10-08')
  })

  it('Tarlatamab Visit Report eTMF 승인은 PM 승인을 끝낸 날(아직이면 PM 승인 마감)부터 5일', () => {
    const ev = visit({ project: 'Amgen - Tarlatamab' })
    const key = 'Visit Report eTMF 업로드·2-step 승인 (PM 승인 후 5일)'
    expect(dates(ev)[key]).toBe('2026-10-28')
    expect(dates(ev, [todo('pm', 'PM - Tarlatamab 가나대병원 MV (WD10)', { done: true, doneAt: '2026-10-20T01:00:00.000Z' })])[key]).toBe('2026-10-23')
  })

  it('이어진 할 일을 모두 끝냈으면 끝낸 날, 그날 마감인 것만 고른다', () => {
    const ev = visit()
    const list = [
      todo('ful', '가나대병원 MV Follow-up Letter 발송', { done: true, doneAt: '2026-10-14T01:00:00.000Z' }),
      todo('scan', '가나대병원 MV 서명문서 스캔·eTMF 업로드', { done: true, doneAt: '2026-10-12T01:00:00.000Z' }),
      todo('etmf', '가나대병원 MV 서명문서 eTMF 업로드'),
    ]
    const on = pmpOn('2026-10-16', data(ev, list))
    expect(on.map((x) => [x.item, x.doneDay, x.linked])).toEqual([
      ['Follow-up Letter', '2026-10-14', true],
      ['Visit Report 작성', '', false],
    ])
    expect(pmpOn('2026-11-06', data(ev, list))[0]).toMatchObject({ item: 'eTMF 문서 보관', doneDay: '', linked: true })
  })

  it('캘린더 칸 이름은 기관을 줄이고 긴 항목은 약어로', () => {
    const chips = (ev: CalEvent) => pmpFor(ev, data(ev)).map((x) => x.chip)
    expect(chips(visit({ site: '09. 가나대병원(PI 홍길동)' }))).toEqual([
      '가나대 MV CL', '가나대 MV FUL', '가나대 MV Report', '가나대 MV PM 승인', '가나대 MV Sponsor 송부', '가나대 MV eTMF 보관',
    ])
    expect(chips(visit({ project: 'Amgen - Tarlatamab' })).slice(-3)).toEqual(['가나대 MV Amgen 승인', '가나대 MV eTMF 보관', '가나대 MV Report eTMF 승인'])
  })
})

describe('마감 줄로 보는 할 일', () => {
  it('제목에 OMF 가 든 할 일은 그 마감일에 마감 줄로도 보인다 (과제 이름은 빼고, 시간은 붙인다)', () => {
    const list = [
      todo('omf', '브레즈트리 OMF 입력 완료', { eventId: undefined, project: 'AZ - Breztri', due: '2026-10-23', time: '11:30' }),
      todo('etc', '브레즈트리 보고서 정리', { eventId: undefined, project: 'AZ - Breztri', due: '2026-10-23' }),
    ]
    expect(pmpOn('2026-10-23', data(visit({ date: '2026-12-01' }), list)).map((x) => [x.project, x.label, x.chip, x.time, x.linked])).toEqual([
      ['AZ - Breztri', 'OMF 입력 완료 · 11:30까지', 'OMF 입력 완료', '11:30', true],
    ])
  })

  it('비용청구, Monthly 업무 계획 보고, QC 도 마감 줄로 보인다', () => {
    const list = [
      todo('cost', '브레즈트리 10월 비용 청구', { eventId: undefined, project: 'AZ - Breztri', due: '2026-10-28' }),
      todo('plan', 'Monthly 업무 계획 보고', { eventId: undefined, due: '2026-10-28' }),
      todo('qc', '암젠 eTMF QC', { eventId: undefined, due: '2026-10-28' }),
      todo('qcx', 'QCR 정리', { eventId: undefined, due: '2026-10-28' }),
    ]
    expect(pmpOn('2026-10-28', data(visit({ date: '2026-12-01' }), list)).map((x) => x.chip)).toEqual(['10월 비용 청구', 'Monthly 업무 계획 보고', '암젠 eTMF QC'])
  })
})

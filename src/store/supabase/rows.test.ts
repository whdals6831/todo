import { describe, expect, it } from 'vitest'
import type { CalEvent, Todo } from '../../types/domain.ts'
import { eventToRow, rowToEvent, rowToTodo, todoToRow } from './rows.ts'

describe('행 변환', () => {
  it('할 일: 이름을 바꾸고, 빈 날짜는 null, 없는 필드도 null 로 보낸다', () => {
    const t: Todo = { id: 'a_ev1_r-ful', title: '가나대 MV FUL', due: '', start: '2026-10-20', time: '', done: false, rank: 1.5, ruleId: null, eventId: 'ev1', autoDue: false }
    const row = todoToRow(t)
    expect(row).toMatchObject({ id: 'a_ev1_r-ful', due: null, start: '2026-10-20', time: '', rank: 1.5, rule_id: null, event_id: 'ev1', auto_due: false })
    expect(row).toHaveProperty('note', null)
    expect(row).toHaveProperty('done_at', null)
  })

  it('할 일: DB 에서 읽으면 마감·착수는 "" 로, 나머지 null 은 없는 필드로', () => {
    const t = rowToTodo({ id: 'x', title: 't', due: null, start: null, time: '', done: true, done_at: '2026-10-16T01:00:00+00:00', rank: null, note: null, updated_at: '…' })
    expect(t).toEqual({ id: 'x', title: 't', due: '', start: '', time: '', done: true, doneAt: '2026-10-16T01:00:00.000Z' })
  })

  it('일정: 배열·빈 종료일 왕복', () => {
    const e: CalEvent = { id: 'ev1', kind: 'visit', date: '2026-10-21', endDate: '', time: '14:00', type: 'MV', skip: ['r-cl'], genKey: 'v3|…' }
    const back = rowToEvent(JSON.parse(JSON.stringify(eventToRow(e))))
    expect(back).toEqual(e)
  })
})

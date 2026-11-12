import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Todo } from '../types/domain.ts'
import { byPriority, dueTone, isUrgent } from './priority.ts'

const todo = (o: Partial<Todo> = {}): Todo => ({ id: 't', title: '일', done: false, ...o })

describe('마감 색 (dueTone)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('지난 일은 late(보라), 오늘·내일 마감은 soon(빨강), 그 뒤·완료·자동 마감은 없음', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-10T09:00:00+09:00'))
    expect(dueTone(todo({ due: '2026-11-09' }))).toBe('late')
    expect(dueTone(todo({ due: '2026-11-10' }))).toBe('soon')
    expect(dueTone(todo({ due: '2026-11-11' }))).toBe('soon')
    expect(dueTone(todo({ due: '2026-11-12' }))).toBe('')
    expect(dueTone(todo({ due: '2026-11-09', done: true }))).toBe('')
    expect(dueTone(todo({ due: '2026-11-09', autoDue: true }))).toBe('')
    expect(isUrgent(todo({ due: '2026-11-09' }))).toBe(true)
    expect(isUrgent(todo({ due: '2026-11-12' }))).toBe(false)
  })
})

describe('할 일 순서 (byPriority)', () => {
  it('지난 마감 다음 오늘 마감, 같은 마감이면 하위 항목 없는 일이 먼저 (시간보다 앞)', () => {
    const list = [
      todo({ id: 'sub', title: '가 방문 후 정리', due: '2026-11-12', subs: ['FUL 발송'] }),
      todo({ id: 'one', title: '나 OMF 업데이트', due: '2026-11-12', time: '17:00' }),
      todo({ id: 'sub2', title: '다 Preparation', due: '2026-11-12', time: '09:00', subs: ['CL 발송'] }),
      todo({ id: 'late', title: '라 지난 일', due: '2026-11-11', subs: ['x'] }),
      todo({ id: 'two', title: '마 비용 청구', due: '2026-11-12' }),
    ]
    expect(list.sort(byPriority).map((x) => x.id)).toEqual(['late', 'one', 'two', 'sub2', 'sub'])
  })
})

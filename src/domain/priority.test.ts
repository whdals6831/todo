import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Todo } from '../types/domain.ts'
import { byPriority, dueTone, isUrgent, sortTodos } from './priority.ts'

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

describe('직접 정한 순서와 새 할 일 (sortTodos)', () => {
  it('순서를 정한 뒤에 생긴 할 일은 맨 아래가 아니라 마감 자리에 (같은 마감이면 하위 항목 있는 일보다 위)', () => {
    const list = [
      todo({ id: 'r-late', due: '2026-11-11', rank: 0, subs: ['x'] }),
      todo({ id: 'r-today', due: '2026-11-12', rank: 1, subs: ['x'] }),
      todo({ id: 'r-next', due: '2026-11-13', rank: 2 }),
      todo({ id: 'new-today', due: '2026-11-12' }),
      todo({ id: 'new-late', due: '2026-11-11' }),
      todo({ id: 'new-far', due: '2026-12-01' }),
      todo({ id: 'done', due: '2026-11-01', done: true }),
    ]
    expect(sortTodos(list).map((x) => x.id)).toEqual(['new-late', 'r-late', 'new-today', 'r-today', 'r-next', 'new-far', 'done'])
  })

  it('직접 정한 순서끼리는 그대로', () => {
    const list = [todo({ id: 'b', due: '2026-11-10', rank: 1 }), todo({ id: 'a', due: '2026-11-20', rank: 0 }), todo({ id: 'n', due: '2026-11-15' })]
    expect(sortTodos(list).map((x) => x.id)).toEqual(['n', 'a', 'b'])
  })
})

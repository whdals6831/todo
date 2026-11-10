import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Todo } from '../types/domain.ts'
import { dueTone, isUrgent } from './priority.ts'

const todo = (o: Partial<Todo> = {}): Todo => ({ id: 't', title: '일', done: false, ...o })

describe('마감 색 (dueTone)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('지난 일은 late(빨강), 오늘·내일 마감은 soon(주황), 그 뒤·완료·자동 마감은 없음', () => {
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

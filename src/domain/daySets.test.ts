import { describe, expect, it } from 'vitest'
import type { Todo } from '../types/domain.ts'
import { deadlinesOn, doneElsewhere } from './daySets.ts'

const todo = (id: string, o: Partial<Todo> = {}): Todo => ({ id, title: id, due: '2026-10-22', done: false, ...o })
const todos = new Map(
  [
    todo('open'),
    todo('early', { done: true, doneAt: '2026-10-16T01:00:00.000Z' }),
    todo('ontime', { done: true, doneAt: '2026-10-22T01:00:00.000Z' }),
    todo('someday', { someday: true }),
    todo('other', { due: '2026-10-23' }),
  ].map((t) => [t.id, t]),
)

describe('마감 줄', () => {
  it('그날 마감인 할 일은 끝냈어도 남긴다 (Someday 빼고)', () => {
    expect(deadlinesOn('2026-10-22', todos).map((t) => t.id).sort()).toEqual(['early', 'ontime', 'open'])
  })

  it('마감일보다 다른 날에 끝낸 할 일만 할 일 목록에서 빠진다', () => {
    expect([...todos.values()].filter((t) => doneElsewhere(t, '2026-10-22')).map((t) => t.id)).toEqual(['early'])
  })
})

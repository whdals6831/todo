import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Todo } from '../types/domain.ts'
import { briefData, dayComplete, daySet, todaySet } from './daySets.ts'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-28T18:00:00+09:00'))
})
afterEach(() => vi.useRealTimers())

const map = (xs: Todo[]) => new Map(xs.map((x) => [x.id, x]))

describe('끝낸 일은 실제로 끝낸 날에', () => {
  const todos = map([
    { id: 'early', title: '오늘 마감, 어제 끝냄', due: '2026-10-28', done: true, doneAt: '2026-10-27T08:00:00.000Z' },
    { id: 'late', title: '어제 마감, 오늘 끝냄', due: '2026-10-27', done: true, doneAt: '2026-10-28T02:00:00.000Z' },
    { id: 'now', title: '오늘 마감, 오늘 끝냄', due: '2026-10-28', done: true, doneAt: '2026-10-28T03:00:00.000Z' },
    { id: 'old', title: '완료 시각 없는 옛 기록', due: '2026-10-27', done: true },
  ])

  it('오늘 완료는 오늘 끝낸 일만', () => {
    expect(todaySet('2026-10-28', todos).doneT.map((x) => x.id)).toEqual(['late', 'now'])
  })

  it('지난 날은 그날 끝낸 일, 그날 마감인데 나중에 끝낸 일은 못 끝낸 일', () => {
    expect(daySet('2026-10-27', todos).done.map((x) => x.id)).toEqual(['early', 'old'])
    const b = briefData('2026-10-27', new Date(), { todos, holidays: {} })!
    expect(b.done.map((x) => x.id)).toEqual(['old', 'early'])
    expect(b.left.map((x) => x.id)).toEqual(['late'])
    expect(dayComplete('2026-10-27', todos)).toBe(false)
  })
})

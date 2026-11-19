import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CalEvent, Rule, Todo } from '../types/domain.ts'
import { briefData, dayComplete, daySet, todayBuckets, todayCount } from './daySets.ts'
import { candidates, inToday, planItems, pmpDues, type PlanCtx } from './plan.ts'

const T = '2026-11-19'
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(T + 'T09:00:00+09:00'))
})
afterEach(() => vi.useRealTimers())

const rule = (id: string, title: string, n: number, over: Partial<Rule> = {}): Rule => ({
  id, key: '', type: 'SIV', project: '*', title, dir: 'before', n, unit: 'WD', send: false, verify: false, start: 'due', startN: 0, ...over,
})
const ev: CalEvent = { id: 'ev', kind: 'visit', date: '2026-11-25', type: 'SIV', project: 'P', site: '가나대병원', createdDate: '2026-11-10' }
const ctx: PlanCtx = {
  rules: [
    rule('r-a', '{site} {type} 도시락 예약', 3, { start: 'lead', startN: 2 }),
    rule('r-b', '{site} {type} PPT 인쇄', 1),
    rule('r-c', '{site} {type} EDC 계정 요청', 5),
    rule('r-send', '{site} {type} CL 발송', 2, { key: 'OWN', send: true }),
  ],
  holidays: {},
  events: new Map([[ev.id, ev]]),
  projects: [{ name: 'P', short: 'Pj', sites: [] }],
}
const map = (xs: Todo[]) => new Map(xs.map((x) => [x.id, x]))
const bundle: Todo = {
  id: 'a_ev_g-prep', title: '가나대병원 SIV Preparation', due: '2026-11-24', start: '2026-11-18', eventId: 'ev', ruleId: 'g-prep', project: 'P',
  subs: ['도시락 예약', 'PPT 인쇄', 'EDC 계정 요청'],
}
const base: Todo[] = [
  bundle,
  { id: 'due', title: '오늘 마감', due: T },
  { id: 'late', title: '어제 마감', due: '2026-11-18' },
  { id: 'started', title: '착수만 지난 일', due: '2026-11-30', start: '2026-11-17' },
  { id: 'send', title: '자료 송부', due: '2026-11-30', start: '2026-11-17' },
  { id: 'future', title: '아직 착수 전', due: '2026-11-30', start: '2026-11-25' },
  { id: 'tbd', title: '마감 미정', due: '', tbd: true },
  { id: 'some', title: '언젠가', due: '', someday: true },
  { id: 'cl', title: '가나대병원 SIV CL 발송', due: '2026-11-30', start: '2026-11-17', ruleId: 'r-send', eventId: 'ev' },
]
const keys = (xs: { key: string }[]) => xs.map((x) => x.key)

describe('오늘 할 일을 직접 고른다', () => {
  it('아무것도 고르지 않은 날: 오늘 마감 + 마감 지난 일만 (착수일만 지난 일은 후보로)', () => {
    const b = todayBuckets(T, { todos: map(base), events: ctx.events, ctx })
    expect(keys(b.late)).toEqual(['a_ev_g-prep', 'late'])
    expect(keys(b.open)).toEqual(['due'])
    expect(todayCount(T, map(base), ctx)).toBe(3)
  })

  it('후보: 착수일이 오늘 이전이거나 없는 일. 마감 임박순, 같은 마감이면 보내는 일이 위. Someday·착수 전은 빼고', () => {
    const b = todayBuckets(T, { todos: map(base), events: ctx.events, ctx })
    expect(keys(b.cands)).toEqual(['cl', 'send', 'started', 'tbd'])
    expect(keys(b.soon)).toEqual(['future'])
  })

  it('묶음은 한 줄: 남은 하위 항목 중 가장 이른 날짜로. 풀어 보면 하위 항목이 각자 날짜로 (체크한 것은 빼고)', () => {
    const one = map([{ ...bundle, checks: ['EDC 계정 요청'] }])
    expect(planItems(one, ctx).map((x) => [x.title, x.due, x.start])).toEqual([[bundle.title, '2026-11-20', '2026-11-18']])
    const items = planItems(one, ctx, true)
    expect(items.map((x) => [x.title, x.due, x.start])).toEqual([
      ['가나대병원 SIV 도시락 예약', '2026-11-20', '2026-11-18'],
      ['가나대병원 SIV PPT 인쇄', '2026-11-24', '2026-11-24'],
    ])
    expect(items.some((x) => x.title === bundle.title)).toBe(false)
  })

  it('오늘에 넣으면 바로 오늘 화면에, 다음 날에는 후보로 돌아간다 (마감이 지났으면 자동으로 남는다)', () => {
    const picked = map(base.map((x) => (x.id === 'started' ? { ...x, today: T } : x.id === bundle.id ? { ...x, subToday: { '도시락 예약': T } } : x)))
    const b = todayBuckets(T, { todos: picked, events: ctx.events, ctx })
    expect(keys(b.open)).toEqual(['due', 'started'])
    expect(keys(b.cands)).toEqual(['cl', 'send', 'tbd'])
    /* 날이 바뀜 */
    vi.setSystemTime(new Date('2026-11-20T09:00:00+09:00'))
    const n = todayBuckets('2026-11-20', { todos: picked, events: ctx.events, ctx })
    expect(keys(n.open)).toEqual([])
    expect(keys(n.late)).toEqual(['a_ev_g-prep', 'late', 'due'])
    expect(keys(n.cands)).toContain('started')
  })

  it('"내일로" 고른 일은 오늘 화면에는 없고 내일 목록에 보인다', () => {
    const todos = map(base.map((x) => (x.id === 'started' ? { ...x, today: '2026-11-20' } : x)))
    expect(planItems(todos, ctx).filter((x) => inToday(x, T)).some((x) => x.key === 'started')).toBe(false)
    expect(keys(candidates(planItems(todos, ctx), T))).toContain('started')
    expect(daySet('2026-11-20', todos, ctx).open.map((x) => x.id)).toEqual(['a_ev_g-prep', 'started'])
  })

  it('브리핑·완료 표시도 오늘 화면 기준 (묶음은 한 줄)', () => {
    const b = briefData(T, new Date(), { todos: map(base), holidays: {}, ctx })!
    expect(b.left.map((x) => x.title)).toEqual(['가나대병원 SIV Preparation', '어제 마감', '오늘 마감'])
    const done = map([{ id: 'x', title: '끝', due: T, done: true, doneAt: T + 'T01:00:00.000Z' }, { id: 'started', title: '착수만 지난 일', due: '2026-11-30', start: '2026-11-17' }])
    expect(dayComplete(T, done, ctx)).toBe(true)
  })
})

describe('PMP 기한', () => {
  it('서명문서 eTMF 업로드: 본인 기준 마감과 따로 방문 후 30일', () => {
    const mv: CalEvent = { id: 'mv', kind: 'visit', date: '2026-10-20', type: 'MV', project: 'AZ - Imjudo', site: '가나대병원' }
    const todos = map([{ id: 'e', title: '가나대병원 MV 서명문서 eTMF 업로드', due: '2026-11-03', eventId: 'mv', ruleId: 'r-etmf-i' }])
    expect(pmpDues({ events: new Map([[mv.id, mv]]), todos, holidays: {}, projects: [] }).get('e')).toBe('2026-11-19')
  })
})

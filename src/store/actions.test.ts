import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_HOLIDAYS } from '../domain/constants.ts'
import type { CalEvent, Rule } from '../types/domain.ts'
import { addTodo, dismissTodo, moveTodo, putEvent, putTodo, replaceAll, setRepository, syncEvent } from './actions.ts'
import { createMemoryRepository } from './localRepository.ts'
import { getState } from './store.ts'

const RULES: Rule[] = [
  { id: 'r-ful', key: 'FUL', type: '*', project: '*', title: '{site} {type} FUL', dir: 'after', n: 3, unit: 'WD', send: false, verify: false, start: 'due', startN: 0 },
  { id: 'r-cl', key: 'CL', type: '*', project: '*', title: '{site} {type} CL', dir: 'before', n: 3, unit: 'WD', send: true, verify: true, start: 'lead', startN: 2 },
]
const visit: CalEvent = { id: 'ev1', kind: 'visit', date: '2026-10-21', type: 'MV', project: 'P', site: '09. 가나대병원(PI 홍길동)', createdDate: '2026-10-12' }
const todos = () => [...getState().todos.values()]

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-12T09:00:00+09:00'))
  setRepository(createMemoryRepository())
  await replaceAll({
    events: [], todos: [], fuls: [],
    config: {
      rules: RULES, holidays: DEFAULT_HOLIDAYS, mig: ['scan1'], notes: null,
      projects: [{ name: 'P', short: 'Pj', sites: [] }],
      companions: [{ project: 'P', keyword: 'OMF', items: ['로그 업데이트', '마일스톤 작성'] }],
    },
  })
})
afterEach(() => vi.useRealTimers())

describe('외근 → 자동 할 일', () => {
  it('규칙마다 고정 id 로 만들고, 다시 맞춰도 늘어나지 않는다', async () => {
    await putEvent(visit)
    await syncEvent(visit)
    expect(todos().map((t) => [t.id, t.due]).sort()).toEqual([
      ['a_ev1_r-cl', '2026-10-15'],
      ['a_ev1_r-ful', '2026-10-26'],
    ])
    await syncEvent(getState().events.get('ev1')!, true)
    expect(todos()).toHaveLength(2)
    expect(getState().events.get('ev1')!.genKey).toMatch(/^v3\|2026-10-21\|MV/)
  })

  it('직접 지운 자동 할 일은 skip 에 남아 다시 생기지 않는다', async () => {
    await putEvent(visit)
    await syncEvent(visit)
    await dismissTodo('a_ev1_r-cl')
    expect(getState().events.get('ev1')!.skip).toEqual(['r-cl'])
    await syncEvent(getState().events.get('ev1')!, true)
    expect(todos().map((t) => t.id)).toEqual(['a_ev1_r-ful'])
  })

  it('직접 옮긴 할 일은 -manual 이 되어 규칙이 바뀌어도 그대로 둔다', async () => {
    await putEvent(visit)
    await syncEvent(visit)
    await moveTodo(getState().todos.get('a_ev1_r-ful'), '2026-10-30', '드래그로 변경')
    const moved = getState().todos.get('a_ev1_r-ful')!
    expect(moved).toMatchObject({ due: '2026-10-30', ruleId: 'r-ful-manual' })
    expect(moved.basis).toContain('드래그로 변경 → 10/30(금)')
    await syncEvent({ ...getState().events.get('ev1')!, date: '2026-10-22' }, true)
    expect(getState().todos.get('a_ev1_r-ful')!.due).toBe('2026-10-30')
  })
})

describe('할 일 추가', () => {
  it('키워드가 있으면 함께 추가할 할 일을 같은 마감으로 만들고, 마감을 옮기면 따라온다', async () => {
    const id = await addTodo({ title: '가나대 OMF 제출', project: 'P', due: '2026-10-20', done: false })
    const kids = todos().filter((t) => t.parentId === id)
    expect(kids.map((t) => [t.title, t.due])).toEqual([
      ['가나대 로그 업데이트', '2026-10-20'],
      ['가나대 마일스톤 작성', '2026-10-20'],
    ])
    await moveTodo(getState().todos.get(id), '2026-10-23', '직접 변경')
    expect(todos().filter((t) => t.parentId === id).every((t) => t.due === '2026-10-23')).toBe(true)
  })

  it('SAE IRB 제출 요청을 완료하면 WD2 확인 할 일이 생기고, 완료를 취소하면 사라진다', async () => {
    const id = await addTodo({ title: '가나대 SAE IRB 제출 요청', due: '2026-10-12', done: false })
    await putTodo({ ...getState().todos.get(id)!, done: true, doneAt: new Date().toISOString() })
    expect(getState().todos.get('f_' + id + '_sae-irb')).toMatchObject({ title: '가나대 SAE IRB 제출 여부 확인', due: '2026-10-14' })
    await putTodo({ ...getState().todos.get(id)!, done: false, doneAt: null })
    expect(getState().todos.has('f_' + id + '_sae-irb')).toBe(false)
  })
})

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
      rules: RULES, holidays: DEFAULT_HOLIDAYS, mig: ['scan1', 'ful5'], notes: null,
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
    expect(getState().events.get('ev1')!.genKey).toMatch(/^v5\|2026-10-21\|MV/)
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

  it('같은 일을 직접 만들어 두었으면 하나로 합친다: 열린 할 일은 규칙 날짜로, 끝낸 할 일은 그대로', async () => {
    const open = await addTodo({ title: 'Pj 가나대 MV FUL', project: 'P', due: '2026-10-24', note: '메모', done: false })
    const done = await addTodo({ title: 'Pj 가나대 MV CL', project: 'P', due: '2026-10-14', done: true })
    await putEvent(visit)
    await syncEvent(visit)
    expect(todos().map((t) => t.id).sort()).toEqual(['a_ev1_r-ful', done].sort())
    expect(getState().todos.get('a_ev1_r-ful')).toMatchObject({ title: '가나대병원 MV FUL', due: '2026-10-26', ruleId: 'r-ful' })
    expect(getState().todos.get('a_ev1_r-ful')!.note).toBeUndefined()
    expect(getState().todos.get(done)).toMatchObject({ eventId: 'ev1', ruleId: 'r-cl-manual', due: '2026-10-14' })
    expect(open).not.toBe('a_ev1_r-ful')
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

describe('저장된 규칙 옮기기', () => {
  it('FUL 은 방문 후 WD5 마감·착수는 마감 2영업일 전으로 바꾸고, 열린 FUL 할 일도 옮긴다', async () => {
    const config = (mig: string[]) => ({ rules: [{ ...RULES[0], send: true }], holidays: DEFAULT_HOLIDAYS, mig, notes: null, projects: [{ name: 'P', short: 'Pj', sites: [] }], companions: [] })
    await replaceAll({ events: [], todos: [], fuls: [], config: config(['scan1', 'prep1', 'ful5']) })
    await putEvent(visit)
    await syncEvent(visit)
    expect(getState().todos.get('a_ev1_r-ful')!.due).toBe('2026-10-23')
    await replaceAll({ events: [...getState().events.values()], todos: todos(), fuls: [], config: config(['scan1', 'prep1']) })
    expect(getState().rules[0]).toMatchObject({ n: 5, unit: 'WD', send: false, start: 'lead', startN: 2 })
    expect(getState().todos.get('a_ev1_r-ful')).toMatchObject({ due: '2026-10-28', start: '2026-10-26' })
  })

  it('eTMF 업로드는 방문 후 WD10 마감·착수는 방문 다음 영업일로 바꾸고, 열린 eTMF 할 일도 옮긴다', async () => {
    const etmf: Rule = { id: 'r-etmf-t', key: 'ETMF', type: '*', project: '*', title: '{site} {type} 서명문서 eTMF 업로드', dir: 'after', n: 30, unit: 'CD', send: false, verify: false, basis: 'PMP: 30일 내', start: 'lead', startN: 5 }
    const config = (mig: string[]) => ({ rules: [etmf], holidays: DEFAULT_HOLIDAYS, mig, notes: null, projects: [{ name: 'P', short: 'Pj', sites: [] }], companions: [] })
    await replaceAll({ events: [], todos: [], fuls: [], config: config(['scan1', 'prep1', 'ful5', 'isf1', 'etmf10']) })
    await putEvent(visit)
    await syncEvent(visit)
    expect(getState().todos.get('a_ev1_r-etmf-t')!.due).toBe('2026-11-20')
    await replaceAll({ events: [...getState().events.values()], todos: todos(), fuls: [], config: config(['scan1', 'prep1', 'ful5', 'isf1']) })
    expect(getState().rules[0]).toMatchObject({ n: 10, unit: 'WD', start: 'fresh', basis: 'PMP: 30일 내 · 본인 기준: Approve 기간 고려해 방문 후 WD10' })
    expect(getState().todos.get('a_ev1_r-etmf-t')).toMatchObject({ due: '2026-11-04', start: '2026-10-22' })
  })

  it('Imjudo MV 에는 방문 후 WD2 마감 ISF checklist 할 일이 생긴다 (착수는 방문 다음 영업일)', async () => {
    const ev = { ...visit, project: 'AZ - Imjudo' }
    await putEvent(ev)
    await syncEvent(ev)
    expect(getState().todos.get('a_ev1_r-i-isf')).toMatchObject({ title: '가나대병원 MV ISF checklist 업데이트·CRA 서명', due: '2026-10-23', start: '2026-10-22' })
  })
})

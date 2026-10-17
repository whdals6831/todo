import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CalEvent, Rule } from '../types/domain.ts'
import { DEFAULT_HOLIDAYS as holidays, ENF } from './constants.ts'
import { computeDue, computeStart, genKey, planTodos, rulesFor, stableStringify } from './rules.ts'

const projects = [
  { name: 'AZ - Imjudo', short: 'Imjudo', sites: ['09. 가나대병원(PI 홍길동)'] },
  { name: ENF, short: '엔플론시아', sites: [] },
]
const rule = (o: Partial<Rule>): Rule => ({
  id: 'r', key: '', type: '*', project: '*', title: '{site} {type}', dir: 'after', n: 3, unit: 'WD', send: false, verify: false, start: 'due', startN: 0, ...o,
})
/** 2026-10-08 목요일 외근 (다음 날 한글날) */
const visit = (o: Partial<CalEvent> = {}): CalEvent => ({
  id: 'ev1', kind: 'visit', date: '2026-10-08', type: 'MV', project: 'AZ - Imjudo', site: '09. 가나대병원(PI 홍길동)', createdDate: '2026-10-01', ...o,
})
const ctx = (rules: Rule[], events: CalEvent[] = []) => ({ rules, holidays, projects, events: new Map(events.map((e) => [e.id, e])) })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-01T09:00:00+09:00'))
})
afterEach(() => vi.useRealTimers())

describe('computeDue', () => {
  it('방문 후 WD: 공휴일을 빼고 WD1 을 함께 적는다', () => {
    const { due, basis } = computeDue(visit(), rule({ n: 3 }), { holidays })
    expect(due).toBe('2026-10-14')
    expect(basis).toBe('방문 10/8(목) 후 WD3 = 10/14(수) (WD1=10/12(월)) · 공휴일 제외: 10/9(금) 한글날')
  })

  it('방문 전 WD + 보내는 일은 전 영업일이 마감', () => {
    const { due, basis } = computeDue(visit(), rule({ dir: 'before', n: 3, send: true, basis: '임시값' }), { holidays })
    expect(due).toBe('2026-10-01')
    expect(basis).toContain('보내는 일 → 전 영업일 10/1(목) 마감')
    expect(basis).toContain('[임시값]')
  })

  it('CD 가 휴일에 떨어지면 직전 영업일로 당긴다', () => {
    const { due } = computeDue(visit({ date: '2026-09-09' }), rule({ n: 30, unit: 'CD' }), { holidays })
    expect(due).toBe('2026-10-08') // 10/9 한글날 → 10/8
  })

  it('급한 개시 과제는 방문 전 기한이 등록일보다 빠르면 등록일로 당긴다', () => {
    const ev = visit({ project: ENF, date: '2026-10-07', createdDate: '2026-10-06' })
    const { due, basis } = computeDue(ev, rule({ dir: 'before', n: 5 }), { holidays })
    expect(due).toBe('2026-10-06')
    expect(basis).toContain('급하게 잡힌 개시라 등록일')
  })
})

describe('computeStart', () => {
  it('fresh: 방문 다음 영업일에 착수', () => {
    expect(computeStart(visit(), rule({ start: 'fresh', n: 5 }), '2026-10-16', ctx([])).start).toBe('2026-10-12')
  })

  it('lead: 마감 N영업일 전, 그날 다른 외근이 있으면 하루 당긴다', () => {
    const other = visit({ id: 'ev2', date: '2026-10-14' })
    const r = rule({ start: 'lead', startN: 2 })
    expect(computeStart(visit(), r, '2026-10-16', ctx([])).start).toBe('2026-10-14')
    const moved = computeStart(visit(), r, '2026-10-16', ctx([], [other]))
    expect(moved.start).toBe('2026-10-13')
    expect(moved.startBasis).toContain('다른 외근')
  })
})

describe('rulesFor', () => {
  it('같은 key 는 과제·방문 종류를 지정한 규칙이 이긴다', () => {
    const all = rule({ id: 'a', key: 'FUL' })
    const proj = rule({ id: 'b', key: 'FUL', project: 'AZ - Imjudo' })
    const typ = rule({ id: 'c', key: 'FUL', type: 'MV' })
    expect(rulesFor(visit(), [all, typ, proj]).map((r) => r.id)).toEqual(['b'])
    expect(rulesFor(visit(), [all, typ]).map((r) => r.id)).toEqual(['c'])
  })

  it('이긴 규칙이 꺼져 있으면 그 key 는 만들지 않는다', () => {
    const all = rule({ id: 'a', key: 'FUL' })
    const off = rule({ id: 'b', key: 'FUL', project: 'AZ - Imjudo', off: true })
    expect(rulesFor(visit(), [all, off])).toEqual([])
  })

  it('SKIP 이 있거나 외근이 아니면 아무것도 없다', () => {
    expect(rulesFor(visit(), [rule({ id: 'a' }), rule({ id: 's', key: 'SKIP', project: 'AZ - Imjudo' })])).toEqual([])
    expect(rulesFor(visit({ kind: 'meeting' }), [rule({ id: 'a' })])).toEqual([])
    expect(rulesFor(visit({ type: '기타' }), [rule({ id: 'a' })])).toEqual([])
  })
})

describe('planTodos · genKey', () => {
  it('자리표시자를 채운다', () => {
    const [t] = planTodos(visit(), ctx([rule({ id: 'r-ful', title: 'PM - {proj} {site} {type}  FUL' })]))
    expect(t).toMatchObject({ title: 'PM - Imjudo 가나대병원 MV FUL', due: '2026-10-14', ruleId: 'r-ful' })
  })

  it('규칙 객체의 키 순서가 달라도 같은 서명', () => {
    const a = rule({ id: 'x', key: 'FUL' })
    const b = Object.fromEntries(Object.entries(a).reverse()) as unknown as Rule
    expect(genKey(visit(), { rules: [a], holidays })).toBe(genKey(visit(), { rules: [b], holidays }))
    expect(stableStringify({ b: 1, a: [{ d: 2, c: undefined }] })).toBe('{"a":[{"d":2}],"b":1}')
  })
})

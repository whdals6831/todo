import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CalEvent, Rule } from '../types/domain.ts'
import { BRZ, BRZ_PSV_FUL, DEFAULT_HOLIDAYS as holidays, ENF, FUL_PACKS, brzPsvFulRule, fulPackRules } from './constants.ts'
import { computeDue, computeStart, copyText, genKey, manualTwin, planTodos, rulesFor, stableStringify } from './rules.ts'

const projects = [
  { name: 'AZ - Imjudo', short: 'Imjudo', sites: ['09. 가나대병원(PI 홍길동)'] },
  { name: ENF, short: '엔플론시아', sites: [] },
  { name: BRZ, short: 'Breztri', sites: ['09. 강원대병원(PI 권오범)', '022. 대구가톨릭대학교병원(PI 김은진)'] },
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

describe('방문 종류별 FUL', () => {
  const rules = [rule({ id: 'r-rpt', key: 'OWN', title: '{site} {type}R 작성' }), ...fulPackRules(rule({ id: 'r-rpt', key: 'OWN', title: '{site} {type}R 작성' }))]

  it('PSV·SIV·MV 는 리포트 작성 대신 FUL 할 일에 하위 항목, COV 는 그대로', () => {
    const p = planTodos(visit({ type: 'PSV' }), ctx(rules))
    expect(p.map((x) => [x.ruleId, x.title])).toEqual([['r-rpt-psv', '가나대병원 PSV FUL']])
    expect(p[0].subs).toEqual(FUL_PACKS[0].subs)
    expect(planTodos(visit({ type: 'MV' }), ctx(rules)).map((x) => [x.title, x.subs.length])).toEqual([['가나대병원 MV FUL', 9]])
    expect(planTodos(visit({ type: 'COV' }), ctx(rules)).map((x) => [x.title, x.subs])).toEqual([['가나대병원 COVR 작성', []]])
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

describe('manualTwin', () => {
  const ev = visit({ type: 'PSV', date: '2026-10-23', site: '09. 가나대학교병원(PI 홍길동)' })
  const todo = (title: string, o = {}) => ({ id: 'm', title, project: 'AZ - Imjudo', due: '2026-10-20', ...o })

  it('과제 이름·소요 시간 표기가 달라도 같은 기관·방문의 같은 일이면 찾는다', () => {
    expect(manualTwin(ev, 'Imjudo 가나대학교병원 PSV 서명문서 준비', [todo('이뮤도 가나대 PSV 서명문서 준비')], projects)?.id).toBe('m')
    expect(manualTwin(ev, 'Imjudo 가나대학교병원 PSV 팜플렛 인쇄 (15분)', [todo('이뮤도 가나대학교병원 PSV 팜플렛 인쇄')], projects)?.id).toBe('m')
  })

  it('다른 일·다른 방문 종류·다른 기관·먼 날짜·외근에서 만든 할 일은 찾지 않는다', () => {
    const title = 'Imjudo 가나대학교병원 PSV 서명문서 준비'
    expect(manualTwin(ev, title, [todo('이뮤도 가나대 PSV 팜플렛 인쇄')], projects)).toBeUndefined()
    expect(manualTwin(ev, title, [todo('이뮤도 가나대 SIV 서명문서 준비')], projects)).toBeUndefined()
    expect(manualTwin(ev, title, [todo('이뮤도 다라대 PSV 서명문서 준비')], projects)).toBeUndefined()
    expect(manualTwin(ev, title, [todo('이뮤도 가나대 PSV 서명문서 준비', { due: '2026-08-01' })], projects)).toBeUndefined()
    expect(manualTwin(ev, title, [todo('이뮤도 가나대 PSV 서명문서 준비', { eventId: 'ev0' })], projects)).toBeUndefined()
  })
})

describe('Breztri PSV FUL', () => {
  const psv = fulPackRules(rule({ id: 'r-rpt', key: 'OWN', title: '{site} {type}R 작성' }))[0]
  const rules = [psv, brzPsvFulRule(psv)]

  it('Breztri PSV 만 결재 상신 순서의 하위 항목으로 덮어쓰고, 다른 과제는 그대로', () => {
    const brz = planTodos(visit({ type: 'PSV', project: BRZ, site: '대구가톨릭대학교병원(PI 김은진)' }), ctx(rules))
    expect(brz.map((x) => [x.ruleId, x.title, x.subs])).toEqual([['r-rpt-psv-b', '대구가톨릭대학교병원 PSV FUL', BRZ_PSV_FUL.subs]])
    expect(planTodos(visit({ type: 'PSV' }), ctx(rules)).map((x) => x.ruleId)).toEqual(['r-rpt-psv'])
  })

  it('상신 제목: 담당 기관 목록에서 기관번호·기관명·PI 를 찾아 채운다 (모르면 이름 그대로)', () => {
    const ev = visit({ id: 'b1', date: '2026-10-23', type: 'PSV', project: BRZ, site: '대구가톨릭대학교병원(PI 김은진)' })
    const c = ctx(rules, [ev, visit({ id: 'b2', type: 'PSV', project: BRZ, site: '09. 강원대병원(PI 권오범)' }), visit({ id: 'b3', type: 'PSV', project: BRZ, site: '새병원' })])
    expect(copyText({ ruleId: 'r-rpt-psv-b', eventId: 'b1' }, c)).toBe('AstraZeneca_Breztri_PMS_S022. 대구가톨릭대학교병원(PI 김은진)_PSVR_20261023')
    expect(copyText({ ruleId: 'r-rpt-psv-b', eventId: 'b2' }, c)).toBe('AstraZeneca_Breztri_PMS_S009. 강원대병원(PI 권오범)_PSVR_20261008')
    expect(copyText({ ruleId: 'r-rpt-psv-b', eventId: 'b3' }, c)).toBe('AstraZeneca_Breztri_PMS_S기관번호. 새병원(PI PI 이름)_PSVR_20261008')
    expect(copyText({ ruleId: 'r-rpt-psv', eventId: 'b1' }, c)).toBe('')
  })
})

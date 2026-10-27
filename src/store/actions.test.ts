import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BRZ_PSV_FUL, DEFAULT_HOLIDAYS, FUL_PACKS } from '../domain/constants.ts'
import type { CalEvent, Rule } from '../types/domain.ts'
import {
  addSub, addTodo, dismissTodo, moveTodo, putEvent, putTodo, renameSub, replaceAll, saveRules, setRepository, syncEvent, toggleCheck, withSubs,
} from './actions.ts'
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
      rules: RULES, holidays: DEFAULT_HOLIDAYS, mig: ['scan1', 'ful5', 'fulpack3'], notes: null,
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
    expect(getState().events.get('ev1')!.genKey).toMatch(/^v6\|2026-10-21\|MV/)
  })

  it('처음 만들 때 규칙의 하위 항목을 붙이고, 그 뒤로는 직접 고친 대로 둔다', async () => {
    await saveRules([{ ...RULES[0], subs: ['{type}R 작성', 'OMF 업데이트'] }, RULES[1]])
    await putEvent(visit)
    await syncEvent(visit)
    expect(getState().todos.get('a_ev1_r-ful')!.subs).toEqual(['MVR 작성', 'OMF 업데이트'])
    await toggleCheck('a_ev1_r-ful', 'MVR 작성')
    await renameSub('a_ev1_r-ful', 'MVR 작성', 'MVR 초안 작성')
    await renameSub('a_ev1_r-ful', 'OMF 업데이트', ' ')
    expect(getState().todos.get('a_ev1_r-ful')).toMatchObject({ subs: ['MVR 초안 작성'], checks: ['MVR 초안 작성'] })
    await saveRules([{ ...RULES[0], subs: ['{type}R 작성', 'OMF 업데이트', '결재 상신'] }, RULES[1]])
    expect(getState().todos.get('a_ev1_r-ful')!.subs).toEqual(['MVR 초안 작성'])
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

  it('하위 항목: 줄을 더하고 체크하고, 뺀 항목의 체크는 같이 지운다', async () => {
    const id = await addTodo({ title: '분당 MV Preparation', due: '2026-10-19', subs: ['ISF 문서 인쇄'], done: false })
    await addSub(id, ' 바인더 정리 ')
    await addSub(id, 'ISF 문서 인쇄')
    await toggleCheck(id, 'ISF 문서 인쇄')
    expect(getState().todos.get(id)).toMatchObject({ subs: ['ISF 문서 인쇄', '바인더 정리'], checks: ['ISF 문서 인쇄'] })
    expect(withSubs(getState().todos.get(id)!, ['바인더 정리'])).toMatchObject({ subs: ['바인더 정리'], checks: [] })
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

  it('Breztri 업무 노트 PSV 서명 문서에 Study Summary 를 한 번만 붙인다', async () => {
    const notes = {
      'AZ - Breztri': [
        { v: 'PSV', items: [], docs: [{ t: 'Signed CV', w: '' }] },
        { v: 'SIV', items: [], docs: [{ t: 'Delegation log', w: '' }] },
      ],
    }
    const config = { rules: [], holidays: DEFAULT_HOLIDAYS, mig: ['scan1', 'prep1', 'ful5', 'isf1', 'etmf10'], notes, projects: [{ name: 'P', short: 'Pj', sites: [] }], companions: [] }
    await replaceAll({ events: [], todos: [], fuls: [], config })
    const brz = () => getState().notes!['AZ - Breztri'].map((x) => (x.docs || []).map((d) => d.t))
    expect(brz()).toEqual([['Signed CV', 'Study Summary'], ['Delegation log']])
    await replaceAll({ events: [], todos: [], fuls: [], config: { ...config, notes: getState().notes } })
    expect(brz()).toEqual([['Signed CV', 'Study Summary'], ['Delegation log']])
  })

  it('Imjudo 업무 노트 MV 에 방문 전 할 일·ISF Checklist·현장에서 써 올 것을 한 번만 넣는다 (체크는 그대로)', async () => {
    const notes = {
      'AZ - Imjudo': [
        { v: 'PSV', items: [{ t: 'Confirmation Letter 발송', w: '' }] },
        {
          v: 'MV',
          items: [
            { t: '등록 · CRF · Safety 현황 확인 → MV Pre-Checklist 작성 · PM 승인', w: 'PMP 기한 없음 (방문 전)', c: true },
            { t: 'Confirmation Letter 발송', w: '방문 최소 WD1 전' },
            { t: 'MV 진행 · SDV', w: '방문일' },
            { t: 'MVR 작성', w: '방문 후 WD5' },
          ],
        },
      ],
    }
    const config = { rules: [], holidays: DEFAULT_HOLIDAYS, mig: ['scan1', 'prep1', 'ful5', 'isf1', 'etmf10', 'brzss1', 'fulpack1', 'fulpack2', 'fulpack3'], notes, projects: [{ name: 'P', short: 'Pj', sites: [] }], companions: [] }
    await replaceAll({ events: [], todos: [], fuls: [], config })
    const mv = () => getState().notes!['AZ - Imjudo'][1].items
    const want = [
      { t: 'EMR ID 발급', w: '방문 전' },
      { t: '모니터링룸 예약', w: '방문 전' },
      { t: 'EDC 입력 현황 파악하여 Query 작성', w: '방문 전' },
      { t: '등록 · CRF · Safety 현황 확인 → MV Pre-Checklist · ISF Checklist 작성 및 상신 · PM 승인', w: 'PMP 기한 없음 (방문 전)', c: true },
      { t: 'Confirmation Letter 발송', w: '방문 최소 WD1 전' },
      { t: 'MV 진행 · SDV · ICF Tracking Log · Discrepancy List 작성', w: '방문일' },
      { t: 'MVR 작성', w: '방문 후 WD5' },
    ]
    expect(mv()).toEqual(want)
    expect(getState().notes!['AZ - Imjudo'][0].items).toEqual([{ t: 'Confirmation Letter 발송', w: '' }])
    await replaceAll({ events: [], todos: [], fuls: [], config: { ...config, notes: getState().notes } })
    expect(mv()).toEqual(want)
  })

  it('Imjudo MV 에는 방문 후 WD2 마감 ISF checklist 할 일이 생긴다 (착수는 방문 다음 영업일)', async () => {
    const ev = { ...visit, project: 'AZ - Imjudo' }
    await putEvent(ev)
    await syncEvent(ev)
    expect(getState().todos.get('a_ev1_r-i-isf')).toMatchObject({ title: '가나대병원 MV ISF checklist 업데이트·CRA 서명', due: '2026-10-23', start: '2026-10-22' })
  })
})

describe('방문 종류별 FUL (fulpack1)', () => {
  it('리포트 작성 규칙이 있으면 PSV·SIV·MV 의 열린 리포트 작성 할 일을 FUL 할 일로 바꾸고 하위 항목을 단다', async () => {
    /* key·start 가 없는 옛 규칙 */
    const rpt: Rule = { id: 'r-rpt', type: '*', project: '*', title: '{site} {type}R 작성', dir: 'after', n: 5, unit: 'WD', send: false, verify: false, basis: 'PMP 공통' }
    await replaceAll({
      events: [{ ...visit, type: 'PSV', genKey: 'v5|old' }],
      todos: [{ id: 'a_ev1_r-rpt', title: '가나대병원 PSVR 작성', due: '2026-10-28', eventId: 'ev1', ruleId: 'r-rpt', project: 'P', done: false }],
      fuls: [],
      config: {
        rules: [rpt], holidays: DEFAULT_HOLIDAYS, mig: ['scan1', 'prep1', 'ful5', 'isf1', 'etmf10', 'brzss1'], notes: null,
        projects: [{ name: 'P', short: 'Pj', sites: [] }], companions: [],
      },
    })
    expect(todos().map((t) => [t.id, t.title, t.due])).toEqual([['a_ev1_r-rpt-psv', '가나대병원 PSV FUL', '2026-10-28']])
    expect(todos()[0].subs).toEqual(FUL_PACKS[0].subs)
    expect(getState().mig).toContain('fulpack1')
  })
})

describe('결재 상신 고치기 (fulpack2)', () => {
  it('PSV 결재상신은 PSVR 결재 상신으로(체크도 따라감), MV 는 맨 끝에 MVR 결재 상신을 더한다. 끝낸 할 일은 그대로', async () => {
    const pack = (id: string, type: string, subs: string[]): Rule => ({
      id, key: 'OWN', type, project: '*', title: '{site} ' + type + ' FUL', dir: 'after', n: 5, unit: 'WD', send: false, verify: false, subs,
    })
    await replaceAll({
      events: [], fuls: [],
      todos: [
        { id: 'a', title: '가나대병원 PSV FUL', due: '2026-10-30', ruleId: 'r-rpt-psv', subs: ['PSVR 작성', 'PSV 결재상신'], checks: ['PSV 결재상신'], done: false },
        { id: 'b', title: '가나대병원 MV FUL', due: '2026-10-30', ruleId: 'r-rpt-mv', subs: ['MVR 작성', '직접 단 것'], done: false },
        { id: 'c', title: '다른병원 MV FUL', due: '2026-10-01', ruleId: 'r-rpt-mv', subs: ['MVR 작성'], done: true },
      ],
      config: {
        rules: [pack('r-rpt-psv', 'PSV', ['PSVR 작성', 'PSV 결재상신']), pack('r-rpt-mv', 'MV', ['MVR 작성'])],
        holidays: DEFAULT_HOLIDAYS, mig: ['scan1', 'prep1', 'ful5', 'isf1', 'etmf10', 'brzss1', 'fulpack1', 'fulpack3', 'brzful1'], notes: null,
        projects: [{ name: 'P', short: 'Pj', sites: [] }], companions: [],
      },
    })
    const s = getState()
    expect(s.rules.map((r) => r.subs)).toEqual([['PSVR 작성', 'PSVR 결재 상신'], ['MVR 작성', 'MVR 결재 상신']])
    expect(s.todos.get('a')).toMatchObject({ subs: ['PSVR 작성', 'PSVR 결재 상신'], checks: ['PSVR 결재 상신'] })
    expect(s.todos.get('b')!.subs).toEqual(['MVR 작성', '직접 단 것', 'MVR 결재 상신'])
    expect(s.todos.get('c')!.subs).toEqual(['MVR 작성'])
  })
})

describe('Breztri PSV FUL (brzful1)', () => {
  it('PSV FUL 규칙 다음에 Breztri 규칙을 넣고, 열린 Breztri PSV FUL 은 체크·직접 단 항목을 지켜 옮긴다', async () => {
    const psv: Rule = {
      id: 'r-rpt-psv', key: 'OWN', type: 'PSV', project: '*', title: '{site} PSV FUL', dir: 'after', n: 5, unit: 'WD', send: false, verify: false,
      subs: ['PSVR 작성', 'PSVR 결재 상신'],
    }
    const ev: CalEvent = { ...visit, type: 'PSV', project: 'AZ - Breztri', site: '대구가톨릭대학교병원(PI 김은진)', genKey: 'v6|old' }
    await replaceAll({
      events: [ev], fuls: [],
      todos: [
        { id: 'a_ev1_r-rpt-psv', title: '대구가톨릭대학교병원 PSV FUL', due: '2026-10-28', eventId: 'ev1', ruleId: 'r-rpt-psv', project: 'AZ - Breztri', subs: ['PSVR 작성', '내가 단 것', 'PSVR 결재 상신'], checks: ['PSVR 작성'], note: '메모', done: false },
      ],
      config: {
        rules: [psv], holidays: DEFAULT_HOLIDAYS, mig: ['scan1', 'prep1', 'ful5', 'isf1', 'etmf10', 'brzss1', 'fulpack1', 'fulpack2', 'fulpack3', 'imjmv1'], notes: null,
        projects: [{ name: 'AZ - Breztri', short: 'Breztri', sites: ['022. 대구가톨릭대학교병원(PI 김은진)'] }], companions: [],
      },
    })
    const s = getState()
    expect(s.rules.map((r) => r.id)).toEqual(['r-rpt-psv', 'r-rpt-psv-b'])
    expect(todos().map((t) => t.id)).toEqual(['a_ev1_r-rpt-psv-b'])
    expect(todos()[0]).toMatchObject({
      ruleId: 'r-rpt-psv-b', checks: ['PSVR 작성'], note: '메모',
      subs: [...BRZ_PSV_FUL.subs.slice(0, -1), '내가 단 것', 'PSVR 결재 상신'],
    })
  })
})

describe('MV FUL 에 ISF Checklist·ICF Tracking Log, MV 당일 현장에서 써 올 것 (fulpack3)', () => {
  it('규칙과 열린 MV FUL 에 제자리로 더하고(이미 있으면 그대로), MV 방문 날 할 일이 생긴다', async () => {
    const mv: Rule = {
      id: 'r-rpt-mv', key: 'OWN', type: 'MV', project: '*', title: '{site} MV FUL', dir: 'after', n: 5, unit: 'WD', send: false, verify: false,
      subs: ['MVR 작성', 'MV Pre checklist 첨부', 'MV FL', 'Visit FU & Discrepancy List', 'MVR 결재 상신'],
    }
    await replaceAll({
      events: [{ ...visit, genKey: 'v6|old' }], fuls: [],
      todos: [
        { id: 'a', title: '가나대병원 MV FUL', due: '2026-10-28', ruleId: 'r-rpt-mv', subs: ['MVR 작성', 'ICF Log', 'MVR 결재 상신'], done: false },
        { id: 'b', title: '다른병원 MV FUL', due: '2026-10-01', ruleId: 'r-rpt-mv', subs: ['MVR 작성'], done: true },
      ],
      config: {
        rules: [mv], holidays: DEFAULT_HOLIDAYS, mig: ['scan1', 'prep1', 'ful5', 'isf1', 'etmf10', 'brzss1', 'fulpack1', 'fulpack2'], notes: null,
        projects: [{ name: 'P', short: 'Pj', sites: [] }], companions: [],
      },
    })
    const s = getState()
    expect(s.rules[0].subs).toEqual(['MVR 작성', 'MV Pre checklist 첨부', 'ISF Checklist 첨부', 'MV FL', 'ICF Tracking Log', 'Visit FU & Discrepancy List', 'MVR 결재 상신'])
    expect(s.todos.get('a')!.subs).toEqual(['MVR 작성', 'ICF Log', 'ISF Checklist 첨부', 'MVR 결재 상신'])
    expect(s.todos.get('b')!.subs).toEqual(['MVR 작성'])
    expect(s.todos.get('a_ev1_r-mv-site')).toMatchObject({ title: '가나대병원 MV 현장에서 써 올 것', due: '2026-10-21', start: '2026-10-21', subs: ['ICF Tracking Log', 'Discrepancy List'] })
    expect(s.mig).toContain('fulpack3')
  })
})

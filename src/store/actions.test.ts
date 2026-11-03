import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BRZ, BRZ_PSV_FUL, DEFAULT_HOLIDAYS, DEFAULT_RULES, ENF, ENF_SS_RULES, FUL_PACKS, PRE_SIV, SCAN_RULE, WID_RULE } from '../domain/constants.ts'
import { nowIso } from '../domain/date.ts'
import { isFarSite } from '../domain/project.ts'
import { bundleParts, genKey, partDues, planTodos } from '../domain/rules.ts'
import type { CalEvent, Rule, Todo } from '../types/domain.ts'
import {
  addFul, addSub, addTodo, dismissTodo, moveTodo, putEvent, putTodo, renameSub, replaceAll, saveRules, setRepository, syncEvent, toggleCheck, toggleDone, toggleStep, withSubs,
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
      rules: RULES, holidays: DEFAULT_HOLIDAYS, mig: ['scant1', 'etmfsolo1', 'ktx2', 'ktx1', 'enfss1', 'scan1', 'ful5', 'fulpack3', 'wid1'], notes: null,
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

  it('리포트 FUL 을 끝내면 하위 항목이 모두 체크되고, 다음 영업일부터 R FUL(수정·T-Sign·WID 업로드)이 생긴다', async () => {
    const id = await addTodo({ title: '가나대병원 MV FUL', due: '2026-10-12', subs: ['MVR 작성', 'MVR 결재 상신'], checks: ['MVR 작성'], done: false })
    await toggleDone(getState().todos.get(id)!)
    expect(getState().todos.get(id)!.checks).toEqual(['MVR 작성', 'MVR 결재 상신'])
    const f = getState().todos.get('f_' + id + '_rpt-fix')!
    expect(f).toMatchObject({ title: '가나대병원 MVR FUL', start: '2026-10-13', due: '2026-10-26', subs: ['MVR 수정', 'T-Sign', 'T-Sign본 WID 업로드'], followOf: id })
    await toggleDone(f)
    expect(todos().filter((t) => t.followOf === f.id)).toEqual([])
    const cov = await addTodo({ title: '나다병원 COVR 작성', due: '2026-10-12', done: false })
    await toggleDone(getState().todos.get(cov)!)
    expect(getState().todos.get('f_' + cov + '_rpt-fix')).toMatchObject({ title: '나다병원 COVR FUL', subs: ['COVR 수정', 'T-Sign', 'T-Sign본 WID 업로드'] })
  })

  it('Imjudo SIVR FUL 을 끝내면 다음 영업일 착수, WD3 마감 SIVR 송부가 생긴다 (다른 과제는 안 생긴다)', async () => {
    const id = await addTodo({ title: '인하대병원 SIVR FUL', project: 'AZ - Imjudo', due: '2026-10-12', followOf: 'x', done: false })
    await putTodo({ ...getState().todos.get(id)!, done: true, doneAt: '2026-10-08T05:00:00.000Z' })
    expect(getState().todos.get('f_' + id + '_sivr-send')).toMatchObject({ title: '인하대병원 SIVR 송부', start: '2026-10-12', due: '2026-10-14', project: 'AZ - Imjudo' })
    const other = await addTodo({ title: '가나대병원 SIVR FUL', project: 'AZ - Breztri', due: '2026-10-12', done: false })
    await toggleDone(getState().todos.get(other)!)
    expect(getState().todos.has('f_' + other + '_sivr-send')).toBe(false)
  })

  it('Imjudo SIVR 송부를 끝내면 FUL 메모에 MV 때 SIVR 인쇄가 남고, MV 를 등록하면 할 일로 넘어간다 (완료 취소하면 같이 지운다)', async () => {
    const siv: CalEvent = { ...visit, id: 'ev2', type: 'SIV', project: 'AZ - Imjudo', site: '03. 인하대병원(PI 홍길동)', date: '2026-10-05' }
    await putEvent(siv)
    const ful = await addTodo({ title: '인하대병원 SIVR FUL', project: 'AZ - Imjudo', due: '2026-10-08', eventId: 'ev2', done: false })
    await toggleDone(getState().todos.get(ful)!)
    const send = getState().todos.get('f_' + ful + '_sivr-send')!
    await toggleDone(send)
    const memo = getState().fuls.get('u_' + send.id + '_sivr-print')!
    expect(memo).toMatchObject({ project: 'AZ - Imjudo', site: '03. 인하대병원(PI 홍길동)', type: 'MV', text: 'SIVR 인쇄' })
    const mv: CalEvent = { ...siv, id: 'ev3', type: 'MV', date: '2026-10-21' }
    await putEvent(mv)
    await syncEvent(mv)
    expect(getState().fuls.get(memo.id)?.todoId).toBe('fu_ev3')
    expect(getState().todos.get('fu_ev3')).toMatchObject({ title: '인하대병원 MV 전 FUL', subs: ['SIVR 인쇄'] })
    await toggleDone(getState().todos.get(send.id)!)
    expect(getState().fuls.has(memo.id)).toBe(false)
    expect(getState().todos.has('fu_ev3')).toBe(false)
  })

  it('FUL 메모는 외근 하나의 "{기관} {방문} 전 FUL" 하위 항목으로 모이고 (착수 = 등록일, 마감 = 방문 WD1 전), 나중 메모는 덧붙고 방문일이 바뀌면 마감도 따라간다', async () => {
    await addFul({ project: 'P', site: '가나대병원', type: 'MV', text: 'ICF 인쇄', created: '2026-10-01T00:00:00.000Z' })
    await addFul({ project: 'P', site: '가나대병원', type: '*', text: 'CV 받기', created: '2026-10-02T00:00:00.000Z' })
    await addFul({ project: 'P', site: '다른병원', type: '*', text: '다른 기관', created: '2026-10-03T00:00:00.000Z' })
    await putEvent(visit)
    await syncEvent(visit)
    expect(getState().todos.get('fu_ev1')).toMatchObject({
      title: '가나대병원 MV 전 FUL', subs: ['ICF 인쇄', 'CV 받기'], start: '2026-10-12', due: '2026-10-20', project: 'P',
    })
    await addFul({ project: 'P', site: '09. 가나대병원(PI 홍길동)', type: '*', text: '바인더 정리', created: nowIso() })
    expect(getState().todos.get('fu_ev1')!.subs).toEqual(['ICF 인쇄', 'CV 받기', '바인더 정리'])
    const moved = { ...getState().events.get('ev1')!, date: '2026-10-23' }
    await putEvent(moved)
    await syncEvent(moved)
    expect(getState().todos.get('fu_ev1')).toMatchObject({ due: '2026-10-22', subs: ['ICF 인쇄', 'CV 받기', '바인더 정리'] })
    expect(todos().filter((t) => t.id.startsWith('fu_'))).toHaveLength(1)
  })

  it('외근을 등록하면 WID 외근 일정 등록이 생긴다 (등록한 날 착수 · 등록일 WD3 마감). 규칙을 넣기 전 외근에는 안 생긴다', async () => {
    await putEvent(visit)
    await syncEvent(visit)
    await saveRules([...RULES, { ...WID_RULE }])
    expect(getState().todos.get('a_ev1_g-prep')!.subs).toEqual(['CL'])
    const ev2: CalEvent = { ...visit, id: 'ev2', site: '다라병원', date: '2026-10-28', createdDate: '2026-10-12' }
    await putEvent(ev2)
    await syncEvent(ev2)
    const t = getState().todos.get('a_ev2_g-prep')!
    expect(t).toMatchObject({ title: '다라병원 MV Preparation', subs: ['WID 외근 일정 등록', 'CL'], start: '2026-10-12' })
    expect(partDues(t, getState())['WID 외근 일정 등록']).toBe('2026-10-15')
  })

  it('하위 항목: 줄을 더하고 체크하고, 뺀 항목의 체크는 같이 지운다', async () => {
    const id = await addTodo({ title: '분당 MV Preparation', due: '2026-10-19', subs: ['ISF 문서 인쇄'], done: false })
    await addSub(id, ' 바인더 정리 ')
    await addSub(id, 'ISF 문서 인쇄')
    await toggleCheck(id, 'ISF 문서 인쇄')
    expect(getState().todos.get(id)).toMatchObject({ subs: ['ISF 문서 인쇄', '바인더 정리'], checks: ['ISF 문서 인쇄'], checkAt: { 'ISF 문서 인쇄': '2026-10-12T00:00:00.000Z' } })
    await toggleCheck(id, '바인더 정리')
    await toggleCheck(id, '바인더 정리')
    expect(getState().todos.get(id)!.checkAt).toEqual({ 'ISF 문서 인쇄': '2026-10-12T00:00:00.000Z' })
    expect(withSubs(getState().todos.get(id)!, ['바인더 정리'])).toMatchObject({ subs: ['바인더 정리'], checks: [], checkAt: {} })
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
    const config = { rules: [], holidays: DEFAULT_HOLIDAYS, mig: ['scant1', 'etmfsolo1', 'ktx2', 'ktx1', 'enfss1', 'scan1', 'prep1', 'ful5', 'isf1', 'etmf10'], notes, projects: [{ name: 'P', short: 'Pj', sites: [] }], companions: [] }
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
    const config = { rules: [], holidays: DEFAULT_HOLIDAYS, mig: ['scant1', 'etmfsolo1', 'ktx2', 'ktx1', 'enfss1', 'scan1', 'prep1', 'ful5', 'isf1', 'etmf10', 'brzss1', 'fulpack1', 'fulpack2', 'fulpack3'], notes, projects: [{ name: 'P', short: 'Pj', sites: [] }], companions: [] }
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
    const t = getState().todos.get('a_ev1_g-post')!
    expect(t).toMatchObject({ title: '가나대병원 MV 방문 후 정리', subs: ['ISF checklist 업데이트·CRA 서명', 'FUL'], start: '2026-10-22' })
    expect(partDues(t, getState())['ISF checklist 업데이트·CRA 서명']).toBe('2026-10-23')
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
        rules: [rpt], holidays: DEFAULT_HOLIDAYS, mig: ['scant1', 'etmfsolo1', 'ktx2', 'ktx1', 'enfss1', 'scan1', 'prep1', 'ful5', 'isf1', 'etmf10', 'brzss1'], notes: null,
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
        holidays: DEFAULT_HOLIDAYS, mig: ['scant1', 'etmfsolo1', 'ktx2', 'ktx1', 'enfss1', 'scan1', 'prep1', 'ful5', 'isf1', 'etmf10', 'brzss1', 'fulpack1', 'fulpack3', 'brzful1', 'wid1'], notes: null,
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

describe('끝낸 할 일 정리 (rptfix1)', () => {
  it('끝낸 할 일의 하위 항목을 모두 체크하고, 이번 주에 끝낸 리포트 FUL 만 R FUL 을 만든다 (마감은 방문 후 WD10, 외근이 없으면 완료일 후 WD10)', async () => {
    await replaceAll({
      events: [visit], fuls: [],
      todos: [
        { id: 'a', title: '가나대병원 MV FUL', due: '2026-10-28', subs: ['MVR 작성', 'MVR 결재 상신'], checks: ['MVR 작성'], done: true, doneAt: '2026-10-27T05:00:00.000Z' },
        { id: 'b', title: '다른병원 SIVR 작성', due: '2026-10-20', done: true, doneAt: '2026-10-20T05:00:00.000Z' },
        { id: 'c', title: '가나대병원 SIV FUL', due: '2026-10-28', eventId: 'ev1', done: true, doneAt: '2026-10-27T05:00:00.000Z' },
      ],
      config: {
        rules: [], holidays: DEFAULT_HOLIDAYS, mig: ['scant1', 'etmfsolo1', 'ktx2', 'ktx1', 'enfss1', 'scan1', 'prep1', 'ful5', 'isf1', 'etmf10', 'brzss1', 'fulpack1', 'fulpack2', 'fulpack3', 'imjmv1', 'brzful1'], notes: null,
        projects: [{ name: 'P', short: 'Pj', sites: [] }], companions: [],
      },
    })
    const s = getState()
    expect(s.todos.get('a')!.checks).toEqual(['MVR 작성', 'MVR 결재 상신'])
    expect(s.todos.get('f_a_rpt-fix')).toMatchObject({ title: '가나대병원 MVR FUL', start: '2026-10-28', due: '2026-11-10' })
    expect(s.todos.get('f_c_rpt-fix')).toMatchObject({ title: '가나대병원 SIVR FUL', start: '2026-10-28', due: '2026-11-04' })
    expect(s.todos.has('f_b_rpt-fix')).toBe(false)
  })

  it('이미 만든 열린 R FUL 마감을 PM 마감(방문 후 WD10)으로 옮기고, 직접 바꾼 날짜는 그대로 둔다 (rptfix2)', async () => {
    const done = { due: '2026-10-28', eventId: 'ev1', done: true, doneAt: '2026-10-27T05:00:00.000Z' }
    const follow = { start: '2026-10-28', due: '2026-11-03', done: false }
    await replaceAll({
      events: [visit], fuls: [],
      todos: [
        { id: 'a', title: '가나대병원 MV FUL', ...done },
        { id: 'f_a_rpt-fix', title: '가나대병원 MVR FUL', followOf: 'a', basis: '완료일 후 WD5', ...follow },
        { id: 'b', title: '나다병원 MV FUL', ...done },
        { id: 'f_b_rpt-fix', title: '나다병원 MVR FUL', followOf: 'b', basis: '직접 변경', ...follow },
      ],
      config: {
        rules: [], holidays: DEFAULT_HOLIDAYS, mig: ['scant1', 'etmfsolo1', 'ktx2', 'ktx1', 'enfss1', 'scan1', 'prep1', 'ful5', 'isf1', 'etmf10', 'brzss1', 'fulpack1', 'fulpack2', 'fulpack3', 'imjmv1', 'brzful1', 'rptfix1'], notes: null,
        projects: [{ name: 'P', short: 'Pj', sites: [] }], companions: [],
      },
    })
    expect(getState().todos.get('f_a_rpt-fix')!.due).toBe('2026-11-04')
    expect(getState().todos.get('f_b_rpt-fix')!.due).toBe('2026-11-03')
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
        rules: [psv], holidays: DEFAULT_HOLIDAYS, mig: ['scant1', 'etmfsolo1', 'ktx2', 'ktx1', 'enfss1', 'scan1', 'prep1', 'ful5', 'isf1', 'etmf10', 'brzss1', 'fulpack1', 'fulpack2', 'fulpack3', 'imjmv1', 'wid1'], notes: null,
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
        rules: [mv], holidays: DEFAULT_HOLIDAYS, mig: ['scant1', 'etmfsolo1', 'ktx2', 'ktx1', 'enfss1', 'scan1', 'prep1', 'ful5', 'isf1', 'etmf10', 'brzss1', 'fulpack1', 'fulpack2', 'wid1'], notes: null,
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

describe('엔플론시아는 SIV 도시락 예약 없음 (enflunch1)', () => {
  it('꺼 둔 엔플론시아 규칙을 더하고, 열린 도시락 예약 할 일은 지운다 (다른 과제는 그대로)', async () => {
    const lunch = DEFAULT_RULES.find((r) => r.id === 'r-siv-lunch')!
    const siv = (id: string, project: string): CalEvent => ({ ...visit, id, type: 'SIV', project, date: '2026-11-13', genKey: 'v6|old' })
    await replaceAll({
      events: [siv('e1', 'MSD - 엔플론시아'), siv('e2', 'AZ - Breztri')], fuls: [],
      todos: [
        { id: 'a_e1_r-siv-lunch', title: '가나대병원 SIV 도시락 예약', due: '2026-11-10', eventId: 'e1', ruleId: 'r-siv-lunch', done: false },
        { id: 'a_e2_r-siv-lunch', title: '가나대병원 SIV 도시락 예약', due: '2026-11-10', eventId: 'e2', ruleId: 'r-siv-lunch', done: false },
      ],
      config: {
        rules: [lunch], holidays: DEFAULT_HOLIDAYS, mig: ['scant1', 'etmfsolo1', 'ktx2', 'ktx1', 'enfss1', 'scan1', 'prep1', 'ful5', 'isf1', 'etmf10', 'brzss1', 'fulpack1', 'fulpack2', 'fulpack3', 'imjmv1', 'brzful1', 'rptfix1', 'rptfix2', 'wid1'], notes: null,
        projects: [], companions: [],
      },
    })
    const s = getState()
    expect(s.rules.map((r) => [r.id, r.project, !!r.off])).toEqual([['r-siv-lunch', '*', false], ['r-e-lunch', 'MSD - 엔플론시아', true]])
    expect(s.todos.has('a_e1_r-siv-lunch')).toBe(false)
    expect(s.todos.has('a_e2_r-siv-lunch')).toBe(true)
  })
})

describe('WID 외근 일정 등록 (wid1)', () => {
  it('WID 규칙을 더하고, 업무 노트의 엔플론시아 도시락 예약만 뺀다', async () => {
    const sec = () => [{ v: 'SIV', items: [{ t: '바인더 제작 요청' }, { t: '도시락 예약', w: 'PMP 기한 없음' }] }]
    await replaceAll({
      events: [], fuls: [], todos: [],
      config: {
        rules: [], holidays: DEFAULT_HOLIDAYS, mig: ['scant1', 'etmfsolo1', 'ktx2', 'ktx1', 'enfss1', 'scan1', 'prep1', 'ful5', 'isf1', 'etmf10', 'brzss1', 'fulpack1', 'fulpack2', 'fulpack3', 'imjmv1', 'brzful1', 'rptfix1', 'rptfix2', 'enflunch1'],
        notes: { 'MSD - 엔플론시아': sec(), 'AZ - Breztri': sec() }, projects: [], companions: [],
      },
    })
    const s = getState()
    expect(s.rules.map((r) => r.id)).toEqual(['r-wid'])
    expect(s.notes!['MSD - 엔플론시아'][0].items.map((x) => x.t)).toEqual(['바인더 제작 요청'])
    expect(s.notes!['AZ - Breztri'][0].items.map((x) => x.t)).toEqual(['바인더 제작 요청', '도시락 예약'])
  })
})

describe('SIV Pre-Checklist 하위 항목 (presiv1)', () => {
  const MIG = ['scant1', 'etmfsolo1', 'ktx2', 'ktx1', 'scan1', 'prep1', 'ful5', 'isf1', 'etmf10', 'brzss1', 'fulpack1', 'fulpack2', 'fulpack3', 'imjmv1', 'brzful1', 'rptfix1', 'rptfix2', 'sivrsend1', 'chkat1', 'enflunch1', 'wid1', 'sivrprint1']
  const pre: Rule = {
    id: 'r-b-pre-siv', key: '', type: 'SIV', project: BRZ, title: '{site} SIV Pre-Checklist 작성·ISF와 함께 PM 승인', dir: 'before', n: 2, unit: 'WD', send: false, verify: false, start: 'lead', startN: 2,
  }
  const enf: Rule = { ...pre, id: 'r-e-pre', project: ENF, title: '{site} SIV Precheck list 결재 상신' }
  const rules = [pre, enf, RULES[1]]
  const ev: CalEvent = { ...visit, id: 'siv', type: 'SIV', project: BRZ, site: '강원대병원', date: '2026-11-06' }

  it('규칙을 짧은 제목·하위 항목으로 바꾸고, 열린 할 일은 제목만 바꿔 하위 항목을 단다 (다른 할 일 날짜·엔플론시아 규칙은 그대로)', async () => {
    await replaceAll({
      events: [{ ...ev, genKey: genKey(ev, { rules, holidays: DEFAULT_HOLIDAYS }) }], fuls: [],
      todos: [
        { id: 'a_siv_r-b-pre-siv', title: '강원대병원 SIV Pre-Checklist 작성·ISF와 함께 PM 승인', due: '2026-11-04', eventId: 'siv', ruleId: 'r-b-pre-siv', project: BRZ, done: false },
        { id: 'a_siv_r-cl', title: '강원대병원 SIV CL', due: '2026-10-30', basis: '드래그로 변경', eventId: 'siv', ruleId: 'r-cl', project: BRZ, done: false },
      ],
      config: { rules, holidays: DEFAULT_HOLIDAYS, mig: MIG, notes: null, projects: [], companions: [] },
    })
    const s = getState()
    expect(s.rules.find((r) => r.id === 'r-b-pre-siv')).toMatchObject({ title: PRE_SIV.title, subs: PRE_SIV.subs })
    expect(s.rules.find((r) => r.id === 'r-e-pre')).toEqual(enf)
    expect(s.todos.get('a_siv_r-b-pre-siv')).toMatchObject({ title: '강원대병원 SIV Pre-Checklist', subs: PRE_SIV.subs, due: '2026-11-04' })
    expect(s.todos.get('a_siv_r-cl')).toMatchObject({ due: '2026-10-30', basis: '드래그로 변경' })
  })

  it('직접 단 하위 항목은 그대로 두고, 새로 등록한 SIV 에는 하위 항목이 붙어 생긴다', async () => {
    await replaceAll({
      events: [{ ...ev, genKey: genKey(ev, { rules, holidays: DEFAULT_HOLIDAYS }) }], fuls: [],
      todos: [{ id: 'a_siv_r-b-pre-siv', title: '강원대병원 SIV Pre-Checklist', due: '2026-11-04', eventId: 'siv', ruleId: 'r-b-pre-siv', project: BRZ, subs: ['내가 단 것'], done: false }],
      config: { rules, holidays: DEFAULT_HOLIDAYS, mig: MIG, notes: null, projects: [], companions: [] },
    })
    expect(getState().todos.get('a_siv_r-b-pre-siv')!.subs).toEqual(['내가 단 것'])
    const ev2: CalEvent = { ...ev, id: 'siv2', site: '울산대' }
    await putEvent(ev2)
    await syncEvent(ev2)
    expect(getState().todos.get('a_siv2_r-b-pre-siv')).toMatchObject({ title: '울산대 SIV Pre-Checklist', subs: PRE_SIV.subs })
  })
})

describe('엔플론시아 SIV 계약서·ICF Site specific 업데이트 (enfss1)', () => {
  const MIG = ['scant1', 'etmfsolo1', 'ktx2', 'ktx1', 'scan1', 'prep1', 'ful5', 'isf1', 'etmf10', 'brzss1', 'fulpack1', 'fulpack2', 'fulpack3', 'imjmv1', 'brzful1', 'rptfix1', 'rptfix2', 'sivrsend1', 'chkat1', 'enflunch1', 'wid1', 'sivrprint1', 'presiv1', 'group1', 'group2']
  const cl: Rule = { id: 'r-e-cl', key: 'CL', type: 'SIV', project: ENF, title: '{site} SIV CL', dir: 'before', n: 2, unit: 'ADD', send: false, verify: false, start: 'due', startN: 0 }
  const old: CalEvent = { ...visit, id: 'old', type: 'SIV', project: ENF, site: '제일산부인과', date: '2026-10-23', createdDate: '2026-10-08' }

  it('규칙을 CL 앞에 더하고, 이미 등록한 외근에는 만들지 않으며 그 할 일 날짜도 그대로 둔다', async () => {
    await replaceAll({
      events: [{ ...old, genKey: genKey(old, { rules: [cl], holidays: DEFAULT_HOLIDAYS }) }], fuls: [],
      todos: [{ id: 'a_old_r-e-cl', title: '제일산부인과 SIV CL', due: '2026-10-14', basis: '드래그로 변경', eventId: 'old', ruleId: 'r-e-cl', project: ENF, done: false }],
      config: { rules: [cl], holidays: DEFAULT_HOLIDAYS, mig: MIG, notes: null, projects: [], companions: [] },
    })
    expect(getState().rules.map((r) => r.id)).toEqual(['r-e-sscontract', 'r-e-ssicf', 'r-e-cl'])
    expect(todos().map((t) => [t.id, t.due])).toEqual([['a_old_r-e-cl', '2026-10-14']])
  })

  it('새로 등록한 엔플론시아 SIV 에는 Preparation 맨 위에 등록 당일로 생긴다 (SIV 예정 준비 할 일은 넘겨받는다)', async () => {
    await replaceAll({
      events: [], fuls: [],
      todos: [{ id: 'prep', title: '엔플론시아 가나의원 ICF Site specific 업데이트', due: '2026-10-13', project: ENF, prepSite: '가나의원', prepKey: 'ICF', done: false }],
      config: { rules: [cl], holidays: DEFAULT_HOLIDAYS, mig: MIG, notes: null, projects: [], companions: [] },
    })
    const ev: CalEvent = { ...visit, id: 'new', type: 'SIV', project: ENF, site: '가나의원', date: '2026-10-21', createdDate: '2026-10-12' }
    await putEvent(ev)
    await syncEvent(ev)
    expect(todos().map((t) => t.id)).toEqual(['a_new_g-prep'])
    const t = todos()[0]
    expect(t).toMatchObject({ title: '가나의원 SIV Preparation', subs: ['계약서 Site specific 업데이트', 'ICF Site specific 업데이트', 'CL'], start: '2026-10-12', due: '2026-10-14' })
    expect(partDues(t, getState())).toEqual({ '계약서 Site specific 업데이트': '2026-10-12', 'ICF Site specific 업데이트': '2026-10-12', CL: '2026-10-14' })
  })
})

describe('방문 전·후 할 일 묶음 (group1)', () => {
  const MIG = ['scant1', 'etmfsolo1', 'ktx2', 'ktx1', 'scan1', 'prep1', 'ful5', 'isf1', 'etmf10', 'brzss1', 'fulpack1', 'fulpack2', 'fulpack3', 'imjmv1', 'brzful1', 'rptfix1', 'rptfix2', 'sivrsend1', 'chkat1', 'enflunch1', 'wid1', 'sivrprint1', 'presiv1', 'enfss1']
  const r = (id: string, title: string, dir: 'before' | 'after', n: number, more: Partial<Rule> = {}): Rule => ({
    id, key: '', type: 'SIV', project: '*', title, dir, n, unit: 'WD', send: false, verify: false, start: 'due', startN: 0, ...more,
  })
  const rules = [
    r('r-lunch', '{site} SIV 도시락 예약', 'before', 3),
    r('r-print', '{proj} {site} SIV PPT 인쇄', 'before', 1),
    r('r-edc', '{site} SIV EDC 계정 요청', 'before', 5),
    r('r-pre', '{site} SIV Pre-Checklist', 'before', 2, { subs: ['작성', 'PM 승인 확인'] }),
    r('r-sign', '{site} SIV 서명서류 재확인', 'before', 1),
    r('r-letter', '{site} {type} Follow-up Letter 발송', 'after', 5),
    r('r-pm', 'PM - {proj} {site} {type} (WD10)', 'after', 10),
    r('r-wait', '[대기] {site} 승인 확인', 'after', 5),
  ]
  const ev: CalEvent = { ...visit, id: 'siv', type: 'SIV', site: '가나대병원', date: '2026-10-28', createdDate: '2026-10-12' }
  const config = { rules, holidays: DEFAULT_HOLIDAYS, mig: MIG, notes: null, projects: [{ name: 'P', short: 'Pj', sites: [] }], companions: [] }

  it('방문 전 일은 Preparation, 방문 후 일은 방문 후 정리 하나에 마감 순 하위 항목으로. 하위 항목이 있는 일·[대기] 일은 따로', async () => {
    await replaceAll({ events: [], todos: [], fuls: [], config: { ...config, mig: [...MIG, 'group1', 'group2'] } })
    await putEvent(ev)
    await syncEvent(ev)
    expect(todos().map((t) => t.id).sort()).toEqual(['a_siv_g-post', 'a_siv_g-prep', 'a_siv_r-pre', 'a_siv_r-wait'])
    const prep = getState().todos.get('a_siv_g-prep')!
    expect(prep).toMatchObject({ title: '가나대병원 SIV Preparation', subs: ['EDC 계정 요청', '도시락 예약', 'PPT 인쇄', '서명서류 재확인'], start: '2026-10-21', due: '2026-10-27' })
    expect(partDues(prep, getState())).toEqual({ 'EDC 계정 요청': '2026-10-21', '도시락 예약': '2026-10-23', 'PPT 인쇄': '2026-10-27', '서명서류 재확인': '2026-10-27' })
    expect(getState().todos.get('a_siv_g-post')).toMatchObject({ title: '가나대병원 SIV 방문 후 정리', subs: ['Follow-up Letter 발송', 'PM - SIV (WD10)'] })
  })

  it('예전 외근: 열린 낱개 할 일은 묶음 하위 항목으로 옮기고(메모도), 끝낸 것은 체크만 남기고 지운다. 지난 외근에 열린 일이 없으면 묶지 않는다', async () => {
    const past: CalEvent = { ...ev, id: 'past', date: '2026-10-05', createdDate: '2026-09-20' }
    const t = (e: string, rule: string, title: string, more: Partial<Todo> = {}): Todo => ({
      id: 'a_' + e + '_' + rule, title, due: '2026-10-20', eventId: e, ruleId: rule, project: 'P', done: false, ...more,
    })
    await replaceAll({
      events: [{ ...ev, genKey: genKey(ev, config) }, { ...past, genKey: genKey(past, config) }], fuls: [],
      todos: [
        t('siv', 'r-lunch', '가나대병원 SIV 도시락 예약', { note: '10명', subs: ['메뉴 확인', '영수증'], checks: ['메뉴 확인'], checkAt: { '메뉴 확인': '2026-10-11' } }),
        t('siv', 'r-edc', '가나대병원 SIV EDC 계정 요청', { done: true, doneAt: '2026-10-10T01:00:00.000Z' }),
        t('siv', 'r-sign', '가나대병원 SIV 서명서류 재확인', { due: '2026-10-19', checks: ['Delegation log'] }),
        t('past', 'r-lunch', '가나대병원 SIV 도시락 예약', { done: true }),
        t('past', 'r-print', '가나대병원 SIV PPT 인쇄', { done: true }),
        t('past', 'r-letter', '가나대병원 SIV Follow-up Letter 발송', { done: true }),
        t('past', 'r-pm', 'PM - Pj 가나대병원 SIV (WD10)', { done: true }),
      ],
      config,
    })
    const ids = todos().map((x) => x.id).sort()
    expect(ids).toEqual(['a_past_r-letter', 'a_past_r-lunch', 'a_past_r-pm', 'a_past_r-print', 'a_siv_g-post', 'a_siv_g-prep'])
    expect(getState().todos.get('a_siv_g-prep')).toMatchObject({
      subs: ['EDC 계정 요청', '도시락 예약', '메뉴 확인', '영수증', 'PPT 인쇄', '서명서류 재확인'], checks: ['EDC 계정 요청', '메뉴 확인', '서명서류 재확인 › Delegation log'],
      checkAt: { 'EDC 계정 요청': '2026-10-10T01:00:00.000Z', '메뉴 확인': '2026-10-11' },
      note: '가나대병원 SIV 도시락 예약: 10명', done: false,
    })
  })
})

describe('묶음에 체크된 끝낸 낱개 할 일 지우기 (dedup1)', () => {
  const MIG = ['enfprep2', 'subdone1', 'enfsteps1', 'scant1', 'etmfsolo1', 'ktx2', 'ktx1', 'scan1', 'prep1', 'ful5', 'isf1', 'etmf10', 'brzss1', 'fulpack1', 'fulpack2', 'fulpack3', 'imjmv1', 'brzful1', 'rptfix1', 'rptfix2', 'sivrsend1', 'chkat1', 'enflunch1', 'wid1', 'sivrprint1', 'presiv1', 'enfss1', 'group1', 'group2', 'docs1', 'enfbeta1']
  const r = (id: string, title: string, dir: 'before' | 'after', n: number): Rule => ({
    id, key: '', type: 'SIV', project: '*', title, dir, n, unit: 'WD', send: false, verify: false, start: 'due', startN: 0,
  })
  const rules = [
    r('r-cl', '{site} {type} Confirmation Letter 발송', 'before', 1),
    r('r-print', '{site} SIV PPT 인쇄', 'before', 1),
    r('r-letter', '{site} {type} Follow-up Letter 발송', 'after', 5),
    r('r-pm', 'PM - {proj} {site} {type} (WD10)', 'after', 10),
  ]
  const config = { rules, holidays: DEFAULT_HOLIDAYS, mig: MIG, notes: null, projects: [{ name: 'P', short: 'Pj', sites: [] }], companions: [] }
  const ev: CalEvent = { ...visit, id: 'siv', type: 'SIV', site: '가나대병원', date: '2026-10-28', createdDate: '2026-10-12' }
  const t = (id: string, rule: string, title: string, more: Partial<Todo> = {}): Todo => ({
    id, title, due: '2026-10-20', eventId: 'siv', ruleId: rule, project: 'P', done: true, doneAt: '2026-10-10T01:00:00.000Z', ...more,
  })

  it('같은 제목의 끝낸 낱개 할 일은 지우고(메모·문서 체크는 묶음으로), 제목을 바꾼 일·이어진 할 일이 있는 일·체크 안 된 일은 둔다', async () => {
    await replaceAll({
      events: [{ ...ev, genKey: genKey(ev, config) }], fuls: [],
      todos: [
        t('a_siv_g-prep', 'g-prep', '가나대병원 SIV Preparation', {
          done: false, doneAt: null, subs: ['Confirmation Letter 발송', 'PPT 인쇄'], checks: ['Confirmation Letter 발송', 'PPT 인쇄'],
          checkAt: { 'Confirmation Letter 발송': '2026-10-10T01:00:00.000Z', 'PPT 인쇄': '2026-10-10T01:00:00.000Z' },
        }),
        t('a_siv_g-post', 'g-post', '가나대병원 SIV 방문 후 정리', {
          done: false, doneAt: null, subs: ['Follow-up Letter 발송', 'PM - SIV (WD10)'], checks: ['PM - SIV (WD10)'],
        }),
        t('a_siv_r-cl', 'r-cl', '가나대병원 SIV Confirmation Letter 발송', { note: '메일로', checks: ['서명 페이지'], checkAt: { '서명 페이지': '2026-10-09' } }),
        t('ss', 'r-cl-manual', '가나대병원 Site Selection Confirmation Letter 발송'),
        t('a_siv_r-print', 'r-print', '가나대병원 SIV PPT 인쇄'),
        { id: 'next', title: 'PPT 파일 보관', due: '2026-10-21', project: 'P', done: false, followOf: 'a_siv_r-print' },
        t('a_siv_r-pm', 'r-pm', 'PM - Pj 가나대병원 SIV (WD10)'),
        t('a_siv_r-letter', 'r-letter', '가나대병원 SIV Follow-up Letter 발송'),
      ],
      config,
    })
    const ids = new Set(todos().map((x) => x.id))
    expect(['a_siv_r-cl', 'a_siv_r-pm'].filter((x) => ids.has(x))).toEqual([])
    expect(['ss', 'a_siv_r-print', 'next', 'a_siv_r-letter'].filter((x) => ids.has(x))).toEqual(['ss', 'a_siv_r-print', 'next', 'a_siv_r-letter'])
    expect(getState().todos.get('a_siv_g-prep')).toMatchObject({
      checks: ['Confirmation Letter 발송', 'PPT 인쇄', 'Confirmation Letter 발송 › 서명 페이지'], note: '가나대병원 SIV Confirmation Letter 발송: 메일로',
    })
    expect(getState().mig).toContain('dedup1')
  })
})

describe('외근 할 일 묶음 다시 맞추기 (group2)', () => {
  const MIG = ['scant1', 'etmfsolo1', 'ktx2', 'ktx1', 'scan1', 'prep1', 'ful5', 'isf1', 'etmf10', 'brzss1', 'fulpack1', 'fulpack2', 'fulpack3', 'imjmv1', 'brzful1', 'rptfix1', 'rptfix2', 'sivrsend1', 'chkat1', 'enflunch1', 'wid1', 'sivrprint1', 'presiv1', 'enfss1', 'group1', 'group2']
  const r = (id: string, title: string, n: number): Rule => ({ id, key: '', type: 'SIV', project: '*', title, dir: 'before', n, unit: 'WD', send: false, verify: false, start: 'due', startN: 0 })
  const lunch = r('r-lunch', '{site} SIV 도시락 예약', 3)
  const print = r('r-print', '{site} SIV PPT 인쇄', 1)
  const edc = r('r-edc', '{site} SIV EDC 계정 요청', 5)
  const ev: CalEvent = { ...visit, id: 'siv', type: 'SIV', site: '가나대병원', date: '2026-10-28', createdDate: '2026-10-12' }

  it('규칙이 늘면 이미 있는 묶음의 제자리에 끼우고(직접 단 항목·체크 그대로), 묶음에서 지운 규칙의 일은 다시 끼우지 않는다', async () => {
    await replaceAll({ events: [], todos: [], fuls: [], config: { rules: [lunch, print], holidays: DEFAULT_HOLIDAYS, mig: MIG, notes: null, projects: [], companions: [] } })
    await putEvent(ev)
    await syncEvent(ev)
    await addSub('a_siv_g-prep', '메뉴 확인')
    await toggleCheck('a_siv_g-prep', '도시락 예약')
    await saveRules([edc, lunch, print])
    expect(getState().todos.get('a_siv_g-prep')).toMatchObject({ subs: ['EDC 계정 요청', '도시락 예약', 'PPT 인쇄', '메뉴 확인'], checks: ['도시락 예약'] })
    await renameSub('a_siv_g-prep', 'EDC 계정 요청', '')
    expect(getState().events.get('siv')!.skip).toEqual(['r-edc'])
    await saveRules([edc, lunch, print, r('r-usb', '{site} SIV USB', 1)])
    expect(getState().todos.get('a_siv_g-prep')!.subs).toEqual(['도시락 예약', 'PPT 인쇄', '메뉴 확인', 'USB'])
  })
})

describe('묶음의 문서 체크는 하위 항목 밑으로 (docs1)', () => {
  it('서명문서 체크는 첫 서명문서 일, eTMF 체크는 마지막 eTMF 일 밑으로 옮기고, 하위 항목 이름을 바꾸면 따라간다', async () => {
    const MIG = ['scant1', 'etmfsolo1', 'ktx2', 'ktx1', 'scan1', 'prep1', 'ful5', 'isf1', 'etmf10', 'brzss1', 'fulpack1', 'fulpack2', 'fulpack3', 'imjmv1', 'brzful1', 'rptfix1', 'rptfix2', 'sivrsend1', 'chkat1', 'enflunch1', 'wid1', 'sivrprint1', 'presiv1', 'enfss1', 'group1', 'group2']
    await replaceAll({
      events: [], fuls: [],
      todos: [{
        id: 'b', title: '가 SIV 방문 후 정리', ruleId: 'g-post', done: false, subs: ['서명문서 스캔·eTMF 업로드', 'FUL', '서명문서 eTMF 업로드'],
        checks: ['FUL', 'CV', 'eTMF:SIV Report'], checkAt: { CV: '2026-10-11' },
      }],
      config: { rules: [], holidays: DEFAULT_HOLIDAYS, mig: MIG, notes: null, projects: [], companions: [] },
    })
    expect(getState().todos.get('b')).toMatchObject({
      checks: ['FUL', '서명문서 스캔·eTMF 업로드 › CV', '서명문서 eTMF 업로드 › eTMF:SIV Report'], checkAt: { '서명문서 스캔·eTMF 업로드 › CV': '2026-10-11' },
    })
    await renameSub('b', '서명문서 스캔·eTMF 업로드', '스캔')
    expect(getState().todos.get('b')!.checks).toEqual(['FUL', '스캔 › CV', '서명문서 eTMF 업로드 › eTMF:SIV Report'])
    await renameSub('b', '스캔', '')
    expect(getState().todos.get('b')!.checks).toEqual(['FUL', '서명문서 eTMF 업로드 › eTMF:SIV Report'])
  })
})

describe('엔플론시아 Beta site 빼기 (enfbeta1)', () => {
  it('엔플론시아 규칙·열린 묶음 하위 항목·업무 노트에서 Beta site 일을 뺀다 (다른 과제는 그대로)', async () => {
    const MIG = ['scant1', 'etmfsolo1', 'ktx2', 'ktx1', 'scan1', 'prep1', 'ful5', 'isf1', 'etmf10', 'brzss1', 'fulpack1', 'fulpack2', 'fulpack3', 'imjmv1', 'brzful1', 'rptfix1', 'rptfix2', 'sivrsend1', 'chkat1', 'enflunch1', 'wid1', 'sivrprint1', 'presiv1', 'enfss1', 'group1', 'group2', 'docs1']
    const beta: Rule = { id: 'r-e-beta', key: '', type: 'SIV', project: ENF, title: '{site} Beta site 안내용 예시 Case 작성 (PI 권한)', dir: 'before', n: 3, unit: 'WD', send: false, verify: false }
    const pre: Rule = { ...beta, id: 'r-e-pre', title: '{site} SIV Precheck list 결재 상신' }
    const sub = 'Beta site 안내용 예시 Case 작성 (PI 권한)'
    await replaceAll({
      events: [], fuls: [],
      todos: [
        { id: 'e', title: '가 SIV Preparation', project: ENF, ruleId: 'g-prep', done: false, subs: ['CL', sub], checks: [sub] },
        { id: 'b', title: '나 SIV Preparation', project: BRZ, ruleId: 'g-prep', done: false, subs: ['CL', sub] },
      ],
      config: {
        rules: [beta, pre], holidays: DEFAULT_HOLIDAYS, mig: MIG, projects: [], companions: [],
        notes: { [ENF]: [{ v: 'SIV', items: [{ t: 'Beta site 예시 Case 작성 (PI 권한) · SIV Precheck list 결재 상신 (SIV Material · PPT)' }, { t: 'Beta site 안내' }, { t: '바인더' }] }] },
      },
    })
    const s = getState()
    expect(s.rules.map((r) => r.id)).toEqual(['r-e-pre'])
    expect(s.todos.get('e')).toMatchObject({ subs: ['CL'], checks: [] })
    expect(s.todos.get('b')!.subs).toEqual(['CL', sub])
    expect(s.notes![ENF][0].items.map((x) => x.t)).toEqual(['SIV Precheck list 결재 상신 (SIV Material · PPT)', '바인더'])
  })
})

describe('지방 기관 KTX 예매 (ktx1)', () => {
  it('지방 기관 외근을 등록하면 Preparation 에 KTX 예매가 생기고(등록한 날 착수, 등록일 WD1), 수도권 기관·예전 외근에는 안 생긴다', async () => {
    const rules = [...RULES, { ...WID_RULE }]
    const old: CalEvent = { ...visit, id: 'old', site: '울산대', date: '2026-10-28', createdDate: '2026-10-01' }
    await replaceAll({
      events: [{ ...old, genKey: genKey(old, { rules, holidays: DEFAULT_HOLIDAYS }) }], todos: [], fuls: [],
      config: { rules, holidays: DEFAULT_HOLIDAYS, mig: ['scan1', 'ful5', 'fulpack3', 'wid1', 'ktx2'], notes: null, projects: [], companions: [] },
    })
    expect(getState().rules.map((r) => r.id)).toContain('r-ktx')
    await syncEvent(getState().events.get('old')!, true)
    expect(getState().todos.get('a_old_g-prep')?.subs ?? []).not.toContain('KTX 예매')
    const far: CalEvent = { ...visit, id: 'far', site: '021. 울산대병원(PI 홍길동)', date: '2026-10-28', createdDate: '2026-10-12' }
    const near: CalEvent = { ...far, id: 'near', site: '서울아산병원' }
    for (const e of [far, near]) {
      await putEvent(e)
      await syncEvent(e)
    }
    const t = getState().todos.get('a_far_g-prep')!
    expect(t.subs).toEqual(['KTX 예매', 'WID 외근 일정 등록', 'CL'])
    expect(partDues(t, getState())['KTX 예매']).toBe('2026-10-13')
    expect(getState().todos.get('a_near_g-prep')!.subs).toEqual(['WID 외근 일정 등록', 'CL'])
  })

  it('지방 기관: 지역·병원 이름으로 본다 (서울아산·순천향·PI 이름은 아님)', () => {
    expect(['강원대병원', '고신대학교병원', '원광대학교병원', '천안충무병원', '창원한마음병원', '원주세브란스', '대구가톨릭대학교병원', '전남대병원'].every((x) => isFarSite(x))).toBe(true)
    expect(['서울아산병원', '순천향대서울병원', '분당서울대', '인하대병원', '성빈센트병원', '아주대병원(PI 김광주)'].some((x) => isFarSite(x))).toBe(false)
  })
})

describe('이미 등록한 지방 외근에 KTX 예매 (ktx2)', () => {
  it('오늘 이후 지방 외근의 열린 Preparation 에 날짜 순 자리로 넣는다 (지난 외근·수도권은 그대로)', async () => {
    const rules = [...RULES, { ...WID_RULE }]
    const ev = (id: string, site: string, date: string): CalEvent => ({ ...visit, id, site, date, createdDate: '2026-10-01' })
    const evs = [ev('far', '울산대', '2026-10-28'), ev('past', '울산대', '2026-10-08'), ev('near', '서울아산병원', '2026-10-28')]
    const prep = (e: string): Todo => ({ id: 'a_' + e + '_g-prep', title: e + ' MV Preparation', eventId: e, ruleId: 'g-prep', project: 'P', done: false, subs: ['WID 외근 일정 등록', '내가 단 것', 'CL'], checks: ['CL'] })
    await replaceAll({
      events: evs.map((e) => ({ ...e, genKey: genKey(e, { rules, holidays: DEFAULT_HOLIDAYS }) })), fuls: [],
      todos: evs.map((e) => prep(e.id)),
      config: { rules, holidays: DEFAULT_HOLIDAYS, mig: ['scan1', 'ful5', 'fulpack3', 'wid1'], notes: null, projects: [], companions: [] },
    })
    expect(getState().todos.get('a_far_g-prep')).toMatchObject({ subs: ['KTX 예매', 'WID 외근 일정 등록', '내가 단 것', 'CL'], checks: ['CL'] })
    expect(getState().todos.get('a_past_g-prep')!.subs).toEqual(['WID 외근 일정 등록', '내가 단 것', 'CL'])
    expect(getState().todos.get('a_near_g-prep')!.subs).toEqual(['WID 외근 일정 등록', '내가 단 것', 'CL'])
  })
})

describe('서명문서 eTMF 업로드는 따로 · Tarlatamab SIV 는 서명문서 스캔 (etmfsolo1, scant1)', () => {
  const TARL = 'Amgen - Tarlatamab'
  const MIG = ['ktx2', 'ktx1', 'scan1', 'prep1', 'ful5', 'isf1', 'etmf10', 'brzss1', 'fulpack1', 'fulpack2', 'fulpack3', 'imjmv1', 'brzful1', 'rptfix1', 'rptfix2', 'sivrsend1', 'chkat1', 'enflunch1', 'wid1', 'sivrprint1', 'presiv1', 'enfss1', 'group1', 'group2', 'docs1', 'enfbeta1']
  const after = (id: string, key: string, title: string, n: number, project = '*'): Rule => ({ id, key, type: '*', project, title, dir: 'after', n, unit: 'WD', send: false, verify: false, start: 'due', startN: 0 })
  const rules = [
    { ...SCAN_RULE },
    after('r-letter', 'FUL', '{site} {type} Follow-up Letter 발송', 5),
    after('r-etmf-t', 'ETMF', '{site} {type} 서명문서 eTMF 업로드', 10, TARL),
  ]
  const ev: CalEvent = { ...visit, id: 'w', type: 'SIV', project: TARL, site: '원주세브란스', date: '2026-10-15', createdDate: '2026-10-01' }
  const scan = '서명문서 스캔·eTMF 업로드'
  const etmf = '서명문서 eTMF 업로드'

  it('방문 후 정리에 들어간 eTMF 업로드를 낱개 할 일로 되돌리고(문서 체크째), 스캔은 "서명문서 스캔"으로 이름을 바꾼다', async () => {
    await replaceAll({
      events: [{ ...ev, genKey: genKey(ev, { rules, holidays: DEFAULT_HOLIDAYS }) }], fuls: [],
      todos: [{
        id: 'a_w_g-post', title: '원주세브란스 SIV 방문 후 정리', eventId: 'w', ruleId: 'g-post', project: TARL, done: false,
        subs: [scan, 'Follow-up Letter 발송', etmf], checks: [scan, scan + ' › CV', etmf + ' › eTMF:SIV Report'], checkAt: { [etmf + ' › eTMF:SIV Report']: '2026-10-20' },
      }],
      config: { rules, holidays: DEFAULT_HOLIDAYS, mig: MIG, notes: null, projects: [], companions: [] },
    })
    const s = getState()
    expect(s.rules.map((r) => r.id)).toEqual(['r-scan', 'r-scan-t-siv', 'r-letter', 'r-etmf-t'])
    expect(s.todos.get('a_w_r-etmf-t')).toMatchObject({ title: '원주세브란스 SIV 서명문서 eTMF 업로드', done: false, checks: ['eTMF:SIV Report'], checkAt: { 'eTMF:SIV Report': '2026-10-20' } })
    expect(s.todos.get('a_w_g-post')).toMatchObject({ subs: ['서명문서 스캔', 'Follow-up Letter 발송'], checks: ['서명문서 스캔', '서명문서 스캔 › CV'] })
    expect(planTodos(s.events.get('w')!, s).find((p) => p.ruleId === 'g-post')!.subs).toEqual(['서명문서 스캔', 'Follow-up Letter 발송'])
  })
})

describe('하위 항목을 다 체크하면 완료 · 단계 (enfsteps1, subdone1)', () => {
  it('하위 항목을 다 체크하면 할 일이 끝나고, 하나를 풀면 다시 열린다 (문서 체크는 상관없다)', async () => {
    const id = await addTodo({ title: '가 SIV Preparation', due: '2026-10-19', subs: ['A', 'B'], done: false })
    await toggleCheck(id, 'A')
    await toggleCheck(id, 'A › CV')
    expect(getState().todos.get(id)!.done).toBe(false)
    await toggleCheck(id, 'B')
    expect(getState().todos.get(id)).toMatchObject({ done: true })
    await toggleCheck(id, 'A')
    expect(getState().todos.get(id)).toMatchObject({ done: false, doneAt: null })
  })

  it('단계를 다 체크하면 그 하위 항목도 체크되고, 단계 하나를 풀면 하위 항목도 풀린다', async () => {
    const id = await addTodo({ title: '가 SIV Preparation', due: '2026-10-19', subs: ['계약서', 'CL'], checks: ['CL'], done: false })
    const steps = ['작성', 'PM 승인 확인']
    await toggleStep(id, '계약서', '작성', steps)
    expect(getState().todos.get(id)).toMatchObject({ checks: ['CL', '계약서 › 작성'], done: false })
    await toggleStep(id, '계약서', 'PM 승인 확인', steps)
    expect(getState().todos.get(id)).toMatchObject({ done: true })
    expect(getState().todos.get(id)!.checks).toContain('계약서')
    await toggleStep(id, '계약서', '작성', steps)
    expect(getState().todos.get(id)).toMatchObject({ done: false })
    expect(getState().todos.get(id)!.checks).not.toContain('계약서')
  })

  it('엔플론시아 계약서·ICF 규칙에 단계를 달고, 오늘 이후 엔플론시아 SIV Preparation 에 없으면 맨 위에 넣는다. 다 체크한 열린 묶음은 끝낸다', async () => {
    const MIG = ['scant1', 'etmfsolo1', 'ktx2', 'ktx1', 'scan1', 'prep1', 'ful5', 'isf1', 'etmf10', 'brzss1', 'fulpack1', 'fulpack2', 'fulpack3', 'imjmv1', 'brzful1', 'rptfix1', 'rptfix2', 'sivrsend1', 'chkat1', 'enflunch1', 'wid1', 'sivrprint1', 'presiv1', 'enfss1', 'group1', 'group2', 'docs1', 'enfbeta1']
    const cl: Rule = { id: 'r-e-cl', key: 'CL', type: 'SIV', project: ENF, title: '{site} SIV CL', dir: 'before', n: 2, unit: 'ADD', send: false, verify: false, start: 'due', startN: 0 }
    const rules = [...ENF_SS_RULES.map((r) => ({ ...r, steps: undefined })), cl]
    const ev: CalEvent = { ...visit, id: 'sc', type: 'SIV', project: ENF, site: 'SC제일산부인과', date: '2026-10-21', createdDate: '2026-10-05' }
    await replaceAll({
      events: [{ ...ev, genKey: genKey(ev, { rules, holidays: DEFAULT_HOLIDAYS }), skip: ['r-e-sscontract'] }], fuls: [],
      todos: [
        { id: 'a_sc_g-prep', title: 'SC제일산부인과 SIV Preparation', eventId: 'sc', ruleId: 'g-prep', project: ENF, done: false, subs: ['CL', '내 할 일'], checks: ['CL'] },
        { id: 'full', title: '다 한 묶음', ruleId: 'g-post', done: false, subs: ['X', 'Y'], checks: ['X', 'Y'], checkAt: { X: '2026-10-08T01:00:00.000Z', Y: '2026-10-09T02:00:00.000Z' } },
      ],
      config: { rules, holidays: DEFAULT_HOLIDAYS, mig: MIG, notes: null, projects: [], companions: [] },
    })
    const s = getState()
    expect(s.rules.find((r) => r.id === 'r-e-ssicf')!.steps).toEqual(['작성', 'ASF 작성', 'WID 상신', 'PM 결재 확인', 'T-sign 요청', 'WID에 T-sign 본 업로드'])
    expect(s.events.get('sc')!.skip).toEqual([])
    expect(s.todos.get('a_sc_g-prep')!.subs).toEqual(['계약서 Site specific 업데이트', 'ICF Site specific 업데이트', 'CL', '내 할 일'])
    expect(bundleParts(s.todos.get('a_sc_g-prep')!, s)['계약서 Site specific 업데이트'].steps).toEqual(['작성', 'WID 결재 상신', 'PM 승인 확인'])
    expect(s.todos.get('full')).toMatchObject({ done: true, doneAt: '2026-10-09T02:00:00.000Z' })
  })
})

describe('완료를 풀면 완료 전 체크로 되돌린다', () => {
  it('완료하며 자동으로 체크된 하위 항목만 풀리고, 직접 체크해 둔 것은 그대로', async () => {
    const id = await addTodo({ title: '가 SIV FUL', due: '2026-10-19', subs: ['A', 'B', 'C'], done: false })
    await toggleCheck(id, 'A')
    await toggleDone(getState().todos.get(id)!)
    expect(getState().todos.get(id)).toMatchObject({ done: true, checks: ['A', 'B', 'C'] })
    await toggleDone(getState().todos.get(id)!)
    expect(getState().todos.get(id)).toMatchObject({ done: false, checks: ['A'] })
    expect(Object.keys(getState().todos.get(id)!.checkAt!)).toEqual(['A'])
  })

  it('하위 항목 하나를 풀어 다시 열려도 자동으로 체크된 것은 함께 풀리고, 직접 다 체크해서 끝난 할 일은 풀어도 체크가 남는다', async () => {
    const id = await addTodo({ title: '가 SIV FUL', due: '2026-10-19', subs: ['A', 'B', 'C'], done: false })
    await toggleCheck(id, 'A')
    await toggleDone(getState().todos.get(id)!)
    await toggleCheck(id, 'B')
    expect(getState().todos.get(id)).toMatchObject({ done: false, checks: ['A'] })
    await toggleCheck(id, 'B')
    await toggleCheck(id, 'C')
    expect(getState().todos.get(id)!.done).toBe(true)
    await toggleDone(getState().todos.get(id)!)
    expect(getState().todos.get(id)).toMatchObject({ done: false, checks: ['A', 'B', 'C'] })
  })
})

describe('엔플론시아 SIV 예정 → 외근 Preparation 으로 합치기', () => {
  const DONE_MIG = ['enfprep2', 'subdone1', 'enfsteps1', 'scant1', 'etmfsolo1', 'ktx2', 'ktx1', 'scan1', 'prep1', 'ful5', 'isf1', 'etmf10', 'brzss1', 'fulpack1', 'fulpack2', 'fulpack3', 'imjmv1', 'brzful1', 'rptfix1', 'rptfix2', 'sivrsend1', 'chkat1', 'enflunch1', 'wid1', 'sivrprint1', 'presiv1', 'enfss1', 'group1', 'group2', 'docs1', 'enfbeta1']
  const cl: Rule = { id: 'r-e-cl', key: 'CL', type: 'SIV', project: ENF, title: '{site} SIV Confirmation Letter 발송', dir: 'before', n: 2, unit: 'ADD', send: false, verify: false, start: 'due', startN: 0 }
  const ppt: Rule = { id: 'r-siv-ssppt', key: 'SSPPT', type: 'SIV', project: '*', title: '{proj} {site} SIV PPT Site specific 업데이트 (ICF 삽입 등 일괄 검토)', dir: 'before', n: 4, unit: 'WD', send: false, verify: false, start: 'lead', startN: 2 }

  it('SIV 예정 Preparation 의 체크·단계 체크를 외근 Preparation 의 같은 일로 옮기고, 규칙에 없는 일은 덧붙인 뒤 지운다', async () => {
    await replaceAll({
      events: [], fuls: [],
      todos: [{
        id: 'prep', title: '엔플론시아 가나의원 SIV Preparation', project: ENF, prepKey: 'PREP', prepSite: '가나의원', done: false, due: '2026-10-14',
        subs: ['계약서 Site specific 업데이트', 'ICF Site specific 업데이트', '바인더 제작 요청 (중앙문화사, 오전 중)', 'Confirmation Letter 발송', '내가 단 것'],
        checks: ['계약서 Site specific 업데이트', 'ICF Site specific 업데이트 › 작성', '바인더 제작 요청 (중앙문화사, 오전 중)'], note: '원장님 확인',
      }],
      config: { rules: [...ENF_SS_RULES, cl, ppt], holidays: DEFAULT_HOLIDAYS, mig: DONE_MIG, notes: null, projects: [], companions: [] },
    })
    const ev: CalEvent = { ...visit, id: 'new', type: 'SIV', project: ENF, site: '가나의원', date: '2026-10-21', createdDate: '2026-10-12' }
    await putEvent(ev)
    await syncEvent(ev)
    expect(todos().map((t) => t.id)).toEqual(['a_new_g-prep'])
    expect(todos()[0]).toMatchObject({
      subs: ['계약서 Site specific 업데이트', 'ICF Site specific 업데이트', 'Confirmation Letter 발송', 'PPT Site specific 업데이트 (ICF 삽입 등 일괄 검토)', '바인더 제작 요청 (중앙문화사, 오전 중)', '내가 단 것'],
      checks: ['계약서 Site specific 업데이트', 'ICF Site specific 업데이트 › 작성', '바인더 제작 요청 (중앙문화사, 오전 중)'],
      note: '엔플론시아 가나의원 SIV Preparation: 원장님 확인',
    })
  })

  it('외근이 이미 있으면 SIV 예정을 적자마자 그 Preparation 으로 합친다 (앞 낱말로 기관을 찾는다)', async () => {
    await replaceAll({ events: [], fuls: [], todos: [], config: { rules: [...ENF_SS_RULES, cl], holidays: DEFAULT_HOLIDAYS, mig: DONE_MIG, notes: null, projects: [{ name: ENF, short: '엔플론시아', sites: [] }], companions: [] } })
    const ev: CalEvent = { ...visit, id: 'gc', type: 'SIV', project: ENF, site: '금천연세로이소아청소년과의원', date: '2026-10-21', createdDate: '2026-10-12' }
    await putEvent(ev)
    await syncEvent(ev)
    await addTodo({ title: '엔플론시아 금천 SIV 예정', done: false })
    expect(todos().map((t) => t.id)).toEqual(['a_gc_g-prep'])
  })
})

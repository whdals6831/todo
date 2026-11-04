import { describe, expect, it } from 'vitest'
import { BRZ } from './constants.ts'
import { docListsFor, etmfDocsFor, signDocsFor, sortDocs } from './signDocs.ts'
import type { CalEvent, Notes } from '../types/domain.ts'

const notes: Notes = {
  [BRZ]: [
    { v: 'PSV', items: [], docs: [{ t: 'CA', w: 'PI' }, { t: 'PSV Checklist', w: '' }, { t: 'CV', w: '미참석 연구진' }] },
    { v: 'Add-on Visit', items: [], docs: [{ t: 'Training Signature Form', w: '' }] },
    { v: 'MV', items: [] },
  ],
}
const events = new Map<string, CalEvent>([['e1', { id: 'e1', date: '2026-10-23', project: BRZ, site: '가나대병원', type: 'PSV' }]])

describe('서명문서 체크리스트', () => {
  it('외근에서 만든 할 일은 그 외근의 과제·방문 종류 목록을 쓴다 (미참석 연구진 → PI → 그 외)', () => {
    const docs = signDocsFor({ title: 'Breztri 가나대병원 PSV 서명문서 준비', eventId: 'e1' }, notes, events)
    expect(docs.map((d) => d.t)).toEqual(['CV', 'CA', 'PSV Checklist'])
  })

  it('직접 만든 할 일은 과제와 제목의 방문 종류로 찾는다', () => {
    expect(signDocsFor({ title: '브레즈트리 가나대 add-on 서명 서류 전달', project: BRZ }, notes, events).map((d) => d.t)).toEqual([
      'Training Signature Form',
    ])
  })

  it('서명문서 할 일이 아니거나, 방문 종류·목록이 없으면 붙이지 않는다', () => {
    expect(signDocsFor({ title: 'Breztri 가나대병원 PSVR 작성', eventId: 'e1' }, notes, events)).toEqual([])
    expect(signDocsFor({ title: '브레즈트리 천안충무병원 서명 서류 전달', project: BRZ }, notes, events)).toEqual([])
    expect(signDocsFor({ title: '브레즈트리 가나대 PSVR 서명문서 확인', project: BRZ }, notes, events)).toEqual([])
    expect(signDocsFor({ title: '브레즈트리 가나대 MV 서명문서 준비', project: BRZ }, notes, events)).toEqual([])
  })
})

describe('eTMF 에 올릴 문서', () => {
  it('Tarlatamab SIV eTMF 할 일에는 SIV 문서 이름 목록을 붙인다', () => {
    const docs = etmfDocsFor({ title: '탈라타맙 원주세브란스병원 SIV 문서 eTMF 업로드', project: 'Amgen - Tarlatamab' }, events)
    expect(docs).toHaveLength(10)
    expect(docs.map((d) => d.t).slice(0, 2)).toEqual(['SIV pre-Checklist', 'SIV Confirmation Letter'])
  })

  it('eTMF 할 일이 아니거나, 목록이 없는 과제·방문 종류면 붙이지 않는다', () => {
    expect(etmfDocsFor({ title: '탈라타맙 원주세브란스 SIVR 작성', project: 'Amgen - Tarlatamab' }, events)).toEqual([])
    expect(etmfDocsFor({ title: 'Breztri 가나대병원 PSV 서명문서 eTMF 업로드', eventId: 'e1' }, events)).toEqual([])
  })
})

describe('하위 항목의 문서 목록 (외근 할 일 묶음)', () => {
  it('서명문서 준비 같은 하위 항목에는 그 외근의 서명문서, eTMF 업로드에는 eTMF 문서 목록이 붙는다', () => {
    const notes = { [BRZ]: [{ v: 'PSV', items: [], docs: [{ t: 'CV' }] }] }
    const events = new Map([['e1', { id: 'e1', kind: 'visit', date: '2026-10-21', type: 'SIV', project: 'Amgen - Tarlatamab', site: '가' } as CalEvent], ['e2', { id: 'e2', kind: 'visit', date: '2026-10-21', type: 'PSV', project: BRZ, site: '가' } as CalEvent]])
    const prep = { title: '가나대병원 PSV Preparation', eventId: 'e2' }
    expect(docListsFor('서명문서 준비', prep, notes, events).map((l) => [l.key, l.items.map((d) => d.t)])).toEqual([['docs', ['CV']]])
    expect(docListsFor('Confirmation Letter 발송', prep, notes, events)).toEqual([])
    const post = { title: '원주 SIV 방문 후 정리', eventId: 'e1' }
    expect(docListsFor('서명문서 eTMF 업로드', post, notes, events).map((l) => l.key)).toEqual(['etmf'])
  })
})

describe('서명문서 순서', () => {
  it('개인정보처리동의서 → Signed CV → GCP 이수증 → PI → 그 외 (영문 이름도)', () => {
    const t = (xs: [string, string][]) => sortDocs(xs.map(([t, w]) => ({ t, w }))).map((d) => d.t)
    expect(
      t([
        ['Delegation log', 'PI/Sub-I/CRC'], ['Study Material Receipt', 'PI'], ['GCP 교육 이수증 (2년 이내)', 'PI/Sub-I/CRC'],
        ['Signed CV', 'PI/Sub-I/CRC'], ['Source Document Agreement', 'PI'], ['개인정보처리동의서 (PSV 때 못 받았거나 추가 인력)', 'PI/Sub-I/CRC'],
      ]),
    ).toEqual(['개인정보처리동의서 (PSV 때 못 받았거나 추가 인력)', 'Signed CV', 'GCP 교육 이수증 (2년 이내)', 'Study Material Receipt', 'Source Document Agreement', 'Delegation log'])
    expect(
      t([
        ['Attendee List', 'PI/Sub-I/CRC'], ['(PSV 미참석 연구진) GCP certificate', '해당 연구진'], ['Site Visit Record', 'PI'],
        ['(PSV 미참석 연구진) Signed and dated English CV', '해당 연구진'], ['(PSV 미참석 연구진) Amgen Privacy Notice', '해당 연구진'],
      ]),
    ).toEqual(['(PSV 미참석 연구진) Amgen Privacy Notice', '(PSV 미참석 연구진) Signed and dated English CV', '(PSV 미참석 연구진) GCP certificate', 'Site Visit Record', 'Attendee List'])
  })
})

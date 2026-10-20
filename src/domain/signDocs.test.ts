import { describe, expect, it } from 'vitest'
import { BRZ } from './constants.ts'
import { etmfDocsFor, signDocsFor } from './signDocs.ts'
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

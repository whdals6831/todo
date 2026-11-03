import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BRZ, DEFAULT_HOLIDAYS as holidays, ENF, TARL } from './constants.ts'
import { detectProject, siteCore, siteShort } from './project.ts'
import { specialFor } from './specials.ts'

const projects = [
  { name: BRZ, short: 'Breztri', sites: ['09. 가나대병원(PI 홍길동)'], aliases: ['브레즈트리'] },
  { name: ENF, short: '엔플론시아', sites: [] },
  { name: TARL, short: 'Tarlatamab', sites: ['01. 원주세브란스(PI 김)'], aliases: ['탈라타맙'] },
  { name: '기타', short: '기타', sites: [] },
]
const ctx = { projects, holidays }

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-08T09:00:00+09:00')) // 목요일, 다음 날 한글날
})
afterEach(() => vi.useRealTimers())

describe('기관·과제 이름', () => {
  it('기관 번호와 PI 를 떼고 핵심 이름으로 비교한다', () => {
    expect(siteShort('014. 다라대학교병원(PI 홍길동)')).toBe('다라대학교병원')
    expect(siteShort('(X)003. 마바의원(PI 김)')).toBe('마바의원')
    expect(siteCore('다라대학교 안암병원')).toBe('다라대안암')
  })

  it('과제 단어와 영문 오타를 알아본다', () => {
    expect(detectProject(projects, '브레즈트리 가나대 CA')).toBe(BRZ)
    expect(detectProject(projects, 'breztr 확인')).toBe(BRZ)
    expect(detectProject(projects, '팀 회의')).toBe('')
  })
})

describe('특수 키워드 흐름', () => {
  it('Breztri 새 기관 메일 → 메일(WD1) + CA(WD3)', () => {
    const sp = specialFor({ title: '브레즈트리 사아병원 메일' }, ctx)
    expect(sp?.kind).toBe('mail')
    expect(sp?.items.map((x) => [x.title, x.due])).toEqual([
      ['사아병원 1st contact mail·PSV 일정 문의', '2026-10-12'],
      ['사아병원 PSV Confidentiality Agreement(CA) 작성·서명 요청', '2026-10-14'],
    ])
  })

  it('탈라타맙 새 기관 메일도 같은 흐름 (과제는 Tarlatamab, 근거는 본인 기준)', () => {
    const sp = specialFor({ title: '탈라타맙 고신대 메일' }, ctx)
    expect(sp?.kind).toBe('mail')
    expect(sp?.items.map((x) => [x.title, x.due, x.project])).toEqual([
      ['고신대 1st contact mail·PSV 일정 문의', '2026-10-12', TARL],
      ['고신대 PSV Confidentiality Agreement(CA) 작성·서명 요청', '2026-10-14', TARL],
    ])
    expect(sp?.items[0].basis?.endsWith(' [본인 기준]')).toBe(true)
    expect(specialFor({ title: '탈라타맙 원주세브란스 메일' }, ctx)).toBeNull()
  })

  it('이미 배정된 기관이나 업무 문장이면 흐름을 쓰지 않는다', () => {
    expect(specialFor({ title: '브레즈트리 가나대 메일' }, ctx)).toBeNull()
    expect(specialFor({ title: '브레즈트리 계약서 메일' }, ctx)).toBeNull()
  })

  it('Breztri 의뢰사 승인 → Site Selection CL', () => {
    const sp = specialFor({ title: '브레즈트리 사아병원 의뢰사 승인됨' }, ctx)
    expect(sp?.kind).toBe('ssl')
    expect(sp?.items[0]).toMatchObject({ title: '브레즈트리 사아병원 Site Selection Confirmation Letter 발송', due: '2026-10-12', approvedSite: '사아병원' })
  })

  it('엔플론시아 SIV 예정 → SIV Preparation 하나 (계약서·ICF 먼저), 메세지·연락 같은 일은 아님', () => {
    const sp = specialFor({ title: '엔플론시아 자차의원 SIV 예정' }, ctx)
    expect(sp?.kind).toBe('enf')
    expect(sp?.items).toHaveLength(1)
    expect(sp?.items[0]).toMatchObject({ title: '엔플론시아 자차의원 SIV Preparation', prepKey: 'PREP', prepSite: '자차의원', due: '2026-10-13' })
    expect(sp?.items[0].subs?.slice(0, 2)).toEqual(['계약서 Site specific 업데이트', 'ICF Site specific 업데이트'])
    expect(specialFor({ title: '엔플론시아 금천 원장님께 SIV 메세지' }, ctx)).toBeNull()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BRZ, DEFAULT_HOLIDAYS as holidays, ENF } from './constants.ts'
import { detectProject, siteCore, siteShort } from './project.ts'
import { specialFor } from './specials.ts'

const projects = [
  { name: BRZ, short: 'Breztri', sites: ['09. 가나대병원(PI 홍길동)'], aliases: ['브레즈트리'] },
  { name: ENF, short: '엔플론시아', sites: [] },
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

  it('이미 배정된 기관이나 업무 문장이면 흐름을 쓰지 않는다', () => {
    expect(specialFor({ title: '브레즈트리 가나대 메일' }, ctx)).toBeNull()
    expect(specialFor({ title: '브레즈트리 계약서 메일' }, ctx)).toBeNull()
  })

  it('Breztri 의뢰사 승인 → Site Selection CL', () => {
    const sp = specialFor({ title: '브레즈트리 사아병원 의뢰사 승인됨' }, ctx)
    expect(sp?.kind).toBe('ssl')
    expect(sp?.items[0]).toMatchObject({ title: '브레즈트리 사아병원 Site Selection Confirmation Letter 발송', due: '2026-10-12', approvedSite: '사아병원' })
  })

  it('엔플론시아 SIV 예정 → 준비 할 일 7개, CL·EDC 는 TBD', () => {
    const sp = specialFor({ title: '엔플론시아 자차의원 SIV 예정' }, ctx)
    expect(sp?.kind).toBe('enf')
    expect(sp?.items).toHaveLength(7)
    expect(sp?.items.filter((x) => x.tbd).map((x) => x.prepKey)).toEqual(['CL', 'EDC'])
    expect(sp?.items.find((x) => x.prepKey === 'BINDER')).toMatchObject({ due: '2026-10-13', time: '11:30' })
  })
})

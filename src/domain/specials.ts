import type { Data, Todo } from '../types/domain.ts'
import { BRZ, ENF } from './constants.ts'
import { addWorkdays, md, todayStr } from './date.ts'
import { detectProject, sameSite, siteCore, stripProj } from './project.ts'

/*
 * 할 일 제목의 키워드로 동작하는 과제별 특수 흐름 (원본 그대로 과제 이름에 묶여 있다).
 *   "브레즈트리 <새 기관> 메일"        → 1st contact mail·PSV 일정 문의(WD1) + CA(WD3)
 *   "브레즈트리 <기관> 의뢰사 승인됨"   → Site Selection CL 발송(WD1), 대기 중인 선정 확인 할 일 완료
 *   "엔플론시아 <기관> SIV 예정"       → 계약서·ICF(WD1), PPT·서명서류·바인더(WD2), CL·EDC(TBD)
 */

/** id 가 없는 새 할 일 */
export type NewTodo = Omit<Todo, 'id'> & { id?: string }

type Ctx = Pick<Data, 'projects' | 'holidays'>

/** 기관 이름이 아니라 업무 내용을 적은 제목이면 특수 흐름을 쓰지 않는다 */
const NEWSITE_TASKWORDS =
  /업데이트|확인|전달|작성|요청|회신|정리|송부|발송|업로드|서명|계약|omf|cl|ful|etmf|edc|crc|pi|ca|sdv|psv|siv|mv|cov|follow|letter|선생님|교수님|담당|수정|ppt|인쇄|예약|회의|교육|qc|검토|논의|일정|자료|파일|문서|바인더|icf|준비물/i

const looksLikeSite = (rest: string) => !!rest && rest.split(' ').length <= 3 && !NEWSITE_TASKWORDS.test(rest)

/** Breztri 신규 배정 기관 첫 연락 메일 → [메일 할 일, CA 할 일] */
export function newSiteMail(t: NewTodo, ctx: Ctx): { main: NewTodo; ca: NewTodo } | null {
  if (t.parentId || detectProject(ctx.projects, t.title) !== BRZ) return null
  if (!/메일|mail/i.test(t.title)) return null
  const proj = ctx.projects.find((p) => p.name === BRZ) ?? { sites: [] as string[] }
  const rest = stripProj(ctx.projects, t.title, BRZ)
    .replace(/1st\s*contact|first\s*contact|메일|mail|보내기|새\s*기관|신규\s*기관|신규|새로|배정|기관(?=\s)|[·,:-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!looksLikeSite(rest)) return null
  const c = siteCore(rest)
  if (c.length < 2) return null
  if (proj.sites.some((x) => sameSite(siteCore(x), c))) return null
  const today = todayStr()
  const due = addWorkdays(today, 1, ctx.holidays)
  const caDue = addWorkdays(today, 3, ctx.holidays)
  return {
    ca: {
      title: rest + ' PSV Confidentiality Agreement(CA) 작성·서명 요청', project: BRZ, start: today, due: caDue, time: '', tbd: false, autoDue: false, done: false,
      created: new Date().toISOString(),
      basis: '신규 배정 기관 · 추가일 ' + md(today) + ' 후 WD3 = ' + md(caDue) + ' [본인 기준. Breztri PMP 13.1: 기관 방문 전 CA 서명 완료되도록 진행]',
      startBasis: '추가한 당일 착수',
    },
    main: {
      ...t,
      title: rest + ' 1st contact mail·PSV 일정 문의', project: BRZ, start: today, due, time: '', tbd: false, autoDue: false,
      basis: '신규 배정 기관 · 추가일 ' + md(today) + ' 후 WD1 = ' + md(due) + ' [본인 기준. Breztri PMP 13.1: site list 수령 후 WD5 이내 기관 연락·방문 일정 논의]',
      startBasis: '추가한 당일 착수',
    },
  }
}

/** 엔플론시아(Non-IRB) 기관 SIV 가 곧 잡힐 때의 준비 할 일 묶음 */
export function enfSivPrep(t: NewTodo, ctx: Ctx): NewTodo[] | null {
  if (t.parentId || t.prepKey || detectProject(ctx.projects, t.title) !== ENF || !/siv|개시/i.test(t.title)) return null
  const rest = stripProj(ctx.projects, t.title, ENF)
    .replace(/siv|개시(모임)?|예정|준비|신규|새\s*기관|기관(?=\s)|확정|[·,:-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!looksLikeSite(rest)) return null
  const today = todayStr()
  const wd = (k: number) => addWorkdays(today, k, ctx.holidays)
  const P1 = '엔플론시아 ' + rest + ' '
  const now = new Date().toISOString()
  const b = (k: number, why: string) => '엔플론시아 SIV 준비 · 추가일 ' + md(today) + (k ? ' 후 WD' + k + ' = ' + md(wd(k)) : '') + ' [' + why + ']'
  const mk = (key: string, title: string, k: number | null, why = '', extra: Partial<NewTodo> = {}): NewTodo => ({
    title: P1 + title, project: ENF, prepSite: rest, prepKey: key,
    start: k == null ? '' : wd(k), due: k == null ? '' : wd(k), tbd: k == null, time: '', autoDue: false, done: false, created: now,
    basis: k == null ? '외근(SIV) 등록 전까지 TBD → 외근 등록하면 등록일 기준 WD2 내로 자동 지정 [본인 기준: Non-IRB 기관이라 개시가 급하게 잡힘]' : b(k, why),
    startBasis: k == null ? '' : '추가일 후 WD' + k + ' 당일 착수 (마감일과 같은 날)',
    ...extra,
  })
  return [
    mk('CONTRACT', '계약서 Site specific 업데이트', 1, '본인 기준: Non-IRB 기관 급한 개시 → 계약서·ICF 먼저, WD1 내'),
    mk('ICF', 'ICF Site specific 업데이트', 1, '본인 기준: Non-IRB 기관 급한 개시 → 계약서·ICF 먼저, WD1 내'),
    mk('SSPPT', 'SIV PPT Site specific 업데이트 (ICF 삽입 등 일괄 검토)', 2, '본인 기준: WD2 내'),
    mk('SSSIGN', 'SIV 서명서류 Site specific develop', 2, '본인 기준: WD2 내'),
    mk('BINDER', 'SIV 바인더 제작 요청 (중앙문화사, 오전 중)', 2, '본인 기준: WD2 내, 오전에 요청하면 다음 날 도착', { time: '11:30' }),
    mk('CL', 'SIV Confirmation Letter 발송', null),
    mk('EDC', 'SIV EDC 계정 발급 요청', null),
  ]
}

/** Breztri 의뢰사 기관 선정 승인 → Site Selection CL 발송 */
export function breztriApproved(t: NewTodo, ctx: Ctx): (NewTodo & { approvedSite: string })[] | null {
  if (t.parentId || t.prepKey || detectProject(ctx.projects, t.title) !== BRZ) return null
  if (!/(의뢰사|스폰서|sponsor|선정)\s*(기관\s*)?(승인|선정)|승인\s*됨|선정\s*됨|승인\s*완료|선정\s*완료/i.test(t.title)) return null
  const rest = stripProj(ctx.projects, t.title, BRZ)
    .replace(/의뢰사|스폰서|sponsor|기관\s*선정|선정|승인|완료|됨|났음|남|확인|기관(?=\s)|[·,:-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!looksLikeSite(rest) || siteCore(rest).length < 2) return null
  const today = todayStr()
  const due = addWorkdays(today, 1, ctx.holidays)
  return [{
    title: '브레즈트리 ' + rest + ' Site Selection Confirmation Letter 발송', project: BRZ, start: today, due, time: '', tbd: false, autoDue: false, done: false,
    created: new Date().toISOString(), approvedSite: rest,
    basis: '의뢰사 기관 선정 승인 확인일 ' + md(today) + ' 후 WD1 = ' + md(due) + ' [본인 기준. Breztri PMP 13.1: 기관 선정이 확인되면 Site Selection Confirmation Letter를 기관에 전달]',
    startBasis: '승인 확인한 당일 착수',
  }]
}

export type Special =
  | { kind: 'enf'; items: NewTodo[] }
  | { kind: 'ssl'; items: (NewTodo & { approvedSite: string })[] }
  | { kind: 'mail'; items: NewTodo[] }

/** 입력한 제목이 특수 흐름이면 만들어질 할 일 (추가와 입력창 미리보기가 함께 쓴다) */
export function specialFor(t: NewTodo, ctx: Ctx): Special | null {
  const e = enfSivPrep(t, ctx)
  if (e) return { kind: 'enf', items: e }
  const a = breztriApproved(t, ctx)
  if (a) return { kind: 'ssl', items: a }
  const m = newSiteMail(t, ctx)
  if (m) return { kind: 'mail', items: [m.main, m.ca] }
  return null
}

/** 입력창이 비어 있을 때 보여 주는 키워드 예시 */
export const QUICK = [
  { t: '브레즈트리 기관명 메일', d: '신규 배정 기관 → 1st contact mail·PSV 일정 문의(WD1) + CA(WD3)' },
  { t: '브레즈트리 기관명 의뢰사 승인됨', d: '→ Site Selection CL 발송(당일 착수, WD1)' },
  { t: '엔플론시아 기관명 SIV 예정', d: '→ 계약서·ICF(WD1), PPT·서명서류·바인더(WD2), CL·EDC(TBD)' },
]

/** 제목에 keyword 가 들어간 할 일과 함께 추가할 할 일 규칙 */
export const companionsFor = (t: Pick<Todo, 'title' | 'project'>, companions: Data['companions']) => {
  const title = String(t.title || '')
  return (companions || []).filter(
    (c) => c.keyword && (!c.project || c.project === t.project) && title.toLowerCase().includes(c.keyword.toLowerCase()),
  )
}

/** 완료하면 확인 할 일이 생기는 할 일 (완료일 + WD n). 완료를 취소하면 아직 열린 확인 할 일은 지운다 */
export const FOLLOWUPS = [
  {
    id: 'sae-irb',
    match: (x: string) => /SAE/i.test(x) && /IRB/i.test(x) && /요청/.test(x) && !/확인/.test(x),
    n: 2,
    title: (x: string) => {
      const i = x.search(/SAE/i)
      const lead = x.slice(0, i).trim()
      return (lead ? lead + ' ' : '') + 'SAE IRB 제출 여부 확인'
    },
    basis: '본인 기준: SAE IRB 제출 요청 후 WD2 내 제출 확인',
  },
]

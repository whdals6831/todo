import type { CalEvent, Companion, DateStr, EventKind, Holidays, Project, Rule, StartMode } from '../types/domain.ts'

export const TYPES = ['PSV', 'SIV', 'MV', 'Add-on', 'COV', '기타'] as const

export const TYPE_LABEL: Record<string, string> = {
  PSV: 'PSV',
  SIV: 'SIV (개시모임)',
  MV: 'MV',
  'Add-on': 'Add-on (추가 방문)',
  COV: 'COV',
  기타: '기타 외근 (자동 할 일 없음)',
}

export const KINDS: [EventKind, string][] = [
  ['visit', '외근'],
  ['meeting', '회의'],
  ['training', '교육'],
  ['leave', '휴가'],
]

export const kindOf = (e?: Pick<CalEvent, 'kind'> | null): EventKind =>
  e && e.kind && e.kind !== 'visit' ? e.kind : 'visit'

export const kindLabel = (k: EventKind) => (KINDS.find((x) => x[0] === k) ?? KINDS[0])[1]

/** 같은 날에 일정 종류를 보여 주는 순서 */
export const KIND_ORDER: Record<EventKind, number> = { leave: 0, visit: 1, training: 2, meeting: 3 }

/** 그날에 걸친 일정인가 (여러 날 일정 포함) */
export const coversDay = (e: CalEvent, d: DateStr) =>
  e.date === d || (!!e.endDate && e.date <= d && d <= e.endDate)

/** 같은 날 일정 정렬: 종류 순, 시간 순 */
export const byKindTime = (a: CalEvent, b: CalEvent) =>
  KIND_ORDER[kindOf(a)] - KIND_ORDER[kindOf(b)] || (a.time || '').localeCompare(b.time || '')

/** 규칙 항목. 같은 key 의 규칙끼리 서로 덮어쓴다 */
export const KEYS: [string, string][] = [
  ['CL', 'Confirmation Letter'],
  ['OWN', '리포트 본인 작성'],
  ['REPORT', '리포트 PM 검토·제출'],
  ['FUL', 'Follow-up Letter'],
  ['SSL', 'Site Selection CL'],
  ['SCAN', '서명문서 스캔·업로드'],
  ['ETMF', 'eTMF 업로드'],
  ['EDC', 'EDC 계정 요청'],
  ['LUNCH', '도시락 예약'],
  ['', '기타 (덮어쓰지 않음)'],
  ['SKIP', '이 과제·방문은 자동 할 일 없음'],
]

export const SCAN_RULE: Rule = {
  id: 'r-scan', key: 'SCAN', type: '*', project: '*', title: '{site} {type} 서명문서 스캔·eTMF 업로드',
  dir: 'after', n: 1, unit: 'WD', send: false, verify: false,
  basis: '본인 기준: 방문 때 받아 온 서명문서는 다음 영업일(WD1)에 스캔·eTMF 업로드', start: 'due', startN: 0,
}

/** 방문 전 서명문서 준비·인쇄 규칙 */
export const PREP_RULES: Rule[] = [
  {
    id: 'r-psv-sign-prep', key: '', type: 'PSV', project: '*', title: '{proj} {site} PSV 서명문서 준비',
    dir: 'before', n: 2, unit: 'WD', send: false, verify: false, basis: '본인 기준: PSV 방문 WD2 전까지 서명문서 준비', start: 'lead', startN: 1,
  },
  {
    id: 'r-siv-script-print', key: '', type: 'SIV', project: '*', title: '{proj} {site} SIV PPT 발표 스크립트 포함 1부 인쇄',
    dir: 'before', n: 1, unit: 'WD', send: false, verify: false, basis: '본인 기준: SIV 전날(방문 WD1 전) 준비', start: 'due', startN: 0,
  },
  {
    id: 'r-b-psv-pamphlet', key: '', type: 'PSV', project: 'AZ - Breztri', title: '{proj} {site} PSV 보험급여 안내 팜플렛 인쇄 (15분)',
    dir: 'before', n: 1, unit: 'WD', send: false, verify: false, basis: '본인 기준: PSV 전날(방문 WD1 전) 준비', start: 'due', startN: 0,
  },
]

/** Imjudo MV 다녀와서 ISF checklist 확인일 업데이트·CRA 서명 */
export const ISF_RULE: Rule = {
  id: 'r-i-isf', key: '', type: 'MV', project: 'AZ - Imjudo', title: '{site} {type} ISF checklist 업데이트·CRA 서명',
  dir: 'after', n: 2, unit: 'WD', send: false, verify: false,
  basis: 'Imjudo: ISF checklist 는 MV 시 확인 후 해당일 업데이트 및 CRA 서명 (본인 기준 WD2)', start: 'fresh', startN: 0,
}

export const DEFAULT_RULES: Rule[] = [
  { ...SCAN_RULE },
  { ...ISF_RULE },
  ...PREP_RULES.map((r) => ({ ...r })),
  { id: 'r-cl', key: 'CL', type: '*', project: '*', title: '{site} {type} Confirmation Letter 발송', dir: 'before', n: 3, unit: 'WD', send: true, verify: true, basis: 'PMP 확인 필요 (임시값)', start: 'lead', startN: 2 },
  { id: 'r-rpt', key: 'OWN', type: '*', project: '*', title: '{site} {type}R 작성', dir: 'after', n: 5, unit: 'WD', send: false, verify: false, basis: '방문 리포트 본인 작성 기한 WD5', start: 'fresh', startN: 0 },
  { id: 'r-pm', key: 'REPORT', type: '*', project: '*', title: 'PM - {proj} {site} {type} (WD10)', dir: 'after', n: 10, unit: 'WD', send: false, verify: false, basis: 'PM 리포트 검토 기한 WD10', start: 'lead', startN: 2 },
  { id: 'r-ful', key: 'FUL', type: '*', project: '*', title: '{site} {type} Follow-up Letter 발송', dir: 'after', n: 5, unit: 'WD', send: false, verify: false, basis: '방문 후 WD5 송부 (PMP: WD5 이내)', start: 'lead', startN: 2 },
  { id: 'r-ssl', key: 'SSL', type: 'PSV', project: '*', title: '[대기] {site} 의뢰사 선정 승인 확인 → Site Selection CL 발송', dir: 'after', n: 5, unit: 'WD', send: false, verify: true, basis: 'PMP 확인 필요 (임시값), 승인 조건부', start: 'due', startN: 0 },
  { id: 'r-etmf-b', key: 'ETMF', type: '*', project: 'AZ - Breztri', title: '{site} {type} 서명문서 eTMF 업로드', dir: 'after', n: 30, unit: 'CD', send: false, verify: false, basis: '서명문서 발생 시 캘린더 데이 30일 이내', start: 'lead', startN: 5 },
  { id: 'r-siv-edc', key: 'EDC', type: 'SIV', project: '*', title: '{site} SIV EDC 계정 요청', dir: 'before', n: 5, unit: 'WD', send: false, verify: false, basis: 'CRA 업무 기준: SIV 전 EDC 계정 요청 (PMP 외, 방문 WD5 전)', start: 'lead', startN: 2 },
  { id: 'r-siv-lunch', key: 'LUNCH', type: 'SIV', project: '*', title: '{site} SIV 도시락 예약', dir: 'before', n: 3, unit: 'WD', send: false, verify: false, basis: 'CRA 업무 기준: SIV 도시락 예약 (PMP 외, 방문 WD3 전)', start: 'lead', startN: 2 },
  { id: 'r-etmf-i', key: 'ETMF', type: '*', project: 'AZ - Imjudo', title: '{site} {type} 서명문서 eTMF 업로드', dir: 'after', n: 30, unit: 'CD', send: false, verify: false, basis: '서명문서 발생 시 캘린더 데이 30일 이내', start: 'lead', startN: 5 },
]

export const START_WHY: Record<StartMode, string> = {
  fresh: '방문 기억이 가장 선명할 때 초안 (망각곡선: 하루 안에 많이 잊음)',
  lead: '작업 시간을 실제보다 짧게 잡는 경향(계획 오류) 대비 여유',
  due: '그날 바로 처리하는 일',
}

/** 옛 규칙에 key·start 가 없을 때 채우는 값 */
export const DEFAULT_KEYMAP: Record<string, string> = {
  'r-cl': 'CL', 'r-rpt': 'OWN', 'r-pm': 'REPORT', 'r-ful': 'FUL', 'r-ssl': 'SSL', 'r-etmf-b': 'ETMF', 'r-etmf-i': 'ETMF',
}
export const DEFAULT_STARTMAP: Record<string, [StartMode, number]> = {
  'r-cl': ['lead', 2], 'r-rpt': ['fresh', 0], 'r-pm': ['lead', 2], 'r-ful': ['fresh', 0], 'r-ssl': ['due', 0], 'r-etmf-b': ['lead', 5], 'r-etmf-i': ['lead', 5],
}

/**
 * 실제 과제·기관 목록은 데이터 가져오기로 채운다 (기관명·PI 실명이 있어 코드에 두지 않는다).
 * 원본은 첫 과제를 새 외근의 기본값으로 쓰므로 최소 하나는 있어야 한다.
 */
export const DEFAULT_PROJECTS: Project[] = [{ name: '기타', short: '기타', sites: [] }]

export const DEFAULT_COMPANIONS: Companion[] = []

export const DEFAULT_HOLIDAYS: Holidays = {
  '2026-01-01': '신정', '2026-02-16': '설날 연휴', '2026-02-17': '설날', '2026-02-18': '설날 연휴', '2026-03-02': '삼일절 대체',
  '2026-05-05': '어린이날', '2026-05-25': '부처님오신날 대체', '2026-06-03': '지방선거', '2026-08-17': '광복절 대체',
  '2026-09-24': '추석 연휴', '2026-09-25': '추석', '2026-09-26': '추석 연휴', '2026-10-05': '개천절 대체', '2026-10-09': '한글날',
  '2026-12-25': '성탄절',
  '2027-01-01': '신정', '2027-02-08': '설날 연휴', '2027-02-09': '설날 대체', '2027-03-01': '삼일절', '2027-05-05': '어린이날',
  '2027-05-13': '부처님오신날', '2027-08-16': '광복절 대체', '2027-09-14': '추석 연휴', '2027-09-15': '추석', '2027-09-16': '추석 연휴',
  '2027-10-04': '개천절 대체', '2027-10-11': '한글날 대체', '2027-12-27': '성탄절 대체',
}

/** 할 일 제목에서 과제를 알아보는 기본 단어 (설정의 과제별 단어와 합쳐 쓴다) */
export const BUILTIN_ALIASES: Record<string, string[]> = {
  'AZ - Imjudo': ['imjudo', '이뮤도', '임주도', '임쥬도', 'imfinzi', '임핀지'],
  'AZ - Breztri': ['breztri', '브레즈트리', '브레즈'],
  'MSD - 엔플론시아': ['엔플론시아', 'enflonsia', '엔플'],
  'Amgen - Tarlatamab': ['tarlatamab', '탈라타맙', '임델트라', 'imdelltra', 'tarla'],
}

/* 과제별 특수 흐름이 쓰는 과제 이름 */
export const BRZ = 'AZ - Breztri'
export const ENF = 'MSD - 엔플론시아'

/** IRB 가 없어 개시가 급하게 잡히는 과제 — 방문 전 기한을 등록일 이후로 당긴다 */
export const URGENT_PROJECTS = [ENF]

/** 이날 이후부터 "그날 할 일 모두 완료" 토끼를 붙인다 */
export const BUNNY_SINCE: DateStr = '2026-10-13'

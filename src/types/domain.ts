/**
 * 도메인 타입. 필드 이름과 값 형식은 원본(protocol.html)과 이전 데이터(protocol-data.json)를
 * 그대로 따른다. 날짜가 "없음"이면 null 이 아니라 빈 문자열이다.
 */

/** 'YYYY-MM-DD', 없으면 "" */
export type DateStr = string
/** 'HH:MM', 없으면 "" */
export type TimeStr = string

export type EventKind = 'visit' | 'meeting' | 'training' | 'leave'
export type VisitType = 'PSV' | 'SIV' | 'MV' | 'Add-on' | 'COV' | '기타'

/** 캘린더 일정. kind 가 없으면 외근(visit)이다. */
export interface CalEvent {
  id: string
  kind?: EventKind
  date: DateStr
  /** 여러 날 일정(교육·휴가)의 마지막 날 */
  endDate?: DateStr
  time?: TimeStr
  project?: string
  /** 외근 기관 — "014. 전남대병원(PI 홍길동)" 형식 */
  site?: string
  /** 외근의 방문 종류(VisitType) */
  type?: string
  /** 외근이 아닌 일정의 제목 */
  title?: string
  memo?: string
  /** 직접 지운 자동 할 일의 규칙 id — 다시 만들지 않는다 */
  skip?: string[]
  /** 마지막으로 자동 할 일을 맞춘 입력의 서명. 같으면 다시 만들지 않는다 */
  genKey?: string
  /** 일정을 등록한 날 (급한 개시·FUL 마감 계산의 기준) */
  createdDate?: DateStr
  /** 외부에서 가져온 일정 표시 (예: 'gcal') */
  source?: string
}

export interface Todo {
  id: string
  title: string
  project?: string
  /** 마감일. "" 이면 TBD 또는 Someday */
  due?: DateStr
  time?: TimeStr
  /** 착수일 */
  start?: DateStr
  tbd?: boolean
  someday?: boolean
  /** 날짜를 적지 않아 추가한 날로 잡힌 마감 — 긴급·지연 표시를 하지 않는다 */
  autoDue?: boolean
  done?: boolean
  /** 완료 시각 (ISO, UTC) */
  doneAt?: string | null
  /** 직접 정한 순서. 사이에 끼우면 소수가 된다 */
  rank?: number
  /** 다음 영업일로 미룬 횟수 */
  rolled?: number
  origDue?: DateStr
  /** 마감일 근거 문장 */
  basis?: string
  /** 착수일 근거 문장 */
  startBasis?: string
  note?: string
  /** 직접 단 하위 항목 (체크리스트) */
  subs?: string[]
  /** 체크리스트(서명문서·하위 항목)에서 체크한 이름 */
  checks?: string[]
  /** 체크한 시각 (이름 → ISO). 시각을 모르는 옛 체크는 날짜(YYYY-MM-DD)만 */
  checkAt?: Record<string, string>
  /** PMP 원문으로 확인되지 않은 임시 규칙에서 나온 할 일 */
  verify?: boolean
  /** 자동 할 일을 만든 일정 */
  eventId?: string
  /** 자동 할 일을 만든 규칙. '-manual' 로 끝나면 직접 고친 것이라 규칙이 바뀌어도 덮어쓰지 않는다 */
  ruleId?: string | null
  /** 함께 추가된 할 일의 원래 할 일 */
  parentId?: string
  /** 함께 추가된 할 일의 날짜를 직접 바꿈 — 원래 할 일을 따라 움직이지 않는다 */
  ownDate?: boolean
  /** 완료하면 생기는 확인 할 일의 원래 할 일 */
  followOf?: string
  /** FUL 메모에서 넘어온 할 일 */
  fulId?: string
  /** 엔플론시아 SIV 준비 할 일의 항목 key 와 기관 */
  prepKey?: string
  prepSite?: string
  /** Breztri 승인 흐름에서 만든 할 일의 기관 */
  approvedSite?: string
  /** 만든 시각 (ISO) */
  created?: string
  /** 외부에서 가져온 할 일 표시 (예: 'mail') */
  source?: string
}

/** FUL 메모: 기관의 다음 방문 때 챙길 일. 그 기관 외근을 등록하면 할 일로 넘어간다 */
export interface Ful {
  id: string
  project: string
  site: string
  /** '*' 이면 다음 방문, 아니면 그 방문 종류 */
  type: string
  text: string
  created: string
  done?: boolean
  todoId?: string
  eventId?: string
  linkedAt?: DateStr
}

export type RuleDir = 'before' | 'after'
/** WD 영업일 · CD 달력일 · ADD 외근 등록일 기준 영업일 */
export type RuleUnit = 'WD' | 'CD' | 'ADD'
/** fresh 방문 다음 영업일 · lead 마감 N영업일 전 · due 마감일 당일 */
export type StartMode = 'fresh' | 'lead' | 'due'

/** 기한 규칙. 같은 key 끼리는 과제·방문 종류를 지정한 규칙이 '전체' 규칙을 덮어쓴다 */
export interface Rule {
  id: string
  /** 옛 데이터에는 없을 수 있다 (normRule 이 채움) */
  key?: string
  /** 방문 종류 또는 '*' */
  type: string
  /** 과제 이름 또는 '*' */
  project: string
  /** {site} {type} {proj} 자리표시자를 쓸 수 있는 할 일 이름 */
  title: string
  dir: RuleDir
  n: number
  unit: RuleUnit
  /** 보내는 일 — 실제 마감을 기한 전 영업일로 */
  send: boolean
  verify: boolean
  basis?: string
  start?: StartMode
  startN?: number
  /** 꺼 둔 규칙 (같은 key 의 '전체' 규칙도 막는다) */
  off?: boolean
  time?: TimeStr
  /** 만들 할 일에 붙일 하위 항목 (자리표시자를 쓸 수 있다) */
  subs?: string[]
  /** 할 일에 띄워 눌러서 복사하는 결재 상신 제목 (자리표시자를 쓸 수 있다) */
  copy?: string
}

export type NormRule = Rule & { key: string; start: StartMode; startN: number }

export interface Project {
  name: string
  short: string
  /** "09. 삼성서울병원(PI 홍길동)" 형식, 한 줄에 하나 */
  sites: string[]
  /** 할 일 제목에서 과제를 알아보는 단어 */
  aliases?: string[]
}

/** 제목에 keyword 가 들어간 할 일을 추가하면 items 도 같은 마감으로 함께 추가한다 */
export interface Companion {
  /** 과제 이름, "" 이면 전체 */
  project: string
  keyword: string
  items: string[]
}

/** 'YYYY-MM-DD' → 이름 */
export type Holidays = Record<DateStr, string>

export interface NoteItem {
  /** 내용 */
  t: string
  /** 기한 또는 서명자 */
  w?: string
  /** 체크 */
  c?: boolean
}

export interface NoteSection {
  /** 방문 이름 (PSV, SIV …) */
  v: string
  items: NoteItem[]
  /** 서명 문서 */
  docs?: NoteItem[]
}

/** 과제 이름 → 방문별 업무 순서 */
export type Notes = Record<string, NoteSection[]>

export interface Config {
  rules: Rule[]
  projects: Project[]
  companions: Companion[]
  holidays: Holidays
  notes: Notes | null
  /** 한 번만 실행하는 데이터 보정의 실행 기록 */
  mig: string[]
}

/** 도메인 함수가 읽는 전체 데이터 */
export interface Data extends Omit<Config, 'mig' | 'notes'> {
  events: Map<string, CalEvent>
  todos: Map<string, Todo>
  fuls: Map<string, Ful>
}

import type { DateStr, Holidays } from '../types/domain.ts'

/*
 * 날짜는 'YYYY-MM-DD' 문자열로 다루고, 계산할 때만 UTC 자정 Date 로 바꾼다.
 * 그래야 시간대와 무관하게 하루씩 정확히 움직인다.
 * "오늘"과 완료 시각(doneAt)만 기기의 현지 시간(한국)을 따른다.
 * 서버(UTC)에서는 setTimeZone 으로 시간대를 정해 같은 결과를 낸다.
 */

export const DOW = ['일', '월', '화', '수', '목', '금', '토'] as const

export const pad = (n: number) => String(n).padStart(2, '0')

export const fmt = (d: Date): DateStr =>
  d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate())

export const parse = (s: DateStr): Date => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

export const shift = (s: DateStr, n: number): DateStr => {
  const d = parse(s)
  d.setUTCDate(d.getUTCDate() + n)
  return fmt(d)
}

/** 요일 (0 = 일요일) */
export const dow = (s: DateStr) => parse(s).getUTCDay()

/** b - a (일) */
export const diffDays = (a: DateStr, b: DateStr) =>
  Math.round((parse(b).getTime() - parse(a).getTime()) / 864e5)

/** "10/15(목)" */
export const md = (s: DateStr) => {
  const d = parse(s)
  return d.getUTCMonth() + 1 + '/' + d.getUTCDate() + '(' + DOW[d.getUTCDay()] + ')'
}

/** 지금 시각 (ISO, UTC) */
export const nowIso = () => new Date().toISOString()

/* ---------- 현지 시간 ---------- */

/** 정해 둔 시간대의 시각 표기. null 이면 기기 시간대 */
let zoneFmt: Intl.DateTimeFormat | null = null

/** "오늘"·완료 시각을 셀 시간대를 정한다 ('Asia/Seoul'). 빈 문자열이면 기기 시간대 */
export function setTimeZone(tz: string) {
  zoneFmt = tz
    ? new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
    : null
}

/** 시각을 현지 연·월·일·시·분으로 */
function wall(d: Date) {
  if (!zoneFmt) return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() }
  const p = Object.fromEntries(zoneFmt.formatToParts(d).map((x) => [x.type, Number(x.value)]))
  return { y: p.year, m: p.month, d: p.day, h: p.hour, mi: p.minute }
}

const dayOf = (w: ReturnType<typeof wall>): DateStr => w.y + '-' + pad(w.m) + '-' + pad(w.d)

export const todayStr = (): DateStr => dayOf(wall(new Date()))

/** 완료 시각(ISO)을 현지 날짜로. UTC 날짜로 비교하면 오전 9시 전 완료가 전날로 잡힌다 */
export const localDay = (iso?: string | null): DateStr => {
  if (!iso) return ''
  const n = new Date(iso)
  if (isNaN(n.getTime())) return ''
  return dayOf(wall(n))
}

export const localHM = (iso?: string | null) => {
  const n = new Date(iso ?? '')
  if (isNaN(n.getTime())) return ''
  const w = wall(n)
  return pad(w.h) + ':' + pad(w.mi)
}

/** 현지 날짜 + "HH:MM"으로 완료 시각을 만든다. 시간이 없으면 이전 완료 시각(없으면 지금)의 시:분을 쓴다 */
export const mkDoneAt = (day: DateStr, hm: string, prev?: string | null) => {
  const [y, m, d] = String(day).split('-').map(Number)
  let h: number, mi: number
  if (hm && /^\d{1,2}:\d{2}$/.test(hm)) {
    ;[h, mi] = hm.split(':').map(Number)
  } else {
    let p = prev ? new Date(prev) : null
    if (!p || isNaN(p.getTime())) p = new Date()
    ;({ h, mi } = wall(p))
  }
  if (!zoneFmt) return new Date(y, m - 1, d, h, mi).toISOString()
  /* 현지 시각을 UTC 로: 같은 숫자를 UTC 로 읽은 뒤 그 시각의 시차만큼 되돌린다 */
  const guess = Date.UTC(y, m - 1, d, h, mi)
  const w = wall(new Date(guess))
  return new Date(guess - (Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi) - guess)).toISOString()
}

/* ---------- 영업일 (주말·공휴일 제외) ---------- */

export const isWork = (s: DateStr, hol: Holidays) => {
  const w = dow(s)
  return w !== 0 && w !== 6 && !hol[s]
}

export const prevWork = (s: DateStr, hol: Holidays) => {
  let d = shift(s, -1)
  while (!isWork(d, hol)) d = shift(d, -1)
  return d
}

export const nextWork = (s: DateStr, hol: Holidays) => {
  let d = shift(s, 1)
  while (!isWork(d, hol)) d = shift(d, 1)
  return d
}

export const nextWorkOrSame = (s: DateStr, hol: Holidays) => {
  let d = s
  while (!isWork(d, hol)) d = shift(d, 1)
  return d
}

/** s 다음부터 영업일을 n개 센 날 (n < 0 이면 앞쪽으로). n = 0 이면 s 그대로 */
export const addWorkdays = (s: DateStr, n: number, hol: Holidays) => {
  const step = n < 0 ? -1 : 1
  let d = s
  let k = 0
  while (k < Math.abs(n)) {
    d = shift(d, step)
    if (isWork(d, hol)) k++
  }
  return d
}

/** a 와 b 사이(양 끝 제외)의 평일 공휴일 — "10/9(금) 한글날" */
export const holidaysBetween = (a: DateStr, b: DateStr, hol: Holidays) => {
  const lo = a < b ? a : b
  const hi = a < b ? b : a
  return Object.keys(hol)
    .filter((h) => h > lo && h < hi && dow(h) !== 0 && dow(h) !== 6)
    .sort()
    .map((h) => md(h) + ' ' + hol[h])
}

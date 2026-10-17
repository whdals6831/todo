import type { DateStr, Holidays } from '../types/domain.ts'

/*
 * 날짜는 'YYYY-MM-DD' 문자열로 다루고, 계산할 때만 UTC 자정 Date 로 바꾼다.
 * 그래야 시간대와 무관하게 하루씩 정확히 움직인다.
 * "오늘"과 완료 시각(doneAt)만 기기의 현지 시간(한국)을 따른다.
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

export const todayStr = (): DateStr => {
  const n = new Date()
  return n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate())
}

/** 완료 시각(ISO)을 현지 날짜로. UTC 날짜로 비교하면 오전 9시 전 완료가 전날로 잡힌다 */
export const localDay = (iso?: string | null): DateStr => {
  if (!iso) return ''
  const n = new Date(iso)
  if (isNaN(n.getTime())) return ''
  return n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate())
}

export const localHM = (iso?: string | null) => {
  const n = new Date(iso ?? '')
  return isNaN(n.getTime()) ? '' : pad(n.getHours()) + ':' + pad(n.getMinutes())
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
    h = p.getHours()
    mi = p.getMinutes()
  }
  return new Date(y, m - 1, d, h, mi).toISOString()
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

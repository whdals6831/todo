import type { DateStr, TimeStr } from '../types/domain.ts'
import { dow, fmt, pad, parse, shift } from './date.ts'

export interface When {
  /** 날짜·시간 표현을 뺀 제목 */
  title: string
  due: DateStr
  time: TimeStr
  tbd: boolean
}

const DW: Record<string, number> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 }
const REL: Record<string, number> = { 오늘: 0, 내일: 1, 낼: 1, 모레: 2 }

/**
 * 할 일 제목에 적은 날짜·시간을 읽는다.
 * "~10/15", "10월 15일", "내일", "금요일", "다음주 월", "14시", "오후 3시", "16:30", "TBD", "오전 중"
 * day: 날짜 없이 "오전"만 쓰면 이 날의 오전 (캘린더에서 고른 날에 추가할 때는 그날)
 */
export function parseWhen(text: string, today: DateStr, day: DateStr = today): When {
  let t = ' ' + String(text || '') + ' '
  let due = ''
  let time = ''
  let tbd = false
  {
    const m = t.match(/[~～([]?\s*(?<![A-Za-z])(TBD|tbd|Tbd|마감\s*미정|일정\s*미정|날짜\s*미정|미정|추후\s*확정)(?![A-Za-z])\s*[)\]]?/)
    if (m) {
      tbd = true
      t = t.replace(m[0], ' ')
    }
  }
  /** 맞으면 fn 을 실행하고, fn 이 false 를 돌려주지 않으면 맞은 부분을 지운다 */
  const cut = (re: RegExp, fn: (m: RegExpMatchArray) => false | void) => {
    const m = t.match(re)
    if (!m) return false
    if (fn(m) === false) return false
    t = t.replace(m[0], ' ')
    return true
  }
  /** 연도 없는 월/일: 60일 넘게 지난 날이면 내년으로 */
  const mkDate = (mo: string | number, da: string | number) => {
    const M = +mo
    const D = +da
    if (M < 1 || M > 12 || D < 1 || D > 31) return ''
    const y = +today.slice(0, 4)
    let d = y + '-' + pad(M) + '-' + pad(D)
    if (fmt(parse(d)) !== d) return ''
    if (d < shift(today, -60)) d = y + 1 + '-' + pad(M) + '-' + pad(D)
    return d
  }

  /* "오전"만 (오늘 오전, 내일 오전까지, 10/15 오전) = 그날 11:30 */
  let am = false
  cut(/[~～]?\s*(오늘|내일|낼|모레)?\s*오전\s*(중으로|중에는|중에|중|까지는|까지|안으로|안에|내로|내|전까지|전)?(?!\s*\d)(?=\s|$)/, (m) => {
    am = true
    if (m[1]) due = shift(today, REL[m[1]])
  })

  /* 날짜: 앞에서부터 처음 맞는 형식 하나만 쓴다 ("오전"이 날짜를 정했으면 연월일 형식은 건너뛴다) */
  ;[
    () =>
      !due &&
      cut(/[~～]?\s*(\d{4})[./-](\d{1,2})[./-](\d{1,2})\s*(까지)?/, (m) => {
        const d = m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3])
        if (fmt(parse(d)) !== d) return false
        due = d
      }),
    () =>
      cut(/[~～]?\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*(까지)?/, (m) => {
        const d = mkDate(m[1], m[2])
        if (!d) return false
        due = d
      }),
    () =>
      cut(/[~～]?\s*(?<![A-Za-z\d:.])(\d{1,2})[/.](\d{1,2})(?![\d:.])\s*(\([월화수목금토일]\))?\s*(까지)?/, (m) => {
        const d = mkDate(m[1], m[2])
        if (!d) return false
        due = d
      }),
    () =>
      cut(/[~～]?\s*(오늘|내일|낼|모레)\s*(까지)?(?=\s|$)/, (m) => {
        due = shift(today, REL[m[1]])
      }),
    () =>
      cut(/[~～]?\s*(이번\s*주|다음\s*주|담주|차주)?\s*([월화수목금토일])(요일|욜)\s*(까지)?/, (m) => {
        const want = DW[m[2]]
        const w = dow(today)
        if (m[1] && /다음|담|차/.test(m[1])) {
          const mon = shift(today, -((w + 6) % 7))
          due = shift(mon, 7 + ((want + 6) % 7))
        } else {
          due = shift(today, (want - w + 7) % 7)
        }
      }),
    () =>
      cut(/[~～]?\s*(이번\s*주|다음\s*주|담주|차주)\s*([월화수목금토일])(?=\s|$)\s*(까지)?/, (m) => {
        const want = DW[m[2]]
        const w = dow(today)
        const mon = shift(today, -((w + 6) % 7))
        due = shift(mon, (/다음|담|차/.test(m[1]) ? 7 : 0) + ((want + 6) % 7))
      }),
  ].some((f) => f())

  /* 시간 — 오전/오후 없이 1~7시면 오후로 본다 */
  ;[
    () =>
      cut(/(오전|오후|아침|저녁|밤)?\s*(\d{1,2})\s*시(?!간)\s*(?:(\d{1,2})\s*분|(반))?\s*(까지)?/, (m) => {
        let h = +m[2]
        const mi = m[3] ? +m[3] : m[4] ? 30 : 0
        if (h > 23 || mi > 59) return false
        if (/오후|저녁|밤/.test(m[1] || '') && h < 12) h += 12
        else if (!m[1] && h >= 1 && h <= 7) h += 12
        if (/오전|아침/.test(m[1] || '') && h === 12) h = 0
        time = pad(h) + ':' + pad(mi)
      }),
    () =>
      cut(/(?<![\d/.])([01]?\d|2[0-3]):([0-5]\d)(?!\d)\s*(까지)?/, (m) => {
        time = pad(+m[1]) + ':' + m[2]
      }),
  ].some((f) => f())

  const title = t
    .replace(/\s+까지\s/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.])/g, '$1')
    .trim()
    .replace(/[~～\-–,]\s*$/, '')
    .trim()
  if (am) {
    if (!due) due = day
    if (!time) time = '11:30'
  }
  if (tbd) due = ''
  return { title, due, time, tbd }
}

import type { Data, DateStr, Todo } from '../types/domain.ts'
import { pmpAll } from './pmp.ts'
import { bundleParts, isGroupRule } from './rules.ts'

/*
 * "오늘 할 일"을 직접 고르는 방식.
 *  - 오늘 화면: 마감이 오늘이거나 지난 일(자동, 뺄 수 없다) + 오늘로 고른 일(today 가 오늘 날짜)
 *  - 후보: 착수일이 오늘 이전이거나 없는 열린 일 중 오늘 화면에 없는 것
 *  - 묶음(Preparation·방문 후 정리)은 한 줄로 두고 하위 항목은 그 밑에서 펼쳐 본다. 묶음의 날짜는 남은 하위 항목 중 가장 이른 것
 * 고른 날은 그 날짜에만 유효해서 날이 바뀌면 저절로 후보로 돌아간다 (지우는 작업이 따로 없다)
 */

export type PlanCtx = Pick<Data, 'rules' | 'holidays' | 'events' | 'projects'>

/** 화면 한 줄: 할 일 하나, 또는 묶음의 하위 항목 하나 */
export interface PlanItem {
  /** 할 일 id, 하위 항목이면 "id|이름" */
  key: string
  todo: Todo
  /** 묶음의 하위 항목 이름 */
  sub?: string
  title: string
  project: string
  /** 마감일 ("" 이면 미정) */
  due: DateStr
  /** 착수일 ("" 이면 없음) */
  start: DateStr
  /** 오늘 할 일로 고른 날 */
  today: DateStr
  /** 남에게 보내는 일 */
  send: boolean
}

const SEND_RE = /발송|송부|회신|보내/
const baseRule = (id?: string | null) => (id || '').replace(/-manual$/, '')

/**
 * 열린 할 일을 화면 줄로. 묶음도 한 줄이고, 날짜는 아직 체크하지 않은 하위 항목 중 가장 이른 마감·착수일로 본다
 * (하위 항목 하나라도 마감이 오늘이거나 지났으면 오늘 화면에 보이게).
 * split 이면 묶음을 하위 항목 하나하나로 푼다 (Claude 커넥터·다른 날 목록용)
 */
export function planItems(todos: Data['todos'], ctx?: PlanCtx, split = false): PlanItem[] {
  const parts = splitItems(todos, ctx)
  if (split) return parts
  const out: PlanItem[] = []
  const min = (xs: string[]) => xs.filter(Boolean).sort()[0] || ''
  for (let i = 0; i < parts.length; i++) {
    const x = parts[i]
    if (!x.sub) {
      out.push(x)
      continue
    }
    const t = x.todo
    const mine = parts.filter((y) => y.todo === t)
    i += mine.length - 1
    out.push({
      key: t.id, todo: t, title: t.title, project: t.project || '',
      due: min(mine.map((y) => y.due)), start: min(mine.map((y) => y.start)),
      /* 하위 항목만 골라 둔 것도 묶음을 고른 것으로 */
      today: t.today || mine.map((y) => y.today).sort().pop() || '',
      send: mine.some((y) => y.send),
    })
  }
  return out
}

function splitItems(todos: Data['todos'], ctx?: PlanCtx): PlanItem[] {
  const out: PlanItem[] = []
  for (const t of todos.values()) {
    if (t.done) continue
    if (ctx && isGroupRule(t.ruleId) && t.subs?.some((x) => !t.checks?.includes(x))) {
      const parts = bundleParts(t, ctx)
      /* 묶음 제목은 숨기지만 어느 기관·방문의 일인지는 남긴다: "전남대병원 SIV Preparation" → "전남대병원 SIV" */
      const where = t.title.replace(/\s*(Preparation|방문 후 정리)\s*$/, '').trim()
      for (const sub of t.subs) {
        if (t.checks?.includes(sub)) continue
        const p = parts[sub]
        const rule = p ? ctx.rules.find((r) => r.id === p.ruleId) : undefined
        out.push({
          key: t.id + '|' + sub, todo: t, sub, title: (where ? where + ' ' : '') + sub, project: t.project || '',
          due: t.subDue?.[sub] || p?.due || t.due || '', start: p?.start || t.start || '', today: t.subToday?.[sub] || '',
          send: !!rule?.send || SEND_RE.test(sub),
        })
      }
      continue
    }
    const rule = ctx?.rules.find((r) => r.id === baseRule(t.ruleId))
    out.push({
      key: t.id, todo: t, title: t.title, project: t.project || '', due: t.due || '', start: t.start || '', today: t.today || '',
      send: !!rule?.send || SEND_RE.test(t.title),
    })
  }
  return out
}

/** 목록에서 접어 두는 일: 서명문서 eTMF 업로드 */
export const isEtmfUpload = (t: Pick<Todo, 'title'>) => /eTMF\s*업로드/i.test(t.title)

/** 고르지 않아도 오늘 화면에 보이는 일: 마감이 오늘이거나 지남 */
export const isAuto = (x: PlanItem, t: DateStr) => !!x.due && x.due <= t
/** 오늘 화면에 보이는 일 */
export const inToday = (x: PlanItem, t: DateStr) => isAuto(x, t) || x.today === t

/** 마감 임박순 (미정은 맨 뒤). 같은 마감이면 남에게 보내는 일이 위 */
export const byDueSend = (a: PlanItem, b: PlanItem) =>
  (a.due || '9999').localeCompare(b.due || '9999') || Number(b.send) - Number(a.send) || a.title.localeCompare(b.title)

/** 후보 목록: 착수일이 오늘 이전이거나 없는 열린 일 중 오늘 화면에 없는 것 (Someday 제외) */
export function candidates(items: PlanItem[], t: DateStr): PlanItem[] {
  return items.filter((x) => !inToday(x, t) && !x.todo.someday && (!x.start || x.start <= t)).sort(byDueSend)
}

/**
 * 본인 기준 마감과 따로 있는 PMP 기한 (서명문서 eTMF 업로드: 방문 후 30일, 캘린더의 마감 줄과 같은 날짜).
 * 줄의 key(할 일 id 또는 "id|하위 항목") → 날짜
 */
export function pmpDues(data: Pick<Data, 'events' | 'todos' | 'holidays' | 'projects'>): Map<string, DateStr> {
  /* 줄마다 부르므로 같은 데이터면 한 번만 센다 */
  if (memo && memo.events === data.events && memo.todos === data.todos && memo.holidays === data.holidays && memo.projects === data.projects) return memo.out
  const m = new Map<string, DateStr>()
  for (const x of pmpAll(data)) {
    if (!x.item.startsWith('eTMF 문서 보관')) continue
    for (const r of x.refs) m.set(r.sub ? r.id + '|' + r.sub : r.id, x.date)
  }
  memo = { ...data, out: m }
  return m
}
let memo: (Pick<Data, 'events' | 'todos' | 'holidays' | 'projects'> & { out: Map<string, DateStr> }) | null = null

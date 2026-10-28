import type { CalEvent, Config, Ful, Notes, Todo } from '../../types/domain.ts'

/*
 * 앱 문서 ↔ DB 행 변환 (supabase/migrations 의 컬럼과 1:1).
 *  - 이름: camelCase ↔ snake_case
 *  - 날짜: 앱의 "" 는 null 로 저장. 읽을 때 앱이 늘 문자열로 다루는 칸(마감·착수·종료일)만 "" 로 돌린다
 *  - 시각(timestamptz): DB 는 "+00:00" 으로 돌려주므로 앱이 쓰는 toISOString 형식("…Z")으로 맞춘다
 *  - 없는 값(undefined)은 null 로 보낸다. upsert 는 보낸 컬럼만 바꾸므로 지운 필드도 반드시 null 로 보내야 한다
 *  - opt 는 나중에 추가한 컬럼이라 없는 값을 보내지 않는다 (그 컬럼을 아직 안 만든 DB 에도 다른 칸은 저장되게)
 */

type Kind = 'text' | 'date' | 'datestr' | 'ts' | 'value' | 'opt'
/** [앱 필드, DB 컬럼, 종류]. datestr = 비면 "" 로 읽는 날짜 */
type Col = readonly [string, string, Kind]

export const EVENT_COLS: readonly Col[] = [
  ['id', 'id', 'text'], ['kind', 'kind', 'text'], ['date', 'date', 'date'], ['endDate', 'end_date', 'datestr'],
  ['time', 'time', 'text'], ['project', 'project', 'text'], ['site', 'site', 'text'], ['type', 'type', 'text'],
  ['title', 'title', 'text'], ['memo', 'memo', 'text'], ['skip', 'skip', 'value'], ['genKey', 'gen_key', 'text'],
  ['createdDate', 'created_date', 'date'], ['source', 'source', 'text'],
]

export const TODO_COLS: readonly Col[] = [
  ['id', 'id', 'text'], ['title', 'title', 'text'], ['project', 'project', 'text'], ['due', 'due', 'datestr'],
  ['time', 'time', 'text'], ['start', 'start', 'datestr'], ['tbd', 'tbd', 'value'], ['someday', 'someday', 'value'],
  ['autoDue', 'auto_due', 'value'], ['done', 'done', 'value'], ['doneAt', 'done_at', 'ts'], ['rank', 'rank', 'value'],
  ['rolled', 'rolled', 'value'], ['origDue', 'orig_due', 'date'], ['basis', 'basis', 'text'], ['startBasis', 'start_basis', 'text'],
  ['note', 'note', 'text'], ['verify', 'verify', 'value'], ['eventId', 'event_id', 'text'], ['ruleId', 'rule_id', 'text'],
  ['parentId', 'parent_id', 'text'], ['ownDate', 'own_date', 'value'], ['followOf', 'follow_of', 'text'], ['fulId', 'ful_id', 'text'],
  ['prepKey', 'prep_key', 'text'], ['prepSite', 'prep_site', 'text'], ['approvedSite', 'approved_site', 'text'],
  ['created', 'created', 'ts'], ['source', 'source', 'text'], ['checks', 'checks', 'opt'], ['subs', 'subs', 'opt'],
  ['checkAt', 'check_at', 'opt'],
]

export const FUL_COLS: readonly Col[] = [
  ['id', 'id', 'text'], ['project', 'project', 'text'], ['site', 'site', 'text'], ['type', 'type', 'text'], ['text', 'text', 'text'],
  ['created', 'created', 'ts'], ['done', 'done', 'value'], ['todoId', 'todo_id', 'text'], ['eventId', 'event_id', 'text'],
  ['linkedAt', 'linked_at', 'date'],
]

export type Row = Record<string, unknown>

/** ISO 문자열로 바꿀 수 있으면 "…Z" 형식으로, 아니면 그대로 */
const iso = (v: unknown) => {
  const d = new Date(String(v))
  return isNaN(d.getTime()) ? v : d.toISOString()
}

function toRow(doc: object, cols: readonly Col[]): Row {
  const o = doc as Record<string, unknown>
  const row: Row = {}
  for (const [key, col, kind] of cols) {
    const v = o[key]
    if (v === undefined && kind === 'opt') continue
    if (v === undefined || ((kind === 'date' || kind === 'datestr' || kind === 'ts') && v === '')) row[col] = null
    else row[col] = v
  }
  return row
}

function fromRow<T>(row: Row, cols: readonly Col[]): T {
  const doc: Record<string, unknown> = {}
  for (const [key, col, kind] of cols) {
    const v = row[col]
    if (v === null || v === undefined) {
      if (kind === 'datestr') doc[key] = ''
      continue
    }
    doc[key] = kind === 'ts' ? iso(v) : v
  }
  return doc as T
}

export const eventToRow = (e: CalEvent) => toRow(e, EVENT_COLS)
export const todoToRow = (t: Todo) => toRow(t, TODO_COLS)
export const fulToRow = (f: Ful) => toRow(f, FUL_COLS)
export const rowToEvent = (r: Row) => fromRow<CalEvent>(r, EVENT_COLS)
export const rowToTodo = (r: Row) => fromRow<Todo>(r, TODO_COLS)
export const rowToFul = (r: Row) => fromRow<Ful>(r, FUL_COLS)

export const configToRow = (c: Config): Row => ({
  rules: c.rules,
  projects: c.projects,
  companions: c.companions,
  holidays: c.holidays,
  notes: c.notes,
  mig: c.mig,
})

export const rowToConfig = (r: Row): Config => ({
  rules: (r.rules as Config['rules']) ?? [],
  projects: (r.projects as Config['projects']) ?? [],
  companions: (r.companions as Config['companions']) ?? [],
  holidays: (r.holidays as Config['holidays']) ?? {},
  notes: (r.notes as Notes | null) ?? null,
  mig: (r.mig as string[]) ?? [],
})

export type Table = 'events' | 'todos' | 'fuls'

export const TABLE_COLUMNS: Record<Table, string> = {
  events: EVENT_COLS.map((c) => c[1]).join(','),
  todos: TODO_COLS.map((c) => c[1]).join(','),
  fuls: FUL_COLS.map((c) => c[1]).join(','),
}

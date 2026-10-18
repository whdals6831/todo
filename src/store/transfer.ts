import type { CalEvent, Config, Ful, Notes, Todo } from '../types/domain.ts'
import type { Snapshot } from './repository.ts'
import { configOf, type AppState } from './store.ts'

/*
 * 가져오기·내보내기 파일 형식. 원본 Protocol 아티팩트 DB 를 내보낸 protocol-data.json 과 같다:
 * { collections: { events: {id: 문서}, todos, fuls, config: { main: 설정 } } }
 */

type Docs<T> = Record<string, Omit<T, 'id'>>

/** 원본 노트에는 버전 표시(_v)가 과제 목록과 같은 객체에 들어 있다 */
type StoredNotes = Record<string, unknown> & { _v?: number }

export interface ExportFile {
  exportedAt: string
  source: string
  collections: {
    events: Docs<CalEvent>
    todos: Docs<Todo>
    fuls: Docs<Ful>
    config: { main: Omit<Config, 'notes'> & { notes?: StoredNotes } }
  }
}

const NOTES_VER = 3

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function docs<T extends { id: string }>(v: unknown, name: string): T[] {
  if (v == null) return []
  if (!isObj(v)) throw new Error(name + ' 형식이 올바르지 않습니다.')
  return Object.entries(v).map(([id, d]) => {
    if (!isObj(d)) throw new Error(name + '/' + id + ' 문서가 객체가 아닙니다.')
    return { ...d, id } as T
  })
}

/** 내보낸 파일을 읽어 저장소 데이터로. 형식이 다르면 이유를 담은 Error */
export function parseExport(json: unknown): Snapshot {
  if (!isObj(json) || !isObj(json.collections)) throw new Error('collections 가 없는 파일입니다. 이 앱에서 내보낸 JSON 인지 확인해 주세요.')
  const c = json.collections
  const events = docs<CalEvent>(c.events, 'events')
  const todos = docs<Todo>(c.todos, 'todos')
  const fuls = docs<Ful>(c.fuls, 'fuls')
  for (const e of events) if (typeof e.date !== 'string') throw new Error('events/' + e.id + ' 에 date 가 없습니다.')
  for (const t of todos) if (typeof t.title !== 'string') throw new Error('todos/' + t.id + ' 에 title 이 없습니다.')
  const main = isObj(c.config) && isObj(c.config.main) ? c.config.main : null
  let config: Config | null = null
  if (main) {
    let notes: Notes | null = null
    if (isObj(main.notes)) {
      const { _v, ...rest } = main.notes as StoredNotes
      void _v
      notes = rest as Notes
    }
    config = {
      rules: Array.isArray(main.rules) ? main.rules : [],
      projects: Array.isArray(main.projects) ? main.projects : [],
      companions: Array.isArray(main.companions) ? main.companions : [],
      holidays: isObj(main.holidays) ? (main.holidays as Config['holidays']) : {},
      notes,
      mig: Array.isArray(main.mig) ? main.mig : [],
    }
  }
  return { events, todos, fuls, config }
}

const byId = <T extends { id: string }>(xs: Iterable<T>): Docs<T> =>
  Object.fromEntries(
    [...xs].map(({ id, ...rest }) => [id, Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined))]),
  ) as Docs<T>

export function toExport(s: AppState): ExportFile {
  const { notes, ...cfg } = configOf(s)
  return {
    exportedAt: new Date().toISOString(),
    source: 'To Do',
    collections: {
      events: byId(s.events.values()),
      todos: byId(s.todos.values()),
      fuls: byId(s.fuls.values()),
      config: { main: { ...cfg, ...(notes ? { notes: { ...notes, _v: NOTES_VER } } : {}) } },
    },
  }
}

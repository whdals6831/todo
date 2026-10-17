import type { CalEvent, Config, Ful, Todo } from '../types/domain.ts'

/** 저장소에서 한 번에 읽어 오는 전체 데이터 */
export interface Snapshot {
  events: CalEvent[]
  todos: Todo[]
  fuls: Ful[]
  /** 아직 한 번도 저장하지 않았으면 null (기본값을 쓴다) */
  config: Config | null
}

/**
 * 데이터 저장소. 1차는 localStorage, 2차에 Supabase 구현으로 바꾼다.
 * 화면 상태는 스토어가 먼저 바꾸고(낙관적 갱신), 저장소에는 그 결과를 문서 단위로 쓴다.
 */
export interface Repository {
  load(): Promise<Snapshot>
  putEvent(e: CalEvent): Promise<void>
  deleteEvent(id: string): Promise<void>
  putTodo(t: Todo): Promise<void>
  deleteTodo(id: string): Promise<void>
  putFul(f: Ful): Promise<void>
  deleteFul(id: string): Promise<void>
  putConfig(c: Config): Promise<void>
  /** 가져오기: 전체를 바꾼다 */
  replaceAll(s: Snapshot): Promise<void>
  /** 다른 기기·탭에서 바뀐 내용을 받는다 (지원하지 않으면 없음) */
  subscribe?(onChange: (s: Snapshot) => void): () => void
}

/** 랜덤 문서 id (원본 DB 와 같은 20자 영숫자) */
export function newId() {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  return Array.from(bytes, (b) => abc[b % abc.length]).join('')
}

/** undefined 필드를 뺀 사본 (저장소에 빈 필드를 남기지 않는다) */
export function compact<T extends object>(o: T): T {
  const c = { ...o }
  for (const k of Object.keys(c) as (keyof T)[]) if (c[k] === undefined) delete c[k]
  return c
}

import type { CalEvent, Config, Ful, Todo } from '../types/domain.ts'

/** 저장소에서 한 번에 읽어 오는 전체 데이터 */
export interface Snapshot {
  events: CalEvent[]
  todos: Todo[]
  fuls: Ful[]
  /** 아직 한 번도 저장하지 않았으면 null (기본값을 쓴다) */
  config: Config | null
}

export type DocTable = 'events' | 'todos' | 'fuls'

/** 다른 기기·탭에서 온 변경 */
export type RemoteChange =
  | { table: 'events'; type: 'put'; doc: CalEvent }
  | { table: 'todos'; type: 'put'; doc: Todo }
  | { table: 'fuls'; type: 'put'; doc: Ful }
  | { table: DocTable; type: 'delete'; id: string }
  | { table: 'settings'; type: 'put'; config: Config }

export interface RemoteListener {
  change(c: RemoteChange): void
  /** 연결이 끊겼다 다시 붙음 — 놓친 변경이 있을 수 있으니 전체를 다시 맞춘다 */
  reconnected(): void
}

/** 저장 상태: 아직 서버에 쓰지 못한 변경 수와 마지막 오류 */
export interface SyncStatus {
  pending: number
  error: string
}

/**
 * 데이터 저장소. localStorage(1차)와 Supabase(2차) 구현이 있다.
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
  subscribe?(listener: RemoteListener): () => void
  /** 저장 상태가 바뀔 때 알린다 (쓰기를 모아 보내는 저장소만) */
  onStatus?(cb: (s: SyncStatus) => void): void
  /** 아직 서버에 쓰지 않은 문서인가 — 원격 변경으로 덮어쓰지 않는다 */
  isPending?(table: DocTable | 'settings', id: string): boolean
  /** 쌓인 쓰기를 지금 보낸다 */
  flush?(): Promise<void>
  dispose?(): void
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

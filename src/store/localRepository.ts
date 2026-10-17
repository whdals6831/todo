import type { CalEvent, Config, Ful, Todo } from '../types/domain.ts'
import { compact, type Repository, type Snapshot } from './repository.ts'

const KEY = 'protocol:data:v1'

interface Stored {
  events: Record<string, CalEvent>
  todos: Record<string, Todo>
  fuls: Record<string, Ful>
  config: Config | null
}

const empty = (): Stored => ({ events: {}, todos: {}, fuls: {}, config: null })

/** 이 브라우저에만 저장한다. 쓰기가 몰려도 한 번만 직렬화하도록 다음 틱에 모아서 저장 */
export function createLocalRepository(storage: Storage | null = globalThis.localStorage ?? null): Repository {
  let data = empty()
  let dirty = false

  const read = (): Stored => {
    try {
      const raw = storage?.getItem(KEY)
      return raw ? { ...empty(), ...JSON.parse(raw) } : empty()
    } catch {
      return empty()
    }
  }
  const flush = () => {
    if (!dirty) return
    dirty = false
    try {
      storage?.setItem(KEY, JSON.stringify(data))
    } catch {
      /* 저장 공간 부족·비공개 모드: 이번 세션 메모리에만 남는다 */
    }
  }
  const touch = () => {
    if (dirty) return
    dirty = true
    setTimeout(flush, 0)
  }
  if (typeof window !== 'undefined') window.addEventListener('pagehide', flush)

  const toSnapshot = (d: Stored): Snapshot => ({
    events: Object.values(d.events),
    todos: Object.values(d.todos),
    fuls: Object.values(d.fuls),
    config: d.config,
  })
  const byId = <T extends { id: string }>(xs: T[]) => Object.fromEntries(xs.map((x) => [x.id, compact(x)]))

  return {
    async load() {
      data = read()
      return toSnapshot(data)
    },
    async putEvent(e) {
      data.events[e.id] = compact(e)
      touch()
    },
    async deleteEvent(id) {
      delete data.events[id]
      touch()
    },
    async putTodo(t) {
      data.todos[t.id] = compact(t)
      touch()
    },
    async deleteTodo(id) {
      delete data.todos[id]
      touch()
    },
    async putFul(f) {
      data.fuls[f.id] = compact(f)
      touch()
    },
    async deleteFul(id) {
      delete data.fuls[id]
      touch()
    },
    async putConfig(c) {
      data.config = c
      touch()
    },
    async replaceAll(s) {
      data = { events: byId(s.events), todos: byId(s.todos), fuls: byId(s.fuls), config: s.config }
      dirty = true
      flush()
    },
  }
}

/** 테스트·비교용: 메모리에만 저장 */
export const createMemoryRepository = () => createLocalRepository(null)

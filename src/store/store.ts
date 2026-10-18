import { createStore } from 'zustand/vanilla'
import { DEFAULT_COMPANIONS, DEFAULT_HOLIDAYS, DEFAULT_PROJECTS, DEFAULT_RULES } from '../domain/constants.ts'
import type { CalEvent, Config, Data, Ful, Notes, Todo } from '../types/domain.ts'
import type { SyncStatus } from './repository.ts'

export interface AppState extends Data {
  notes: Notes | null
  mig: string[]
  /** 저장소에서 처음 읽어 오기 전 */
  loading: boolean
  /** 화면 위쪽 안내 문구 (불러오기 실패 등) */
  notice: string
  /** 서버에 아직 쓰지 못한 변경과 마지막 오류 */
  sync: SyncStatus
}

export const defaultConfig = (): Config => ({
  rules: DEFAULT_RULES.map((r) => ({ ...r })),
  projects: DEFAULT_PROJECTS.map((p) => ({ ...p, sites: [...p.sites] })),
  companions: DEFAULT_COMPANIONS.map((c) => ({ ...c, items: [...c.items] })),
  holidays: { ...DEFAULT_HOLIDAYS },
  notes: null,
  mig: [],
})

const initial = (): AppState => ({
  ...defaultConfig(),
  events: new Map(),
  todos: new Map(),
  fuls: new Map(),
  loading: true,
  notice: '',
  sync: { pending: 0, error: '' },
})

/** 앱 데이터. React 밖(동기화 로직·테스트)에서도 getState/setState 로 쓴다 */
export const appStore = createStore<AppState>()(initial)

export const getState = appStore.getState

export function resetState(over: Partial<AppState> = {}) {
  appStore.setState({ ...initial(), ...over }, true)
}

export const configOf = (s: AppState): Config => ({
  rules: s.rules,
  projects: s.projects,
  companions: s.companions,
  holidays: s.holidays,
  notes: s.notes,
  mig: s.mig,
})

/* ---------- 문서 단위 상태 갱신 (새 Map 으로 바꿔야 화면이 다시 그려진다) ---------- */

export const setEvent = (e: CalEvent) => appStore.setState((s) => ({ events: new Map(s.events).set(e.id, e) }))
export const removeEvent = (id: string) =>
  appStore.setState((s) => {
    const m = new Map(s.events)
    m.delete(id)
    return { events: m }
  })
export const setTodo = (t: Todo) => appStore.setState((s) => ({ todos: new Map(s.todos).set(t.id, t) }))
export const removeTodo = (id: string) =>
  appStore.setState((s) => {
    const m = new Map(s.todos)
    m.delete(id)
    return { todos: m }
  })
export const setFul = (f: Ful) => appStore.setState((s) => ({ fuls: new Map(s.fuls).set(f.id, f) }))
export const removeFul = (id: string) =>
  appStore.setState((s) => {
    const m = new Map(s.fuls)
    m.delete(id)
    return { fuls: m }
  })

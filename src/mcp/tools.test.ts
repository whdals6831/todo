import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_HOLIDAYS } from '../domain/constants.ts'
import type { Repository, Snapshot } from '../store/repository.ts'
import type { CalEvent, Config, Ful, Rule, Todo } from '../types/domain.ts'
import { runTool, withData, type ToolName } from './tools.ts'

const RULES: Rule[] = [
  { id: 'r-ful', key: 'FUL', type: '*', project: '*', title: '{site} {type} FUL', dir: 'after', n: 3, unit: 'WD', send: false, verify: false, start: 'due', startN: 0 },
  { id: 'r-cl', key: 'CL', type: '*', project: '*', title: '{site} {type} CL', dir: 'before', n: 3, unit: 'WD', send: true, verify: true, start: 'lead', startN: 2 },
]
const CONFIG: Config = {
  rules: RULES, holidays: DEFAULT_HOLIDAYS, mig: ['scan1'], notes: null,
  projects: [{ name: 'P', short: 'Pj', sites: [] }],
  companions: [{ project: 'P', keyword: 'OMF', items: ['로그 업데이트'] }],
}

/** 요청마다 새로 읽는 서버 DB 흉내 */
function fakeDb() {
  const db = { events: new Map<string, CalEvent>(), todos: new Map<string, Todo>(), fuls: new Map<string, Ful>(), config: CONFIG as Config | null }
  const copy = <T>(x: T): T => structuredClone(x)
  const repo = (): Repository => ({
    async load(): Promise<Snapshot> {
      return { events: [...db.events.values()].map(copy), todos: [...db.todos.values()].map(copy), fuls: [...db.fuls.values()].map(copy), config: copy(db.config) }
    },
    putEvent: async (e) => void db.events.set(e.id, copy(e)),
    deleteEvent: async (id) => void db.events.delete(id),
    putTodo: async (t) => void db.todos.set(t.id, copy(t)),
    deleteTodo: async (id) => void db.todos.delete(id),
    putFul: async (f) => void db.fuls.set(f.id, copy(f)),
    deleteFul: async (id) => void db.fuls.delete(id),
    putConfig: async (c) => void (db.config = copy(c)),
    replaceAll: async () => {},
  })
  const call = async (name: ToolName, input: Record<string, unknown> = {}) => JSON.parse(await withData(repo(), () => runTool(name, input)))
  return { db, call }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-12T09:00:00+09:00'))
})
afterEach(() => vi.useRealTimers())

describe('커넥터 도구', () => {
  it('외근을 추가하면 기한 규칙대로 할 일이 저장된다', async () => {
    const { db, call } = fakeDb()
    const out = await call('add_visit', { date: '2026-10-21', type: 'MV', project: 'P', site: '09. 가나대병원(PI 홍길동)' })
    expect(db.events.get(out.id)?.genKey).toMatch(/^v3\|2026-10-21\|MV/)
    expect([...db.todos.values()].map((t) => [t.id, t.due]).sort()).toEqual([
      ['a_' + out.id + '_r-cl', '2026-10-15'],
      ['a_' + out.id + '_r-ful', '2026-10-26'],
    ])
  })

  it('요청마다 저장된 데이터를 다시 읽는다 (추가 → 조회 → 삭제)', async () => {
    const { db, call } = fakeDb()
    const { id } = await call('add_todo', { title: 'OMF 정리', due: '2026-10-14', project: 'P' })
    expect(db.todos.size).toBe(2) // 함께 추가할 할 일 포함
    const listed = await call('list_items', { from: '2026-10-12', to: '2026-10-31' })
    expect(listed.todos.map((t: Todo) => t.title).sort()).toEqual(['OMF 정리', 'Pj 로그 업데이트'])
    expect(await call('delete_todo', { id })).toBe('deleted')
    expect(db.todos.has(id)).toBe(false)
  })

  it('늦게 완료 처리하면 완료일을 한국 날짜로 남긴다', async () => {
    const { db, call } = fakeDb()
    const { id } = await call('add_todo', { title: '보고서', due: '2026-10-09' })
    await call('update_todo', { id, done: true, doneDay: '2026-10-08' })
    expect(db.todos.get(id)?.doneAt).toBe('2026-10-08T00:00:00.000Z') // 10/8 09:00 KST
  })

  it('동시에 와도 하나씩 실행해 서로의 변경을 잃지 않는다', async () => {
    const { db, call } = fakeDb()
    await Promise.all([call('add_todo', { title: 'A' }), call('add_todo', { title: 'B' }), call('add_todo', { title: 'C' })])
    expect([...db.todos.values()].map((t) => t.title).sort()).toEqual(['A', 'B', 'C'])
  })

  it('잘못된 입력은 아무것도 쓰지 않고 실패한다', async () => {
    const { db, call } = fakeDb()
    await expect(call('add_visit', { date: '10/21' })).rejects.toThrow('YYYY-MM-DD')
    await expect(call('update_todo', { id: 'nope', done: true })).rejects.toThrow('할 일이 없습니다')
    expect(db.events.size + db.todos.size).toBe(0)
    /* 실패한 뒤에도 다음 요청은 돈다 */
    expect((await call('get_overview')).today).toBe('2026-10-12 (월)')
  })
})

import { describe, expect, it } from 'vitest'
import type { SyncStatus } from '../repository.ts'
import { createWriteQueue, type WriteBackend } from './writeQueue.ts'

/** 호출을 기록하고, fail 이 켜져 있으면 실패하는 가짜 서버 */
function fakeBackend() {
  const calls: string[] = []
  const state = { fail: false, n: 0 }
  const stamp = () => new Date(Date.UTC(2026, 9, 18, 0, 0, state.n++)).toISOString()
  const backend: WriteBackend = {
    async upsert(table, rows) {
      if (state.fail) throw new Error('offline')
      calls.push('upsert ' + table + ' ' + rows.map((r) => r.id + ':' + (r.title ?? '')).join(','))
      return rows.map((r) => ({ id: String(r.id), updated_at: stamp() }))
    },
    async remove(table, ids) {
      if (state.fail) throw new Error('offline')
      calls.push('remove ' + table + ' ' + ids.join(','))
    },
    async upsertConfig() {
      if (state.fail) throw new Error('offline')
      calls.push('config')
    },
  }
  return { backend, calls, state }
}

describe('쓰기 큐', () => {
  it('같은 문서는 마지막 쓰기만, 표마다 한 번에 보낸다', async () => {
    const { backend, calls } = fakeBackend()
    const q = createWriteQueue(backend, () => {})
    q.put('todos', 'a', { id: 'a', title: '1' })
    q.put('todos', 'b', { id: 'b', title: '1' })
    q.put('todos', 'a', { id: 'a', title: '2' })
    q.put('events', 'e', { id: 'e' })
    q.remove('events', 'e')
    q.putConfig({ rules: [] })
    expect(q.isPending('todos', 'a')).toBe(true)
    expect(q.isPending('settings', '')).toBe(true)
    await q.flush()
    expect(calls.sort()).toEqual(['config', 'remove events e', 'upsert todos a:2,b:1'])
    expect(q.pending()).toBe(0)
    expect(q.isPending('todos', 'a')).toBe(false)
  })

  it('실패하면 버리지 않고 다시 보내며, 그사이 새로 쓴 것이 이긴다', async () => {
    const { backend, calls, state } = fakeBackend()
    const statuses: SyncStatus[] = []
    const q = createWriteQueue(backend, (s) => statuses.push(s))
    state.fail = true
    q.put('todos', 'a', { id: 'a', title: 'old' })
    q.put('todos', 'b', { id: 'b', title: 'b' })
    await q.flush()
    expect(statuses.at(-1)).toEqual({ pending: 2, error: 'offline' })
    q.put('todos', 'a', { id: 'a', title: 'new' })
    state.fail = false
    await q.flush()
    expect(calls).toEqual(['upsert todos a:new,b:b'])
    expect(statuses.at(-1)).toEqual({ pending: 0, error: '' })
    q.dispose()
  })

  it('보내는 동안 쌓인 쓰기는 다음 묶음으로 간다', async () => {
    const { backend, calls } = fakeBackend()
    const q = createWriteQueue(backend, () => {}, 0)
    q.put('todos', 'a', { id: 'a', title: '1' })
    const first = q.flush()
    q.put('todos', 'a', { id: 'a', title: '2' })
    expect(q.isPending('todos', 'a')).toBe(true)
    await first
    await q.flush()
    expect(calls).toEqual(['upsert todos a:1', 'upsert todos a:2'])
  })

  it('서버가 알려 준 것보다 오래된 원격 변경은 거른다', async () => {
    const { backend } = fakeBackend()
    const q = createWriteQueue(backend, () => {})
    q.put('todos', 'a', { id: 'a', title: 'x' })
    await q.flush()
    expect(q.isNewer('todos', 'a', '2026-10-17T00:00:00Z')).toBe(false)
    expect(q.isNewer('todos', 'a', '2026-10-18T00:00:00Z')).toBe(false)
    expect(q.isNewer('todos', 'a', '2026-10-18T00:01:00Z')).toBe(true)
    expect(q.isNewer('todos', 'zz', '2020-01-01T00:00:00Z')).toBe(true)
  })
})

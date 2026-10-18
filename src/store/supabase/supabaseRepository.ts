import type { SupabaseClient } from '@supabase/supabase-js'
import type { DocTable, RemoteListener, Repository, Snapshot, SyncStatus } from '../repository.ts'
import {
  TABLE_COLUMNS, configToRow, eventToRow, fulToRow, rowToConfig, rowToEvent, rowToFul, rowToTodo, todoToRow, type Row,
} from './rows.ts'
import { createWriteQueue, type WriteBackend } from './writeQueue.ts'

const PAGE = 1000

/**
 * Supabase 저장소. 쓰기는 큐에 모아 묶어 보내고(바로 돌아온다), 실패하면 다시 시도한다.
 * 다른 기기·탭의 변경은 Realtime 으로 받는다. 모든 행은 RLS 로 로그인한 본인 것만 보인다.
 */
export function createSupabaseRepository(client: SupabaseClient, userId: string): Repository {
  const statusListeners: ((s: SyncStatus) => void)[] = []

  const fail = (what: string, e: { message: string } | null) => {
    if (e) throw new Error(what + ': ' + e.message)
  }

  const backend: WriteBackend = {
    async upsert(table, rows) {
      const { data, error } = await client
        .from(table)
        .upsert(rows.map((r) => ({ ...r, user_id: userId })), { onConflict: 'user_id,id' })
        .select('id,updated_at')
      fail(table + ' 저장', error)
      return (data ?? []) as { id: string; updated_at: string }[]
    },
    async remove(table, ids) {
      const { error } = await client.from(table).delete().eq('user_id', userId).in('id', ids)
      fail(table + ' 삭제', error)
    },
    async upsertConfig(row) {
      const { error } = await client.from('settings').upsert({ ...row, user_id: userId }, { onConflict: 'user_id' })
      fail('설정 저장', error)
    },
  }

  const queue = createWriteQueue(backend, (s) => statusListeners.forEach((f) => f(s)))

  /** 1000행씩 나눠 전부 읽는다 */
  async function readAll(table: DocTable): Promise<Row[]> {
    const out: Row[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await client.from(table).select(TABLE_COLUMNS[table] + ',updated_at').order('id').range(from, from + PAGE - 1)
      fail(table + ' 불러오기', error)
      out.push(...((data ?? []) as unknown as Row[]))
      if (!data || data.length < PAGE) return out
    }
  }

  return {
    async load(): Promise<Snapshot> {
      const [ev, td, fu, st] = await Promise.all([
        readAll('events'),
        readAll('todos'),
        readAll('fuls'),
        client.from('settings').select('*').maybeSingle(),
      ])
      fail('설정 불러오기', st.error)
      for (const [table, rows] of [['events', ev], ['todos', td], ['fuls', fu]] as const)
        for (const r of rows) queue.isNewer(table, String(r.id), String(r.updated_at))
      return {
        events: ev.map(rowToEvent),
        todos: td.map(rowToTodo),
        fuls: fu.map(rowToFul),
        config: st.data ? rowToConfig(st.data as Row) : null,
      }
    },
    async putEvent(e) {
      queue.put('events', e.id, eventToRow(e))
    },
    async deleteEvent(id) {
      queue.remove('events', id)
    },
    async putTodo(t) {
      queue.put('todos', t.id, todoToRow(t))
    },
    async deleteTodo(id) {
      queue.remove('todos', id)
    },
    async putFul(f) {
      queue.put('fuls', f.id, fulToRow(f))
    },
    async deleteFul(id) {
      queue.remove('fuls', id)
    },
    async putConfig(c) {
      queue.putConfig(configToRow(c))
    },
    async replaceAll(s) {
      /* 쌓인 쓰기를 먼저 보내야 가져온 데이터 위에 옛 쓰기가 덮이지 않는다 */
      await queue.flush()
      const { error } = await client.rpc('replace_all_data', {
        p_events: s.events.map(eventToRow),
        p_todos: s.todos.map(todoToRow),
        p_fuls: s.fuls.map(fulToRow),
        p_settings: s.config ? configToRow(s.config) : null,
      })
      fail('가져오기', error)
    },
    subscribe(listener: RemoteListener) {
      let joined = false
      const channel = client.channel('todo-data')
      for (const table of ['events', 'todos', 'fuls'] as const) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table }, (p) => {
          if (p.eventType === 'DELETE') {
            const old = p.old as Row
            /* 삭제 알림은 RLS 로 걸러지지 않아 기본키(user_id, id)만 온다 */
            if (old.user_id !== userId || queue.isPending(table, String(old.id))) return
            listener.change({ table, type: 'delete', id: String(old.id) })
            return
          }
          const row = p.new as Row
          const id = String(row.id)
          if (row.user_id !== userId || queue.isPending(table, id) || !queue.isNewer(table, id, String(row.updated_at))) return
          if (table === 'events') listener.change({ table, type: 'put', doc: rowToEvent(row) })
          else if (table === 'todos') listener.change({ table, type: 'put', doc: rowToTodo(row) })
          else listener.change({ table, type: 'put', doc: rowToFul(row) })
        })
      }
      channel.on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, (p) => {
        const row = p.new as Row
        if (p.eventType === 'DELETE' || row.user_id !== userId || queue.isPending('settings', '')) return
        listener.change({ table: 'settings', type: 'put', config: rowToConfig(row) })
      })
      channel.subscribe((status) => {
        if (status !== 'SUBSCRIBED') return
        if (joined) listener.reconnected()
        joined = true
      })
      return () => {
        void client.removeChannel(channel)
      }
    },
    onStatus(cb) {
      statusListeners.push(cb)
    },
    isPending: (table, id) => queue.isPending(table, id),
    flush: () => queue.flush(),
    dispose: () => queue.dispose(),
  }
}

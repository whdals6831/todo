import type { DocTable, SyncStatus } from '../repository.ts'
import type { Row } from './rows.ts'

/** 실제로 서버에 쓰는 쪽 (테스트에서는 가짜로 바꾼다) */
export interface WriteBackend {
  /** 행들을 upsert 하고, 서버가 붙인 updated_at 을 id 별로 돌려준다 */
  upsert(table: DocTable, rows: Row[]): Promise<{ id: string; updated_at: string }[]>
  remove(table: DocTable, ids: string[]): Promise<void>
  upsertConfig(row: Row): Promise<void>
}

type Op = { table: DocTable; id: string; row: Row | null } // row = null 이면 삭제

const CHUNK = 500

/**
 * 쓰기를 모아서 보낸다.
 *  - 같은 문서에 대한 쓰기는 마지막 것만 남긴다 (put→delete 면 delete)
 *  - 한 번에 하나의 묶음만 보내고, 보내는 동안 쌓인 것은 다음 묶음으로
 *  - 실패하면 버리지 않고 다시 넣어 점점 늦게 다시 시도한다 (그사이 새로 쓴 것이 있으면 새것이 이긴다)
 */
export function createWriteQueue(backend: WriteBackend, onStatus: (s: SyncStatus) => void, delay = 30) {
  const queued = new Map<string, Op>()
  let inFlight = new Map<string, Op>()
  let config: Row | null = null
  let configInFlight = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<void> | null = null
  let failures = 0
  let error = ''
  /** 서버가 알려 준 문서별 마지막 updated_at — 늦게 도착한 옛 변경을 거른다 */
  const seen = new Map<string, string>()

  const key = (table: string, id: string) => table + '\u0000' + id
  const count = () => queued.size + inFlight.size + (config ? 1 : 0) + (configInFlight ? 1 : 0)
  const report = () => onStatus({ pending: count(), error })

  const backoff = () => (failures ? Math.min(30000, 1000 * 2 ** (failures - 1)) : delay)

  /** 보내기는 여기서만 시작한다 — 한 번에 하나 */
  function drain(): Promise<void> {
    if (running) return running
    running = run().finally(() => {
      running = null
      if (queued.size || config) schedule(backoff())
    })
    return running
  }

  function schedule(ms = delay) {
    if (timer || running) return
    timer = setTimeout(() => {
      timer = null
      void drain()
    }, ms)
  }

  async function run() {
    inFlight = new Map(queued)
    queued.clear()
    const cfg = config
    config = null
    configInFlight = !!cfg
    report()
    const ops = [...inFlight.values()]
    try {
      const jobs: Promise<unknown>[] = []
      for (const table of ['events', 'todos', 'fuls'] as DocTable[]) {
        const puts = ops.filter((o) => o.table === table && o.row).map((o) => o.row!)
        const dels = ops.filter((o) => o.table === table && !o.row).map((o) => o.id)
        for (let i = 0; i < puts.length; i += CHUNK)
          jobs.push(
            backend.upsert(table, puts.slice(i, i + CHUNK)).then((rows) => {
              for (const r of rows) seen.set(key(table, r.id), r.updated_at)
            }),
          )
        for (let i = 0; i < dels.length; i += CHUNK) jobs.push(backend.remove(table, dels.slice(i, i + CHUNK)))
      }
      if (cfg) jobs.push(backend.upsertConfig(cfg))
      await Promise.all(jobs)
      failures = 0
      error = ''
    } catch (e) {
      failures++
      error = e instanceof Error ? e.message : String(e)
      for (const [k, op] of inFlight) if (!queued.has(k)) queued.set(k, op)
      if (cfg && !config) config = cfg
    } finally {
      inFlight = new Map()
      configInFlight = false
      report()
    }
  }

  return {
    put(table: DocTable, id: string, row: Row) {
      queued.set(key(table, id), { table, id, row })
      report()
      schedule()
    },
    remove(table: DocTable, id: string) {
      queued.set(key(table, id), { table, id, row: null })
      report()
      schedule()
    },
    putConfig(row: Row) {
      config = row
      report()
      schedule()
    },
    isPending(table: DocTable | 'settings', id: string) {
      if (table === 'settings') return !!config || configInFlight
      const k = key(table, id)
      return queued.has(k) || inFlight.has(k)
    },
    /** 원격 변경이 이미 본 것보다 오래됐으면 false */
    isNewer(table: DocTable, id: string, updatedAt: string) {
      const prev = seen.get(key(table, id))
      if (prev && Date.parse(updatedAt) <= Date.parse(prev)) return false
      seen.set(key(table, id), updatedAt)
      return true
    },
    /** 지금 쌓인 것을 한 번 보내고 끝날 때까지 기다린다 (실패해도 던지지 않고 다음 재시도를 예약한다) */
    async flush() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (running) await running
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (queued.size || config) await drain()
    },
    pending: count,
    dispose() {
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
}

export type WriteQueue = ReturnType<typeof createWriteQueue>

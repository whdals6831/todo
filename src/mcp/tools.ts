import { TYPES, kindLabel, kindOf } from '../domain/constants.ts'
import { DOW, dow, md, mkDoneAt, nowIso, shift, todayStr } from '../domain/date.ts'
import { parseWhen } from '../domain/parseWhen.ts'
import { pmpAll } from '../domain/pmp.ts'
import { detectProject, projShort } from '../domain/project.ts'
import { planTodos } from '../domain/rules.ts'
import { addTodo, applySnapshot, dismissTodo, flushWrites, manualId, putEvent, putTodo, setRepository, syncEvent } from '../store/actions.ts'
import type { Repository } from '../store/repository.ts'
import { getState as S, resetState } from '../store/store.ts'
import type { CalEvent, EventKind, Todo } from '../types/domain.ts'

/*
 * claude.ai 커넥터(MCP 서버, supabase/functions/mcp)가 실행하는 도구.
 * 원본(protocol.html)의 채팅 도구를 옮겼다. 앱과 같은 동작(actions.ts)으로 데이터를 바꾸므로
 * 자동 할 일·확인 할 일·함께 추가할 할 일 규칙이 화면에서 고칠 때와 똑같이 적용된다.
 */

export type ToolName = 'get_overview' | 'list_items' | 'list_deadlines' | 'add_visit' | 'add_todo' | 'update_todo' | 'update_visit' | 'delete_todo'
type Input = Record<string, unknown>

/** Claude 에 주는 사용 안내 (서버 instructions, get_overview 에도 싣는다) */
export const INSTRUCTIONS = [
  '이 커넥터는 CRA(임상연구 모니터요원)의 개인 업무 캘린더 앱 "To Do"의 일정·할 일을 읽고 바꿉니다. 일정이나 할 일을 다루기 전에 get_overview 로 오늘 날짜(한국 시간)·과제·기한 규칙·가까운 일정과 할 일을 먼저 확인하세요. 한국어로, 두괄식으로 짧게 답하세요.',
  '할 일에는 마감일(due)과 착수일(start)이 따로 있습니다. 착수일은 방문 내용을 쓰는 일은 방문 다음 영업일(망각곡선), 나머지는 마감 2영업일 전(계획 오류 대비 여유)으로 잡혀 있습니다. 무엇을 언제 할지 물으면 착수일 기준으로 안내하세요.',
  '날짜를 안내할 때는 반드시 근거(어떤 규칙, WD/CD 계산, 제외한 공휴일)를 함께 말하세요. WD는 방문 다음 영업일을 WD1로 셉니다.',
  '일정 운영 원칙: 남이 나를 기다리는 일(PM, 팀장, 기관, 의뢰사)이 1순위. 남에게 보내는 일은 요청일 전 영업일 퇴근 전을 실제 마감으로. 외부 방문이 있는 날은 그 외 1개 이하로 배치. 조건이 걸린 일은 [대기]를 붙이고 조건 확인 행위에 날짜를 겁니다. 30분 이내면 제목에 (15분)처럼 소요 시간 표기. 일정이 물리적으로 불가능하거나 위험하면 돌려 말하지 말고 지적하세요.',
  '일정 종류는 외근(visit)·회의(meeting)·교육(training)·휴가(leave)입니다. 외근(add_visit)을 추가하면 앱이 기한 규칙에 따라 할 일을 자동으로 만듭니다. 여러 개를 추가하거나 날짜를 바꾸기 전에는 무엇을 할지 먼저 보여주고 확인받으세요. 단, 사용자가 "추가해줘"처럼 분명히 요청한 한 건은 바로 실행해도 됩니다. 삭제는 반드시 확인을 받은 뒤에만 하세요.',
  '스크린샷·사진으로 일정을 주면 날짜·시간·기관·방문 종류를 읽어 위 원칙대로 추가하세요.',
  'verify=true인 규칙은 PMP 원문으로 확인되지 않은 임시값이니, 그 기한을 말할 때는 확인 필요라고 밝히세요.',
].join('\n')

const str = (v: unknown) => (v == null ? '' : String(v))
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

let queue: Promise<unknown> = Promise.resolve()

/**
 * 저장소의 전체 데이터를 앱 상태로 올려 fn 을 실행하고, 쓴 것을 모두 보낸 뒤 결과를 돌려준다.
 * 앱 상태는 모듈 하나뿐이라 같은 서버 안에서 겹쳐 실행하지 않는다. 저장하지 못했으면 Error.
 */
export function withData<T>(repo: Repository, fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    setRepository(repo)
    resetState()
    applySnapshot(await repo.load())
    const out = await fn()
    await flushWrites()
    const { sync, notice } = S()
    if (notice) throw new Error(notice)
    if (sync.pending) throw new Error('저장하지 못했습니다: ' + sync.error)
    return out
  })
  queue = run.catch(() => undefined)
  return run
}

/** 오늘 기준 -21일 ~ +60일의 일정과 열린(또는 최근 완료한) 할 일, 과제·기한 규칙 */
function overview() {
  const s = S()
  const t = todayStr()
  const lo = shift(t, -21)
  const hi = shift(t, 60)
  return {
    today: t + ' (' + DOW[dow(t)] + ')',
    guide: INSTRUCTIONS,
    projects: s.projects.map((p) => p.name),
    visitTypes: TYPES,
    rules: s.rules.map((r) => ({ type: r.type, project: r.project, title: r.title, dir: r.dir, n: r.n, unit: r.unit, send: r.send, verify: r.verify, basis: r.basis, subs: r.subs })),
    events: [...s.events.values()]
      .filter((e) => e.date >= lo && e.date <= hi)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => ({ id: e.id, kind: kindOf(e), date: e.date, endDate: e.endDate || '', time: e.time, title: e.title || '', project: e.project, site: e.site, type: e.type, memo: e.memo })),
    todos: [...s.todos.values()]
      .filter((x) => !x.done || (x.doneAt || '') >= lo)
      .sort((a, b) => (a.due || '9').localeCompare(b.due || '9'))
      .slice(0, 150)
      .map((x) => ({ id: x.id, title: x.title, due: x.due, start: x.start || '', done: !!x.done, project: x.project, basis: x.basis, verify: !!x.verify })),
  }
}

/** 구글 캘린더 알림용 일정에 넣는 표시 (이 말로 동기화한 일정을 찾는다) */
export const DEADLINE_TAG = 'tododeadline'
/** 시간이 없는 마감은 퇴근 시간까지로 본다 */
const DEADLINE_TIME = '18:00'

/**
 * 앱 캘린더의 마감 줄(PMP 마감, OMF·비용청구처럼 마감으로 보는 할 일) 중 아직 끝내지 않은 것.
 * 끝냈는지 알 수 있는 마감은 지난 14일까지, 알 수 없는 마감은 오늘부터, 앞으로 60일까지.
 * sync_id 에 날짜·시간이 들어 있어 마감이 옮겨지면 다른 sync_id 가 된다
 */
function deadlines() {
  const s = S()
  const t = todayStr()
  const hm = (m: number) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')
  return pmpAll(s)
    .filter((d) => d.date && !d.doneDay && d.date <= shift(t, 60) && d.date >= (d.linked ? shift(t, -14) : t))
    .sort((a, b) => (a.date + (a.time || DEADLINE_TIME)).localeCompare(b.date + (b.time || DEADLINE_TIME)))
    .map((d) => {
      const time = d.time || DEADLINE_TIME
      const [h, m] = time.split(':').map(Number)
      const short = projShort(s.projects, d.project)
      return {
        sync_id: d.key + '@' + d.date + 'T' + time,
        title: '마감 · ' + (short ? short + ' ' : '') + d.label,
        date: d.date,
        time,
        time_given: !!d.time,
        start: d.date + 'T' + time + ':00',
        end: d.date + 'T' + hm(Math.min(h * 60 + m + 30, 23 * 60 + 59)) + ':00',
      }
    })
}

/** 도구를 실행하고 Claude 에 돌려줄 결과(JSON 문자열)를 만든다. 잘못된 입력이면 Error. withData 안에서 부른다 */
export async function runTool(name: ToolName, i: Input): Promise<string> {
  switch (name) {
    case 'get_overview':
      return JSON.stringify(overview())
    case 'list_items': {
      const a = str(i.from)
      const b = str(i.to)
      if (!isDate(a) || !isDate(b)) throw new Error('from·to 는 YYYY-MM-DD 형식이어야 합니다')
      return JSON.stringify({
        events: [...S().events.values()].filter((e) => e.date >= a && e.date <= b),
        todos: [...S().todos.values()]
          .filter((t) => (t.due || '') >= a && (t.due || '') <= b)
          .map((t) => ({ id: t.id, title: t.title, due: t.due, start: t.start || '', done: !!t.done, project: t.project, basis: t.basis })),
      })
    }
    case 'list_deadlines':
      return JSON.stringify({ today: todayStr(), tag: DEADLINE_TAG, deadlines: deadlines() })
    case 'add_visit': {
      const k: EventKind = ['meeting', 'training', 'leave'].includes(str(i.kind)) ? (str(i.kind) as EventKind) : 'visit'
      const base = { kind: k, createdDate: todayStr(), date: str(i.date), project: str(i.project), memo: str(i.memo), genKey: '' }
      const e: Omit<CalEvent, 'id'> =
        k === 'visit'
          ? { ...base, time: str(i.time), site: str(i.site), type: (TYPES as readonly string[]).includes(str(i.type)) ? str(i.type) : '기타' }
          : { ...base, endDate: str(i.endDate), time: k === 'leave' ? '' : str(i.time), title: str(i.title) || kindLabel(k) }
      if (!isDate(e.date)) throw new Error('date 형식은 YYYY-MM-DD')
      const id = await putEvent(e)
      const ev = { ...e, id } as CalEvent
      await syncEvent(ev, false)
      return JSON.stringify({ id, created_todos: planTodos(ev, S()) })
    }
    case 'add_todo': {
      const raw = str(i.title)
      if (!raw.trim()) throw new Error('title 이 비었습니다')
      const w = parseWhen(raw, todayStr())
      const id = await addTodo({
        title: w.title || raw,
        due: w.tbd ? '' : str(i.due) || w.due,
        tbd: !!w.tbd,
        time: w.time || '',
        start: str(i.start),
        project: str(i.project) || detectProject(S().projects, raw),
        note: str(i.note),
        done: false,
        created: nowIso(),
      })
      return JSON.stringify({ id })
    }
    case 'update_todo': {
      const t = S().todos.get(str(i.id))
      if (!t) throw new Error('해당 id의 할 일이 없습니다')
      const n: Todo = { ...t }
      if (i.title != null) n.title = str(i.title)
      if (i.due != null && str(i.due) !== t.due) {
        n.due = str(i.due)
        n.basis = (t.basis ? t.basis + ' · ' : '') + 'Claude가 변경 → ' + (n.due ? md(n.due) : '날짜 없음')
        n.ruleId = manualId(t.ruleId)
      }
      if (i.start != null && str(i.start) !== (t.start || '')) {
        n.start = str(i.start)
        n.startBasis = (t.startBasis ? t.startBasis + ' · ' : '') + 'Claude가 변경 → ' + (n.start ? md(n.start) : '없음')
        n.ruleId = manualId(t.ruleId)
      }
      const dd = i.doneDay != null && isDate(str(i.doneDay)) && str(i.doneDay) <= todayStr() ? str(i.doneDay) : ''
      if (i.done != null) {
        n.done = !!i.done
        n.doneAt = n.done ? (dd ? mkDoneAt(dd, '', t.doneAt) : t.done && t.doneAt ? t.doneAt : nowIso()) : null
      } else if (dd && t.done) n.doneAt = mkDoneAt(dd, '', t.doneAt)
      await putTodo(n)
      return '"ok"'
    }
    case 'update_visit': {
      const e = S().events.get(str(i.id))
      if (!e) throw new Error('해당 id의 외근이 없습니다')
      const n = { ...e } as CalEvent & Record<string, unknown>
      for (const k of ['date', 'time', 'project', 'site', 'type', 'memo']) if (i[k] != null) n[k] = str(i[k])
      if (!isDate(n.date)) throw new Error('date 형식은 YYYY-MM-DD')
      await putEvent(n)
      await syncEvent(n, true)
      return JSON.stringify({ updated: true, todos: planTodos(n, S()) })
    }
    case 'delete_todo': {
      if (!S().todos.has(str(i.id))) throw new Error('해당 id의 할 일이 없습니다')
      await dismissTodo(str(i.id))
      return '"deleted"'
    }
  }
}

import type Anthropic from '@anthropic-ai/sdk'
import { TYPES, kindLabel } from '@/domain/constants.ts'
import { md, mkDoneAt, nowIso, todayStr } from '@/domain/date.ts'
import { parseWhen } from '@/domain/parseWhen.ts'
import { detectProject } from '@/domain/project.ts'
import { planTodos } from '@/domain/rules.ts'
import { addTodo, dismissTodo, manualId, putEvent, putTodo, syncEvent } from '@/store/actions.ts'
import { getState } from '@/store/store.ts'
import type { CalEvent, EventKind, Todo } from '@/types/domain.ts'

/*
 * 채팅에서 Claude 가 쓰는 도구. 원본(protocol.html)의 TOOLS 를 옮겼다.
 * 도구는 브라우저에서 앱 상태를 직접 바꾸므로, 저장·동기화는 화면에서 고칠 때와 같은 경로를 탄다.
 */

type Input = Record<string, unknown>
const str = (v: unknown) => (v == null ? '' : String(v))
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'list_items',
    description: '기간 안의 일정과 할 일을 돌려줍니다. 대화를 시작한 뒤 바뀌었을 수 있는 데이터를 확인하거나, 위 스냅샷 범위 밖의 날짜를 볼 때 쓰세요. 날짜는 YYYY-MM-DD.',
    input_schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
  },
  {
    name: 'add_visit',
    description: '일정을 추가합니다. kind=visit(외근, 기본값)이면 project·site·type이 필요하고 기한 규칙에 따라 할 일이 자동 생성됩니다. kind=meeting(회의)·training(교육)·leave(휴가)는 title을 쓰고 자동 할 일은 없습니다. 여러 날이면 endDate.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['visit', 'meeting', 'training', 'leave'] },
        date: { type: 'string' },
        endDate: { type: 'string' },
        time: { type: 'string', description: 'HH:MM, 선택' },
        title: { type: 'string' },
        project: { type: 'string' },
        site: { type: 'string' },
        type: { type: 'string', enum: [...TYPES] },
        memo: { type: 'string' },
      },
      required: ['date'],
    },
  },
  {
    name: 'add_todo',
    description: '할 일을 직접 추가합니다. due(마감일)와 start(착수일)는 YYYY-MM-DD 또는 빈 문자열.',
    input_schema: {
      type: 'object',
      properties: { title: { type: 'string' }, due: { type: 'string' }, start: { type: 'string' }, project: { type: 'string' }, note: { type: 'string' } },
      required: ['title'],
    },
  },
  {
    name: 'update_todo',
    description: '할 일의 제목, 마감일(due), 착수일(start), 완료 여부, 완료일(doneDay)을 바꿉니다. 실제로는 며칠 전에 끝낸 일을 뒤늦게 완료 처리할 때는 done:true와 함께 doneDay(YYYY-MM-DD)를 주세요. id는 list_items나 현재 데이터에서 가져옵니다.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        due: { type: 'string' },
        start: { type: 'string' },
        done: { type: 'boolean' },
        doneDay: { type: 'string', description: '완료한 날짜 YYYY-MM-DD (오늘 이전만)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'update_visit',
    description: '외근의 날짜·시간·기관·종류·과제를 바꿉니다. 바꾸면 미완료 자동 할 일의 기한이 다시 계산됩니다.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' }, date: { type: 'string' }, time: { type: 'string' }, project: { type: 'string' }, site: { type: 'string' }, type: { type: 'string' }, memo: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'delete_todo',
    description: '할 일을 삭제합니다. 사용자가 이 대화에서 삭제를 확인한 뒤에만 호출하세요.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
]

/** 채팅 화면에 남길 한 줄 요약 */
export const TOOL_LABEL: Record<string, (i: Input) => string> = {
  list_items: (i) => '일정·할 일 조회 ' + str(i.from) + ' ~ ' + str(i.to),
  add_visit: (i) => '일정 추가 ' + str(i.date) + ' ' + (str(i.title) || [i.site, i.type].filter(Boolean).join(' ')),
  add_todo: (i) => '할 일 추가 · ' + str(i.title),
  update_todo: (i) => '할 일 수정 · ' + (getState().todos.get(str(i.id))?.title ?? str(i.id)),
  update_visit: (i) => '외근 수정 · ' + str(i.id),
  delete_todo: (i) => '할 일 삭제 · ' + (getState().todos.get(str(i.id))?.title ?? str(i.id)),
}

/** 도구를 실행하고 Claude 에 돌려줄 결과(JSON 문자열)를 만든다. 잘못된 입력이면 Error */
export async function runTool(name: string, i: Input): Promise<string> {
  const S = getState
  switch (name) {
    case 'list_items': {
      const a = str(i.from)
      const b = str(i.to)
      if (!isDate(a) || !isDate(b)) throw new Error('from·to 는 YYYY-MM-DD 형식이어야 합니다')
      return JSON.stringify({
        events: [...S().events.values()].filter((e) => e.date >= a && e.date <= b),
        todos: [...S().todos.values()]
          .filter((t) => (t.due || '') >= a && (t.due || '') <= b)
          .map((t) => ({ id: t.id, title: t.title, due: t.due, done: !!t.done, project: t.project, basis: t.basis })),
      })
    }
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
    default:
      throw new Error('알 수 없는 도구: ' + name)
  }
}

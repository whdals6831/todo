import { useState, type CSSProperties } from 'react'
import { md, nowIso, todayStr } from '@/domain/date.ts'
import { parseWhen } from '@/domain/parseWhen.ts'
import { detectProject } from '@/domain/project.ts'
import { FOLLOWUPS, QUICK, specialFor } from '@/domain/specials.ts'
import { Button } from '@/components/ui/Button.tsx'
import { Input } from '@/components/ui/Field.tsx'
import { addSub, addTodo } from '@/store/actions.ts'
import { getState } from '@/store/store.ts'
import { useApp } from '@/store/ui.ts'
import type { DateStr } from '@/types/domain.ts'
import s from './QuickAdd.module.css'
import { useHintInput } from './useHintInput.ts'

interface HintsProps {
  value: string
  focused: boolean
  /** 키워드 예시를 눌렀을 때: 입력창에 넣고 "기관명" 부분을 선택 */
  onPick: (text: string) => void
}

/** 입력창 아래 안내: 비어 있으면 자동 키워드 예시, 특수 흐름이면 추가될 할 일 미리보기 */
export function KeywordHints({ value, focused, onPick }: HintsProps) {
  const projects = useApp((st) => st.projects)
  const holidays = useApp((st) => st.holidays)
  const v = value.trim()
  if (!v) {
    if (!focused) return null
    return (
      <div className={s.hints} aria-live="polite">
        <span className={s.hintsLabel}>자동 키워드</span>
        {QUICK.map((q) => (
          <button key={q.t} type="button" className={s.chip} title={q.d} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(q.t)}>
            {q.t.replace('기관명', '○○')}
            <span className={s.desc}> {q.d}</span>
          </button>
        ))}
      </div>
    )
  }
  const sp = specialFor({ title: v, project: detectProject(projects, v) }, { projects, holidays })
  if (sp) {
    return (
      <div className={s.hints} aria-live="polite">
        <div className={s.hintsLabel}>Enter 누르면 이렇게 추가돼요</div>
        {sp.items.map((x, i) => (
          <div key={i} className={s.previewRow}>
            <span>{x.due ? md(x.due) + (x.time ? ' ' + x.time : '') : 'TBD'}</span>
            {x.title}
          </div>
        ))}
        {sp.kind === 'ssl' && <div className={s.desc}>같은 기관의 [대기] 선정 확인 할 일은 완료로 바뀌어요.</div>}
      </div>
    )
  }
  const f = FOLLOWUPS.find((f) => f.match(v) && (!f.project || detectProject(projects, v) === f.project))
  if (f) {
    return (
      <div className={s.hints} aria-live="polite">
        <div className={s.desc}>완료 체크하면 → {f.title(v)} (완료일 후 WD{f.n}) 자동 추가</div>
      </div>
    )
  }
  return null
}

interface Props {
  placeholder: string
  label: string
  /** 날짜를 적지 않았을 때의 마감일 */
  defaultDue: DateStr
  /** 제목의 상대 날짜(내일, 금요일)를 계산할 기준일 */
  parseBase?: DateStr
  /** 날짜를 적지 않아 기본 마감이 붙은 할 일은 긴급 표시를 하지 않는다 */
  autoDue?: boolean
  style?: CSSProperties
}

/** 한 줄로 할 일 추가 (제목에 날짜·시간·TBD 를 쓸 수 있다). Shift+Enter 는 방금 추가한 할 일의 하위 항목으로 */
export function QuickAdd({ placeholder, label, defaultDue, parseBase, autoDue = true, style }: Props) {
  const h = useHintInput()
  const [lastId, setLastId] = useState('')
  const parent = useApp((st) => st.todos.get(lastId))
  const add = async (sub = false) => {
    const raw = h.value.trim()
    if (!raw) return
    h.setValue('')
    /* 붙일 할 일이 없으면(아직 안 만들었거나 지웠으면) 그냥 할 일로 추가 */
    if (sub && parent) {
      await addSub(parent.id, raw)
      return
    }
    const w = parseWhen(raw, parseBase ?? todayStr(), defaultDue)
    const title = w.title || raw
    const id = await addTodo({
      title,
      due: w.tbd ? '' : w.due || defaultDue,
      ...(autoDue ? { autoDue: !w.tbd && !w.due } : {}),
      tbd: !!w.tbd,
      time: w.time || '',
      project: detectProject(getState().projects, title),
      done: false,
      created: nowIso(),
    })
    setLastId(id)
  }
  return (
    <div style={style}>
      <div className={s.quick}>
        <Input
          {...h.inputProps}
          placeholder={placeholder}
          aria-label={label}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              add(e.shiftKey)
            }
          }}
        />
        <Button onClick={() => add()}>추가</Button>
      </div>
      {parent && h.focused && <div className={s.subHint}>Shift+Enter → 「{parent.title}」 하위 항목으로 추가</div>}
      <KeywordHints value={h.value} focused={h.focused} onPick={h.pick} />
    </div>
  )
}

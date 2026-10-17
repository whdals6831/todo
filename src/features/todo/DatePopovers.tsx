import { useState, type KeyboardEvent } from 'react'
import { localDay, localHM, md, mkDoneAt, nextWork, prevWork, shift, todayStr } from '@/domain/date.ts'
import { Button } from '@/components/ui/Button.tsx'
import { Input } from '@/components/ui/Field.tsx'
import { Popover } from '@/components/ui/Popover.tsx'
import { manualId, putTodo, syncChildren } from '@/store/actions.ts'
import { getState } from '@/store/store.ts'
import { closePopover } from '@/store/ui.ts'
import type { DateStr, Todo } from '@/types/domain.ts'
import s from './DatePopovers.module.css'

/* 다른 날짜 버튼을 누르면 그 버튼이 새 팝오버를 열도록, 날짜 버튼 클릭으로는 닫지 않는다 */
const isDueButton = (t: Element) => !!t.closest('[data-due-button]')

/** 할 일 오른쪽 날짜에서 여는 마감일 바꾸기 */
export function DuePopover({ todo: t, anchor }: { todo: Todo; anchor: DOMRect }) {
  const [due, setDue] = useState(t.due || '')
  const [time, setTime] = useState(t.time || '')
  const today = todayStr()

  const save = async (dv: DateStr, tm: string) => {
    const n: Todo = { ...t, time: tm || '' }
    if (dv !== (t.due || '')) {
      n.due = dv
      n.tbd = !dv
      n.someday = false
      n.autoDue = false
      n.basis = (t.basis ? t.basis + ' · ' : '') + '직접 변경 → ' + (dv ? md(dv) : 'TBD')
      if (n.start && dv && n.start > dv) n.start = dv
    }
    if (n.due !== t.due || (n.time || '') !== (t.time || '')) n.ruleId = manualId(t.ruleId)
    if (t.parentId && n.due !== t.due) n.ownDate = true
    closePopover()
    await putTodo(n)
    await syncChildren(n)
  }
  const enter = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      save(due, time)
    }
  }
  const chip = (label: string, d: DateStr) => (
    <Button size="sm" onClick={() => save(d, time)}>
      {label}
    </Button>
  )

  return (
    <Popover anchor={anchor} onClose={closePopover} keepOpenOn={isDueButton} label="마감일 바꾸기" className={s.pop}>
      <div className={s.row}>
        <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} onKeyDown={enter} aria-label="마감일" />
        <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} onKeyDown={enter} aria-label="마감 시간" />
      </div>
      <div className={s.row}>
        {chip('오늘', today)}
        {chip('내일', shift(today, 1))}
        {chip('다음 영업일', nextWork(today, getState().holidays))}
        {chip('TBD', '')}
      </div>
      <div className={s.acts}>
        <Button size="sm" variant="ghost" onClick={closePopover}>
          취소
        </Button>
        <Button size="sm" variant="solid" onClick={() => save(due, time)}>
          저장
        </Button>
      </div>
    </Popover>
  )
}

/** 완료한 할 일의 실제 완료일 바꾸기 ("화요일에 했는데 오늘 체크했다") */
export function DonePopover({ todo: t, anchor }: { todo: Todo; anchor: DOMRect }) {
  const today = todayStr()
  const cur = localDay(t.doneAt) || today
  const [day, setDay] = useState(cur)
  const [time, setTime] = useState(t.doneAt ? localHM(t.doneAt) : '')
  const hol = getState().holidays

  const save = async (dv: DateStr, tm: string) => {
    if (!dv) return
    if (dv > today) dv = today
    const iso = mkDoneAt(dv, tm, t.doneAt)
    closePopover()
    if (localDay(iso) !== localDay(t.doneAt) || (tm || '') !== (t.doneAt ? localHM(t.doneAt) : '')) await putTodo({ ...t, done: true, doneAt: iso })
  }
  const enter = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      save(day, time)
    }
  }
  const quick: [string, DateStr][] = [
    ['오늘', today],
    ['어제', shift(today, -1)],
    ['이전 영업일', prevWork(today, hol)],
  ]
  if (t.due && t.due <= today && !quick.some(([, d]) => d === t.due)) quick.push(['마감일 ' + md(t.due), t.due])

  return (
    <Popover anchor={anchor} onClose={closePopover} keepOpenOn={isDueButton} label="완료일 바꾸기" className={s.pop}>
      <div className={s.label}>실제로 끝낸 날</div>
      <div className={s.row}>
        <Input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} onKeyDown={enter} aria-label="완료일" />
        <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} onKeyDown={enter} aria-label="완료 시간" />
      </div>
      <div className={s.row}>
        {quick.map(([label, d]) => (
          <Button key={label} size="sm" pressed={d === cur} onClick={() => save(d, time)}>
            {label}
          </Button>
        ))}
      </div>
      <div className={s.acts}>
        <Button size="sm" variant="ghost" onClick={closePopover}>
          취소
        </Button>
        <Button size="sm" variant="solid" onClick={() => save(day, time)}>
          저장
        </Button>
      </div>
    </Popover>
  )
}

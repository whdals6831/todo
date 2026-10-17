import type { PointerEvent as ReactPointerEvent } from 'react'
import { localDay, mkDoneAt, todayStr } from '@/domain/date.ts'
import { moveTodo, putTodo, setRanks } from '@/store/actions.ts'
import { getState } from '@/store/store.ts'
import { setUi } from '@/store/ui.ts'
import s from './drag.module.css'

/*
 * 포인터(마우스·펜·터치)로 할 일을 끈다. 원본과 같은 규칙:
 *  - 같은 목록([data-reorder]) 안의 다른 행([data-todo-id]) 위에 놓으면 순서를 바꾼다
 *  - 캘린더 칸([data-drop-date]) 위에 놓으면 마감일(또는 착수일)을 옮긴다
 *  - 완료한 할 일을 칸에 놓으면 그날을 완료일로 (미래는 안 됨)
 * 5px 넘게 움직여야 끌기가 시작되고, 놓은 직후의 클릭은 무시한다.
 */

let dragging = false
let justDropped = false

/** 방금 끌어 놓았으면 이번 클릭은 무시한다 */
export const wasJustDropped = () => justDropped

const marks = (sel: string) => document.querySelectorAll<HTMLElement>(sel)
const clearRowMarks = () => marks('[data-drop="before"],[data-drop="after"]').forEach((n) => n.removeAttribute('data-drop'))
const clearCellMarks = () => marks('[data-drop="cell"]').forEach((n) => n.removeAttribute('data-drop'))

export function startDrag(e: ReactPointerEvent, id: string, field: 'due' | 'start' = 'due') {
  if (e.button !== 0 || dragging) return
  e.stopPropagation()
  const x0 = e.clientX
  const y0 = e.clientY
  const srcBox = (e.currentTarget as Element).closest<HTMLElement>('[data-reorder]')
  let ghost: HTMLDivElement | null = null
  let overDate: string | null = null
  let row: { id: string; before: boolean } | null = null

  const begin = () => {
    const t = getState().todos.get(id)
    if (!t) return cancel()
    dragging = true
    ghost = document.createElement('div')
    ghost.className = s.ghost
    ghost.textContent =
      t.done && field !== 'start' ? '✓ ' + t.title + ' → 완료한 날짜 칸에 놓기' : (field === 'start' ? '▶ 착수 ' : '') + t.title + ' → 날짜 칸에 놓기'
    document.body.append(ghost)
    document.body.dataset.dragging = ''
  }

  const move = (ev: PointerEvent) => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return
      begin()
      if (!ghost) return
    }
    ev.preventDefault()
    ghost.style.transform = 'translate(' + (ev.clientX + 14) + 'px,' + (ev.clientY + 14) + 'px)'
    const hit = document.elementFromPoint(ev.clientX, ev.clientY)
    clearRowMarks()
    const r = srcBox && hit?.closest<HTMLElement>('[data-todo-id]')
    if (r && r.parentElement === srcBox && r.dataset.todoId !== id) {
      const b = r.getBoundingClientRect()
      const before = ev.clientY < b.top + b.height / 2
      r.dataset.drop = before ? 'before' : 'after'
      row = { id: r.dataset.todoId!, before }
    } else row = null
    const c = !row ? hit?.closest<HTMLElement>('[data-drop-date]') : null
    const prev = overDate
    overDate = c ? c.dataset.dropDate! : null
    if (prev !== overDate) {
      clearCellMarks()
      if (c) c.dataset.drop = 'cell'
    }
  }

  const stop = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancel)
    window.removeEventListener('keydown', esc)
  }
  const clear = () => {
    ghost?.remove()
    ghost = null
    dragging = false
    delete document.body.dataset.dragging
    clearCellMarks()
    clearRowMarks()
  }
  const markDropped = () => {
    justDropped = true
    setTimeout(() => {
      justDropped = false
    }, 60)
  }

  const up = async () => {
    stop()
    if (!ghost) return
    const d = overDate
    const rw = row
    const t = getState().todos.get(id)
    if (rw && srcBox) {
      const ids = [...srcBox.querySelectorAll<HTMLElement>(':scope > [data-todo-id]')].map((n) => n.dataset.todoId!).filter((x) => x !== id)
      let k = ids.indexOf(rw.id)
      if (k < 0) k = ids.length
      else if (!rw.before) k++
      ids.splice(k, 0, id)
      clear()
      markDropped()
      await setRanks(ids)
      return
    }
    clear()
    markDropped()
    if (d && t && t.done && field !== 'start') {
      if (d > todayStr() || d === localDay(t.doneAt)) return
      setUi({ sel: d })
      await putTodo({ ...t, doneAt: mkDoneAt(d, '', t.doneAt) })
      return
    }
    if (d && t) {
      setUi({ sel: d })
      await moveTodo(t, d, '드래그로 변경', field)
    }
  }
  const cancel = () => {
    stop()
    clear()
  }
  const esc = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') cancel()
  }

  window.addEventListener('pointermove', move, { passive: false })
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', cancel)
  window.addEventListener('keydown', esc)
}

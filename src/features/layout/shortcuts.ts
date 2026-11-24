import { todayStr } from '@/domain/date.ts'
import { undoCheck } from '@/store/actions.ts'
import { closePopover, openModal, ui } from '@/store/ui.ts'

/** 할 일 추가: 오늘 할 일 화면이면 오늘 마감, 아니면 캘린더에서 고른 날 */
export const openTodoForView = () => openModal({ kind: 'todoAdd', due: ui().view === 'today' ? todayStr() : undefined })

/** N = 새 할 일, V = 새 일정 (한글 자판 ㅜ·ㅍ 도), Ctrl+Z = 마지막 체크 되돌리기. 입력 중이거나 창이 열려 있으면 무시 */
export function bindShortcuts() {
  const onKey = (e: KeyboardEvent) => {
    const tg = e.target as HTMLElement | null
    const typing = !!tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName))
    if (typing || ui().modal || e.isComposing) return
    const k = (e.key || '').toLowerCase()
    /* Ctrl+Z (맥은 ⌘Z): 방금 체크한 것을 원래대로. 글자를 쓰는 중이면 글자 되돌리기가 먼저라 건드리지 않는다 */
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (k === 'z' || k === 'ㅋ')) {
      e.preventDefault()
      void undoCheck()
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (k === 'n' || k === 'ㅜ') {
      e.preventDefault()
      closePopover()
      openTodoForView()
    } else if (k === 'v' || k === 'ㅍ') {
      e.preventDefault()
      closePopover()
      openModal({ kind: 'event', event: {} })
    }
  }
  document.addEventListener('keydown', onKey)
  return () => document.removeEventListener('keydown', onKey)
}

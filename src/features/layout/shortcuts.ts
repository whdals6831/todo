import { todayStr } from '@/domain/date.ts'
import { closePopover, openModal, ui } from '@/store/ui.ts'

/** 할 일 추가: 오늘 할 일 화면이면 오늘 마감, 아니면 캘린더에서 고른 날 */
export const openTodoForView = () => openModal({ kind: 'todoAdd', due: ui().view === 'today' ? todayStr() : undefined })

/** N = 새 할 일, V = 새 일정 (한글 자판 ㅜ·ㅍ 도). 입력 중이거나 창이 열려 있으면 무시 */
export function bindShortcuts() {
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return
    const tg = e.target as HTMLElement | null
    const typing = !!tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName))
    if (typing || ui().modal) return
    const k = (e.key || '').toLowerCase()
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

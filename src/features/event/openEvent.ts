import { kindLabel, kindOf } from '@/domain/constants.ts'
import { openModal } from '@/store/ui.ts'
import type { CalEvent } from '@/types/domain.ts'

/** 일정 이름: 외근은 "기관 방문종류", 나머지는 제목 */
export const eventName = (e: CalEvent) => {
  const k = kindOf(e)
  return k === 'visit' ? (e.site || '') + ' ' + (e.type || '') : e.title || kindLabel(k)
}

export const openEvent = (e: Partial<CalEvent>) => openModal({ kind: 'event', event: e })

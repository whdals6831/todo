import { create } from 'zustand'
import { useStore } from 'zustand'
import { todayStr } from '../domain/date.ts'
import { BRIEF_FROM_MIN } from '../domain/daySets.ts'
import type { CalEvent, DateStr, EventKind } from '../types/domain.ts'
import { appStore, type AppState } from './store.ts'

export type View = 'cal' | 'today' | 'all' | 'ful' | 'notes' | 'search' | 'rules'

export type Modal =
  | { kind: 'todoAdd'; due?: DateStr }
  | { kind: 'todoEdit'; id: string }
  | { kind: 'event'; event: Partial<CalEvent>; as?: EventKind }

export type Popover =
  | { kind: 'due' | 'done'; id: string; anchor: DOMRect }
  | { kind: 'cell'; date: DateStr; anchor: DOMRect }

interface UiState {
  view: View
  /** 검색을 닫으면 돌아갈 화면 */
  beforeSearch: View
  searchQ: string
  /** 캘린더에 보이는 달 [연, 월] */
  month: [number, number]
  /** 캘린더에서 고른 날 */
  sel: DateStr
  /** 오늘 할 일 화면에서 보고 있는 다른 날 (null = 오늘) */
  dayView: DateStr | null
  /** 전체 할 일 과제 필터 */
  filter: string
  calVisitOnly: boolean
  modal: Modal | null
  popover: Popover | null
  /** 다시 그려도 열려 있어야 하는 접힘 섹션 */
  foldOpen: Set<string>
  /** 시계: 날짜가 바뀌거나 17:50 이 지나면 갱신 */
  today: DateStr
  briefTime: boolean
  /** 마지막으로 시계를 본 시각 (ms) — 브리핑의 "HH:MM 기준" */
  now: number
  /** 오늘 할 일을 다 끝낸 순간의 축하 표시 */
  celebrate: number
  /** Claude 채팅 패널 */
  chatOpen: boolean
}

const now = () => {
  const n = new Date()
  return { today: todayStr(), briefTime: n.getHours() * 60 + n.getMinutes() >= BRIEF_FROM_MIN, now: n.getTime() }
}

const t0 = todayStr()

export const useUi = create<UiState>()(() => ({
  view: 'cal',
  beforeSearch: 'cal',
  searchQ: '',
  month: [+t0.slice(0, 4), +t0.slice(5, 7)],
  sel: t0,
  dayView: null,
  filter: '전체',
  calVisitOnly: false,
  modal: null,
  popover: null,
  foldOpen: new Set(),
  ...now(),
  celebrate: 0,
  chatOpen: false,
}))

export const ui = useUi.getState
export const setUi = useUi.setState

export function setView(v: View) {
  const s = ui()
  const patch: Partial<UiState> = { popover: null }
  if (v !== 'search' && s.view === 'search') patch.searchQ = ''
  if (v === 'today') patch.dayView = null
  if (s.view !== v) {
    patch.view = v
    window.scrollTo(0, 0)
  }
  setUi(patch)
}

export const openModal = (modal: Modal) => setUi({ modal, popover: null })
export const closeModal = () => setUi({ modal: null })
export const openPopover = (popover: Popover) => setUi({ popover })
export const closePopover = () => setUi({ popover: null })

export function toggleFold(key: string, open: boolean) {
  const s = new Set(ui().foldOpen)
  if (open) s.add(key)
  else s.delete(key)
  setUi({ foldOpen: s })
}

export function goToday() {
  const t = todayStr()
  setUi({ sel: t, month: [+t.slice(0, 4), +t.slice(5, 7)] })
}

/** 30초마다 날짜·브리핑 시각이 바뀌었는지 본다. 모달이 열려 있으면 기다린다 */
export function startClock() {
  const id = setInterval(() => {
    const n = now()
    const s = ui()
    if ((n.today !== s.today || n.briefTime !== s.briefTime) && !s.modal) setUi(n)
    else setUi({ now: n.now })
  }, 30000)
  return () => clearInterval(id)
}

/** 앱 데이터 구독 훅 */
export const useApp = <T,>(selector: (s: AppState) => T) => useStore(appStore, selector)

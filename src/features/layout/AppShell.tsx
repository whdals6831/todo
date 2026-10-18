import { lazy, Suspense, useEffect } from 'react'
import bunny from '@/assets/bunny.png'
import { appStore } from '@/store/store.ts'
import { setUi, setView, useApp, useUi } from '@/store/ui.ts'
import { CalendarView, CellMenu } from '../calendar/CalendarView.tsx'
import { EventModal } from '../event/EventModal.tsx'
import { FulView } from '../ful/FulView.tsx'
import { NotesView } from '../notes/NotesView.tsx'
import { SearchView } from '../search/SearchView.tsx'
import { SettingsView } from '../settings/SettingsView.tsx'
import { DonePopover, DuePopover } from '../todo/DatePopovers.tsx'
import { TodoAddModal, TodoEditModal } from '../todo/TodoModals.tsx'
import { AllTodosView } from '../todos/AllTodosView.tsx'
import { TodayView } from '../today/TodayView.tsx'
import { Sidebar } from './Sidebar.tsx'
import s from './AppShell.module.css'

/* 채팅(Anthropic SDK 포함)은 처음 열 때 불러온다 */
const ChatPanel = lazy(() => import('../chat/ChatPanel.tsx').then((m) => ({ default: m.ChatPanel })))

export function AppShell() {
  const view = useUi((u) => u.view)
  const chatOpen = useUi((u) => u.chatOpen)
  return (
    <div className={s.shell}>
      <Sidebar />
      <main className={s.content}>
        <Notice />
        {view === 'cal' && <CalendarView />}
        {view === 'today' && <TodayView />}
        {view === 'all' && <AllTodosView />}
        {view === 'ful' && <FulView />}
        {view === 'notes' && <NotesView />}
        {view === 'search' && <SearchView />}
        {view === 'rules' && <SettingsView />}
      </main>
      <Overlays />
      <Celebration />
      {chatOpen && (
        <Suspense fallback={null}>
          <ChatPanel />
        </Suspense>
      )}
    </div>
  )
}

/** 위쪽 안내: 불러오는 중 · 저장 실패 · 데이터가 비어 있음 */
function Notice() {
  const loading = useApp((st) => st.loading)
  const notice = useApp((st) => st.notice)
  const empty = useApp((st) => !st.events.size && !st.todos.size && st.projects.length <= 1)
  const sync = useApp((st) => st.sync)
  const view = useUi((u) => u.view)
  if (loading) return <div className={s.notice}>불러오는 중…</div>
  if (sync.error && sync.pending)
    return (
      <div className={s.notice} role="alert">
        저장하지 못한 변경 {sync.pending}건 — 연결되면 자동으로 다시 보냅니다. ({sync.error})
      </div>
    )
  if (notice)
    return (
      <div className={s.notice} role="alert">
        {notice}
        <button type="button" onClick={() => appStore.setState({ notice: '' })}>
          닫기
        </button>
      </div>
    )
  if (empty && view !== 'rules')
    return (
      <div className={s.notice}>
        아직 데이터가 없습니다. 과제·규칙 설정 → 데이터 가져오기에서 내보낸 JSON 을 불러오세요.
        <button type="button" onClick={() => setView('rules')}>
          설정으로
        </button>
      </div>
    )
  return null
}

/** 열려 있는 모달·팝오버 하나 */
function Overlays() {
  const modal = useUi((u) => u.modal)
  const popover = useUi((u) => u.popover)
  const todos = useApp((st) => st.todos)
  const popTodo = popover && popover.kind !== 'cell' ? todos.get(popover.id) : undefined
  const editTodo = modal?.kind === 'todoEdit' ? todos.get(modal.id) : undefined
  return (
    <>
      {modal?.kind === 'todoAdd' && <TodoAddModal due={modal.due} />}
      {editTodo && <TodoEditModal key={editTodo.id} todo={editTodo} />}
      {modal?.kind === 'event' && <EventModal key={modal.event.id || 'new'} event={modal.event} as={modal.as} />}
      {popover?.kind === 'due' && popTodo && <DuePopover key={popTodo.id} todo={popTodo} anchor={popover.anchor} />}
      {popover?.kind === 'done' && popTodo && <DonePopover key={popTodo.id} todo={popTodo} anchor={popover.anchor} />}
      {popover?.kind === 'cell' && <CellMenu key={popover.date} date={popover.date} anchor={popover.anchor} />}
    </>
  )
}

/** 오늘 할 일이 방금 모두 끝났으면 잠깐 축하 (2.6초 뒤 사라진다) */
function Celebration() {
  const at = useUi((u) => u.celebrate)
  useEffect(() => {
    if (!at) return
    const id = setTimeout(() => setUi({ celebrate: 0 }), 2600)
    return () => clearTimeout(id)
  }, [at])
  if (!at) return null
  return (
    <div key={at} className={s.yay} role="status">
      <img src={bunny} alt="" />
      오늘 할 일 끝!
    </div>
  )
}

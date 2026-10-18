import { useEffect, useRef } from 'react'
import { md } from '@/domain/date.ts'
import { todayCount } from '@/domain/daySets.ts'
import { Button, LinkButton } from '@/components/ui/Button.tsx'
import { supabase } from '@/store/supabase/client.ts'
import { setUi, setView, ui, useApp, useUi, type View } from '@/store/ui.ts'
import { openEvent } from '../event/openEvent.ts'
import { openTodoForView } from './shortcuts.ts'
import s from './Sidebar.module.css'

const MENU: [View, string, 'all' | 'today' | 'ful' | null][] = [
  ['cal', '캘린더', null],
  ['all', '전체 할 일', 'all'],
  ['today', '오늘 할 일', 'today'],
  ['ful', 'FUL 메모', 'ful'],
  ['notes', '업무 노트', null],
]

export function Sidebar() {
  const view = useUi((u) => u.view)
  const today = useUi((u) => u.today)
  const todos = useApp((st) => st.todos)
  const fuls = useApp((st) => st.fuls)
  const counts = {
    all: [...todos.values()].filter((x) => !x.done).length,
    today: todayCount(today, todos),
    ful: [...fuls.values()].filter((f) => !f.todoId).length,
  }
  /* "10/18(일)" → "10월 18일 (일)" */
  const todayLabel = md(today).replace('/', '월 ').replace('(', '일 (')

  return (
    <nav className={s.side} aria-label="메뉴">
      <div className={s.brand}>
        <h1>
          To Do<span className={s.tagline}>CRA desk</span>
        </h1>
        <span className={s.today}>{todayLabel}</span>
      </div>
      <SearchBox />
      <div className={s.menu}>
        {MENU.map(([v, label, c]) => (
          <button key={v} type="button" aria-current={view === v ? 'page' : undefined} onClick={() => setView(v)}>
            {label} {c && <span className={s.n}>{counts[c] || ''}</span>}
          </button>
        ))}
      </div>
      <div className={s.acts}>
        <Button variant="solid" title="단축키 V" onClick={() => openEvent({})}>
          + 일정 <kbd>V</kbd>
        </Button>
        <Button title="단축키 N" onClick={openTodoForView}>
          + 할 일 <kbd>N</kbd>
        </Button>
        {/* Claude 는 claude.ai 커넥터로 이 앱의 Supabase 데이터를 쓰므로 로그인해 쓸 때만 */}
        {supabase && (
          <LinkButton href="https://claude.ai/new" target="_blank" rel="noopener noreferrer" title="claude.ai 를 새 탭으로 엽니다 (To Do 커넥터를 켜고 채팅)">
            Claude 열기 ↗
          </LinkButton>
        )}
      </div>
      <button type="button" className={s.settings} aria-pressed={view === 'rules'} onClick={() => setView('rules')}>
        과제·규칙 설정
      </button>
    </nav>
  )
}

/** 검색창: 입력하면 검색 화면으로, 지우거나 Esc 면 원래 화면으로. "/" 또는 ⌘K 로 포커스 */
function SearchBox() {
  const q = useUi((u) => u.searchQ)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || ui().modal) return
      const tg = e.target as HTMLElement | null
      const typing = !!tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName))
      if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K'))) {
        e.preventDefault()
        ref.current?.focus()
        ref.current?.select()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const change = (v: string) => {
    const u = ui()
    if (v.trim()) {
      if (u.view !== 'search') {
        setUi({ searchQ: v, beforeSearch: u.view, view: 'search', popover: null })
        window.scrollTo(0, 0)
      } else setUi({ searchQ: v })
    } else setUi(u.view === 'search' ? { searchQ: v, view: u.beforeSearch } : { searchQ: v })
  }

  return (
    <label className={s.search}>
      <span className={s.searchIcon} aria-hidden="true">
        ⌕
      </span>
      <input
        ref={ref}
        type="search"
        value={q}
        placeholder="검색  /"
        aria-label="할 일·일정 검색"
        autoComplete="off"
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            change('')
            e.currentTarget.blur()
          }
        }}
      />
    </label>
  )
}

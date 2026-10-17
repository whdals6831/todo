import { kindLabel, kindOf } from '@/domain/constants.ts'
import { md } from '@/domain/date.ts'
import { search, searchWords } from '@/domain/search.ts'
import { Highlight } from '@/components/ui/Highlight.tsx'
import { EmptyState, Fold, Group, Label, Sub, ViewHeader } from '@/components/ui/Layout.tsx'
import { Tag } from '@/components/ui/Tag.tsx'
import { useApp, useUi } from '@/store/ui.ts'
import { openEvent } from '../event/openEvent.ts'
import { TodoRow } from '../todo/TodoRow.tsx'
import s from './Search.module.css'

/** 검색: 모든 단어가 제목·기관·과제(별칭 포함)·방문 종류·메모 어딘가에 있는 일정과 할 일 */
export function SearchView() {
  const q = useUi((u) => u.searchQ)
  const today = useUi((u) => u.today)
  const events = useApp((st) => st.events)
  const todos = useApp((st) => st.todos)
  const projects = useApp((st) => st.projects)
  const words = searchWords(q)
  const r = words.length ? search(words, { events, todos, projects }, today) : null

  return (
    <section>
      <ViewHeader title="검색">{r && <Label>{'일정 ' + r.events.length + ' · 할 일 ' + r.count}</Label>}</ViewHeader>
      {!r ? (
        <EmptyState>할 일 제목, 기관, 과제(예: 브레즈트리), 방문 종류(SIV), 메모로 찾을 수 있어요.</EmptyState>
      ) : !r.events.length && !r.count ? (
        <EmptyState>「{q.trim()}」와 맞는 일정·할 일이 없습니다.</EmptyState>
      ) : (
        <>
          {r.events.length > 0 && (
            <Group title="일정" count={r.events.length}>
              {r.events.map((e) => {
                const k = kindOf(e)
                const name = k === 'visit' ? [e.site, e.type].filter(Boolean).join(' ') : e.title || kindLabel(k)
                return (
                  <div
                    key={e.id}
                    className={s.ev}
                    role="button"
                    tabIndex={0}
                    onClick={() => openEvent(e)}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter') openEvent(e)
                    }}
                  >
                    <span className={s.date}>{md(e.date) + (e.endDate && e.endDate !== e.date ? '~' : '')}</span>
                    <div>
                      <div className={s.name}>
                        <Tag>{kindLabel(k)}</Tag>
                        <Highlight text={name} words={words} />
                        {e.time && <Sub> {e.time}</Sub>}
                      </div>
                      <Sub>
                        <Highlight text={[e.project, e.memo].filter(Boolean).join(' · ')} words={words} />
                      </Sub>
                    </div>
                  </div>
                )
              })}
            </Group>
          )}
          {r.open.length > 0 && (
            <Group title="할 일" count={r.open.length}>
              {r.open.map((x) => <TodoRow key={x.id} todo={x} highlight={words} />)}
            </Group>
          )}
          {r.done.length > 0 && (
            <Fold id="search-done" label={'완료한 할 일 ' + r.done.length}>
              {r.done.map((x) => <TodoRow key={x.id} todo={x} highlight={words} />)}
            </Fold>
          )}
        </>
      )}
    </section>
  )
}

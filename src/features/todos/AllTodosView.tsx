import { todoGroups } from '@/domain/daySets.ts'
import { projShort } from '@/domain/project.ts'
import { Button } from '@/components/ui/Button.tsx'
import { EmptyState, Fold, Group, Label, ViewHeader } from '@/components/ui/Layout.tsx'
import { openModal, setUi, useApp, useUi } from '@/store/ui.ts'
import { openEvent } from '../event/openEvent.ts'
import { PlainList } from '../todo/TodoList.tsx'
import s from './AllTodos.module.css'

/** 전체 할 일: 과제별로 걸러서 지연 · 오늘 · 7일 안 · 그 이후 · TBD */
export function AllTodosView() {
  const filter = useUi((u) => u.filter)
  const today = useUi((u) => u.today)
  const todos = useApp((st) => st.todos)
  const projects = useApp((st) => st.projects)
  const all = [...todos.values()].filter((t) => filter === '전체' || t.project === filter || (filter === '기타' && !t.project))
  const { open, groups, done } = todoGroups(all, today)

  return (
    <section>
      <ViewHeader
        title="전체 할 일"
        end={
          <>
            <Button size="sm" variant="solid" onClick={() => openEvent({})}>
              + 일정
            </Button>
            <Button size="sm" onClick={() => openModal({ kind: 'todoAdd' })}>
              + 할 일
            </Button>
          </>
        }
      >
        <Label>남은 {open.length}</Label>
      </ViewHeader>
      <div className={s.filters}>
        {['전체', ...projects.map((p) => p.name)].map((n) => (
          <Button key={n} size="sm" pressed={filter === n} onClick={() => setUi({ filter: n })}>
            {n === '전체' ? '전체' : projShort(projects, n)}
          </Button>
        ))}
      </div>
      {groups.map((g) => (
        <Group key={g.name} title={g.name} count={g.items.length} over={g.over}>
          <PlainList items={g.items} />
        </Group>
      ))}
      {!groups.length && <EmptyState>남은 할 일이 없습니다. 위의 + 일정으로 외근을 등록하면 기한에 맞춘 할 일이 생깁니다.</EmptyState>}
      {done.length > 0 && (
        <Fold id="all-done" label={'완료 ' + done.length}>
          <PlainList items={done.slice(0, 50)} />
        </Fold>
      )}
    </section>
  )
}

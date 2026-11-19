import { md } from '@/domain/date.ts'
import { isAuto, type PlanItem } from '@/domain/plan.ts'
import { dLabel } from '@/domain/priority.ts'
import { projShort } from '@/domain/project.ts'
import { Button } from '@/components/ui/Button.tsx'
import { RoundCheckbox } from '@/components/ui/RoundCheckbox.tsx'
import { Tag } from '@/components/ui/Tag.tsx'
import { cx } from '@/lib/cx.ts'
import { pickDay, toggleCheck, toggleDone } from '@/store/actions.ts'
import { openModal, useApp } from '@/store/ui.ts'
import type { DateStr } from '@/types/domain.ts'
import s from './PlanRow.module.css'

/** 본인 기준 마감이 지난 일에 붙는 PMP 기한 꼬리표: "PMP 기한 12/3(목) · D-1" */
export function PmpTag({ due, pmp, today }: { due: DateStr; pmp?: DateStr; today: DateStr }) {
  if (!pmp || !due || due >= today || pmp === due) return null
  const l = dLabel(pmp)
  return <Tag tone={l.late || l.soon ? 'danger' : 'warn'}>{'PMP 기한 ' + md(pmp) + ' · ' + l.t}</Tag>
}

/** 오늘 화면에서 고른 일을 다시 빼는 단추 (마감이 오늘이거나 지난 일은 뺄 수 없어 단추가 없다) */
export function UnpickButton({ item, today }: { item: PlanItem; today: DateStr }) {
  if (isAuto(item, today)) return null
  return (
    <Button size="sm" variant="ghost" onClick={() => pickDay(item.todo.id, item.sub, '')}>
      오늘에서 빼기
    </Button>
  )
}

interface Props {
  item: PlanItem
  today: DateStr
  /** 다음 영업일 ("내일로") */
  next: DateStr
  /** today: 오늘 화면의 줄 (체크·빼기) · pick: 후보 목록의 줄 (넣기·내일로) */
  mode: 'today' | 'pick'
  /** 본인 기준 마감과 따로 있는 PMP 기한 */
  pmp?: DateStr
}

/**
 * 가볍게 보는 한 줄: 묶음의 하위 항목 하나(묶음 제목 없이 "기관 방문 · 항목"), 또는 후보 목록의 할 일.
 * 제목을 누르면 편집 창이 열린다
 */
export function PlanRow({ item: x, today, next, mode, pmp }: Props) {
  const projects = useApp((st) => st.projects)
  const l = x.due ? dLabel(x.due) : null
  const late = !!x.due && x.due < today
  const soon = x.due === today
  const edit = () => openModal(x.sub ? { kind: 'subEdit', id: x.todo.id, sub: x.sub } : { kind: 'todoEdit', id: x.todo.id })
  const toggle = () => (x.sub ? toggleCheck(x.todo.id, x.sub) : toggleDone(x.todo))
  /* 다른 날(내일)로 골라 둔 일 */
  const later = x.today > today ? x.today : ''
  return (
    <div className={cx(s.row, late && s.late, soon && s.soon)}>
      {mode === 'pick' ? (
        <button type="button" className={s.add} title="오늘 할 일에 넣기" aria-label={x.title + ' 오늘 할 일에 넣기'} onClick={() => pickDay(x.todo.id, x.sub, today)}>
          ＋
        </button>
      ) : (
        <RoundCheckbox checked={false} onToggle={toggle} label={x.title + ' 완료 표시'} tone={late ? 'late' : soon ? 'danger' : 'default'} />
      )}
      <div className={s.body}>
        <button type="button" className={s.title} title="눌러서 편집" onClick={edit}>
          {x.title}
        </button>
        <div className={s.meta}>
          {x.project && <Tag tone={late ? 'late' : soon ? 'danger' : 'default'}>{projShort(projects, x.project)}</Tag>}
          {x.send && <Tag>보내는 일</Tag>}
          {x.start && x.start !== x.due && <span>▶ 착수 {md(x.start)}</span>}
          <PmpTag due={x.due} pmp={pmp} today={today} />
          {later && <span className={s.later}>{md(later) + '에 하기로 고름'}</span>}
        </div>
      </div>
      <div className={s.end}>
        <span className={s.due}>
          {x.due ? md(x.due) : 'TBD'}
          <span className={s.dd}>{l ? l.t : '마감 미정'}</span>
        </span>
        {mode === 'pick' ? (
          later ? (
            <Button size="sm" variant="ghost" onClick={() => pickDay(x.todo.id, x.sub, '')}>
              취소
            </Button>
          ) : (
            <Button size="sm" variant="ghost" title={md(next) + ' 할 일로 미리 고르기'} onClick={() => pickDay(x.todo.id, x.sub, next)}>
              내일로
            </Button>
          )
        ) : (
          <UnpickButton item={x} today={today} />
        )}
      </div>
    </div>
  )
}

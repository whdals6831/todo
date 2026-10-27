import bunny from '@/assets/bunny.png'
import { DOW, diffDays, dow, fmt, md, parse, shift, todayStr } from '@/domain/date.ts'
import { kindLabel, kindOf } from '@/domain/constants.ts'
import { dayComplete, dayTodos, eventsOn } from '@/domain/daySets.ts'
import { pmpAll, pmpOn, type PmpDue } from '@/domain/pmp.ts'
import { byPriority, dLabel } from '@/domain/priority.ts'
import { chipSite, projShort } from '@/domain/project.ts'
import { Button, IconButton } from '@/components/ui/Button.tsx'
import { EmptyState, Label, Sub } from '@/components/ui/Layout.tsx'
import { Popover } from '@/components/ui/Popover.tsx'
import { SegmentedControl } from '@/components/ui/SegmentedControl.tsx'
import { Tag } from '@/components/ui/Tag.tsx'
import { cx } from '@/lib/cx.ts'
import { closePopover, goToday, openModal, openPopover, setUi, ui, useApp, useUi } from '@/store/ui.ts'
import type { CalEvent, DateStr } from '@/types/domain.ts'
import { wasJustDropped } from '../drag/drag.ts'
import { EventRow } from '../event/EventRow.tsx'
import es from '../event/EventRow.module.css'
import { openEvent } from '../event/openEvent.ts'
import { QuickAdd } from '../todo/QuickAdd.tsx'
import { DoneFold, RankInfo, ReorderList } from '../todo/TodoList.tsx'
import s from './Calendar.module.css'

const selectDay = (d: DateStr) => setUi({ sel: d })

export function CalendarView() {
  return (
    <section className={s.layout}>
      <div>
        <MonthHead />
        <MonthGrid />
        <Legend />
      </div>
      <DayPanel />
    </section>
  )
}

function MonthHead() {
  const [y, m] = useUi((u) => u.month)
  const visitOnly = useUi((u) => u.calVisitOnly)
  const go = (delta: number) => {
    let mm = m + delta
    let yy = y
    if (mm < 1) [mm, yy] = [12, y - 1]
    if (mm > 12) [mm, yy] = [1, y + 1]
    setUi({ month: [yy, mm] })
  }
  return (
    <div className={s.head}>
      <h2 className={s.month}>
        <span className={s.mm}>{m}월</span>
        <span className={s.yy}>{y}</span>
      </h2>
      <IconButton variant="nav" label="이전 달" onClick={() => go(-1)}>
        ‹
      </IconButton>
      <IconButton variant="nav" label="다음 달" onClick={() => go(1)}>
        ›
      </IconButton>
      <Button size="sm" variant="ghost" className={s.todayBtn} onClick={goToday}>
        오늘
      </Button>
      <SegmentedControl
        className={s.filter}
        label="캘린더 보기"
        options={[['all', '전체'], ['visit', '일정만']] as const}
        value={visitOnly ? 'visit' : 'all'}
        onChange={(v) => setUi({ calVisitOnly: v === 'visit' })}
      />
    </div>
  )
}

function MonthGrid() {
  const [y, m] = useUi((u) => u.month)
  const sel = useUi((u) => u.sel)
  const today = useUi((u) => u.today)
  const visitOnly = useUi((u) => u.calVisitOnly)
  const events = useApp((st) => st.events)
  const todos = useApp((st) => st.todos)
  const holidays = useApp((st) => st.holidays)
  const projects = useApp((st) => st.projects)

  const first = fmt(new Date(Date.UTC(y, m - 1, 1)))
  const start = shift(first, -dow(first))
  const days: DateStr[] = []
  for (let i = 0; i < 42; i++) {
    const d = shift(start, i)
    if (i === 35 && parse(d).getUTCMonth() !== m - 1) break
    days.push(d)
  }
  /* 전체 보기: 일정과 마감 줄(PMP 마감·OMF)만. 할 일은 오른쪽 목록에서 */
  const dues = new Map<DateStr, PmpDue[]>()
  if (!visitOnly) for (const x of pmpAll({ events, todos, holidays, projects })) dues.set(x.date, [...(dues.get(x.date) || []), x])

  return (
    <div>
      <div className={s.dow}>
        {DOW.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      <div className={s.grid}>
        {days.map((d) => {
          const inMonth = parse(d).getUTCMonth() === m - 1
          const evs = eventsOn(d, events)
          const dl = dues.get(d) || []
          const lines = [
            ...evs.map((e) => <EventChip key={e.id} event={e} day={d} projects={projects} />),
            ...dl.map((x) => <DueChip key={x.key} due={x} day={d} />),
          ]
          const hol = holidays[d]
          return (
            <button
              key={d}
              type="button"
              data-drop-date={d}
              className={cx(s.cell, !inMonth && s.out, d === today && s.today, d === sel && s.sel, hol && s.hol, (hol || dow(d) === 0) && s.red)}
              aria-label={md(d) + ' 일정 ' + evs.length + '건' + (visitOnly ? '' : ', 마감 ' + dl.length + '건')}
              onClick={(e) => {
                if (wasJustDropped()) return
                selectDay(d)
                openPopover({ kind: 'cell', date: d, anchor: e.currentTarget.getBoundingClientRect() })
              }}
            >
              <span className={s.dnum}>
                <b>{parse(d).getUTCDate()}</b>
                {inMonth && dayComplete(d, todos) && <img className={s.yay} src={bunny} alt="이날 할 일 모두 완료" title="이날 할 일 모두 완료" />}
                {hol && <span className={s.hname}>{hol}</span>}
              </span>
              {lines.slice(0, 3)}
              {lines.length > 3 && <span className={s.more}>+{lines.length - 3}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function EventChip({ event: e, day: d, projects }: { event: CalEvent; day: DateStr; projects: Parameters<typeof projShort>[0] }) {
  const k = kindOf(e)
  const main = k === 'visit' ? chipSite(e.site) + ' ' + (e.type || '') : e.title || kindLabel(k)
  const sub = k === 'visit' ? projShort(projects, e.project) : [kindLabel(k), e.project ? projShort(projects, e.project) : ''].filter(Boolean).join(' · ')
  /* 여러 날 일정은 첫날과 일요일에만 시간·이름을, 나머지 날은 ↳ */
  const first = !e.endDate || e.date === d || dow(d) === 0
  return (
    <span
      className={cx(s.chip, s.ev, k !== 'visit' && s[k])}
      title={kindLabel(k) + ' · 클릭해서 편집'}
      onClick={(ev) => {
        ev.stopPropagation()
        if (wasJustDropped()) return
        selectDay(d)
        openEvent(e)
      }}
    >
      <span>
        {e.time && first && <span className={s.tm}>{e.time} </span>}
        {first ? main : '↳ ' + main}
      </span>
      <span className={s.c2}>{sub}</span>
    </span>
  )
}

/** 마감 줄 (오른쪽 그날 목록의 "마감"과 같은 것). 누르면 그날을 고른다. 끝냈는지 볼 할 일이 없는 마감은 지나도 빨갛게 두지 않는다 */
function DueChip({ due: x, day: d }: { due: PmpDue; day: DateStr }) {
  const dl = dLabel(x.date)
  return (
    <span
      className={cx(s.chip, s.dl, x.doneDay && s.done, !x.doneDay && (dl.soon || (dl.late && x.linked)) && s.urgent)}
      title={x.label + (x.doneDay ? ' · 완료' : '')}
      onClick={(e) => {
        e.stopPropagation()
        if (wasJustDropped()) return
        selectDay(d)
      }}
    >
      {x.time && <span className={s.tm}>{x.time} </span>}
      {x.chip}
    </span>
  )
}

function Legend() {
  const visitOnly = useUi((u) => u.calVisitOnly)
  return (
    <div className={s.legend} aria-hidden="true">
      <span><i className={s.lv} />외근</span>
      <span><i className={s.lm} />회의</span>
      <span><i className={s.lt} />교육</span>
      <span><i className={s.ll} />휴가</span>
      {!visitOnly && <span><i className={s.ld} />PMP 마감</span>}
    </div>
  )
}

/** 칸을 누르면 뜨는 작은 메뉴: 이날에 일정·할 일 추가 */
export function CellMenu({ date, anchor }: { date: DateStr; anchor: DOMRect }) {
  return (
    <Popover anchor={anchor} onClose={closePopover} placement="start-fixed" role="menu" label={md(date) + ' 추가'} className={s.cellMenu}>
      <Label>{md(date)}</Label>
      <Button size="sm" variant="solid" role="menuitem" onClick={() => { closePopover(); openEvent({ date }) }}>
        + 일정
      </Button>
      <Button size="sm" role="menuitem" onClick={() => { closePopover(); openModal({ kind: 'todoAdd' }) }}>
        + 할 일
      </Button>
    </Popover>
  )
}

/** "10월 16일" */
const monthDay = (d: DateStr) => parse(d).getUTCMonth() + 1 + '월 ' + parse(d).getUTCDate() + '일'

/** 그날이 PMP 마감인 것: 일정 줄과 같은 모양 (시간 자리에 마감, 태그에 과제). 이어진 할 일을 끝냈으면 끝낸 날을 붙인다 */
function PmpRow({ due: x }: { due: PmpDue }) {
  const projects = useApp((st) => st.projects)
  const dl = dLabel(x.date)
  const late = x.doneDay && x.doneDay > x.date ? diffDays(x.date, x.doneDay) : 0
  const state = x.doneDay
    ? monthDay(x.doneDay) + ' 완료' + (late ? ' · ' + late + '일 지나서' : '')
    : x.linked && x.date < todayStr()
      ? '미완료'
      : ''
  return (
    <div className={cx(es.row, x.doneDay && s.pmpDone)}>
      <span className={cx(es.time, s.pmpLabel)}>마감</span>
      <div className={es.body}>
        <div className={es.name}>
          {x.project && <Tag>{projShort(projects, x.project)}</Tag>}
          <span className={s.pmpName}>{x.label}</span>
        </div>
        {state && <Sub>{state}</Sub>}
      </div>
      {!x.doneDay && <span className={cx(s.pmpLeft, (dl.late || dl.soon) && s.pmpUrgent)}>{dl.t}</span>}
    </div>
  )
}

/** 고른 날의 일정과 할 일 (오늘 할 일 화면과 같은 목록) */
function DayPanel() {
  const d = useUi((u) => u.sel)
  useUi((u) => u.today)
  const events = useApp((st) => st.events)
  const todos = useApp((st) => st.todos)
  const hol = useApp((st) => st.holidays[d])
  const holidays = useApp((st) => st.holidays)
  const evs = eventsOn(d, events)
  const projects = useApp((st) => st.projects)
  const pmp = pmpOn(d, { events, todos, holidays, projects })
  const merged = dayTodos(d, todos).sort(byPriority)
  const open = merged.filter((t) => !t.done)

  return (
    <div className={s.day}>
      <div className={s.dayTop}>
      <div className={s.dayHead}>
        <h3>
          {parse(d).getUTCDate()}일<span> {DOW[dow(d)]}요일</span>
          {hol && <span className={s.holName}> · {hol}</span>}
        </h3>
        <Button size="sm" onClick={() => openEvent({ date: d })}>
          + 일정
        </Button>
        <Button size="sm" onClick={() => openModal({ kind: 'todoAdd', due: ui().sel })}>
          + 할 일
        </Button>
      </div>
      <QuickAdd placeholder="이날 마감인 할 일 바로 추가" label="할 일 제목" defaultDue={d} autoDue={false} style={{ marginTop: 'var(--space-1)' }} />
      </div>
      {open.length > 1 && <Sub className={s.dayHelp} style={{ display: 'block' }}>⋮⋮ 손잡이를 위아래로 끌면 우선순위가, 캘린더 칸에 놓으면 날짜가 바뀝니다.</Sub>}
      {!evs.length && !pmp.length && !merged.length && <EmptyState>이날 외근과 할 일이 없습니다.</EmptyState>}
      {evs.map((e) => (
        <EventRow key={e.id} event={e} />
      ))}
      {pmp.map((x) => (
        <PmpRow key={x.key} due={x} />
      ))}
      {open.length > 0 && (
        <>
          <div className={s.listHead}>
            <RankInfo items={open} label="할 일" />
          </div>
          {/* 이날 진행 중인 일(착수했지만 마감 전)을 다른 칸에 놓으면 착수일이 옮겨진다 */}
          <ReorderList items={open} field={(t) => (t.due === d || !t.start ? 'due' : 'start')} />
        </>
      )}
      <DoneFold id="cal-done" items={merged.filter((t) => t.done)} />
    </div>
  )
}

import { Fragment } from 'react'
import bunny from '@/assets/bunny.png'
import { DOW, localDay, localHM, md, nextWork, parse, shift } from '@/domain/date.ts'
import { briefData, dayComplete, daySet, eventsOn, todayBuckets, visitFirst } from '@/domain/daySets.ts'
import { isAuto, isEtmfUpload, type PlanItem } from '@/domain/plan.ts'
import { sortTodos } from '@/domain/priority.ts'
import { Button, IconButton } from '@/components/ui/Button.tsx'
import { EmptyState, Fold, Group, Sub, ViewHeader } from '@/components/ui/Layout.tsx'
import { Tag } from '@/components/ui/Tag.tsx'
import { projShort } from '@/domain/project.ts'
import { cx } from '@/lib/cx.ts'
import { setUi, useApp, usePlanCtx, useUi } from '@/store/ui.ts'
import type { DateStr, Todo } from '@/types/domain.ts'
import { EventRow } from '../event/EventRow.tsx'
import { QuickAdd } from '../todo/QuickAdd.tsx'
import { DoneFold, OpenList, RankInfo } from '../todo/TodoList.tsx'
import { RollActions, TodoRow } from '../todo/TodoRow.tsx'
import { PickButtons, UnpickButton } from './PlanRow.tsx'
import s from './Today.module.css'

/** 오늘 할 일 (‹ › 로 다른 날도 본다) */
export function TodayView() {
  const today = useUi((u) => u.today)
  const dayView = useUi((u) => u.dayView)
  const d = dayView && dayView !== today ? dayView : today
  return (
    <section>
      <ViewHeader
        className={s.head}
        title={<DayTitle d={d} label={d === today ? '오늘 할 일' : d < today ? '한 일' : '할 일'} />}
        end={<DayNav d={d} today={today} />}
      />
      {d === today ? <TodayBody t={today} /> : <OtherDayBody d={d} today={today} />}
    </section>
  )
}

function DayTitle({ d, label }: { d: DateStr; label: string }) {
  const x = parse(d)
  return (
    <>
      <span className={s.date}>
        {x.getUTCMonth() + 1}/{x.getUTCDate()}
        <span className={s.wd}>{DOW[x.getUTCDay()]}</span>
      </span>
      {label}
    </>
  )
}

function DayNav({ d, today }: { d: DateStr; today: DateStr }) {
  const isToday = d === today
  return (
    <span className={s.nav}>
      <Button size="sm" style={isToday ? { visibility: 'hidden' } : undefined} aria-hidden={isToday || undefined} tabIndex={isToday ? -1 : undefined} onClick={() => setUi({ dayView: null })}>
        오늘
      </Button>
      <IconButton variant="nav" label="이전 날" onClick={() => setUi({ dayView: shift(d, -1) })}>
        ‹
      </IconButton>
      <IconButton variant="nav" label="다음 날" onClick={() => setUi({ dayView: shift(d, 1) })}>
        ›
      </IconButton>
    </span>
  )
}

/** 오늘 화면의 줄 묶음 (reorder 면 끌어서 순서 변경, eTMF 업로드는 접어 둔다) */
function Items({ id, items, t, reorder }: { id: string; items: PlanItem[]; t: DateStr; reorder?: boolean }) {
  const by = new Map(items.map((x) => [x.todo.id, x]))
  /* 지난 일은 미루기, 고른 일은 오늘에서 빼기 */
  const extra = (x: Todo) => {
    const it = by.get(x.id)
    if (x.due && x.due < t) return <RollActions todo={x} />
    return it && !isAuto(it, t) ? <UnpickButton item={it} today={t} /> : undefined
  }
  const todos = sortTodos(items.map((x) => x.todo))
  return reorder ? <OpenList id={id} items={todos} extra={extra} /> : todos.map((x) => <TodoRow key={x.id} todo={x} extra={extra(x)} />)
}

/** 고르는 목록(후보 · 곧 착수할 일): 할 일 줄 옆에 넣기·내일로. eTMF 업로드는 맨 위에 접어 두고 눌러서 펼쳐 본다 */
function PickList({ id, items, t, next, flat }: { id: string; items: PlanItem[]; t: DateStr; next: DateStr; flat?: boolean }) {
  const row = (x: PlanItem) => <TodoRow key={x.key} todo={x.todo} extra={<PickButtons item={x} today={t} next={next} />} />
  if (flat) return items.map(row)
  const up = items.filter((x) => isEtmfUpload(x.todo))
  return (
    <>
      {up.length > 0 && (
        <Fold id={id + '-etmf'} label={'eTMF 업로드 ' + up.length}>
          {up.map(row)}
        </Fold>
      )}
      {items.filter((x) => !isEtmfUpload(x.todo)).map(row)}
    </>
  )
}

function TodayBody({ t }: { t: DateStr }) {
  const events = useApp((st) => st.events)
  const evs = eventsOn(t, events)

  return (
    <>
      <QuickAdd
        style={{ marginBottom: 'var(--space-5)' }}
        placeholder="할 일 추가 (예: 아주대 EDC 요청 ~10/15, 금요일 14시 TC, 계약 확인 TBD) · 날짜 없으면 오늘 마감"
        label="오늘 할 일 제목"
        defaultDue={t}
        parseBase={t}
      />
      <BriefCard d={t} />
      {evs.length > 0 && (
        <Group title="오늘 일정" count={evs.length}>
          {evs.map((e) => <EventRow key={e.id} event={e} />)}
        </Group>
      )}
      <TodayLists t={t} busy={evs.length > 0} />
    </>
  )
}

/**
 * 오늘 할 일 목록: 외근 업무 · 지연 · 할 일(오늘 마감 + 고른 일) · 후보(고르기) · 7일 안에 착수할 일.
 * 오늘 할 일 화면과 캘린더의 오늘 목록이 함께 쓴다. busy 는 위에 일정 등 다른 줄이 있어 "없습니다" 안내가 필요 없을 때
 */
export function TodayLists({ t, busy }: { t: DateStr; busy?: boolean }) {
  const events = useApp((st) => st.events)
  const todos = useApp((st) => st.todos)
  const holidays = useApp((st) => st.holidays)
  const ctx = usePlanCtx()
  const b0 = todayBuckets(t, { todos, events, ctx })
  /* eTMF 업로드는 어느 칸의 것이든 맨 위 한 줄에 접어 둔다 (오늘 화면의 것 먼저, 그다음 후보) */
  const up = (x: PlanItem) => isEtmfUpload(x.todo)
  const not = (xs: PlanItem[]) => xs.filter((x) => !up(x))
  const etmf = [...b0.visit, ...b0.judge, ...b0.late1, ...b0.open].filter(up)
  const etmfCands = b0.cands.filter(up)
  const b = { ...b0, visit: not(b0.visit), judge: not(b0.judge), late1: not(b0.late1), open: not(b0.open), cands: not(b0.cands) }
  const complete = dayComplete(t, todos, ctx)
  const next = nextWork(t, holidays)
  const openTodos = b.open.map((x) => x.todo)

  return (
    <>
      {etmf.length + etmfCands.length > 0 && (
        <Fold id="today-etmf" label={'eTMF 업로드 ' + (etmf.length + etmfCands.length)}>
          <Items id="today-etmf-list" items={etmf} t={t} />
          <PickList id="today-etmf-cands" items={etmfCands} t={t} next={next} flat />
        </Fold>
      )}
      {b.visit.length > 0 && (
        <Group title="오늘 외근 업무" count={b.visit.length} hint="오늘 외근과 이어진 할 일이에요.">
          <Items id="today-visit" items={b.visit} t={t} />
        </Group>
      )}
      {b.judge.length > 0 && (
        <Group title="판정 필요 · 두 번째 밀린 일" count={b.judge.length} over hint="한 번 미룬 일이 또 밀렸어요. 날짜를 다시 잡을지, Someday로 보낼지, 지울지 정해 주세요.">
          <Items id="today-judge" items={b.judge} t={t} />
        </Group>
      )}
      {b.late1.length > 0 && (
        <Group title="지연 · 어제까지 마감" count={b.late1.length} over>
          <Items id="today-late" items={b.late1} t={t} />
        </Group>
      )}
      {b.open.length + b.done.length > 0 && (
        <Group
          title="할 일"
          count={b.open.length + (b.done.length ? ' · 완료 ' + b.done.length : '')}
          hint="오늘 마감인 일과 내가 오늘 하려고 고른 일이에요."
          extra={
            <>
              {complete && <img className={s.yay} src={bunny} alt="" />}
              {complete && <span className={s.yayMsg}>오늘 할 일 끝!</span>}
              <RankInfo items={openTodos} />
            </>
          }
        >
          <Items id="today" items={b.open} t={t} reorder />
          <DoneFold id="today-done" items={b.done} />
        </Group>
      )}
      {!busy && !etmf.length && !b.visit.length && !b.judge.length && !b.late1.length && !b.open.length && !b.done.length && <EmptyState>오늘 할 일이 없습니다. 아래 후보에서 골라 보세요.</EmptyState>}
      {b.cands.length > 0 && (
        <Group title="오늘 할 일 고르기 · 후보" count={b.cands.length} hint={'＋를 누르면 오늘 할 일에 들어가요. "내일로"는 ' + md(next) + ' 할 일로 미리 골라 둡니다. 마감 임박순, 같은 마감이면 남에게 보내는 일이 위예요.'}>
          <PickList id="today-cands" items={b.cands} t={t} next={next} />
        </Group>
      )}
      {b.soon.length > 0 && (
        <Fold id="today-soon" label={'7일 안에 착수할 일 ' + b.soon.length}>
          <PickList id="today-soon-list" items={b.soon} t={t} next={next} />
        </Fold>
      )}
    </>
  )
}

function OtherDayBody({ d, today }: { d: DateStr; today: DateStr }) {
  const events = useApp((st) => st.events)
  const todos = useApp((st) => st.todos)
  const evs = eventsOn(d, events)
  const ctx = usePlanCtx()
  const ds = daySet(d, todos, ctx)
  const open = visitFirst(sortTodos(ds.open), d, events)
  const items = [...open, ...ds.done.sort((a, b) => (a.doneAt || '').localeCompare(b.doneAt || ''))]

  return (
    <>
      <QuickAdd style={{ marginBottom: 'var(--space-5)' }} placeholder={md(d) + ' 할 일 추가 · 날짜 없으면 이날 마감'} label="할 일 제목" defaultDue={d} parseBase={d} />
      {d < today && <BriefCard d={d} />}
      {evs.length > 0 && (
        <Group title="일정" count={evs.length}>
          {evs.map((e) => <EventRow key={e.id} event={e} />)}
        </Group>
      )}
      {items.length > 0 && (
        <Group
          title="할 일"
          count={ds.open.length + (ds.done.length ? ' · 완료 ' + ds.done.length : '')}
          extra={
            <>
              {dayComplete(d, todos, ctx) && <img className={s.yay} src={bunny} alt="" />}
              <RankInfo items={open} />
            </>
          }
        >
          <OpenList id="day" items={open} />
          <DoneFold id="day-done" items={ds.done} />
        </Group>
      )}
      {!evs.length && !items.length && <EmptyState>이날 기록된 할 일이 없습니다.</EmptyState>}
    </>
  )
}

/** 완료율과 남은 일 (오늘도 하루 종일 보인다) */
function BriefCard({ d }: { d: DateStr }) {
  const nowMs = useUi((u) => u.now)
  const todos = useApp((st) => st.todos)
  const holidays = useApp((st) => st.holidays)
  const projects = useApp((st) => st.projects)
  const ctx = usePlanCtx()
  const now = new Date(nowMs)
  const b = briefData(d, now, { todos, holidays, ctx })
  if (!b) return null
  /* 끝낸 할 일과 체크한 하위 항목을 시간 순으로. 시각을 모르는 체크는 맨 뒤 */
  const log = [
    ...b.done.map((x) => ({ key: x.id, at: x.doneAt || '', title: x.title, project: x.project || '', sub: '', todo: x })),
    ...b.subs.map((x) => ({ key: x.key, at: x.at, title: x.title, project: x.project, sub: x.name, todo: undefined })),
  ].sort((p, q) => (p.at.length === 10 ? '~' : p.at).localeCompare(q.at.length === 10 ? '~' : q.at))
  /* 제목 앞 과제 약칭 (할 일 줄의 과제 꼬리표와 같은 이름) */
  const proj = (p?: string) => (p ? <Tag className={s.bProj}>{projShort(projects, p)}</Tag> : null)
  return (
    <section className={s.brief} aria-label="오늘 브리핑">
      <h3>
        {b.past ? '이날 브리핑' : '오늘 브리핑'}
        <Sub>{md(d) + (b.past ? '' : ' · ' + localHM(now.toISOString()) + ' 기준')}</Sub>
      </h3>
      <div>
        <span className={s.rate}>{b.rate}%</span>
        <Sub>{'목표 ' + b.goal + '개 중 ' + b.done.length + '개 완료' + (b.subs.length ? ' · 하위 항목 ' + b.subs.length + '개 체크' : '')}</Sub>
      </div>
      <div className={s.bar}>
        <i style={{ width: b.rate + '%' }} />
      </div>
      {log.length > 0 && (
        <>
          <div className={s.lbl}>완료한 일</div>
          <ul>
            {log.map((x) => (
              <li key={x.key} className={cx(!!x.todo?.subs?.length && s.withSubs)}>
                <span>{x.at.length > 10 ? localHM(x.at) : '—'}</span>
                {x.sub ? (
                  <span>
                    {proj(x.project)}
                    <span className={s.subOf}>{x.title + ' › '}</span>
                    {x.sub}
                  </span>
                ) : (
                  <span>
                    {proj(x.project)}
                    {x.title}
                  </span>
                )}
                {x.todo && <SubRows t={x.todo} d={d} />}
              </li>
            ))}
          </ul>
        </>
      )}
      {b.left.length > 0 ? (
        <>
          <div className={s.lbl}>{b.past ? '못 끝낸 일' : b.evening ? '남은 일 · 내일(' + md(b.next) + ')로 넘길지 확인' : '남은 일'}</div>
          <ul>
            {b.left.map((x) => (
              <li key={x.id}>
                <span>{x.due ? md(x.due) : 'TBD'}</span>
                <span>
                  {proj(x.project)}
                  {x.title}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className={s.lbl}>남은 일 없음. 수고했어요.</div>
      )}
    </section>
  )
}

/** 끝낸 할 일 아래 줄마다 하위 항목: 체크한 시각(다른 날이면 날짜, 시각이 남지 않은 옛 체크는 비움) · 이름 */
function SubRows({ t, d }: { t: Todo; d: DateStr }) {
  const when = (at?: string) => (!at || at.length === 10 ? '' : localDay(at) === d ? localHM(at) : md(localDay(at)))
  return (t.subs || []).map((x) => (
    <Fragment key={x}>
      <span className={s.subT}>{when(t.checkAt?.[x])}</span>
      <span className={s.subN}>{'› ' + x}</span>
    </Fragment>
  ))
}

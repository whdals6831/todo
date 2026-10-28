import bunny from '@/assets/bunny.png'
import { DOW, localDay, localHM, md, parse, shift } from '@/domain/date.ts'
import { briefData, dayComplete, daySet, eventsOn, todayBuckets } from '@/domain/daySets.ts'
import { byPriority } from '@/domain/priority.ts'
import { Button, IconButton } from '@/components/ui/Button.tsx'
import { EmptyState, Fold, Group, Sub, ViewHeader } from '@/components/ui/Layout.tsx'
import { setUi, useApp, useUi } from '@/store/ui.ts'
import type { DateStr } from '@/types/domain.ts'
import { EventRow } from '../event/EventRow.tsx'
import { QuickAdd } from '../todo/QuickAdd.tsx'
import { DoneFold, RankInfo, ReorderList } from '../todo/TodoList.tsx'
import { RollActions, TodoRow } from '../todo/TodoRow.tsx'
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

function TodayBody({ t }: { t: DateStr }) {
  const events = useApp((st) => st.events)
  const todos = useApp((st) => st.todos)
  const evs = eventsOn(t, events)
  const b = todayBuckets(t, todos)
  const complete = dayComplete(t, todos)

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
      {b.judge.length > 0 && (
        <Group title="판정 필요 · 두 번째 밀린 일" count={b.judge.length} over hint="한 번 미룬 일이 또 밀렸어요. 날짜를 다시 잡을지, Someday로 보낼지, 지울지 정해 주세요.">
          {b.judge.map((x) => <TodoRow key={x.id} todo={x} extra={<RollActions todo={x} />} />)}
        </Group>
      )}
      {b.late1.length > 0 && (
        <Group title="지연 · 어제까지 마감" count={b.late1.length} over hint="한 번은 다음 영업일로 미룰 수 있어요. 또 밀리면 위의 판정 칸으로 올라갑니다.">
          {b.late1.map((x) => <TodoRow key={x.id} todo={x} extra={<RollActions todo={x} />} />)}
        </Group>
      )}
      {b.list.length > 0 && (
        <Group
          title="할 일"
          count={b.openN + (b.doneN ? ' · 완료 ' + b.doneN : '')}
          extra={
            <>
              {complete && <img className={s.yay} src={bunny} alt="" />}
              {complete && <span className={s.yayMsg}>오늘 할 일 끝!</span>}
              <RankInfo items={b.list.filter((x) => !x.done)} />
            </>
          }
        >
          <ReorderList items={b.list.filter((x) => !x.done)} />
          <DoneFold id="today-done" items={b.list.filter((x) => x.done)} />
        </Group>
      )}
      {!evs.length && !b.late.length && !b.list.length && <EmptyState>오늘 할 일이 없습니다.</EmptyState>}
      {b.soon.length > 0 && (
        <Fold id="today-soon" label={'7일 안에 착수할 일 ' + b.soon.length}>
          {b.soon.map((x) => <TodoRow key={x.id} todo={x} />)}
        </Fold>
      )}
    </>
  )
}

function OtherDayBody({ d, today }: { d: DateStr; today: DateStr }) {
  const events = useApp((st) => st.events)
  const todos = useApp((st) => st.todos)
  const evs = eventsOn(d, events)
  const ds = daySet(d, todos)
  const open = ds.open.sort(byPriority)
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
              {dayComplete(d, todos) && <img className={s.yay} src={bunny} alt="" />}
              <RankInfo items={open} />
            </>
          }
        >
          <ReorderList items={open} />
          <DoneFold id="day-done" items={ds.done} />
        </Group>
      )}
      {!evs.length && !items.length && <EmptyState>이날 기록된 할 일이 없습니다.</EmptyState>}
    </>
  )
}

/** 완료율과 남은 일. 오늘은 17:50 이후에, 지난 날은 언제나 */
function BriefCard({ d }: { d: DateStr }) {
  const nowMs = useUi((u) => u.now)
  const todos = useApp((st) => st.todos)
  const holidays = useApp((st) => st.holidays)
  const now = new Date(nowMs)
  const b = briefData(d, now, { todos, holidays })
  if (!b) return null
  return (
    <section className={s.brief} aria-label="오늘 브리핑">
      <h3>
        {b.past ? '이날 브리핑' : '오늘 브리핑'}
        <Sub>{md(d) + (b.past ? '' : ' · ' + localHM(now.toISOString()) + ' 기준')}</Sub>
      </h3>
      <div>
        <span className={s.rate}>{b.rate}%</span>
        <Sub>{'목표 ' + b.goal + '개 중 ' + b.done.length + '개 완료'}</Sub>
      </div>
      <div className={s.bar}>
        <i style={{ width: b.rate + '%' }} />
      </div>
      {b.done.length > 0 && (
        <>
          <div className={s.lbl}>완료한 일</div>
          <ul>
            {b.done.map((x) => (
              <li key={x.id}>
                <span>{x.doneAt ? (localDay(x.doneAt) === d ? localHM(x.doneAt) : md(localDay(x.doneAt))) : '—'}</span>
                <span>
                  {x.title}
                  <SubLines subs={x.subs} />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {b.left.length > 0 ? (
        <>
          <div className={s.lbl}>{b.past ? '못 끝낸 일' : '남은 일 · 내일(' + md(b.next) + ')로 넘길지 확인'}</div>
          <ul>
            {b.left.map((x) => (
              <li key={x.id}>
                <span>{x.due ? md(x.due) : 'TBD'}</span>
                <span>{x.title}</span>
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

/** 끝낸 할 일 아래에 그 하위 항목 */
function SubLines({ subs }: { subs?: string[] }) {
  if (!subs?.length) return null
  return (
    <span className={s.subLines}>
      {subs.map((x) => (
        <span key={x}>{'› ' + x}</span>
      ))}
    </span>
  )
}

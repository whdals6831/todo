import { Fragment, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { localDay, md, todayStr } from '@/domain/date.ts'
import { dLabel, dueTone } from '@/domain/priority.ts'
import { projShort } from '@/domain/project.ts'
import { bundleParts, copyText, isGroupRule } from '@/domain/rules.ts'
import { docListsFor } from '@/domain/signDocs.ts'
import { stepsFor } from '@/domain/specials.ts'
import { Button } from '@/components/ui/Button.tsx'
import { Highlight } from '@/components/ui/Highlight.tsx'
import { ConfirmLine } from '@/components/ui/Layout.tsx'
import { RoundCheckbox } from '@/components/ui/RoundCheckbox.tsx'
import { Tag } from '@/components/ui/Tag.tsx'
import { cx } from '@/lib/cx.ts'
import { addSub, dismissTodo, moveSub, removeSub, rollOver, toSomeday, toggleCheck, toggleDone, toggleStep } from '@/store/actions.ts'
import { openModal, openPopover, useApp, usePmpDues } from '@/store/ui.ts'
import type { Todo } from '@/types/domain.ts'
import { startDrag, wasJustDropped } from '../drag/drag.ts'
import s from './TodoRow.module.css'

interface Props {
  todo: Todo
  /** ⋮⋮ 손잡이로 끌 수 있게. 캘린더 칸에 놓으면 이 필드(마감 또는 착수)를 옮긴다 */
  drag?: 'due' | 'start'
  /** 제목 아래 붙는 버튼 줄 */
  extra?: ReactNode
  /** 검색어 강조 */
  highlight?: string[]
}

const openEdit = (t: Todo) => openModal({ kind: 'todoEdit', id: t.id })
/** 하위 항목 편집 창 (이름·마감일·삭제) */
const editSub = (id: string, sub: string) => openModal({ kind: 'subEdit', id, sub })

export function TodoRow({ todo: t, drag, extra, highlight }: Props) {
  const projects = useApp((s) => s.projects)
  const notes = useApp((s) => s.notes)
  const events = useApp((s) => s.events)
  const rules = useApp((s) => s.rules)
  const holidays = useApp((s) => s.holidays)
  const copy = t.done ? '' : copyText(t, { rules, events, projects })
  const pmpMap = usePmpDues()
  const pmp = pmpMap.get(t.id)
  const [open, setOpen] = useState('')
  /** 이 줄을 골랐거나(과제 꼬리표 등을 누름) 하위 항목 입력칸에 쓰는 중 → 입력칸을 띄운다.
     CSS :focus 로 숨기면 줄 → 입력칸으로 포커스가 옮겨 가는 순간 칸이 잠깐 숨어 포커스를 놓치므로 상태로 둔다 */
  const [picked, setPicked] = useState(false)
  /** 하위 항목을 끌어서 순서 바꾸기: 끄는 줄(from)과 놓을 자리(to 번째 줄 앞) */
  const [dragSub, setDragSub] = useState<{ from: number; to: number } | null>(null)
  /* 지난 미완료는 보라(urgent), 오늘·내일 마감은 빨강(soon) */
  const tone = dueTone(t)
  const urgent = tone === 'late'
  const soon = tone === 'soon'
  const dd = localDay(t.doneAt)
  const checks = t.checks || []
  const group = isGroupRule(t.ruleId)
  /* 체크리스트. 체크는 앞말(pre)을 붙인 이름으로 남겨, 목록끼리 같은 이름이 있어도 따로 체크된다.
     서명문서·eTMF 문서는 눌러서 펼쳐 보고, 직접 단 하위 항목은 늘 보인다.
     외근 할 일 묶음(Preparation 등)은 문서 목록을 그 하위 항목(서명문서 준비 등) 밑에 달고, 체크는 "하위 항목 › 문서" 이름으로 */
  const lists = group ? [] : docListsFor(t.title, t, notes, events)
  const shown = lists.find((l) => l.key === open)
  /* 묶음 할 일은 하위 항목마다 그 일의 날짜를 오른쪽에 (지났으면 빨갛게), 단계가 있는 일(엔플론시아 계약서·ICF)은 밑에 단계를 */
  const parts = t.done ? {} : bundleParts(t, { rules, holidays, events, projects })
  /* 직접 정한 하위 항목 마감일이 규칙 날짜보다 먼저 */
  const dues: Record<string, string> = { ...Object.fromEntries(Object.entries(parts).map(([k, x]) => [k, x.due])), ...(t.done ? {} : t.subDue) }
  const today = todayStr()
  const subs = (t.subs || []).map((x) => ({
    /* eTMF 업로드 하위 항목이면 PMP 기한(방문 후 30일)을 옆에 */
    w: !t.done && !checks.includes(x) && pmpMap.get(t.id + '|' + x) ? 'PMP 기한 ' + md(pmpMap.get(t.id + '|' + x)!) + ' · ' + dLabel(pmpMap.get(t.id + '|' + x)!).t : undefined,
    t: x, due: dues[x], ruleDue: parts[x]?.due || '', late: !!dues[x] && dues[x] < today && !checks.includes(x), soon: dues[x] === today && !checks.includes(x), docs: group ? docListsFor(x, t, notes, events) : [],
    steps: stepsFor(x, parts[x]?.steps, t),
  }))
  const checked = (items: { t: string }[], pre: string) => items.filter((d) => checks.includes(pre + d.t)).length

  /** 하위 항목 맨 아래 입력칸에 바로 쓰게 한다 */
  const startSub = (body: HTMLElement) => body.querySelector<HTMLInputElement>('[data-sub-add]')?.focus()

  /** 펼치는 문서 목록 단추 (다시 누르면 접힌다) */
  const docsBtn = (key: string, name: string, n: number, of: number) => (
    <button
      key={key}
      type="button"
      className={s.docsBtn}
      aria-expanded={open === key}
      onClick={(e) => {
        e.stopPropagation()
        setOpen((o) => (o === key ? '' : key))
      }}
    >
      {(open === key ? '▴ ' : '▾ ') + name + ' ' + n + '/' + of}
    </button>
  )

  /* 체크해도 편집 창이 열리지 않게. 하위 항목(sub)은 글자를 눌러 고치고, 줄을 골랐으면 맨 아래에 입력칸 */
  const checklist = (
    items: { t: string; w?: string; due?: string; ruleDue?: string; late?: boolean; soon?: boolean; docs?: typeof lists; steps?: string[] }[],
    pre: string,
    sub = false,
    toggle = (name: string) => toggleCheck(t.id, pre + name),
    /** 단계(하위 항목의 하위 항목) 글자를 누르면 그 하위 항목 편집 창 */
    edit?: () => void,
  ) => (
    <ol className={cx(s.docs, sub && (!t.done || Object.keys(dues).length > 0) && s.subList)} onClick={(e) => e.stopPropagation()}>
      {items.map((d, i) => {
        const on = checks.includes(pre + d.t)
        return (
          <Fragment key={i}>
          <li
            className={cx(
              on && s.docOn, d.late && s.subLate, d.soon && s.subSoon,
              sub && !t.done && items.length > 1 && s.subDrag,
              sub && dragSub?.from === i && s.subDragging,
              sub && dragSub && dragSub.from !== i && dragSub.to === i && s.dropBefore,
              sub && dragSub && dragSub.from !== i && i === items.length - 1 && dragSub.to === items.length && s.dropAfter,
            )}
            {...(sub && !t.done && items.length > 1
              ? {
                  /* 줄을 끌어서 위아래로 옮긴다 (이름을 고치는 중에는 SubText 가 잠깐 꺼 둔다) */
                  draggable: true,
                  title: '끌어서 순서 바꾸기',
                  onDragStart: (e: DragEvent<HTMLLIElement>) => {
                    if (e.target !== e.currentTarget) return
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', d.t)
                    setDragSub({ from: i, to: i })
                  },
                  onDragOver: (e: DragEvent<HTMLLIElement>) => {
                    if (!dragSub) return
                    e.preventDefault()
                    const r = e.currentTarget.getBoundingClientRect()
                    const to = e.clientY < r.top + r.height / 2 ? i : i + 1
                    if (to !== dragSub.to) setDragSub({ from: dragSub.from, to })
                  },
                  onDrop: (e: DragEvent<HTMLLIElement>) => {
                    if (!dragSub) return
                    e.preventDefault()
                    void moveSub(t.id, items[dragSub.from].t, dragSub.to)
                    setDragSub(null)
                  },
                  onDragEnd: () => setDragSub(null),
                }
              : {})}
          >
            <RoundCheckbox checked={on} onToggle={() => toggle(d.t)} label={d.t + ' 체크'} />
            {sub ? (
              <SubText id={t.id} text={d.t} />
            ) : edit ? (
              <span className={cx(s.docT, s.subT)} title="눌러서 고치기·빼기" onClick={edit}>
                {d.t}
              </span>
            ) : (
              <span className={s.docT}>{d.t}</span>
            )}
            {/* 하위 항목 마감일: 눌러서 고친다 (아직 없으면 "＋ 마감일") */}
            {sub && !t.done ? (
              <span className={s.subEnd}>
                <SubDel id={t.id} name={d.t} />
                <button
                  type="button"
                  className={cx(s.subDue, s.subDueBtn, !d.due && s.subDueNone, d.late && s.late, d.soon && s.soonT)}
                  title="눌러서 하위 항목 마감일 고치기 (이름·삭제도)"
                  onClick={() => editSub(t.id, d.t)}
                >
                  {d.due ? md(d.due) : '＋ 마감일'}
                </button>
              </span>
            ) : (
              d.due && <span className={cx(s.subDue, d.late && s.late, d.soon && s.soonT)}>{md(d.due)}</span>
            )}
            {d.w && <span className={s.docW}>{d.w}</span>}
            {d.docs?.map((l) => {
              const key = d.t + '|' + l.key
              const p = d.t + ' › ' + l.pre
              return (
                <div key={key} className={s.subDocs}>
                  {docsBtn(key, l.name, checked(l.items, p), l.items.length)}
                  {open === key && checklist(l.items, p)}
                </div>
              )
            })}
            {/* 단계: 다 체크하면 이 하위 항목도 체크된다 (끝낸 하위 항목이면 접어 둔다) */}
            {!on && !!d.steps?.length && (
              <div className={s.subDocs}>
                {checklist(d.steps.map((x) => ({ t: x })), d.t + ' › ', false, (x) => toggleStep(t.id, d.t, x, d.steps!), t.done ? undefined : () => editSub(t.id, d.t))}
              </div>
            )}
          </li>
          </Fragment>
        )
      })}
      {sub && picked && (
        <li>
          <SubAdd id={t.id} />
        </li>
      )}
    </ol>
  )

  const due = t.done ? (
    <button
      type="button"
      data-due-button
      className={s.due}
      title="눌러서 완료일 바꾸기"
      aria-label={'완료일 ' + (dd ? md(dd) : '미정') + ' 바꾸기'}
      onClick={(e) => openPopover({ kind: 'done', id: t.id, anchor: e.currentTarget.getBoundingClientRect() })}
    >
      {dd ? md(dd) : '—'}
      <span className={s.dd}>{'완료' + (t.due && t.due !== dd ? ' · 마감 ' + md(t.due) : '')}</span>
    </button>
  ) : (
    <button
      type="button"
      data-due-button
      className={s.due}
      title="눌러서 마감일 바꾸기"
      aria-label={t.due ? '마감일 ' + md(t.due) + ' 바꾸기' : '마감일 바꾸기'}
      onClick={(e) => openPopover({ kind: 'due', id: t.id, anchor: e.currentTarget.getBoundingClientRect() })}
    >
      {t.due ? (
        <>
          {md(t.due) + (t.time ? ' ' + t.time : '')}
          <span className={cx(s.dd, dLabel(t.due).late && !t.autoDue && s.late)}>{dLabel(t.due).t}</span>
        </>
      ) : (
        <>
          TBD<span className={s.dd}>{t.someday ? 'Someday' : '마감 미정'}</span>
        </>
      )}
    </button>
  )

  return (
    <div className={cx(s.row, t.done && s.done, urgent && s.urgent, soon && s.soon)} data-todo-id={t.id}>
      <RoundCheckbox checked={!!t.done} onToggle={() => toggleDone(t)} label="완료 표시" tone={urgent ? 'late' : soon ? 'danger' : 'default'} />
      {/* 제목 글자를 눌러야 편집. 나머지(과제 꼬리표 등)를 누르면 이 줄이 골라져 Shift+Enter 로 하위 항목을 단다 */}
      <div
        className={s.body}
        tabIndex={0}
        aria-label={t.title + ' · Enter 편집, Shift+Enter 하위 항목 추가'}
        onFocus={(e) => setPicked(e.target === e.currentTarget || e.target.hasAttribute('data-sub-add'))}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setPicked(false)
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault()
            startSub(e.currentTarget)
          } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            openEdit(t)
          }
        }}
      >
        <div className={s.title}>
          {drag && (
            <span className={s.handle} data-handle title="끌어서 우선순위·날짜 바꾸기" aria-hidden="true" onPointerDown={(e) => startDrag(e, t.id, drag)}>
              ⋮⋮
            </span>
          )}
          <span
            className={s.titleText}
            /* 제목을 누를 땐 줄이 골라지지 않게 (과제 꼬리표 테두리가 잠깐 보였다 사라지지 않도록) */
            onMouseDown={(e) => {
              e.preventDefault()
              if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
            }}
            onClick={() => {
              if (!wasJustDropped()) openEdit(t)
            }}
          >
            <Highlight text={t.title} words={highlight} />
          </span>
        </div>
        <div className={s.meta}>
          {t.project && (
            <Tag tone={urgent ? 'late' : soon ? 'danger' : 'default'} className={s.proj} title="누르고 Shift+Enter: 하위 항목 추가">
              {projShort(projects, t.project)}
            </Tag>
          )}
          {t.verify && <Tag tone="warn">규칙 확인 필요</Tag>}
          {t.start && !t.done && t.start !== t.due && <span>▶ 착수 {md(t.start)}</span>}
          {/* 본인 기준 마감이 지났으면 따로 있는 PMP 기한까지 남은 날 */}
          {pmp && !t.done && pmp !== t.due && (
            <Tag tone={dLabel(pmp).late || dLabel(pmp).soon ? 'danger' : 'warn'}>{'PMP 기한 ' + md(pmp) + ' · ' + dLabel(pmp).t}</Tag>
          )}
          {!!t.rolled && !t.done && (
            <span className={s.rolled}>{'이월 ' + t.rolled + '회' + (t.origDue ? ' · 원래 마감 ' + md(t.origDue) : '')}</span>
          )}
          {t.note && <span>{t.note}</span>}
          {subs.length > 0 && <span className={s.subCount}>{'하위 항목 ' + checked(subs, '') + '/' + subs.length}</span>}
          {lists.map((l) => docsBtn(l.key, l.name, checked(l.items, l.pre), l.items.length))}
        </div>
        {copy && <CopyLine text={copy} />}
        {(subs.length > 0 || picked) && checklist(subs, '', true)}
        {shown && checklist(shown.items, shown.pre)}
        {extra}
      </div>
      {due}
    </div>
  )
}

/** 하위 항목 글자: 누르면 편집 창 (이름·마감일·그 밑의 하위 항목·삭제) */
function SubText({ id, text }: { id: string; text: string }) {
  return (
    <span className={cx(s.docT, s.subT)} title="눌러서 편집 (이름·마감일·하위 항목) · 끌어서 순서 바꾸기" onClick={() => editSub(id, text)}>
      {text}
    </span>
  )
}

/** 하위 항목 지우기: × 를 누르면 "삭제?"로 바뀌고, 한 번 더 눌러야 지운다 (마우스를 떼면 되돌아간다) */
function SubDel({ id, name }: { id: string; name: string }) {
  const [ask, setAsk] = useState(false)
  return (
    <span className={cx(s.subMove, ask && s.subAsk)} onMouseLeave={() => setAsk(false)}>
      <button
        type="button"
        className={cx(s.subMoveBtn, ask && s.subDelAsk)}
        title="하위 항목 삭제"
        aria-label={name + (ask ? ' 삭제 확인' : ' 삭제')}
        onBlur={() => setAsk(false)}
        onClick={() => (ask ? void removeSub(id, name) : setAsk(true))}
      >
        {ask ? '삭제?' : '✕'}
      </button>
    </span>
  )
}

/** 결재 상신 제목: 눌러서 복사 */
function CopyLine({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className={s.copy}
      title="눌러서 복사"
      onClick={async (e) => {
        e.stopPropagation()
        await navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
    >
      <span className={s.copyLbl}>상신 제목</span>
      <span className={s.copyT}>{text}</span>
      <span className={s.copyLbl}>{done ? '복사됨 ✓' : '복사'}</span>
    </button>
  )
}

/** 하위 항목 맨 아래에서 바로 한 줄 더 (Enter 로 추가하고 계속 쓴다. 쓴 채로 벗어나도 추가, Esc 는 취소) */
function SubAdd({ id, after, onAdded, onClose }: { id: string; after?: string; onAdded?: () => void; onClose?: () => void }) {
  const [v, setV] = useState('')
  const cancel = useRef(false)
  /* after 가 있으면 그 하위 항목 바로 아래 칸: 추가하면 새 줄 아래로 내려가고(onAdded), 빈 채로 벗어나면 닫힌다(onClose) */
  const add = (close?: boolean) => {
    const ok = !!v.trim() && !cancel.current
    if (ok) void addSub(id, v, after)
    cancel.current = false
    setV('')
    if (ok && !close) onAdded?.()
    else onClose?.()
  }
  return (
    <input
      className={s.subAdd}
      {...(after == null ? { 'data-sub-add': true } : { autoFocus: true })}
      value={v}
      placeholder="+ 하위 항목 추가 (Enter)"
      aria-label="하위 항목 추가"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => add(true)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          cancel.current = true
          e.currentTarget.blur()
        }
        if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
        e.preventDefault()
        add()
      }}
    />
  )
}

/** 지연된 할 일의 처리 버튼: 처음이면 미루기, 두 번째면 다시 잡기·Someday·삭제 */
export function RollActions({ todo: t }: { todo: Todo }) {
  const [confirming, setConfirming] = useState(false)
  const stop = (fn: () => void) => (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    fn()
  }
  if (!(t.rolled || 0)) {
    return (
      <div className={s.acts}>
        <Button size="sm" onClick={stop(() => rollOver(t))}>
          다음 영업일로 미루기
        </Button>
      </div>
    )
  }
  return (
    <div className={s.acts}>
      {confirming ? (
        <ConfirmLine message="삭제할까요?" onConfirm={() => dismissTodo(t.id)} onCancel={() => setConfirming(false)} />
      ) : (
        <>
          <Button size="sm" variant="solid" onClick={stop(() => openEdit(t))}>
            날짜 다시 잡기
          </Button>
          <Button size="sm" onClick={stop(() => toSomeday(t))}>
            Someday로
          </Button>
          <Button size="sm" variant="ghost" onClick={stop(() => setConfirming(true))}>
            삭제
          </Button>
        </>
      )}
    </div>
  )
}

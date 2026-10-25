import { useState, type ReactNode } from 'react'
import { localDay, md } from '@/domain/date.ts'
import { dLabel, isUrgent } from '@/domain/priority.ts'
import { projShort } from '@/domain/project.ts'
import { etmfDocsFor, signDocsFor } from '@/domain/signDocs.ts'
import { Button } from '@/components/ui/Button.tsx'
import { Highlight } from '@/components/ui/Highlight.tsx'
import { ConfirmLine } from '@/components/ui/Layout.tsx'
import { RoundCheckbox } from '@/components/ui/RoundCheckbox.tsx'
import { Tag } from '@/components/ui/Tag.tsx'
import { cx } from '@/lib/cx.ts'
import { addSub, dismissTodo, rollOver, toSomeday, toggleCheck, toggleDone } from '@/store/actions.ts'
import { openModal, openPopover, useApp } from '@/store/ui.ts'
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

export function TodoRow({ todo: t, drag, extra, highlight }: Props) {
  const projects = useApp((s) => s.projects)
  const notes = useApp((s) => s.notes)
  const events = useApp((s) => s.events)
  const [open, setOpen] = useState('')
  const urgent = isUrgent(t)
  const dd = localDay(t.doneAt)
  const checks = t.checks || []
  /* 펼쳐 보는 체크리스트. 체크는 앞말(pre)을 붙인 이름으로 남겨, 목록끼리 같은 이름이 있어도 따로 체크된다 */
  const lists = [
    { key: 'docs', name: '서명문서', pre: '', items: signDocsFor(t, notes, events) },
    { key: 'etmf', name: 'eTMF 문서', pre: 'eTMF:', items: etmfDocsFor(t, events) },
    { key: 'subs', name: '하위 항목', pre: '', items: (t.subs || []).map((x) => ({ t: x, w: '' })) },
  ].filter((l) => l.items.length || (l.key === 'subs' && open === 'subs'))
  const shown = lists.find((l) => l.key === open)

  /** 하위 항목을 펼치고 맨 아래 입력칸에 바로 쓰게 한다 */
  const startSub = (body: HTMLElement) => {
    setOpen('subs')
    requestAnimationFrame(() => body.querySelector<HTMLInputElement>('[data-sub-add]')?.focus())
  }

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
    <div className={cx(s.row, t.done && s.done, urgent && s.urgent)} data-todo-id={t.id}>
      <RoundCheckbox checked={!!t.done} onToggle={() => toggleDone(t)} label="완료 표시" tone={urgent ? 'danger' : 'default'} />
      {/* 제목 글자를 눌러야 편집. 나머지(과제 꼬리표 등)를 누르면 이 줄이 골라져 Shift+Enter 로 하위 항목을 단다 */}
      <div
        className={s.body}
        tabIndex={0}
        aria-label={t.title + ' · Enter 편집, Shift+Enter 하위 항목 추가'}
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
            <Tag tone={urgent ? 'danger' : 'default'} className={s.proj} title="누르고 Shift+Enter: 하위 항목 추가">
              {projShort(projects, t.project)}
            </Tag>
          )}
          {t.verify && <Tag tone="warn">규칙 확인 필요</Tag>}
          {t.start && !t.done && t.start !== t.due && <span>▶ 착수 {md(t.start)}</span>}
          {!!t.rolled && !t.done && (
            <span className={s.rolled}>{'이월 ' + t.rolled + '회' + (t.origDue ? ' · 원래 마감 ' + md(t.origDue) : '')}</span>
          )}
          {t.note && <span>{t.note}</span>}
          {lists.map((l) => (
            <button
              key={l.key}
              type="button"
              className={s.docsBtn}
              aria-expanded={open === l.key}
              onClick={(e) => {
                e.stopPropagation()
                setOpen((o) => (o === l.key ? '' : l.key))
              }}
            >
              {(open === l.key ? '▴ ' : '▾ ') + l.name + ' ' + l.items.filter((d) => checks.includes(l.pre + d.t)).length + '/' + l.items.length}
            </button>
          ))}
        </div>
        {shown && (
          /* 체크해도 편집 창이 열리지 않게 */
          <ol className={s.docs} onClick={(e) => e.stopPropagation()}>
            {shown.items.map((d, i) => {
              const on = checks.includes(shown.pre + d.t)
              return (
                <li key={i} className={cx(on && s.docOn)}>
                  <RoundCheckbox checked={on} onToggle={() => toggleCheck(t.id, shown.pre + d.t)} label={d.t + ' 체크'} />

                  <span className={s.docT}>{d.t}</span>
                  {d.w && <span className={s.docW}>{d.w}</span>}
                </li>
              )
            })}
            {shown.key === 'subs' && (
              <li>
                <SubAdd
                  id={t.id}
                  onLeave={() => {
                    if (!t.subs?.length) setOpen('')
                  }}
                />
              </li>
            )}
          </ol>
        )}
        {extra}
      </div>
      {due}
    </div>
  )
}

/** 펼친 하위 항목 맨 아래에서 바로 한 줄 더. 아무것도 안 쓰고 벗어나면 onLeave */
function SubAdd({ id, onLeave }: { id: string; onLeave: () => void }) {
  const [v, setV] = useState('')
  return (
    <input
      className={s.subAdd}
      data-sub-add
      value={v}
      placeholder="+ 하위 항목 추가 (Enter)"
      aria-label="하위 항목 추가"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (!v.trim()) onLeave()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') e.currentTarget.blur()
        if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
        e.preventDefault()
        void addSub(id, v)
        setV('')
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

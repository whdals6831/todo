import { useRef, useState, type ReactNode } from 'react'
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
import { addSub, dismissTodo, renameSub, rollOver, toSomeday, toggleCheck, toggleDone } from '@/store/actions.ts'
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
  /** 이 줄을 골랐거나(과제 꼬리표 등을 누름) 하위 항목 입력칸에 쓰는 중 → 입력칸을 띄운다.
     CSS :focus 로 숨기면 줄 → 입력칸으로 포커스가 옮겨 가는 순간 칸이 잠깐 숨어 포커스를 놓치므로 상태로 둔다 */
  const [picked, setPicked] = useState(false)
  const urgent = isUrgent(t)
  const dd = localDay(t.doneAt)
  const checks = t.checks || []
  /* 체크리스트. 체크는 앞말(pre)을 붙인 이름으로 남겨, 목록끼리 같은 이름이 있어도 따로 체크된다.
     서명문서·eTMF 문서는 눌러서 펼쳐 보고, 직접 단 하위 항목은 늘 보인다 */
  const lists = [
    { key: 'docs', name: '서명문서', pre: '', items: signDocsFor(t, notes, events) },
    { key: 'etmf', name: 'eTMF 문서', pre: 'eTMF:', items: etmfDocsFor(t, events) },
  ].filter((l) => l.items.length)
  const shown = lists.find((l) => l.key === open)
  const subs = (t.subs || []).map((x) => ({ t: x }))
  const checked = (items: { t: string }[], pre: string) => items.filter((d) => checks.includes(pre + d.t)).length

  /** 하위 항목 맨 아래 입력칸에 바로 쓰게 한다 */
  const startSub = (body: HTMLElement) => body.querySelector<HTMLInputElement>('[data-sub-add]')?.focus()

  /* 체크해도 편집 창이 열리지 않게. 하위 항목(sub)은 글자를 눌러 고치고, 줄을 골랐으면 맨 아래에 입력칸 */
  const checklist = (items: { t: string; w?: string }[], pre: string, sub = false) => (
    <ol className={s.docs} onClick={(e) => e.stopPropagation()}>
      {items.map((d, i) => {
        const on = checks.includes(pre + d.t)
        return (
          <li key={i} className={cx(on && s.docOn)}>
            <RoundCheckbox checked={on} onToggle={() => toggleCheck(t.id, pre + d.t)} label={d.t + ' 체크'} />
            {sub ? <SubText id={t.id} text={d.t} /> : <span className={s.docT}>{d.t}</span>}
            {d.w && <span className={s.docW}>{d.w}</span>}
          </li>
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
    <div className={cx(s.row, t.done && s.done, urgent && s.urgent)} data-todo-id={t.id}>
      <RoundCheckbox checked={!!t.done} onToggle={() => toggleDone(t)} label="완료 표시" tone={urgent ? 'danger' : 'default'} />
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
          {subs.length > 0 && <span className={s.subCount}>{'하위 항목 ' + checked(subs, '') + '/' + subs.length}</span>}
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
              {(open === l.key ? '▴ ' : '▾ ') + l.name + ' ' + checked(l.items, l.pre) + '/' + l.items.length}
            </button>
          ))}
        </div>
        {(subs.length > 0 || picked) && checklist(subs, '', true)}
        {shown && checklist(shown.items, shown.pre)}
        {extra}
      </div>
      {due}
    </div>
  )
}

/** 하위 항목 글자: 누르면 그 자리에서 고친다 (Enter·바깥을 누르면 저장, Esc 는 취소, 비우면 지움) */
function SubText({ id, text }: { id: string; text: string }) {
  const [v, setV] = useState<string | null>(null)
  const cancel = useRef(false)
  if (v == null)
    return (
      <span
        className={cx(s.docT, s.subT)}
        title="눌러서 고치기"
        /* 줄이 골라져 추가 칸이 잠깐 보이지 않게 */
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setV(text)}
      >
        {text}
      </span>
    )
  return (
    <input
      className={cx(s.subAdd, s.subEdit)}
      autoFocus
      value={v}
      aria-label={text + ' 고치기'}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (!cancel.current) void renameSub(id, text, v)
        cancel.current = false
        setV(null)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') cancel.current = true
        else if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
        e.preventDefault()
        e.currentTarget.blur()
      }}
    />
  )
}

/** 하위 항목 맨 아래에서 바로 한 줄 더 (Enter 로 추가하고 계속 쓴다. 쓴 채로 벗어나도 추가, Esc 는 취소) */
function SubAdd({ id }: { id: string }) {
  const [v, setV] = useState('')
  const cancel = useRef(false)
  const add = () => {
    if (v.trim() && !cancel.current) void addSub(id, v)
    cancel.current = false
    setV('')
  }
  return (
    <input
      className={s.subAdd}
      data-sub-add
      value={v}
      placeholder="+ 하위 항목 추가 (Enter)"
      aria-label="하위 항목 추가"
      onChange={(e) => setV(e.target.value)}
      onBlur={add}
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

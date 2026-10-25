import { useState, type KeyboardEvent } from 'react'
import { md, nowIso, todayStr } from '@/domain/date.ts'
import { parseWhen } from '@/domain/parseWhen.ts'
import { detectProject } from '@/domain/project.ts'
import { Button, IconButton } from '@/components/ui/Button.tsx'
import { CheckField, Field, FormGrid, Input, Select } from '@/components/ui/Field.tsx'
import { ConfirmLine } from '@/components/ui/Layout.tsx'
import { Modal, ModalFoot } from '@/components/ui/Modal.tsx'
import { addTodo, dismissTodo, manualId, putTodo, syncChildren, withSubs } from '@/store/actions.ts'
import { getState } from '@/store/store.ts'
import { closeModal, ui, useApp } from '@/store/ui.ts'
import type { DateStr, Todo } from '@/types/domain.ts'
import { KeywordHints } from './QuickAdd.tsx'
import { useHintInput } from './useHintInput.ts'
import s from './TodoModals.module.css'

const useProjectOptions = () => {
  const projects = useApp((st) => st.projects)
  return [['', '과제 없음'] as const, ...projects.map((p) => [p.name, p.name] as const)]
}

const onEnter = (fn: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
    e.preventDefault()
    fn()
  }
}

function TbdDate({ due, setDue, tbd, setTbd }: { due: string; setDue: (v: string) => void; tbd: boolean; setTbd: (v: boolean) => void }) {
  return (
    <Field label="마감일">
      <Input type="date" value={due} disabled={tbd} onChange={(e) => setDue(e.target.value)} />
      <span className={s.tbd}>
        <input type="checkbox" checked={tbd} onChange={(e) => setTbd(e.target.checked)} />
        마감일 미정 (TBD)
      </span>
    </Field>
  )
}

/** 하위 항목 목록과 쓰는 중인 한 줄. 저장할 때 쓰다 만 줄도 넣는다 */
function useSubs(init: string[] = []) {
  const [items, setItems] = useState(init)
  const [draft, setDraft] = useState('')
  const v = draft.trim()
  const all = v && !items.includes(v) ? [...items, v] : items
  const add = () => {
    setItems(all)
    setDraft('')
  }
  return { items, setItems, draft, setDraft, add, all }
}

/** 창의 어느 칸에서든 Shift+Enter 면 하위 항목 칸으로 (제목칸 Enter 처럼 저장되지 않게) */
const toSubs = (e: KeyboardEvent) => {
  const el = e.currentTarget.querySelector<HTMLInputElement>('[data-sub-input]')
  if (e.key !== 'Enter' || !e.shiftKey || e.nativeEvent.isComposing || !el || e.target === el) return
  e.preventDefault()
  e.stopPropagation()
  el.focus()
}

/** 할 일 아래 펼쳐 보는 체크리스트에 들어갈 항목. 빈칸에서 Enter 면 창을 저장한다 */
function SubsField({ subs, onDone }: { subs: ReturnType<typeof useSubs>; onDone: () => void }) {
  return (
    <div className={s.subs}>
      하위 항목 (선택) · 아무 칸에서나 Shift+Enter 로 바로 쓰기
      {subs.items.length > 0 && (
        <ol className={s.subList}>
          {subs.items.map((x) => (
            <li key={x}>
              {x}
              <IconButton variant="mini" label={x + ' 빼기'} onClick={() => subs.setItems(subs.items.filter((y) => y !== x))}>
                ×
              </IconButton>
            </li>
          ))}
        </ol>
      )}
      <div className={s.subAdd}>
        <Input
          data-sub-input
          size="sm"
          value={subs.draft}
          onChange={(e) => subs.setDraft(e.target.value)}
          onKeyDown={onEnter(() => (subs.draft.trim() ? subs.add() : onDone()))}
          placeholder="예: ISF 문서 인쇄 → Enter (빈칸에서 Enter 는 저장)"
          aria-label="하위 항목"
        />
        <Button size="sm" onClick={subs.add}>
          추가
        </Button>
      </div>
    </div>
  )
}

/** 할 일 추가. 제목에 쓴 날짜·시간·TBD·과제를 아래 칸에 채워 준다 (직접 고친 칸은 그대로) */
export function TodoAddModal({ due: due0 }: { due?: DateStr }) {
  const options = useProjectOptions()
  const title = useHintInput()
  const [due, setDue] = useState(due0 || ui().sel)
  const [tbd, setTbd] = useState(false)
  const [time, setTime] = useState('')
  const [start, setStart] = useState('')
  const [project, setProject] = useState('')
  const [note, setNote] = useState('')
  const subs = useSubs()
  const [touched, setTouched] = useState({ due: false, time: false, project: false })

  const onTitle = (v: string) => {
    title.setValue(v)
    const w = parseWhen(v, todayStr(), due0 || ui().sel)
    if (!touched.due) setTbd(!!w.tbd)
    if (w.due && !touched.due) setDue(w.due)
    if (w.time && !touched.time) setTime(w.time)
    if (!touched.project) setProject(detectProject(getState().projects, w.title || v))
  }

  const go = async () => {
    const raw = title.value.trim()
    if (!raw) {
      title.ref.current?.focus()
      return
    }
    closeModal()
    const w = parseWhen(raw, todayStr(), due0 || ui().sel)
    const dv = tbd ? '' : due
    const st = start && dv && start > dv ? dv : start
    await addTodo({
      title: w.title || raw, due: dv, autoDue: !tbd && !touched.due && !w.due, tbd, time: time || '', start: st || '',
      project, note: note.trim(), subs: subs.all.length ? subs.all : undefined, done: false, created: nowIso(),
    })
  }

  return (
    <Modal title="할 일 추가" onClose={closeModal}>
      <FormGrid onKeyDownCapture={toSubs}>
        <Field label="제목 · 날짜·시간·TBD는 제목에 써도 돼요 (~10/15, 금요일 14시, TBD)" full>
          <Input
            {...title.inputProps}
            onChange={(e) => onTitle(e.target.value)}
            onKeyDown={onEnter(go)}
            placeholder="예: 이뮤도 아주대 CRC 변경 서류 확인 (15분)"
          />
        </Field>
        <div className={s.hints}>
          <KeywordHints value={title.value} focused={title.focused} onPick={title.pick} />
        </div>
        <TbdDate
          due={due}
          setDue={(v) => { setDue(v); setTouched((x) => ({ ...x, due: true })) }}
          tbd={tbd}
          setTbd={(v) => { setTbd(v); setTouched((x) => ({ ...x, due: true })) }}
        />
        <Field label="마감 시간 (선택)">
          <Input type="time" value={time} onChange={(e) => { setTime(e.target.value); setTouched((x) => ({ ...x, time: true })) }} />
        </Field>
        <Field label="착수일 (선택)">
          <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="과제">
          <Select options={options} value={project} onChange={(v) => { setProject(v); setTouched((x) => ({ ...x, project: true })) }} />
        </Field>
        <Field label="메모" full>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="선택" />
        </Field>
        <SubsField subs={subs} onDone={go} />
      </FormGrid>
      <ModalFoot>
        <span />
        <Button onClick={closeModal}>취소</Button>
        <Button variant="solid" onClick={go}>
          추가
        </Button>
      </ModalFoot>
    </Modal>
  )
}

/** 할 일 편집 (자동 할 일 포함). 제목·날짜를 바꾸면 직접 고친 것으로 표시해 규칙이 덮어쓰지 않는다 */
export function TodoEditModal({ todo: t }: { todo: Todo }) {
  const options = useProjectOptions()
  const ev = useApp((st) => (t.eventId ? st.events.get(t.eventId) : undefined))
  const [title, setTitle] = useState(t.title)
  const [due, setDue] = useState(t.due || '')
  const [tbd, setTbd] = useState(!t.due && (!!t.tbd || !!t.someday))
  const [time, setTime] = useState(t.time || '')
  const [start, setStart] = useState(t.start || '')
  const [project, setProject] = useState(t.project || '')
  const [note, setNote] = useState(t.note || '')
  const subs = useSubs(t.subs)
  const [done, setDone] = useState(!!t.done)
  const [confirming, setConfirming] = useState(false)

  const onTitle = (v: string) => {
    setTitle(v)
    const w = parseWhen(v, todayStr())
    if (w.tbd) setTbd(true)
    else if (w.due) {
      setDue(w.due)
      setTbd(false)
    }
    if (w.time) setTime(w.time)
  }

  const save = async () => {
    const raw = title.trim()
    if (!raw) return
    const ti = parseWhen(raw, todayStr()).title || raw
    const n: Todo = { ...withSubs(t, subs.all), title: ti, time: time || '', project, note: note.trim(), done, doneAt: done ? t.doneAt || nowIso() : null }
    const dv = tbd ? '' : due
    n.tbd = tbd
    let st = start
    if (st && dv && st > dv) st = dv
    if (dv !== (t.due || '')) {
      n.due = dv
      n.autoDue = false
      n.basis = (t.basis ? t.basis + ' · ' : '') + '직접 변경 → ' + (dv ? md(dv) : 'TBD')
    }
    if (st !== (t.start || '')) {
      n.start = st
      n.startBasis = (t.startBasis ? t.startBasis + ' · ' : '') + '직접 변경 → ' + (st ? md(st) : '없음')
    }
    if (n.title !== t.title || n.due !== t.due || n.start !== t.start || (n.time || '') !== (t.time || '')) n.ruleId = manualId(t.ruleId)
    if (t.parentId && (n.due !== t.due || !!n.tbd !== !!t.tbd)) n.ownDate = true
    closeModal()
    await putTodo(n)
    await syncChildren(n)
  }

  return (
    <Modal title="할 일 편집" onClose={closeModal}>
      <FormGrid onKeyDownCapture={toSubs}>
        <Field label="제목" full>
          <Input value={title} onChange={(e) => onTitle(e.target.value)} onKeyDown={onEnter(save)} />
        </Field>
        <TbdDate due={due} setDue={setDue} tbd={tbd} setTbd={setTbd} />
        <Field label="마감 시간">
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <Field label="착수일">
          <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="과제">
          <Select options={options} value={project} onChange={setProject} />
        </Field>
        <Field label="메모" full>
          <Input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={onEnter(save)} placeholder="선택" />
        </Field>
        <SubsField subs={subs} onDone={save} />
        <CheckField checked={done} onChange={setDone} full>
          완료
        </CheckField>
      </FormGrid>
      <div className={s.info}>
        {ev && <div className={s.basis}>{'외근 ' + md(ev.date) + ' ' + (ev.site || '') + ' ' + ev.type + ' (' + (ev.project || '') + ')'}</div>}
        {t.basis && <div className={s.basis}>마감 근거: {t.basis}</div>}
        {t.startBasis && <div className={s.basis}>착수 근거: {t.startBasis}</div>}
        {t.ruleId?.endsWith('-manual') && <div className={s.basis}>직접 수정한 항목이라 규칙이 바뀌어도 그대로 둡니다.</div>}
      </div>
      <ModalFoot>
        {confirming ? (
          <ConfirmLine
            message="이 할 일을 삭제할까요?"
            onConfirm={async () => {
              closeModal()
              await dismissTodo(t.id)
            }}
            onCancel={() => setConfirming(false)}
          />
        ) : (
          <>
            <Button onClick={() => setConfirming(true)}>삭제</Button>
            <Button onClick={closeModal}>취소</Button>
            <Button variant="solid" onClick={save}>
              저장
            </Button>
          </>
        )}
      </ModalFoot>
    </Modal>
  )
}

import { useState } from 'react'
import { KINDS, TYPES, TYPE_LABEL, kindLabel, kindOf } from '@/domain/constants.ts'
import { md, todayStr } from '@/domain/date.ts'
import { dLabel } from '@/domain/priority.ts'
import { chipSite, escapeRegExp, projShort, safeId, siteShort } from '@/domain/project.ts'
import { Button } from '@/components/ui/Button.tsx'
import { Field, FormGrid, Input, Select, Textarea } from '@/components/ui/Field.tsx'
import { ConfirmLine, Label, Sub } from '@/components/ui/Layout.tsx'
import { cx } from '@/lib/cx.ts'
import { Modal, ModalFoot } from '@/components/ui/Modal.tsx'
import { SegmentedControl } from '@/components/ui/SegmentedControl.tsx'
import { deleteEventCascade, putEvent, syncEvent } from '@/store/actions.ts'
import { closeModal, setUi, ui, useApp } from '@/store/ui.ts'
import type { CalEvent, EventKind } from '@/types/domain.ts'
import s from './EventModal.module.css'

type FieldKey = 'title' | 'date' | 'end' | 'time' | 'proj' | 'projOpt' | 'type' | 'site' | 'memo'

/** 일정 종류마다 보이는 칸 */
const SHOW: Record<EventKind, FieldKey[]> = {
  visit: ['date', 'time', 'proj', 'type', 'site', 'memo'],
  meeting: ['title', 'date', 'time', 'projOpt', 'memo'],
  training: ['title', 'date', 'end', 'time', 'projOpt', 'memo'],
  leave: ['title', 'date', 'end', 'memo'],
}
const PLACEHOLDER: Partial<Record<EventKind, string>> = {
  meeting: '예: Imjudo 정기 TC, 팀 회의',
  training: '예: GCP 리프레시 교육',
  leave: '예: 연차, 오후 반차',
}

/** 일정 추가·편집 (외근·회의·교육·휴가). 외근을 저장하면 기한 규칙대로 할 일을 맞춘다 */
export function EventModal({ event: ev, as }: { event: Partial<CalEvent>; as?: EventKind }) {
  const projects = useApp((st) => st.projects)
  const isNew = !ev.id
  const [kind, setKind] = useState<EventKind>(as || kindOf(ev))
  const [date, setDate] = useState(ev.date || ui().sel)
  const [end, setEnd] = useState(ev.endDate || '')
  const [time, setTime] = useState(ev.time || '')
  const [proj, setProj] = useState(ev.project || projects[0].name)
  const [projOpt, setProjOpt] = useState(kindOf(ev) === 'visit' ? '' : ev.project || '')
  const [type, setType] = useState(ev.type || 'PSV')
  const [site, setSite] = useState(ev.site || '')
  const [title, setTitle] = useState(ev.title || '')
  const [memo, setMemo] = useState(ev.memo || '')
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const hide = (k: FieldKey) => !SHOW[kind].includes(k)
  const sites = projects.find((p) => p.name === proj)?.sites ?? []

  const read = (): Omit<CalEvent, 'id'> & { id?: string } => {
    const base = { ...ev, kind, date, memo: memo.trim() }
    if (kind === 'visit') return { ...base, time, project: proj, type, site: site.trim(), title: '', endDate: '' }
    const endDate = (kind === 'training' || kind === 'leave') && end && end > date ? end : ''
    return { ...base, title: title.trim() || kindLabel(kind), time: kind === 'leave' ? '' : time, project: kind === 'leave' ? '' : projOpt, endDate, site: '', type: '' }
  }

  const save = async () => {
    const cur = read()
    if (!cur.date) return
    setSaving(true)
    cur.genKey = isNew ? '' : cur.genKey
    if (isNew) cur.createdDate = todayStr()
    const id = await putEvent(cur)
    setUi({ sel: cur.date })
    closeModal()
    await syncEvent({ ...cur, id } as CalEvent, !isNew)
  }

  return (
    <Modal title={kindLabel(kind) + (isNew ? ' 추가' : ' 편집')} onClose={closeModal} initialFocus={kind === 'visit' ? 'input[type=date]' : 'input'}>
      <div className={s.kind}>
        <Label>일정 종류 · 교육·회의·휴가는 여기서 고르세요</Label>
        <SegmentedControl size="lg" label="일정 종류" options={KINDS} value={kind} onChange={setKind} />
      </div>
      <FormGrid>
        <Field label="제목" full hidden={hide('title')}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={PLACEHOLDER[kind] || ''} />
        </Field>
        <Field label="날짜" hidden={hide('date')}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="종료일 (여러 날이면)" hidden={hide('end')}>
          <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <Field label="시간" hidden={hide('time')}>
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <Field label="과제" hidden={hide('proj')}>
          <Select options={projects.map((p) => [p.name, p.name] as const)} value={proj} onChange={setProj} />
        </Field>
        <Field label="과제 (선택)" hidden={hide('projOpt')}>
          <Select options={[['', '과제 없음'] as const, ...projects.map((p) => [p.name, p.name] as const)]} value={projOpt} onChange={setProjOpt} />
        </Field>
        <Field label="방문 종류" hidden={hide('type')}>
          <Select options={TYPES.map((t) => [t, TYPE_LABEL[t]] as const)} value={type} onChange={setType} />
        </Field>
        <Field label="기관" full hidden={hide('site')}>
          <Input value={site} onChange={(e) => setSite(e.target.value)} list="siteList" placeholder="예: 014. ○○대병원(PI 홍길동)" />
          <datalist id="siteList">
            {sites.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </Field>
        <Field label="메모" full hidden={hide('memo')}>
          <Textarea value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={kind === 'visit' ? 'PI, 장소 등' : '장소, 링크 등'} />
        </Field>
      </FormGrid>
      {!isNew && kind === 'visit' && kindOf(ev) === 'visit' && <VisitTodos ev={ev as CalEvent} />}
      <ModalFoot>
        {confirming ? (
          <ConfirmLine
            message={kindOf(ev) === 'visit' ? '외근과 미완료 자동 할 일을 함께 삭제할까요?' : '이 일정을 삭제할까요?'}
            onConfirm={async () => {
              closeModal()
              await deleteEventCascade(ev.id!)
            }}
            onCancel={() => setConfirming(false)}
          />
        ) : (
          <>
            {isNew ? <span /> : <Button onClick={() => setConfirming(true)}>삭제</Button>}
            <Button onClick={closeModal}>취소</Button>
            <Button variant="solid" disabled={saving} onClick={save}>
              저장
            </Button>
          </>
        )}
      </ModalFoot>
    </Modal>
  )
}

/** 이 외근으로 생긴 할 일 (자동 할 일 · 전 FUL · 끝내면 이어지는 할 일) 중 남은 것을 마감 순으로 */
function VisitTodos({ ev }: { ev: CalEvent }) {
  const todos = useApp((st) => st.todos)
  const projects = useApp((st) => st.projects)
  const all = [...todos.values()]
  const ids = new Set(all.filter((t) => t.eventId === ev.id || t.id === safeId('fu_' + ev.id)).map((t) => t.id))
  for (let grew = true; grew; ) {
    grew = false
    for (const t of all) {
      if (!t.followOf || !ids.has(t.followOf) || ids.has(t.id)) continue
      ids.add(t.id)
      grew = true
    }
  }
  if (!ids.size) return null
  const left = all
    .filter((t) => ids.has(t.id) && !t.done)
    .sort((a, b) => (a.due || '9').localeCompare(b.due || '9') || a.title.localeCompare(b.title))
  /* 제목 앞의 과제·기관 이름은 이 창에서는 빼고 보여 준다 */
  const alt = (xs: (string | undefined)[]) => '(?:' + xs.filter(Boolean).map((x) => escapeRegExp(x!)).join('|') + ')'
  const pre = new RegExp('^\\s*(?:' + alt([projShort(projects, ev.project), ev.project]) + '\\s+)?' + alt([siteShort(ev.site), chipSite(ev.site)]) + '\\s+')
  return (
    <div className={s.left}>
      <Label>
        남은 할 일 {left.length} · 전체 {ids.size}
      </Label>
      {left.length ? (
        <ul>
          {left.map((t) => {
            const d = t.due ? dLabel(t.due) : null
            const subs = t.subs?.length ? t.subs.filter((x) => t.checks?.includes(x)).length + '/' + t.subs.length : ''
            return (
              <li key={t.id}>
                <span>
                  {t.title.replace(pre, '')}
                  {subs && <Sub>{' · 하위 ' + subs}</Sub>}
                </span>
                <span className={cx(s.due, d?.late && s.late)}>{t.due ? md(t.due) + ' · ' + d!.t : '마감 미정'}</span>
              </li>
            )
          })}
        </ul>
      ) : (
        <Sub>모두 끝냈어요</Sub>
      )}
    </div>
  )
}

import { useState } from 'react'
import { create } from 'zustand'
import { Button, IconButton } from '@/components/ui/Button.tsx'
import { Input } from '@/components/ui/Field.tsx'
import { EmptyState, Label, ViewHeader } from '@/components/ui/Layout.tsx'
import { RoundCheckbox } from '@/components/ui/RoundCheckbox.tsx'
import { SegmentedControl } from '@/components/ui/SegmentedControl.tsx'
import { cx } from '@/lib/cx.ts'
import { saveNotes } from '@/store/actions.ts'
import { getState } from '@/store/store.ts'
import { useApp } from '@/store/ui.ts'
import type { NoteItem, NoteSection, Notes } from '@/types/domain.ts'
import s from './Notes.module.css'

const NOTE_ORDER = ['PSV', 'SIV', 'MV', 'COV', 'Add-on', 'SAE', '외근 공통']
const byVisit = (a: NoteSection, b: NoteSection) => {
  const i = NOTE_ORDER.indexOf(a.v)
  const j = NOTE_ORDER.indexOf(b.v)
  return (i < 0 ? 99 : i) - (j < 0 ? 99 : j)
}

/** 서명 문서 순서: PSV 미참석 연구진(해당 인력) → PI만 → 그 외. 같은 묶음 안은 원래 순서 */
function docGroup(it: NoteItem) {
  const t = String(it.t || '')
  const w = String(it.w || '').trim()
  if (/미참석|해당\s*(연구진|인력)|PSV 때 못 받았|추가 인력/.test(t + ' ' + w)) return 0
  if (/^PI(만)?(\s*[·(]|$)/.test(w)) return 1
  return 2
}
const sortDocs = (arr: NoteItem[]) =>
  arr.map((it, i) => [it, i] as const).sort((a, b) => docGroup(a[0]) - docGroup(b[0]) || a[1] - b[1]).map((x) => x[0])

/** 고른 과제·펼친 방문 (다른 화면에 다녀와도 기억) */
const useNoteUi = create<{ proj: string; open: Set<string> }>()(() => ({ proj: '', open: new Set() }))

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const uncheck = (x: NoteItem): NoteItem => {
  const n = { ...x }
  delete n.c
  return n
}

/** 업무 노트: 과제별·방문별로 해야 할 일 순서와 서명 문서 (체크해 가며 쓰는 체크리스트) */
export function NotesView() {
  const projects = useApp((st) => st.projects)
  const notes = useApp((st) => st.notes) ?? {}
  const { proj: proj0, open } = useNoteUi()
  const [edit, setEdit] = useState<{ proj: string; secs: NoteSection[] } | null>(null)
  const proj = projects.some((p) => p.name === proj0) ? proj0 : projects[0]?.name || ''
  const editing = edit?.proj === proj
  const saved = notes[proj] || []
  const secs = editing ? edit.secs : [...saved].sort(byVisit)

  /** 이 과제의 노트만 바꿔 저장 */
  const write = (next: NoteSection[]) => {
    const all: Notes = { ...(getState().notes ?? {}), [proj]: next }
    return saveNotes(all)
  }
  const toggleOpen = (key: string) => {
    const n = new Set(open)
    if (n.has(key)) n.delete(key)
    else n.add(key)
    useNoteUi.setState({ open: n })
  }
  const toggleCheck = (sv: string, list: 'items' | 'docs', it: NoteItem) =>
    write(saved.map((sec) => (sec.v !== sv ? sec : { ...sec, [list]: (sec[list] || []).map((x) => (x === it ? { ...x, c: !x.c } : x)) })))
  const resetChecks = () =>
    write(saved.map((sec) => ({ ...sec, items: sec.items.map(uncheck), docs: (sec.docs || []).map(uncheck) })))
  const startEdit = () => {
    const copy = clone(saved).map((x) => ({ ...x, docs: x.docs || [] }))
    useNoteUi.setState({ open: new Set([...open, ...saved.map((x) => proj + '|' + x.v)]) })
    setEdit({ proj, secs: copy })
  }
  const saveEdit = async () => {
    if (!edit) return
    const clean = (a?: NoteItem[]) => (a || []).filter((i) => i.t.trim()).map((i) => ({ t: i.t.trim(), w: (i.w || '').trim(), ...(i.c ? { c: true } : {}) }))
    const next = edit.secs.filter((x) => x.v.trim()).map((x) => ({ v: x.v.trim(), items: clean(x.items), docs: clean(x.docs) }))
    setEdit(null)
    await write(next)
  }
  /** 편집 중인 사본을 바꾼다 */
  const mutate = (fn: (secs: NoteSection[]) => void) =>
    setEdit((e) => {
      if (!e) return e
      const secs = clone(e.secs)
      fn(secs)
      return { ...e, secs }
    })

  return (
    <section>
      <ViewHeader title="업무 노트">
        <Label>방문별로 해야 할 일 순서</Label>
      </ViewHeader>
      <div className={s.bar}>
        <SegmentedControl
          tabs
          label="과제"
          options={projects.map((p) => [p.name, p.short || p.name] as const)}
          value={proj}
          onChange={(v) => {
            if (!edit) useNoteUi.setState({ proj: v })
          }}
        />
        <span className={s.barEnd}>
          {editing ? (
            <>
              <Button size="sm" onClick={() => setEdit(null)}>
                취소
              </Button>
              <Button size="sm" variant="solid" onClick={saveEdit}>
                저장
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={resetChecks}>
                체크 초기화
              </Button>
              <Button size="sm" onClick={startEdit}>
                편집
              </Button>
            </>
          )}
        </span>
      </div>
      {!secs.length && !editing && <EmptyState>아직 노트가 없어요. 편집을 눌러 방문별 단계를 적어 두세요.</EmptyState>}
      <div className={s.acc}>
        {secs.map((sec, si) => {
          const key = proj + '|' + sec.v
          const isOpen = editing || open.has(key)
          const docs = sec.docs || []
          if (editing) {
            return (
              <section key={si} className={cx(s.section, s.open)}>
                <div className={s.head}>
                  <Input className={s.nameIn} value={sec.v} placeholder="방문 이름 (예: PSV)" aria-label="방문 이름" onChange={(e) => mutate((x) => void (x[si].v = e.target.value))} />
                  <Button size="sm" variant="ghost" onClick={() => mutate((x) => void x.splice(si, 1))}>
                    방문 삭제
                  </Button>
                </div>
                <div className={s.body}>
                  <div>
                    <div className={s.sub}>할 일 순서</div>
                    <EditList arr={sec.items} ph1="단계" ph2="기한 (PMP)" onChange={(fn) => mutate((x) => fn(x[si].items))} />
                    <Button size="sm" onClick={() => mutate((x) => void x[si].items.push({ t: '', w: '' }))}>
                      + 단계 추가
                    </Button>
                  </div>
                  <div>
                    <div className={s.sub}>서명 문서</div>
                    <EditList arr={docs} ph1="문서" ph2="서명자 · 원본/사본" onChange={(fn) => mutate((x) => fn((x[si].docs ??= [])))} />
                    <Button size="sm" onClick={() => mutate((x) => void (x[si].docs ??= []).push({ t: '', w: '' }))}>
                      + 문서 추가
                    </Button>
                  </div>
                </div>
              </section>
            )
          }
          const done = sec.items.filter((i) => i.c).length + docs.filter((i) => i.c).length
          return (
            <section key={key} className={cx(s.section, isOpen && s.open)}>
              <button type="button" className={s.head} aria-expanded={isOpen} onClick={() => toggleOpen(key)}>
                <span className={s.chev} aria-hidden="true">
                  {isOpen ? '−' : '+'}
                </span>
                <h3>{sec.v}</h3>
                <span className={s.sum}>{sec.items.length + '단계' + (docs.length ? ' · 서명 문서 ' + docs.length : '')}</span>
                <span className={s.count}>{done + ' / ' + (sec.items.length + docs.length)}</span>
              </button>
              {isOpen && (
                <div className={s.body}>
                  <div>
                    <div className={s.sub}>할 일 순서 · 기한은 PMP 기준</div>
                    <ViewList arr={sec.items} onToggle={(it) => toggleCheck(sec.v, 'items', it)} />
                  </div>
                  {docs.length > 0 && (
                    <div>
                      <div className={s.sub}>서명 문서 · 서명자</div>
                      <ViewList arr={sortDocs(docs)} onToggle={(it) => toggleCheck(sec.v, 'docs', it)} />
                    </div>
                  )}
                </div>
              )}
            </section>
          )
        })}
        {editing && (
          <Button className={s.addSection} onClick={() => mutate((x) => void x.push({ v: '', items: [{ t: '', w: '' }], docs: [] }))}>
            + 방문 추가
          </Button>
        )}
      </div>
    </section>
  )
}

function ViewList({ arr, onToggle }: { arr: NoteItem[]; onToggle: (it: NoteItem) => void }) {
  return (
    <ol className={s.list}>
      {arr.map((it, i) => (
        <li key={i} className={cx(it.c && s.checked)}>
          <RoundCheckbox checked={!!it.c} onToggle={() => onToggle(it)} label={it.t + ' 체크'} />
          <span className={s.n}>{i + 1}</span>
          <span className={s.t}>{it.t}</span>
          {it.w && <span className={s.w}>{it.w}</span>}
        </li>
      ))}
    </ol>
  )
}

function EditList({ arr, ph1, ph2, onChange }: { arr: NoteItem[]; ph1: string; ph2: string; onChange: (fn: (a: NoteItem[]) => void) => void }) {
  return (
    <ol className={cx(s.list, s.edit)}>
      {arr.map((it, i) => (
        <li key={i}>
          <Input size="sm" value={it.t} placeholder={ph1} aria-label={ph1} onChange={(e) => onChange((a) => void (a[i].t = e.target.value))} />
          <Input size="sm" value={it.w || ''} placeholder={ph2} aria-label={ph2} onChange={(e) => onChange((a) => void (a[i].w = e.target.value))} />
          <span className={s.btns}>
            <IconButton variant="mini" label="위로" disabled={i === 0} onClick={() => onChange((a) => void a.splice(i - 1, 0, a.splice(i, 1)[0]))}>
              ↑
            </IconButton>
            <IconButton variant="mini" label="아래로" disabled={i === arr.length - 1} onClick={() => onChange((a) => void a.splice(i + 1, 0, a.splice(i, 1)[0]))}>
              ↓
            </IconButton>
            <IconButton variant="mini" label="삭제" onClick={() => onChange((a) => void a.splice(i, 1))}>
              ×
            </IconButton>
          </span>
        </li>
      ))}
    </ol>
  )
}

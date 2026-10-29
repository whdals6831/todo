import { useRef, useState } from 'react'
import { create } from 'zustand'
import { TYPES } from '@/domain/constants.ts'
import { md, nowIso } from '@/domain/date.ts'
import { projShort, siteCore } from '@/domain/project.ts'
import { Button, IconButton } from '@/components/ui/Button.tsx'
import { Input, Select } from '@/components/ui/Field.tsx'
import { EmptyState, Fold, Label, Sub, ViewHeader } from '@/components/ui/Layout.tsx'
import { Tag } from '@/components/ui/Tag.tsx'
import { addFul, deleteFul, updateFul } from '@/store/actions.ts'
import { useApp } from '@/store/ui.ts'
import type { Ful } from '@/types/domain.ts'
import s from './Ful.module.css'

const TYPE_OPTIONS = [['*', '다음 방문'] as const, ...TYPES.filter((x) => x !== '기타').map((x) => [x, x] as const)]

/** 입력 중인 메모와 고른 과제 칩 (다른 화면에 다녀와도 남는다) */
const useDraft = create<{ project: string; site: string; type: string; text: string; filter: string }>()(() => ({
  project: '', site: '', type: '*', text: '', filter: '전체',
}))

const newest = (a: Ful, b: Ful) => Date.parse(b.created) - Date.parse(a.created)

/** FUL 메모: 기관의 다음 방문 때 챙길 일. 그 기관 외근을 등록하면 할 일로 넘어간다 */
export function FulView() {
  const projects = useApp((st) => st.projects)
  const fuls = useApp((st) => st.fuls)
  const todos = useApp((st) => st.todos)
  const draft = useDraft()
  const textRef = useRef<HTMLInputElement>(null)
  const siteRef = useRef<HTMLInputElement>(null)
  const project = draft.project || projects[0]?.name || ''
  const proj = projects.find((p) => p.name === project) ?? projects[0]

  const add = async () => {
    const site = draft.site.trim()
    const text = draft.text.trim()
    if (!site) return siteRef.current?.focus()
    if (!text) return textRef.current?.focus()
    useDraft.setState({ text: '' })
    await addFul({ project, site, type: draft.type, text, created: nowIso() })
    textRef.current?.focus()
  }

  const all = [...fuls.values()]
  const shown = all.filter((f) => draft.filter === '전체' || f.project === draft.filter)
  /** 기관별로 묶는다. 최근에 적은 메모가 맨 위 (묶음도 가장 최근 메모 순) */
  const bySite = (list: Ful[]) => {
    const groups = new Map<string, { project: string; site: string; items: Ful[] }>()
    for (const f of [...list].sort(newest)) {
      const k = f.project + '|' + siteCore(f.site)
      if (!groups.has(k)) {
        const known = projects.find((p) => p.name === f.project)?.sites.find((x) => siteCore(x) === siteCore(f.site))
        groups.set(k, { project: f.project, site: known || f.site, items: [] })
      }
      groups.get(k)!.items.push(f)
    }
    return [...groups.values()]
  }
  /* 대기 중인 메모만 위에, 할 일로 넘어간 메모는 맨 아래 "완료"에 접어 둔다 */
  const pending = bySite(shown.filter((f) => !f.todoId))
  const moved = shown.filter((f) => f.todoId)
  const head = (g: { project: string; site: string }, sub: string) => (
    <div className={s.head}>
      <Tag className={s.proj}>{projShort(projects, g.project)}</Tag>
      <strong>{g.site}</strong>
      <Sub>{sub}</Sub>
    </div>
  )

  return (
    <section>
      <ViewHeader title="FUL 메모">
        <Label>다음 방문 때 챙길 기관별 사항 · 외근 등록하면 할 일로 넘어가요</Label>
      </ViewHeader>
      <div className={s.form}>
        <Select
          aria-label="과제"
          options={projects.filter((p) => p.name !== '기타').map((p) => [p.name, p.short || p.name] as const)}
          value={project}
          onChange={(v) => useDraft.setState({ project: v })}
        />
        <Input ref={siteRef} list="fulSites" value={draft.site} onChange={(e) => useDraft.setState({ site: e.target.value })} placeholder="기관 (예: 09. ○○병원(PI 홍길동))" aria-label="기관" />
        <datalist id="fulSites">
          {(proj?.sites || []).map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
        <Select aria-label="방문" options={TYPE_OPTIONS} value={draft.type} onChange={(v) => useDraft.setState({ type: v })} />
        <Input
          ref={textRef}
          className={s.text}
          value={draft.text}
          onChange={(e) => useDraft.setState({ text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              add()
            }
          }}
          placeholder="챙길 일 (예: 개인정보동의서 1페이지 전체 교체)"
          aria-label="챙길 일"
        />
        <Button variant="solid" onClick={add}>
          추가
        </Button>
      </div>
      <div className={s.filters}>
        {['전체', ...projects.map((p) => p.name)].map((n) => (
          <Button key={n} size="sm" pressed={draft.filter === n} onClick={() => useDraft.setState({ filter: n })}>
            {n === '전체' ? '전체' : projShort(projects, n)}
          </Button>
        ))}
      </div>
      {!all.length && <EmptyState>방문 때 기관에 요청·정정해야 할 사항을 적어 두면, 그 기관 외근을 등록할 때 할 일로 자동 추가돼요.</EmptyState>}
      {!!all.length && !shown.length && <EmptyState>이 과제의 FUL 메모가 없어요.</EmptyState>}
      {pending.map((g) => (
        <section key={g.project + '|' + g.site} className={s.group}>
          {head(g, '대기 ' + g.items.length)}
          {g.items.map((f) => (
            <PendingRow key={f.id} ful={f} />
          ))}
        </section>
      ))}
      {moved.length > 0 && (
        <Fold id="ful-done" label={'완료 ' + moved.length + ' · 할 일로 넘어간 메모'}>
          {bySite(moved).map((g) => (
            <section key={g.project + '|' + g.site} className={s.group}>
              {head(g, '할 일로 넘어감 ' + g.items.length)}
              {g.items.map((f) => {
                const t = f.todoId ? todos.get(f.todoId) : undefined
                return (
                  <div key={f.id} className={s.row}>
                    <span className={s.movedType}>→ 할 일</span>
                    <span className={s.moved}>
                      {f.text}
                      <Sub>{' · ' + (t ? md(t.due || '') + ' 마감' + (t.done ? ' · 완료' : '') : '할 일 삭제됨')}</Sub>
                    </span>
                    <IconButton variant="mini" label="기록 지우기" onClick={() => deleteFul(f.id)}>
                      ×
                    </IconButton>
                  </div>
                )
              })}
            </section>
          ))}
        </Fold>
      )}
    </section>
  )
}

/** 대기 중인 메모: 방문 종류와 내용을 바로 고친다 (Enter·포커스 이동으로 저장, Esc 로 취소) */
function PendingRow({ ful: f }: { ful: Ful }) {
  const [text, setText] = useState(f.text)
  const commit = () => {
    const v = text.trim()
    if (v && v !== f.text) updateFul(f, { text: v })
    else setText(f.text)
  }
  return (
    <div className={s.row}>
      <select className={s.typeSel} aria-label="방문 바꾸기" value={f.type || '*'} onChange={(e) => updateFul(f, { type: e.target.value })}>
        {TYPE_OPTIONS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <input
        className={s.textIn}
        value={text}
        aria-label="챙길 일 고치기"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            setText(f.text)
            requestAnimationFrame(() => (e.target as HTMLInputElement).blur())
          }
        }}
      />
      <IconButton variant="mini" label="삭제" onClick={() => deleteFul(f.id)}>
        ×
      </IconButton>
    </div>
  )
}

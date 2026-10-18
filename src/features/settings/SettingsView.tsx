import { useRef, useState } from 'react'
import { BUILTIN_ALIASES, KEYS, TYPES, TYPE_LABEL } from '@/domain/constants.ts'
import { projShort } from '@/domain/project.ts'
import { normRule } from '@/domain/rules.ts'
import { Button } from '@/components/ui/Button.tsx'
import { Input, Select, Textarea } from '@/components/ui/Field.tsx'
import { ConfirmLine, Help, SectionHeader, Sub, ViewHeader } from '@/components/ui/Layout.tsx'
import { cx } from '@/lib/cx.ts'
import { newId } from '@/store/repository.ts'
import {
  replaceAll, saveCompanions, saveHolidays, saveProjects, saveRules, type ProjectDraft,
} from '@/store/actions.ts'
import { getState } from '@/store/store.ts'
import { parseExport, toExport } from '@/store/transfer.ts'
import { useApp } from '@/store/ui.ts'
import type { NormRule, Rule } from '@/types/domain.ts'
import s from './Settings.module.css'

/** 과제·규칙 설정 */
export function SettingsView() {
  return (
    <section>
      <ViewHeader title="과제·규칙" />
      <ProjectsSection />
      <CompanionsSection />
      <RulesSection />
      <HolidaysSection />
      <TransferSection />
    </section>
  )
}

/* ---------- 과제 ---------- */

const toDrafts = (): ProjectDraft[] =>
  getState().projects.map((p) => ({
    orig: p.name, name: p.name, short: p.short, sites: (p.sites || []).join('\n'), aliases: (p.aliases || BUILTIN_ALIASES[p.name] || []).join(', '),
  }))

function ProjectsSection() {
  const [drafts, setDrafts] = useState(toDrafts)
  const [msg, setMsg] = useState('')
  const [confirm, setConfirm] = useState<number | null>(null)
  const events = useApp((st) => st.events)
  const todos = useApp((st) => st.todos)
  const upd = (i: number, patch: Partial<ProjectDraft>) => setDrafts((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const save = async () => {
    const r = await saveProjects(drafts)
    setMsg(r.message)
    if (r.ok) setDrafts(toDrafts())
  }
  return (
    <div className={s.section}>
      <SectionHeader title="과제">
        <Button size="sm" onClick={() => setDrafts((d) => [...d, { orig: '', name: '', short: '', sites: '', aliases: '' }])}>
          + 과제 추가
        </Button>
        <Button size="sm" variant="solid" onClick={save}>
          과제 저장
        </Button>
        <Sub>{msg}</Sub>
      </SectionHeader>
      <Help>
        새 과제를 배정받으면 여기에 추가하세요. 담당 기관은 한 줄에 하나씩 "09. ○○병원(PI 홍길동)" 형식으로 적으면 외근 등록·FUL 메모의 기관 목록에 그대로 나옵니다. 기관 번호나 PI가 바뀌면 여기서 고치고 과제 저장을 누르세요. 과제 이름을 바꾸면 그 과제의 외근·할 일·규칙에도 같이 반영됩니다.
      </Help>
      <div className={s.scroll}>
        <table className={cx(s.table, s.top)} style={{ minWidth: 860 }}>
          <thead>
            <tr>
              <th>과제 이름</th>
              <th>약칭</th>
              <th>담당 기관 (한 줄에 하나: 번호. 기관명(PI 이름))</th>
              <th>자동 인식 단어 (쉼표)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {drafts.map((p, i) => {
              const used = [...events.values()].some((e) => e.project === p.orig) || [...todos.values()].some((t) => t.project === p.orig && !t.done)
              return (
                <tr key={i}>
                  <td style={{ minWidth: 200 }}>
                    <Input size="sm" value={p.name} onChange={(e) => upd(i, { name: e.target.value })} placeholder="예: Pfizer - 과제명" />
                  </td>
                  <td style={{ width: 130 }}>
                    <Input size="sm" value={p.short} onChange={(e) => upd(i, { short: e.target.value })} placeholder="약칭" />
                  </td>
                  <td style={{ minWidth: 320 }}>
                    <Textarea
                      size="sm"
                      className={s.siteList}
                      rows={Math.max(2, p.sites.split('\n').length)}
                      value={p.sites}
                      onChange={(e) => upd(i, { sites: e.target.value })}
                      placeholder={'09. ○○병원(PI 홍길동)\n10. ○○대병원(PI 김철수)'}
                    />
                  </td>
                  <td style={{ minWidth: 200 }}>
                    <Input size="sm" value={p.aliases} onChange={(e) => upd(i, { aliases: e.target.value })} placeholder="예: 브레즈트리, breztri" />
                  </td>
                  <td>
                    {confirm === i ? (
                      <ConfirmLine
                        message={used ? '외근·할 일은 남고 목록에서만 빠집니다.' : '삭제할까요?'}
                        onConfirm={() => {
                          setDrafts((d) => d.filter((_, j) => j !== i))
                          setConfirm(null)
                        }}
                        onCancel={() => setConfirm(null)}
                      />
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setConfirm(i)}>
                        삭제
                      </Button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ---------- 함께 추가할 할 일 ---------- */

function CompanionsSection() {
  const projects = useApp((st) => st.projects)
  const init = () => getState().companions.map((c) => ({ project: c.project || '', keyword: c.keyword || '', items: (c.items || []).join(', ') }))
  const [rows, setRows] = useState(init)
  const [msg, setMsg] = useState('')
  const upd = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  return (
    <div className={s.section}>
      <SectionHeader title="함께 추가할 할 일">
        <Button size="sm" onClick={() => setRows((d) => [...d, { project: '', keyword: '', items: '' }])}>
          + 추가
        </Button>
        <Button
          size="sm"
          variant="solid"
          onClick={async () => {
            await saveCompanions(rows)
            setRows(init())
            setMsg('저장했습니다. 다음에 추가하는 할 일부터 적용됩니다.')
          }}
        >
          저장
        </Button>
        <Sub>{msg}</Sub>
      </SectionHeader>
      <Help>
        할 일 제목에 키워드가 들어가면 아래 할 일이 같은 마감일로 함께 생깁니다. 처음 할 일의 마감일을 옮기면 같이 생긴 할 일도 따라 움직여요. 같이 생긴 할 일의 날짜를 직접 바꾸면 그때부터는 따로 움직입니다.
      </Help>
      <div className={s.scroll}>
        <table className={s.table} style={{ minWidth: 720 }}>
          <thead>
            <tr>
              <th>과제</th>
              <th>키워드</th>
              <th>함께 추가할 할 일 (쉼표로 구분)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => (
              <tr key={i}>
                <td style={{ width: 140 }}>
                  <Select size="sm" options={[['', '전체'] as const, ...projects.map((p) => [p.name, projShort(projects, p.name)] as const)]} value={c.project} onChange={(v) => upd(i, { project: v })} />
                </td>
                <td style={{ width: 140 }}>
                  <Input size="sm" value={c.keyword} onChange={(e) => upd(i, { keyword: e.target.value })} placeholder="예: OMF" />
                </td>
                <td style={{ minWidth: 320 }}>
                  <Input size="sm" value={c.items} onChange={(e) => upd(i, { items: e.target.value })} placeholder="예: ICF Tracking Log 업데이트, eTMF 내 Milestone 작성" />
                </td>
                <td>
                  <Button size="sm" variant="ghost" onClick={() => setRows((d) => d.filter((_, j) => j !== i))}>
                    삭제
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ---------- 기한 규칙 ---------- */

const TYPE_ORDER = ['PSV', 'SIV', 'MV', 'COV', 'Add-on', '기타']
const PROJ_ORDER = ['Imjudo', 'Breztri', '엔플론시아', 'Tarlatamab']

/** 규칙 표 순서: 과제(공통 먼저) → 방문 종류 → 항목 → 할 일 이름 */
function sortRules<T extends Pick<Rule, 'project' | 'type' | 'key' | 'title'>>(list: T[]): T[] {
  const projects = getState().projects
  const ti = (t: string) => (t === '*' ? -1 : TYPE_ORDER.indexOf(t) < 0 ? 99 : TYPE_ORDER.indexOf(t))
  const pi = (p: string) => {
    if (p === '*') return -1
    const sh = projShort(projects, p)
    const k = PROJ_ORDER.findIndex((x) => sh === x || String(p).includes(x))
    if (k >= 0) return k
    const j = projects.findIndex((x) => x.name === p)
    return 10 + (j < 0 ? 99 : j)
  }
  const ki = (k?: string) => {
    const j = KEYS.findIndex((x) => x[0] === (k || ''))
    return j < 0 ? 98 : j
  }
  return list
    .slice()
    .sort((a, b) => pi(a.project) - pi(b.project) || ti(a.type) - ti(b.type) || ki(a.key) - ki(b.key) || String(a.title).localeCompare(String(b.title), 'ko'))
}

const START_OPTIONS = [['fresh', '방문 다음 영업일'], ['lead', '마감 N영업일 전'], ['due', '마감일 당일']] as const
const DIR_OPTIONS = [['before', '방문 전'], ['after', '방문 후']] as const
const UNIT_OPTIONS = [['WD', 'WD'], ['CD', 'CD'], ['ADD', '외근 등록일 기준']] as const

function RulesSection() {
  const projects = useApp((st) => st.projects)
  const [draft, setDraft] = useState<NormRule[]>(() => sortRules(getState().rules.map(normRule)))
  const [msg, setMsg] = useState<{ proj: string; text: string } | null>(null)
  const upd = (id: string, patch: Partial<NormRule>, resort = false) =>
    setDraft((d) => {
      const n = d.map((r) => (r.id === id ? { ...r, ...patch } : r))
      return resort ? sortRules(n) : n
    })
  const addIn = (proj: string) => {
    const id = 'r-' + newId()
    setDraft((d) => sortRules([...d, { id, key: '', type: '*', project: proj, title: '{site} {type} ', dir: 'after', n: 5, unit: 'WD', send: false, verify: true, basis: '', start: 'lead', startN: 2 }]))
    requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>('tr[data-rid="' + id + '"]')
      row?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      row?.querySelector<HTMLElement>('td:nth-child(3) select')?.focus({ preventScroll: true })
    })
  }
  const saveNow = async (proj: string) => {
    setMsg({ proj, text: '저장하는 중…' })
    const sorted = sortRules(draft)
    await saveRules(sorted)
    setDraft(sortRules(getState().rules.map(normRule)))
    setMsg({ proj, text: '저장했습니다. 미완료 자동 할 일에도 반영했어요.' })
    setTimeout(() => setMsg((m) => (m?.proj === proj ? null : m)), 5000)
  }

  /* 묶음: 전체 공통 → 과제 순 (규칙이 없는 과제도 제목은 보인다) */
  const keys = ['*', ...projects.map((p) => p.name)]
  draft.forEach((r) => {
    if (!keys.includes(r.project)) keys.push(r.project)
  })
  const groups = sortRules(keys.map((g) => ({ project: g, type: '*', key: '', title: '' }))).map((x) => x.project)
  const projOptions = [['*', '전체'] as const, ...projects.map((p) => [p.name, projShort(projects, p.name)] as const)]
  const typeOptions = [['*', '전체'] as const, ...TYPES.filter((t) => t !== '기타').map((t) => [t, t] as const)]

  return (
    <div className={s.section}>
      <SectionHeader title="기한 규칙" />
      <Help>
        외근을 등록하면 아래 규칙대로 할 일이 만들어집니다. WD는 방문 다음 영업일을 WD1로 셉니다(주말·공휴일 제외). CD는 달력 기준이며, 그날이 휴일이면 직전 영업일로 당깁니다. "보내는 일"에 체크하면 실제 마감을 기한 전 영업일로 잡습니다. 같은 항목이면 과제를 지정한 규칙이 "전체" 규칙보다 우선합니다. PMP를 반영할 때는 과제별 규칙을 추가하는 방식이라 다른 과제에는 영향이 없습니다.
      </Help>
      <Help>
        착수일은 마감과 별도로 "언제 시작할지"입니다. 방문 내용을 쓰는 일(리포트, Follow-up Letter)은 방문 다음 영업일에 시작합니다. 방문 직후 하루 안에 기억이 빠르게 흐려지기 때문입니다(에빙하우스 망각곡선). 나머지는 마감 2영업일 전에 시작해서, 일에 드는 시간을 짧게 잡는 경향(계획 오류)에 대비합니다. 착수일이 다른 외근 날과 겹치면 하루 옮깁니다. 저장하면 기존 외근의 미완료 자동 할 일에도 바로 반영됩니다. 완료했거나 날짜를 직접 옮긴 할 일은 그대로 둡니다.
      </Help>
      <div className={s.scroll}>
        <table className={s.table} style={{ minWidth: 1240 }}>
          <thead>
            <tr>
              {['과제', '방문 종류', '항목', '할 일 이름', '기준', 'N', '단위', '착수', '보내는 일', '확인 필요', '근거', ''].map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const rows = draft.filter((r) => r.project === g)
              let lastType: string | null = null
              return [
                <tr key={'g' + g} className={s.groupRow}>
                  <td colSpan={12}>
                    <span className={s.groupIn}>
                      <span>{g === '*' ? '전체 과제 공통' : projShort(projects, g)}</span>
                      <Button size="sm" onClick={() => addIn(g)}>
                        + 규칙 추가
                      </Button>
                      <Button size="sm" variant="solid" onClick={() => saveNow(g)}>
                        규칙 저장
                      </Button>
                      <Sub>{msg?.proj === g ? msg.text : ''}</Sub>
                    </span>
                  </td>
                </tr>,
                !rows.length && (
                  <tr key={'e' + g} className={s.subRow}>
                    <td colSpan={12}>이 과제만의 규칙은 아직 없습니다 (전체 과제 공통 규칙이 적용됩니다)</td>
                  </tr>
                ),
                ...rows.flatMap((r) => {
                  const head =
                    r.type !== lastType ? (
                      <tr key={'t' + g + r.type + r.id} className={s.subRow}>
                        <td colSpan={12}>{r.type === '*' ? '모든 방문' : TYPE_LABEL[r.type] || r.type}</td>
                      </tr>
                    ) : null
                  lastType = r.type
                  const keyOptions = KEYS.some((k) => k[0] === (r.key || '')) ? KEYS : [...KEYS, [r.key, r.key] as [string, string]]
                  return [
                    head,
                    <tr key={r.id} data-rid={r.id}>
                      <td><Select size="sm" options={projOptions} value={r.project} onChange={(v) => upd(r.id, { project: v }, true)} /></td>
                      <td><Select size="sm" options={typeOptions} value={r.type} onChange={(v) => upd(r.id, { type: v }, true)} /></td>
                      <td><Select size="sm" options={keyOptions} value={r.key || ''} onChange={(v) => upd(r.id, { key: v })} /></td>
                      <td style={{ minWidth: 240 }}><Input size="sm" value={r.title} onChange={(e) => upd(r.id, { title: e.target.value })} /></td>
                      <td><Select size="sm" options={DIR_OPTIONS} value={r.dir} onChange={(v) => upd(r.id, { dir: v as Rule['dir'] })} /></td>
                      <td><Input size="sm" type="number" min={0} value={r.n} onChange={(e) => upd(r.id, { n: Math.max(0, parseInt(e.target.value || '0', 10)) })} /></td>
                      <td><Select size="sm" options={UNIT_OPTIONS} value={r.unit} onChange={(v) => upd(r.id, { unit: v as Rule['unit'] })} /></td>
                      <td className={s.nowrap}>
                        <Select size="sm" options={START_OPTIONS} value={r.start} onChange={(v) => upd(r.id, { start: v as NormRule['start'] })} />{' '}
                        {r.start === 'lead' && (
                          <Input size="sm" type="number" min={0} style={{ width: 52 }} value={r.startN} onChange={(e) => upd(r.id, { startN: Math.max(0, parseInt(e.target.value || '0', 10)) })} />
                        )}
                      </td>
                      <td><input type="checkbox" checked={!!r.send} onChange={(e) => upd(r.id, { send: e.target.checked })} aria-label="보내는 일" /></td>
                      <td><input type="checkbox" checked={!!r.verify} onChange={(e) => upd(r.id, { verify: e.target.checked })} aria-label="확인 필요" /></td>
                      <td style={{ minWidth: 200 }}><Input size="sm" value={r.basis || ''} onChange={(e) => upd(r.id, { basis: e.target.value })} /></td>
                      <td>
                        <Button size="sm" variant="ghost" onClick={() => setDraft((d) => d.filter((x) => x.id !== r.id))}>
                          삭제
                        </Button>
                      </td>
                    </tr>,
                  ]
                }),
              ]
            })}
          </tbody>
        </table>
      </div>
      <Help>할 일 이름에 {'{site}'} 기관, {'{type}'} 방문 종류, {'{proj}'} 과제 약칭을 넣을 수 있습니다.</Help>
    </div>
  )
}

/* ---------- 공휴일 ---------- */

function HolidaysSection() {
  const toText = () => {
    const h = getState().holidays
    return Object.keys(h).sort().map((k) => k + ' ' + h[k]).join('\n')
  }
  const [text, setText] = useState(toText)
  const [msg, setMsg] = useState('')
  return (
    <div className={s.section}>
      <SectionHeader title="공휴일">
        <Button
          size="sm"
          variant="solid"
          onClick={async () => {
            const n = await saveHolidays(text)
            setText(toText())
            setMsg('저장했습니다 (' + n + '일). 기존 외근의 미완료 자동 할 일 기한도 다시 계산했습니다.')
          }}
        >
          공휴일 저장
        </Button>
        <Sub>{msg}</Sub>
      </SectionHeader>
      <Help>한 줄에 하나씩 "YYYY-MM-DD 이름" 형식입니다. 회사 휴무일(예: 국군의날)을 쉬는 날로 셀 거라면 여기에 추가하세요.</Help>
      <Textarea className={s.holidays} value={text} onChange={(e) => setText(e.target.value)} aria-label="공휴일 목록" />
    </div>
  )
}

/* ---------- 데이터 가져오기·내보내기 ---------- */

function TransferSection() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ name: string; snap: ReturnType<typeof parseExport> } | null>(null)
  const [msg, setMsg] = useState('')

  const pick = async (file: File) => {
    try {
      const snap = parseExport(JSON.parse(await file.text()))
      setPending({ name: file.name, snap })
      setMsg('')
    } catch (e) {
      setMsg('가져오지 못했습니다: ' + (e instanceof Error ? e.message : String(e)))
    }
  }
  const download = () => {
    const blob = new Blob([JSON.stringify(toExport(getState()), null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'todo-' + new Date().toISOString().slice(0, 10) + '.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className={s.section}>
      <SectionHeader title="데이터 가져오기·내보내기" />
      <Help>
        내보낸 JSON 파일(protocol-data.json 형식)을 가져오면 지금 데이터를 모두 바꿉니다. 지금은 이 브라우저에만 저장되니, 가져오기 전에 필요하면 먼저 내보내 두세요.
      </Help>
      <div className={s.transfer}>
        {pending ? (
          <ConfirmLine
            message={`${pending.name}: 일정 ${pending.snap.events.length} · 할 일 ${pending.snap.todos.length} · FUL ${pending.snap.fuls.length}건으로 지금 데이터를 모두 바꿀까요?`}
            confirmLabel="가져오기"
            onConfirm={async () => {
              const p = pending
              setPending(null)
              await replaceAll(p.snap)
              setMsg('가져왔습니다. 자동 할 일도 규칙에 맞춰 확인했습니다.')
            }}
            onCancel={() => setPending(null)}
          />
        ) : (
          <>
            <Button onClick={() => fileRef.current?.click()}>JSON 가져오기</Button>
            <Button onClick={download}>내보내기</Button>
          </>
        )}
        <Sub>{msg}</Sub>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) pick(f)
          }}
        />
      </div>
    </div>
  )
}

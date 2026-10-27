import { useRef, useState, type FormEvent } from 'react'
import { BUILTIN_ALIASES, KEYS, TYPES, TYPE_LABEL } from '@/domain/constants.ts'
import { projShort } from '@/domain/project.ts'
import { normRule } from '@/domain/rules.ts'
import { Button } from '@/components/ui/Button.tsx'
import { Input, Select, Textarea } from '@/components/ui/Field.tsx'
import { ConfirmLine, Help, SectionHeader, Sub, ViewHeader } from '@/components/ui/Layout.tsx'
import { cx } from '@/lib/cx.ts'
import { newId } from '@/store/repository.ts'
import {
  flushWrites, replaceAll, saveCompanions, saveHolidays, saveProjects, saveRules, type ProjectDraft,
} from '@/store/actions.ts'
import { getState } from '@/store/store.ts'
import { parseExport, toExport } from '@/store/transfer.ts'
import { supabase } from '@/store/supabase/client.ts'
import { useApp } from '@/store/ui.ts'
import { changePassword, signOut, useAuth } from '../auth/auth.ts'
import type { NormRule, Rule } from '@/types/domain.ts'
import { ClaudeSection } from './ClaudeSection.tsx'
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
      {supabase && <ClaudeSection client={supabase} />}
      {supabase && <AccountSection />}
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
        약칭을 비우면 과제 이름을 그대로 씁니다. 담당 기관은 외근 등록·FUL 메모의 기관 목록에 나옵니다. 자동 인식 단어가 할 일 제목에 들어 있으면 그 과제로 분류합니다. 과제 이름을 바꾸면 그 과제의 외근·할 일·규칙도 같이 바뀝니다.
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
        할 일 제목에 키워드가 들어가면 오른쪽 할 일들이 같은 마감일로 함께 생깁니다. 과제를 "전체"로 두면 모든 과제에 적용됩니다.
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
        외근을 등록하면 아래 규칙대로 할 일이 생깁니다. 같은 항목에 규칙이 여럿이면 과제·방문 종류를 지정한 규칙이 "전체" 규칙보다 우선합니다.
      </Help>
      <ul className={s.helpList}>
        <li><strong>항목</strong>"기타"는 다른 규칙을 덮어쓰지 않고 따로 생깁니다. "이 과제·방문은 자동 할 일 없음"을 고르면 그 외근에는 할 일이 생기지 않습니다.</li>
        <li><strong>할 일 이름</strong>{'{site}'}는 기관, {'{type}'}은 방문 종류, {'{proj}'}는 과제 약칭으로 바뀝니다.</li>
        <li><strong>단위</strong>WD는 영업일(방문 다음 영업일이 WD1), CD는 달력 날짜(그날이 휴일이면 직전 영업일), 외근 등록일 기준은 외근을 등록한 날부터 N영업일 뒤입니다.</li>
        <li><strong>보내는 일</strong>체크하면 마감을 한 영업일 앞당깁니다.</li>
        <li><strong>확인 필요</strong>PMP 원문으로 확인하지 못한 기한이면 체크하세요. 할 일에 "규칙 확인 필요"가 붙습니다.</li>
        <li><strong>근거</strong>PMP 조항처럼 기한을 정한 출처를 적으면 할 일의 기한 근거에 같이 나옵니다.</li>
        <li><strong>하위 항목</strong>쉼표로 나눠 적으면 그 할 일에 체크리스트로 붙습니다.</li>
      </ul>
      <div className={s.scroll}>
        {/* 규칙 하나를 두 줄로: 위는 무엇을, 아래는 언제·어떻게 (넓은 표가 화면 밖으로 잘리지 않게) */}
        <table className={s.table} style={{ minWidth: 720 }}>
          <thead>
            <tr>
              {['과제', '방문 종류', '항목', '할 일 이름', ''].map((h, i) => (
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
                  <td colSpan={5}>
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
                    <td colSpan={5}>이 과제만의 규칙은 아직 없습니다 (전체 과제 공통 규칙이 적용됩니다)</td>
                  </tr>
                ),
                ...rows.flatMap((r) => {
                  const head =
                    r.type !== lastType ? (
                      <tr key={'t' + g + r.type + r.id} className={s.subRow}>
                        <td colSpan={5}>{r.type === '*' ? '모든 방문' : TYPE_LABEL[r.type] || r.type}</td>
                      </tr>
                    ) : null
                  lastType = r.type
                  const keyOptions = KEYS.some((k) => k[0] === (r.key || '')) ? KEYS : [...KEYS, [r.key, r.key] as [string, string]]
                  return [
                    head,
                    <tr key={r.id} data-rid={r.id} className={s.ruleTop}>
                      <td><Select size="sm" options={projOptions} value={r.project} onChange={(v) => upd(r.id, { project: v }, true)} aria-label="과제" /></td>
                      <td><Select size="sm" options={typeOptions} value={r.type} onChange={(v) => upd(r.id, { type: v }, true)} aria-label="방문 종류" /></td>
                      <td><Select size="sm" options={keyOptions} value={r.key || ''} onChange={(v) => upd(r.id, { key: v })} aria-label="항목" /></td>
                      <td style={{ width: '100%' }}><Input size="sm" value={r.title} onChange={(e) => upd(r.id, { title: e.target.value })} aria-label="할 일 이름" /></td>
                      <td>
                        <Button size="sm" variant="ghost" onClick={() => setDraft((d) => d.filter((x) => x.id !== r.id))}>
                          삭제
                        </Button>
                      </td>
                    </tr>,
                    <tr key={r.id + '-when'}>
                      <td colSpan={5}>
                        <div className={s.ruleWhen}>
                          <span className={s.ruleField}>
                            마감
                            <Select size="sm" options={DIR_OPTIONS} value={r.dir} onChange={(v) => upd(r.id, { dir: v as Rule['dir'] })} aria-label="기준" />
                            <Input size="sm" type="number" min={0} value={r.n} onChange={(e) => upd(r.id, { n: Math.max(0, parseInt(e.target.value || '0', 10)) })} aria-label="N" />
                            <Select size="sm" options={UNIT_OPTIONS} value={r.unit} onChange={(v) => upd(r.id, { unit: v as Rule['unit'] })} aria-label="단위" />
                          </span>
                          <span className={s.ruleField}>
                            착수
                            <Select size="sm" options={START_OPTIONS} value={r.start} onChange={(v) => upd(r.id, { start: v as NormRule['start'] })} aria-label="착수" />
                            {/* 다른 착수 방식이어도 자리는 남겨 아래위 줄이 어긋나지 않게 */}
                            <Input size="sm" type="number" min={0} style={{ width: 52, visibility: r.start === 'lead' ? undefined : 'hidden' }} value={r.startN} onChange={(e) => upd(r.id, { startN: Math.max(0, parseInt(e.target.value || '0', 10)) })} aria-label="착수 N영업일 전" />
                          </span>
                          <label className={s.ruleField}>
                            <input type="checkbox" checked={!!r.send} onChange={(e) => upd(r.id, { send: e.target.checked })} />
                            보내는 일
                          </label>
                          <label className={s.ruleField}>
                            <input type="checkbox" checked={!!r.verify} onChange={(e) => upd(r.id, { verify: e.target.checked })} />
                            확인 필요
                          </label>
                          <span className={cx(s.ruleField, s.ruleBasis)}>
                            근거
                            <Input size="sm" value={r.basis || ''} onChange={(e) => upd(r.id, { basis: e.target.value })} placeholder="선택" aria-label="근거" title={r.basis || undefined} />
                          </span>
                          {/* 쓰는 그대로 두고(쉼표 뒤 빈칸 포함) 할 일을 만들 때 다듬는다 */}
                          <span className={cx(s.ruleField, s.ruleBasis)}>
                            하위 항목
                            <Input
                              size="sm"
                              value={(r.subs || []).join(',')}
                              onChange={(e) => upd(r.id, { subs: e.target.value ? e.target.value.split(',') : undefined })}
                              placeholder="쉼표로 구분 (선택)"
                              aria-label="하위 항목"
                              title={r.subs?.join(', ') || undefined}
                            />
                          </span>
                        </div>
                      </td>
                    </tr>,
                  ]
                }),
              ]
            })}
          </tbody>
        </table>
      </div>
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
      <Help>한 줄에 하나씩 "YYYY-MM-DD 이름" 형식으로 적습니다. 여기 적힌 날은 영업일에서 빠지니, 회사 휴무일(예: 국군의날)도 쉬는 날로 셀 거면 추가하세요.</Help>
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
      <Help>가져오면 지금 데이터가 모두 파일 내용으로 바뀝니다. 필요하면 먼저 내보내 두세요.</Help>
      <div className={s.transfer}>
        {pending ? (
          <ConfirmLine
            message={`${pending.name}: 일정 ${pending.snap.events.length} · 할 일 ${pending.snap.todos.length} · FUL ${pending.snap.fuls.length}건으로 지금 데이터를 모두 바꿀까요?`}
            confirmLabel="가져오기"
            onConfirm={async () => {
              const p = pending
              setPending(null)
              setMsg('가져오는 중…')
              try {
                await replaceAll(p.snap)
                setMsg('가져왔습니다. 자동 할 일도 규칙에 맞춰 확인했습니다.')
              } catch (e) {
                setMsg('가져오지 못했습니다: ' + (e instanceof Error ? e.message : String(e)))
              }
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

/* ---------- 계정 (Supabase 에 저장할 때만) ---------- */

function AccountSection() {
  const email = useAuth((a) => a.email)
  const pending = useApp((st) => st.sync.pending)
  const [busy, setBusy] = useState(false)
  return (
    <div className={s.section}>
      <SectionHeader title="계정" />
      <div className={s.transfer}>
        <Sub>{email} 로 로그인 · Supabase 에 저장{pending ? ' · 보낼 변경 ' + pending + '건' : ''}</Sub>
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await flushWrites()
            await signOut()
          }}
        >
          로그아웃
        </Button>
      </div>
      <PasswordForm email={email} />
    </div>
  )
}

function PasswordForm({ email }: { email: string }) {
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password !== again) return setMsg('두 비밀번호가 다릅니다.')
    setBusy(true)
    try {
      await changePassword(password)
      setPassword('')
      setAgain('')
      setMsg('비밀번호를 바꿨습니다.')
    } catch (err) {
      setMsg('바꾸지 못했습니다: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={cx(s.transfer, s.password)} onSubmit={submit}>
      {/* 비밀번호 관리자가 어느 계정의 비밀번호인지 알게 한다 */}
      <input type="email" autoComplete="username" value={email} readOnly hidden />
      <Input size="sm" type="password" autoComplete="new-password" placeholder="새 비밀번호 (8자 이상)" aria-label="새 비밀번호" value={password} onChange={(e) => setPassword(e.target.value)} />
      <Input size="sm" type="password" autoComplete="new-password" placeholder="새 비밀번호 확인" aria-label="새 비밀번호 확인" value={again} onChange={(e) => setAgain(e.target.value)} />
      <Button size="sm" type="submit" disabled={busy || !password}>
        비밀번호 바꾸기
      </Button>
      {msg && <Sub>{msg}</Sub>}
    </form>
  )
}

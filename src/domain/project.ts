import type { Project } from '../types/domain.ts'
import { BRZ, BUILTIN_ALIASES } from './constants.ts'

export const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** "014. 전남대병원(PI 홍길동)" → "전남대병원" (제목·칩에 쓰는 기관 이름) */
export const siteShort = (x?: string | null) =>
  String(x || '')
    .replace(/^\s*(\(X\))?\s*\d+\s*\.?\s*/, '')
    .replace(/\s*\(\s*PI[^)]*\)\s*$/, '')
    .trim() || String(x || '')

/** 캘린더 칩용 더 짧은 이름: "전남대병원" → "전남대" */
export const chipSite = (x?: string | null) => {
  const s0 = siteShort(x)
  return s0.replace(/(대학교병원|대학병원|기독병원|여성병원|병원|의원)$/, '') || s0
}

/** 기관 비교용 핵심 이름 (공백·"병원"·"의원" 제거). 엔플론시아 SIV 준비 연결은 원본대로 이 형태로 비교한다 */
export const siteCoreRaw = (x?: string | null) =>
  siteShort(x).replace(/\s+/g, '').replace(/(대학교|대학)?(부속)?병원$|의원$/, '')

/** 기관 비교용 핵심 이름 ("대학교" → "대" 까지 줄임) */
export const siteCore = (x?: string | null) => siteCoreRaw(x).replace(/대학교/, '대')

/** 두 기관 이름이 같은 기관을 가리키는가 (한쪽이 다른 쪽을 포함) */
export const sameSite = (a: string, b: string) => !!a && !!b && (a.includes(b) || b.includes(a))

export const projShort = (projects: Project[], name?: string) =>
  (projects.find((p) => p.name === name) ?? { short: name || '' }).short

/** 편집 거리. 길이가 2 넘게 차이 나면 계산하지 않고 9 */
export function lev(a: string, b: string) {
  const m = a.length
  const n = b.length
  if (Math.abs(m - n) > 2) return 9
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i])
  for (let j = 1; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[m][n]
}

/** 과제를 알아보는 단어: 과제 이름, 약칭, 기본 단어, 설정의 단어 */
const projectKeys = (p: Project) => [p.name, p.short, ...(BUILTIN_ALIASES[p.name] || []), ...(p.aliases || [])]

/** 할 일 제목에서 과제를 찾는다. 영문 5자 이상은 오타(편집 거리 1~2)도 허용 */
export function detectProject(projects: Project[], title?: string) {
  const norm = String(title || '').toLowerCase().replace(/\s+/g, '')
  const words = String(title || '').toLowerCase().match(/[a-z]{5,}/g) || []
  for (const p of projects) {
    if (p.name === '기타') continue
    const keys = projectKeys(p)
      .map((k) => String(k || '').toLowerCase().replace(/\s+/g, ''))
      .filter((k) => k.length >= 2)
    if (keys.some((k) => norm.includes(k))) return p.name
    if (words.some((w) => keys.some((k) => /^[a-z]{5,}$/.test(k) && lev(w, k) <= (k.length >= 7 ? 2 : 1))))
      return p.name
  }
  return ''
}

/** 제목에서 과제를 가리키는 단어를 지운다 (긴 단어부터) */
export function stripProj(projects: Project[], title: string, name: string) {
  const proj = projects.find((p) => p.name === name)
  let rest = ' ' + title + ' '
  const keys = [proj?.name, proj?.short, ...(BUILTIN_ALIASES[name] || []), ...(proj?.aliases || []), name === BRZ ? 'bresztri' : '']
    .filter(Boolean)
    .map(String)
    .sort((a, b) => b.length - a.length)
  for (const k of keys) rest = rest.replace(new RegExp(escapeRegExp(k), 'ig'), ' ')
  return rest
}

/** 결정적 문서 id 에 쓸 수 없는 문자를 _ 로 */
export const safeId = (s: string) => s.replace(/[^A-Za-z0-9_\-.~:@+]/g, '_')

import { escapeRegExp } from '@/domain/project.ts'

/** 검색어와 맞는 부분을 <mark> 로 */
export function Highlight({ text, words }: { text: string; words?: string[] }) {
  const t = String(text || '')
  if (!words?.length) return t
  const re = new RegExp('(' + words.map(escapeRegExp).join('|') + ')', 'ig')
  return t.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))
}

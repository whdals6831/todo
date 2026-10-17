import type { CalEvent, Ful } from '../types/domain.ts'
import { kindOf } from './constants.ts'
import { sameSite, siteCore } from './project.ts'

/** FUL 메모가 이 외근에서 챙길 일인가: 같은 과제 · 같은 기관 · (지정했다면) 같은 방문 종류 */
export const fulMatch = (f: Ful, ev: CalEvent) =>
  kindOf(ev) === 'visit' &&
  f.project === ev.project &&
  (!f.type || f.type === '*' || f.type === ev.type) &&
  sameSite(siteCore(f.site), siteCore(ev.site))

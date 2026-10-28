import { localHM } from '@/domain/date.ts'
import { cx } from '@/lib/cx.ts'
import { useUi } from '@/store/ui.ts'
import s from './Sidebar.module.css'

/** 퇴근 차 시간: [출발, 동탄 도착] */
const BUS: [string, string][] = [
  ['17:15', '18:31'], ['17:33', '18:49'], ['17:47', '19:03'], ['17:56', '19:12'], ['18:33', '19:49'],
  ['18:51', '20:07'], ['19:09', '20:25'], ['19:24', '20:40'], ['19:40', '20:56'], ['19:55', '21:11'],
  ['20:17', '21:33'], ['20:37', '21:53'], ['20:55', '22:11'], ['21:13', '22:29'], ['21:35', '22:51'],
]

/** Claude 열기 아래 퇴근 시간표. 지난 차는 흐리게, 다음 차는 굵게 (좁은 화면에서는 다음 차만) */
export function Commute() {
  const nowMs = useUi((u) => u.now)
  const hm = localHM(new Date(nowMs).toISOString())
  const next = BUS.findIndex(([go]) => go >= hm)
  return (
    <div className={s.bus}>
      <div className={s.busHead}>
        {/* 이모지(빨간 하트)가 아니라 글자로 */}
        <span className={s.heart} aria-hidden="true">
          {'♥︎'}
        </span>
        퇴근 → 동탄
      </div>
      <ol>
        {BUS.map(([go, at], i) => (
          <li key={go} className={cx((next < 0 || i < next) && s.busPast, i === next && s.busNext)}>
            {go + ' → ' + at}
          </li>
        ))}
      </ol>
    </div>
  )
}

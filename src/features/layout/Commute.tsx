import { useEffect, useRef } from 'react'
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

/**
 * Claude 열기 아래 검정 하트와 퇴근 시간표 (검정 상자에 한 줄씩). 지난 차는 흐리게, 다음 차는 굵게.
 * 사이드바 자리가 모자라면 상자 안에서 스크롤되고, 다음 차가 맨 위에 오게 맞춘다 (좁은 화면에서는 다음 차만)
 */
export function Commute() {
  const nowMs = useUi((u) => u.now)
  const hm = localHM(new Date(nowMs).toISOString())
  const next = BUS.findIndex(([go]) => go >= hm)
  const box = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    /* 상자 크기가 정해진 뒤에도(화면 크기 변경 등) 다시 맞춘다 */
    const toNext = () => {
      const li = el.children[next] as HTMLElement | undefined
      if (li) el.scrollTop = li.offsetTop - el.offsetTop - parseFloat(getComputedStyle(el).paddingTop)
    }
    toNext()
    const ro = new ResizeObserver(toNext)
    ro.observe(el)
    return () => ro.disconnect()
  }, [next])
  return (
    <div className={s.bus}>
      {/* 이모지(빨간 하트)가 아니라 글자로 */}
      <span className={s.heart} aria-label="퇴근 시간표">
        {'♥︎'}
      </span>
      <ol ref={box}>
        {BUS.map(([go, at], i) => (
          <li key={go} className={cx((next < 0 || i < next) && s.busPast, i === next && s.busNext)}>
            {go + ' → ' + at}
          </li>
        ))}
      </ol>
    </div>
  )
}

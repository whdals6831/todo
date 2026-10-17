import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '@/lib/cx.ts'
import s from './Popover.module.css'

interface Props {
  anchor: DOMRect
  onClose: () => void
  children: ReactNode
  /**
   * end: 기준 요소 아래, 오른쪽 끝을 맞춘다 (문서와 함께 스크롤)
   * start-fixed: 기준 요소 아래 왼쪽, 화면에 고정 — 스크롤하면 닫는다
   */
  placement?: 'end' | 'start-fixed'
  /** 이 요소를 누를 때는 닫지 않는다 (다른 팝오버를 여는 버튼 등) */
  keepOpenOn?: (target: Element) => boolean
  role?: 'dialog' | 'menu'
  label: string
  className?: string
}

const GAP = 8

export function Popover({ anchor, onClose, children, placement = 'end', keepOpenOn, role = 'dialog', label, className }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const close = useRef(onClose)
  useLayoutEffect(() => {
    close.current = onClose
  })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    if (placement === 'end') {
      const vw = document.documentElement.clientWidth
      setPos({
        top: window.scrollY + anchor.bottom + 6,
        left: Math.max(GAP, Math.min(window.scrollX + anchor.right - w, window.scrollX + vw - w - GAP)),
      })
    } else {
      let x = anchor.left
      let y = anchor.bottom + 4
      if (x + w > innerWidth - GAP) x = innerWidth - GAP - w
      if (y + h > innerHeight - GAP) y = anchor.top - h - 4
      setPos({ left: Math.max(GAP, x), top: Math.max(GAP, y) })
    }
  }, [anchor, placement])

  useEffect(() => {
    const outside = (e: Event) => {
      const t = e.target as Element
      if (ref.current?.contains(t) || keepOpenOn?.(t)) return
      close.current()
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current()
    }
    const scroll = () => close.current()
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', esc)
    if (placement === 'start-fixed') {
      window.addEventListener('scroll', scroll, { passive: true })
      document.addEventListener('focusin', outside)
    }
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', esc)
      window.removeEventListener('scroll', scroll)
      document.removeEventListener('focusin', outside)
    }
  }, [placement, keepOpenOn])

  /* 처음 위치가 정해지면 첫 입력·버튼에 포커스 */
  const focused = useRef(false)
  useEffect(() => {
    if (!pos || focused.current) return
    focused.current = true
    ref.current?.querySelector<HTMLElement>('input,button')?.focus({ preventScroll: true })
  }, [pos])

  return createPortal(
    <div
      ref={ref}
      role={role}
      aria-label={label}
      className={cx(s.pop, placement === 'start-fixed' && s.fixed, className)}
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  )
}

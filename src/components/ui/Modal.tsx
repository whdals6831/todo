import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { IconButton } from './Button.tsx'
import s from './Modal.module.css'

interface Props {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  /** 열릴 때 포커스할 요소를 고르는 선택자 (기본: 첫 입력창) */
  initialFocus?: string
}

/**
 * 모달 대화상자. 네이티브 <dialog> 의 showModal 을 써서 포커스가 바깥으로 나가지 않고 Esc 로 닫힌다.
 * 바깥(배경)을 누르면 닫는다.
 */
export function Modal({ title, onClose, children, initialFocus = 'input:not([type=checkbox]),select,textarea' }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const close = useRef(onClose)
  useLayoutEffect(() => {
    close.current = onClose
  })

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (!d.open) d.showModal()
    const f = d.querySelector<HTMLElement>(initialFocus)
    f?.focus()
    const onCancel = (e: Event) => {
      e.preventDefault()
      close.current()
    }
    d.addEventListener('cancel', onCancel)
    return () => d.removeEventListener('cancel', onCancel)
  }, [initialFocus])

  return (
    <dialog
      ref={ref}
      className={s.dialog}
      aria-label={typeof title === 'string' ? title : undefined}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={s.inner}>
        <div className={s.head}>
          <h3>{title}</h3>
          <IconButton variant="close" label="닫기" title="닫기 (Esc)" onClick={onClose}>
            ×
          </IconButton>
        </div>
        {children}
      </div>
    </dialog>
  )
}

export function ModalFoot({ children }: { children: ReactNode }) {
  return <div className={s.foot}>{children}</div>
}

import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from '@/lib/cx.ts'
import { toggleFold, useUi } from '@/store/ui.ts'
import { Button } from './Button.tsx'
import s from './Layout.module.css'

/** 화면 제목 (아래 굵은 선). end 는 오른쪽 끝에 붙는다 */
export function ViewHeader({ title, children, end, className }: { title: ReactNode; children?: ReactNode; end?: ReactNode; className?: string }) {
  return (
    <div className={cx(s.viewHead, className)}>
      <h2>{title}</h2>
      {children}
      {end != null && <span className={s.viewHeadEnd}>{end}</span>}
    </div>
  )
}

export function SectionHeader({ title, children, className }: { title: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cx(s.secHead, className)}>
      <h2>{title}</h2>
      {children}
    </div>
  )
}

interface GroupProps {
  title: ReactNode
  count?: ReactNode
  /** 지연: 제목을 빨강으로 */
  over?: boolean
  /** 제목 줄 오른쪽에 붙는 것 */
  extra?: ReactNode
  /** 제목 아래 안내 */
  hint?: ReactNode
  children: ReactNode
}

/** 제목과 개수가 있는 묶음 */
export function Group({ title, count, over, extra, hint, children }: GroupProps) {
  return (
    <div className={cx(s.group, over && s.over)}>
      <div className={s.groupHead}>
        <strong>{title}</strong>
        {count != null && <span className={s.count}>{count}</span>}
        {extra}
      </div>
      {hint && <div className={cx(s.sub, s.groupHint)}>{hint}</div>}
      {children}
    </div>
  )
}

/** 접히는 묶음. 다시 그려도 열림 상태를 기억한다 */
export function Fold({ id, label, className, children }: { id: string; label: ReactNode; className?: string; children: ReactNode }) {
  const open = useUi((u) => u.foldOpen.has(id))
  return (
    <details className={cx(s.fold, className)} open={open} onToggle={(e) => toggleFold(id, e.currentTarget.open)}>
      <summary>{label}</summary>
      {open && children}
    </details>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className={s.empty}>{children}</div>
}

export const Sub = ({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) => <span className={cx(s.sub, className)} {...rest} />
export const Label = ({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) => <span className={cx(s.label, className)} {...rest} />
export const Help = ({ className, ...rest }: HTMLAttributes<HTMLParagraphElement>) => <p className={cx(s.help, className)} {...rest} />

/** "삭제할까요? [삭제] [취소]" */
export function ConfirmLine({ message, confirmLabel = '삭제', onConfirm, onCancel }: { message: ReactNode; confirmLabel?: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <span className={s.confirm}>
      {message}
      <Button size="sm" variant="solid" onClick={(e) => { e.stopPropagation(); onConfirm() }}>
        {confirmLabel}
      </Button>
      <Button size="sm" onClick={(e) => { e.stopPropagation(); onCancel() }}>
        취소
      </Button>
    </span>
  )
}

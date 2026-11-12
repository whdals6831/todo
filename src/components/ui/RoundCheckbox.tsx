import { cx } from '@/lib/cx.ts'
import s from './RoundCheckbox.module.css'

interface Props {
  checked: boolean
  onToggle: () => void
  label: string
  tone?: 'default' | 'danger' | 'late'
  /** 눌러도 바뀌지 않는 체크 (저절로 끝낸 것) */
  disabled?: boolean
  title?: string
}

/** 동그란 완료 체크 */
export function RoundCheckbox({ checked, onToggle, label, tone = 'default', disabled, title }: Props) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      className={cx(s.box, tone === 'danger' && !checked && s.danger, tone === 'late' && !checked && s.late)}
      onClick={onToggle}
    />
  )
}

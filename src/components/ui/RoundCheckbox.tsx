import { cx } from '@/lib/cx.ts'
import s from './RoundCheckbox.module.css'

interface Props {
  checked: boolean
  onToggle: () => void
  label: string
  tone?: 'default' | 'danger'
}

/** 동그란 완료 체크 */
export function RoundCheckbox({ checked, onToggle, label, tone = 'default' }: Props) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      className={cx(s.box, tone === 'danger' && !checked && s.danger)}
      onClick={onToggle}
    />
  )
}

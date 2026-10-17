import { cx } from '@/lib/cx.ts'
import s from './SegmentedControl.module.css'

interface Props<T extends string> {
  options: readonly (readonly [T, string])[]
  value: T
  onChange: (v: T) => void
  label: string
  size?: 'sm' | 'lg'
  /** 탭으로 쓰면 tablist (aria-selected) */
  tabs?: boolean
  className?: string
}

/** 여럿 중 하나를 고르는 알약 묶음 */
export function SegmentedControl<T extends string>({ options, value, onChange, label, size = 'sm', tabs, className }: Props<T>) {
  return (
    <div className={cx(s.seg, size === 'lg' && s.lg, className)} role={tabs ? 'tablist' : 'group'} aria-label={label}>
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          role={tabs ? 'tab' : undefined}
          aria-selected={tabs ? v === value : undefined}
          aria-pressed={tabs ? undefined : v === value}
          onClick={() => onChange(v)}
        >
          {l}
        </button>
      ))}
    </div>
  )
}

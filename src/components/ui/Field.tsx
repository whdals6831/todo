import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cx } from '@/lib/cx.ts'
import s from './Field.module.css'

type Size = 'md' | 'sm'

export const Input = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & { size?: Size }>(
  function Input({ size = 'md', className, type = 'text', ...rest }, ref) {
    return <input ref={ref} type={type} className={cx(s.control, size === 'sm' && s.sm, className)} {...rest} />
  },
)

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { size?: Size }>(
  function Textarea({ size = 'md', className, ...rest }, ref) {
    return <textarea ref={ref} className={cx(s.control, size === 'sm' && s.sm, className)} {...rest} />
  },
)

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size' | 'onChange'> {
  options: readonly (readonly [string, string])[]
  onChange: (v: string) => void
  size?: Size
}

export function Select({ options, onChange, size = 'md', className, ...rest }: SelectProps) {
  return (
    <select className={cx(s.control, size === 'sm' && s.sm, className)} onChange={(e) => onChange(e.target.value)} {...rest}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  )
}

/** 라벨 아래 입력 */
export function Field({ label, full, children, hidden }: { label: ReactNode; full?: boolean; children: ReactNode; hidden?: boolean }) {
  return (
    <label className={cx(s.field, full && s.full)} hidden={hidden}>
      {label}
      {children}
    </label>
  )
}

/** 체크박스와 글 한 줄 */
export function CheckField({ checked, onChange, children, full }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; full?: boolean }) {
  return (
    <label className={cx(s.check, full && s.full)}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  )
}

/** 두 칸 폼 */
export function FormGrid({ children }: { children: ReactNode }) {
  return <div className={s.form}>{children}</div>
}

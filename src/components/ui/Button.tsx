import type { ButtonHTMLAttributes } from 'react'
import { cx } from '@/lib/cx.ts'
import s from './Button.module.css'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'solid' | 'ghost'
  size?: 'md' | 'sm'
  /** 토글 버튼이면 눌림 상태 (aria-pressed) */
  pressed?: boolean
}

export function Button({ variant = 'default', size = 'md', pressed, className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      aria-pressed={pressed}
      className={cx(s.btn, variant !== 'default' && s[variant], size === 'sm' && s.sm, className)}
      {...rest}
    />
  )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant: 'nav' | 'close' | 'mini'
  /** 화면 낭독기용 이름 (아이콘만 있으므로 필수) */
  label: string
}

export function IconButton({ variant, label, className, type = 'button', title, ...rest }: IconButtonProps) {
  return <button type={type} aria-label={label} title={title ?? label} className={cx(s.icon, s[variant], className)} {...rest} />
}

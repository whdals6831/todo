import type { HTMLAttributes } from 'react'
import { cx } from '@/lib/cx.ts'
import s from './Tag.module.css'

interface Props extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'default' | 'warn' | 'danger'
}

/** 과제 약칭·일정 종류 같은 작은 꼬리표 */
export function Tag({ tone = 'default', className, ...rest }: Props) {
  return <span className={cx(s.tag, tone !== 'default' && s[tone], className)} {...rest} />
}

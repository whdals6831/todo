import { kindLabel, kindOf } from '@/domain/constants.ts'
import { md } from '@/domain/date.ts'
import { Button } from '@/components/ui/Button.tsx'
import { Sub } from '@/components/ui/Layout.tsx'
import { Tag } from '@/components/ui/Tag.tsx'
import type { CalEvent } from '@/types/domain.ts'
import s from './EventRow.module.css'
import { eventName, openEvent } from './openEvent.ts'

export function EventRow({ event: e }: { event: CalEvent }) {
  const k = kindOf(e)
  const range = e.endDate && e.endDate !== e.date ? md(e.date) + ' ~ ' + md(e.endDate) : ''
  return (
    <div className={s.row}>
      <span className={s.time}>{k === 'leave' ? '종일' : e.time || '--:--'}</span>
      <div className={s.body}>
        <div className={s.name}>
          <Tag>{kindLabel(k)}</Tag>
          {eventName(e)}
        </div>
        <Sub>{[range, e.project, e.memo].filter(Boolean).join(' · ')}</Sub>
      </div>
      <Button size="sm" onClick={() => openEvent(e)}>
        편집
      </Button>
    </div>
  )
}

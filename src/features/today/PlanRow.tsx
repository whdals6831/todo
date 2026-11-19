import { md } from '@/domain/date.ts'
import { isAuto, type PlanItem } from '@/domain/plan.ts'
import { Button } from '@/components/ui/Button.tsx'
import { pickDay } from '@/store/actions.ts'
import type { DateStr } from '@/types/domain.ts'

/** 오늘 화면에서 고른 일을 다시 빼는 단추 (마감이 오늘이거나 지난 일은 뺄 수 없어 단추가 없다) */
export function UnpickButton({ item, today }: { item: PlanItem; today: DateStr }) {
  if (isAuto(item, today)) return null
  return (
    <Button size="sm" variant="ghost" onClick={() => pickDay(item.todo.id, undefined, '')}>
      오늘에서 빼기
    </Button>
  )
}

/** 후보 목록의 단추: 오늘 할 일에 넣기 · 내일로(다음 영업일 next 로 미리 고르기) · 다른 날로 골라 둔 것 취소 */
export function PickButtons({ item: x, today, next }: { item: PlanItem; today: DateStr; next: DateStr }) {
  /* 다른 날(내일)로 골라 둔 일 */
  const later = x.today > today ? x.today : ''
  return (
    <>
      <Button size="sm" variant="ghost" title="오늘 할 일에 넣기" onClick={() => pickDay(x.todo.id, undefined, today)}>
        ＋ 오늘
      </Button>
      {later ? (
        <Button size="sm" variant="ghost" title={md(later) + '에 하기로 골라 둔 것을 취소'} onClick={() => pickDay(x.todo.id, undefined, '')}>
          {md(later) + ' 취소'}
        </Button>
      ) : (
        <Button size="sm" variant="ghost" title={md(next) + ' 할 일로 미리 고르기'} onClick={() => pickDay(x.todo.id, undefined, next)}>
          내일로
        </Button>
      )}
    </>
  )
}

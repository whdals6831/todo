import { Button } from '@/components/ui/Button.tsx'
import { Fold, Label, Sub } from '@/components/ui/Layout.tsx'
import { resetRanks } from '@/store/actions.ts'
import type { Todo } from '@/types/domain.ts'
import { TodoRow } from './TodoRow.tsx'

/** 끌어서 순서를 바꿀 수 있는 할 일 목록. field 는 캘린더 칸에 놓았을 때 옮길 날짜 */
export function ReorderList({ items, field = () => 'due' }: { items: Todo[]; field?: (t: Todo) => 'due' | 'start' }) {
  return (
    <div data-reorder>
      {items.map((t) => (
        <TodoRow key={t.id} todo={t} drag={field(t)} />
      ))}
    </div>
  )
}

const isEtmfUpload = (t: Todo) => /eTMF\s*업로드/i.test(t.title)

/** 열린 할 일 목록. eTMF 업로드는 맨 위에 접어 두고 눌러서 펼쳐 본다 (펼침 상태는 id 별로 기억) */
export function OpenList({ id, items, field }: { id: string; items: Todo[]; field?: (t: Todo) => 'due' | 'start' }) {
  const up = items.filter(isEtmfUpload)
  return (
    <>
      {up.length > 0 && (
        <Fold id={id + '-etmf'} label={'eTMF 업로드 ' + up.length}>
          <ReorderList items={up} field={field} />
        </Fold>
      )}
      <ReorderList items={items.filter((x) => !isEtmfUpload(x))} field={field} />
    </>
  )
}

/**
 * 정렬 상태 안내와 "마감순으로 되돌리기".
 * label 이 있으면 왼쪽에 "할 일 · 마감 임박순"으로, 없으면 묶음 제목 줄 오른쪽에 붙는다.
 */
export function RankInfo({ items, label }: { items: Todo[]; label?: string }) {
  const ranked = items.some((x) => x.rank != null)
  return (
    <>
      {label != null ? (
        <Label style={{ marginRight: 'auto' }}>{label + ' · ' + (ranked ? '내가 정한 순서' : '마감 임박순')}</Label>
      ) : (
        <Sub style={{ marginLeft: 'auto' }}>{ranked ? '내가 정한 순서' : '마감 임박순 · ⋮⋮를 끌어 순서 변경'}</Sub>
      )}
      {ranked && (
        <Button size="sm" variant="ghost" onClick={() => resetRanks(items)}>
          마감순으로 되돌리기
        </Button>
      )}
    </>
  )
}

/** 순서 없이 나열 */
export function PlainList({ items }: { items: Todo[] }) {
  return items.map((t) => <TodoRow key={t.id} todo={t} />)
}

/** 끝낸 할 일: 목록 맨 아래에 접어 두고 눌러서 펼쳐 본다 (펼침 상태는 id 별로 기억) */
export function DoneFold({ id, items }: { id: string; items: Todo[] }) {
  if (!items.length) return null
  return (
    <Fold id={id} label={'완료 ' + items.length}>
      <PlainList items={items} />
    </Fold>
  )
}

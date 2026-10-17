import { dayComplete } from '@/domain/daySets.ts'
import { appStore } from '@/store/store.ts'
import { setUi, ui } from '@/store/ui.ts'

/** 할 일이 바뀔 때마다 오늘이 "방금" 완료됐는지 본다 (불러오기 직후는 제외) */
export function watchCelebration() {
  let prev: boolean | null = null
  return appStore.subscribe((st) => {
    if (st.loading) {
      prev = null
      return
    }
    const c = dayComplete(ui().today, st.todos)
    if (prev === false && c) setUi({ celebrate: Date.now() })
    prev = c
  })
}

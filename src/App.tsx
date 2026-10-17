import { useEffect } from 'react'
import { AppShell } from '@/features/layout/AppShell.tsx'
import { watchCelebration } from '@/features/layout/celebration.ts'
import { bindShortcuts } from '@/features/layout/shortcuts.ts'
import { loadAll, setRepository } from '@/store/actions.ts'
import { createLocalRepository } from '@/store/localRepository.ts'
import { startClock } from '@/store/ui.ts'

/* 1차: 이 브라우저(localStorage)에 저장. 2차에서 Supabase 저장소로 바꾼다 */
setRepository(createLocalRepository())

export default function App() {
  useEffect(() => {
    const stops = [watchCelebration(), startClock(), bindShortcuts()]
    loadAll()
    return () => stops.forEach((f) => f())
  }, [])
  return <AppShell />
}

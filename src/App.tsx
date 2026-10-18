import { useEffect } from 'react'
import { AuthGate } from '@/features/auth/AuthGate.tsx'
import { watchAuth } from '@/features/auth/auth.ts'
import { AppShell } from '@/features/layout/AppShell.tsx'
import { watchCelebration } from '@/features/layout/celebration.ts'
import { watchConnectivity } from '@/features/layout/connectivity.ts'
import { bindShortcuts } from '@/features/layout/shortcuts.ts'
import { loadAll, setRepository } from '@/store/actions.ts'
import { createLocalRepository } from '@/store/localRepository.ts'
import { supabase } from '@/store/supabase/client.ts'
import { startClock } from '@/store/ui.ts'

/** .env.local 에 Supabase 설정이 있으면 로그인 후 Supabase 에, 없으면 이 브라우저에 저장한다 */
export default function App() {
  useEffect(() => {
    const stops = [watchCelebration(), startClock(), bindShortcuts(), watchConnectivity(), watchAuth()]
    return () => stops.forEach((f) => f())
  }, [])
  return supabase ? <AuthGate client={supabase} /> : <LocalApp />
}

function LocalApp() {
  useEffect(() => {
    setRepository(createLocalRepository())
    void loadAll()
  }, [])
  return <AppShell />
}

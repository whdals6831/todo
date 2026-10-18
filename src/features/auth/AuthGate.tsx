import { useEffect } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadAll, setRepository, stopSync } from '@/store/actions.ts'
import { createMemoryRepository } from '@/store/localRepository.ts'
import { resetState } from '@/store/store.ts'
import { createSupabaseRepository } from '@/store/supabase/supabaseRepository.ts'
import { AppShell } from '../layout/AppShell.tsx'
import { useAuth } from './auth.ts'
import { LoginView } from './LoginView.tsx'

/** 로그인해야 앱이 보인다. 사용자가 바뀌면 그 사람의 데이터로 다시 불러온다 */
export function AuthGate({ client }: { client: SupabaseClient }) {
  const status = useAuth((a) => a.status)
  const userId = useAuth((a) => a.userId)

  useEffect(() => {
    if (status === 'in' && userId) {
      setRepository(createSupabaseRepository(client, userId))
      resetState()
      void loadAll()
      return () => stopSync()
    }
    if (status === 'out') {
      /* 이전 사용자의 데이터가 화면에 남지 않게 비운다 */
      setRepository(createMemoryRepository())
      resetState()
    }
  }, [client, status, userId])

  if (status === 'checking') return null
  if (status === 'out') return <LoginView />
  return <AppShell />
}

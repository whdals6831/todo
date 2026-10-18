import { create } from 'zustand'
import { supabase } from '@/store/supabase/client.ts'

interface AuthState {
  /** checking: 저장된 로그인 확인 중 */
  status: 'checking' | 'out' | 'in'
  userId: string
  email: string
}

export const useAuth = create<AuthState>()(() => ({ status: 'checking', userId: '', email: '' }))

/** 로그인 상태를 따라간다 (처음 한 번은 저장된 세션으로 바로 알려 준다) */
export function watchAuth() {
  if (!supabase) return () => {}
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    const next: AuthState = session
      ? { status: 'in', userId: session.user.id, email: session.user.email ?? '' }
      : { status: 'out', userId: '', email: '' }
    const cur = useAuth.getState()
    /* 토큰 갱신처럼 사용자가 그대로면 다시 그리지 않는다 */
    if (cur.status !== next.status || cur.userId !== next.userId) useAuth.setState(next)
  })
  return () => data.subscription.unsubscribe()
}

/** 이메일·비밀번호로 로그인. 가입은 막혀 있어 등록된 계정만 들어온다 */
export async function signIn(email: string, password: string) {
  const { error } = await supabase!.auth.signInWithPassword({ email, password })
  if (error) throw error
}

/** 로그인한 계정의 비밀번호를 바꾼다 (최소 길이는 config.toml 의 minimum_password_length) */
export async function changePassword(password: string) {
  const { error } = await supabase!.auth.updateUser({ password })
  if (error) throw error
}

export async function signOut() {
  await supabase!.auth.signOut()
}

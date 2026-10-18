import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button.tsx'
import { Input } from '@/components/ui/Field.tsx'
import { cx } from '@/lib/cx.ts'
import { signIn } from './auth.ts'
import s from './Login.module.css'

const message = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e)
  if (/invalid login credentials/i.test(m)) return '이메일 또는 비밀번호가 맞지 않습니다.'
  if (/rate limit|too many/i.test(m)) return '잠시 후 다시 시도해 주세요. (' + m + ')'
  return m
}

/** 이메일·비밀번호 로그인. 로그인 메일을 보내지 않아 메일 발송 한도에 걸리지 않는다 */
export function LoginView() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    setBusy(true)
    setError('')
    try {
      await signIn(email.trim(), password)
    } catch (err) {
      setError(message(err))
      setBusy(false)
    }
  }

  return (
    <main className={s.wrap}>
      <div className={s.card}>
        <h1 className={s.brand}>
          To Do<span className={s.tagline}>CRA desk</span>
        </h1>
        <form className={s.form} onSubmit={submit}>
          <Input type="email" autoComplete="username" placeholder="이메일" aria-label="이메일" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input type="password" autoComplete="current-password" placeholder="비밀번호" aria-label="비밀번호" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button type="submit" variant="solid" disabled={busy}>
            로그인
          </Button>
        </form>
        {error && <p className={cx(s.msg, s.error)}>{error}</p>}
      </div>
    </main>
  )
}

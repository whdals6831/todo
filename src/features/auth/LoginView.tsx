import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button.tsx'
import { Input } from '@/components/ui/Field.tsx'
import { cx } from '@/lib/cx.ts'
import { sendLoginMail, verifyLoginCode } from './auth.ts'
import s from './Login.module.css'

const message = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e)
  if (/signups not allowed|user not found/i.test(m)) return '등록된 계정이 아닙니다. 이메일 주소를 확인해 주세요.'
  if (/rate limit|security purposes/i.test(m)) return '잠시 후 다시 시도해 주세요. (' + m + ')'
  if (/expired|invalid/i.test(m)) return '코드가 맞지 않거나 만료됐습니다.'
  return m
}

/** 이메일 로그인: 메일로 받은 링크를 누르거나 인증 코드를 입력한다 */
export function LoginView() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const send = async (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setBusy(true)
    setError('')
    try {
      await sendLoginMail(email.trim())
      setSent(true)
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }
  const verify = async (e: FormEvent) => {
    e.preventDefault()
    if (!code.trim()) return
    setBusy(true)
    setError('')
    try {
      await verifyLoginCode(email.trim(), code.trim())
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
        <form className={s.row} onSubmit={send}>
          <Input type="email" autoComplete="email" placeholder="이메일" aria-label="이메일" value={email} onChange={(e) => setEmail(e.target.value)} disabled={sent && busy} />
          <Button type="submit" variant={sent ? 'default' : 'solid'} disabled={busy}>
            {sent ? '다시 보내기' : '로그인 메일 받기'}
          </Button>
        </form>
        {sent && (
          <>
            <p className={s.msg}>{email} 로 로그인 메일을 보냈습니다. 메일의 링크를 이 브라우저에서 누르거나, 메일에 적힌 인증 코드를 입력하세요.</p>
            <form className={s.row} onSubmit={verify}>
              <Input inputMode="numeric" autoComplete="one-time-code" placeholder="인증 코드" aria-label="로그인 코드" value={code} onChange={(e) => setCode(e.target.value)} />
              <Button type="submit" variant="solid" disabled={busy}>
                확인
              </Button>
            </form>
          </>
        )}
        {error && <p className={cx(s.msg, s.error)}>{error}</p>}
      </div>
    </main>
  )
}

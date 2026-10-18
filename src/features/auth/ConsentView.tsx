import { useEffect, useState } from 'react'
import type { OAuthAuthorizationDetails, SupabaseClient } from '@supabase/supabase-js'
import { Button } from '@/components/ui/Button.tsx'
import { cx } from '@/lib/cx.ts'
import { useAuth } from './auth.ts'
import { LoginView } from './LoginView.tsx'
import s from './Login.module.css'

/** Supabase OAuth 서버가 동의를 받으러 보내는 주소 (config.toml 의 authorization_url_path) */
export const CONSENT_PATH = '/oauth/consent'

/** claude.ai 커넥터의 돌아갈 주소 */
const CLAUDE_REDIRECT = /^https:\/\/(claude\.ai|claude\.com)\//

type Step = { kind: 'loading' } | { kind: 'ask'; details: OAuthAuthorizationDetails } | { kind: 'leaving' } | { kind: 'error'; message: string }

/** 동의 화면도 로그인해야 보인다 */
export function ConsentGate({ client }: { client: SupabaseClient }) {
  const status = useAuth((a) => a.status)
  if (status === 'checking') return null
  if (status === 'out') return <LoginView />
  return <ConsentView client={client} />
}

/** claude.ai 같은 OAuth 클라이언트가 내 데이터에 접근하도록 허용하거나 거부한다 */
function ConsentView({ client }: { client: SupabaseClient }) {
  const id = new URLSearchParams(window.location.search).get('authorization_id')
  const [step, setStep] = useState<Step>(id ? { kind: 'loading' } : { kind: 'error', message: '연결 요청 정보가 없습니다.' })

  useEffect(() => {
    if (!id) return
    let live = true
    void client.auth.oauth.getAuthorizationDetails(id).then(({ data, error }) => {
      if (!live) return
      if (error || !data) {
        setStep({ kind: 'error', message: error?.message ?? '연결 요청을 찾지 못했습니다.' })
      } else if ('authorization_id' in data) {
        setStep({ kind: 'ask', details: data })
      } else {
        /* 이미 허용한 클라이언트면 바로 돌려보낸다 */
        setStep({ kind: 'leaving' })
        window.location.replace(data.redirect_url)
      }
    })
    return () => {
      live = false
    }
  }, [client, id])

  const decide = async (allow: boolean) => {
    if (!id) return
    setStep({ kind: 'leaving' })
    const { data, error } = allow
      ? await client.auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true })
      : await client.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true })
    if (error || !data?.redirect_url) setStep({ kind: 'error', message: error?.message ?? '돌아갈 주소를 받지 못했습니다.' })
    else window.location.assign(data.redirect_url)
  }

  return (
    <main className={s.wrap}>
      <div className={s.card}>
        <h1 className={s.brand}>
          To Do<span className={s.tagline}>CRA desk</span>
        </h1>
        {step.kind === 'loading' && <p className={s.msg}>연결 요청을 확인하는 중…</p>}
        {step.kind === 'leaving' && <p className={s.msg}>돌아가는 중…</p>}
        {step.kind === 'error' && (
          <p className={cx(s.msg, s.error)}>
            {step.message} 연결을 시작한 곳(Claude)에서 다시 시도해 주세요.
          </p>
        )}
        {step.kind === 'ask' && <Ask details={step.details} onDecide={decide} />}
      </div>
    </main>
  )
}

function Ask({ details, onDecide }: { details: OAuthAuthorizationDetails; onDecide: (allow: boolean) => void }) {
  const trusted = CLAUDE_REDIRECT.test(details.redirect_uri)
  return (
    <>
      <h2 className={s.title}>{details.client.name || '외부 앱'} 연결</h2>
      <p className={s.lead}>
        허용하면 {details.user.email} 계정의 일정·할 일을 읽고 추가·수정·삭제할 수 있습니다. 과제·규칙 설정 → Claude 연결에서 언제든 끊을 수 있습니다.
      </p>
      <p className={s.msg}>돌아갈 주소: {details.redirect_uri}</p>
      {!trusted && <p className={cx(s.msg, s.error)}>Claude(claude.ai)가 아닌 곳입니다. 직접 시작한 연결이 아니면 거부하세요.</p>}
      <div className={s.row}>
        <Button onClick={() => onDecide(false)}>거부</Button>
        <Button variant="solid" onClick={() => onDecide(true)}>
          허용
        </Button>
      </div>
    </>
  )
}

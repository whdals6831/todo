import { useEffect, useState } from 'react'
import type { OAuthGrant, SupabaseClient } from '@supabase/supabase-js'
import { Button } from '@/components/ui/Button.tsx'
import { Help, SectionHeader, Sub } from '@/components/ui/Layout.tsx'
import s from './Settings.module.css'

/** claude.ai 커넥터에 넣을 주소 (supabase/functions/mcp) */
const MCP_URL = String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '') + '/functions/v1/mcp'

/** claude.ai 커넥터 연결 안내와, 허용한 연결 목록·끊기 */
export function ClaudeSection({ client }: { client: SupabaseClient }) {
  const [grants, setGrants] = useState<OAuthGrant[] | null>(null)
  const [msg, setMsg] = useState('')
  /** 올리면 목록을 다시 읽는다 */
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let live = true
    void client.auth.oauth.listGrants().then(({ data, error }) => {
      if (!live) return
      if (error) setMsg('연결 목록을 불러오지 못했습니다: ' + error.message)
      else setGrants(data)
    })
    return () => {
      live = false
    }
  }, [client, version])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(MCP_URL)
      setMsg('주소를 복사했습니다.')
    } catch {
      setMsg('복사하지 못했습니다. 주소를 직접 선택해 복사하세요.')
    }
  }
  const revoke = async (g: OAuthGrant) => {
    const { error } = await client.auth.oauth.revokeGrant({ clientId: g.client.id })
    setMsg(error ? '끊지 못했습니다: ' + error.message : g.client.name + ' 연결을 끊었습니다. claude.ai 에서 다시 연결하면 이 앱의 허용 화면이 열립니다.')
    setVersion((v) => v + 1)
  }

  return (
    <div className={s.section}>
      <SectionHeader title="Claude 연결" />
      <Help>
        claude.ai → 설정 → 커넥터 → 사용자 지정 커넥터 추가에 아래 주소를 넣고, 열리는 이 앱 화면에서 허용하세요. claude.ai(웹·데스크톱·모바일)에서 일정·할 일을 묻고 추가할 수 있습니다. Claude 구독으로 쓰고 API 키는 필요 없습니다. 연결할 때는 이 앱(개발 서버)이 켜져 있어야 합니다.
      </Help>
      <div className={s.transfer}>
        <code className={s.url}>{MCP_URL}</code>
        <Button size="sm" onClick={copy}>
          주소 복사
        </Button>
      </div>
      <div className={s.grants}>
        {grants?.length === 0 && <Sub>아직 허용한 연결이 없습니다.</Sub>}
        {grants?.map((g) => (
          <div key={g.client.id} className={s.transfer}>
            <span>{g.client.name || g.client.id}</span>
            <Sub>{g.granted_at.slice(0, 10)} 허용</Sub>
            <Button size="sm" onClick={() => revoke(g)}>
              연결 끊기
            </Button>
          </div>
        ))}
        {msg && <Sub>{msg}</Sub>}
      </div>
    </div>
  )
}

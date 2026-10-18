// Claude 채팅 프록시 (Supabase Edge Function, Deno)
//
// 브라우저는 Anthropic SDK 의 baseURL 을 이 함수로 두고 /v1/messages 를 그대로 호출한다.
// 이 함수가 하는 일:
//   1. Supabase 로그인 토큰(Authorization: Bearer)을 확인한다 — 등록된 계정만 쓴다
//   2. 모델·최대 토큰·effort·거절 대비 폴백은 서버가 정한다 (브라우저가 바꿀 수 없다)
//   3. ANTHROPIC_API_KEY 를 붙여 Claude 에 보내고, 응답(SSE 스트림 포함)을 손대지 않고 넘긴다
// 메시지·시스템 프롬프트·도구 목록은 바이트 그대로 전달한다. 이전 턴과 달라지면
// thinking 블록이 무효가 되므로(preserved thinking) 프록시가 고쳐 쓰지 않는다.

import Anthropic from 'npm:@anthropic-ai/sdk@0.135.0'
import { createClient } from 'npm:@supabase/supabase-js@2.118.0'

const MODEL = 'claude-opus-5-5'
const MAX_TOKENS = 32000
const EFFORTS = ['low', 'medium', 'high'] as const

const anthropic = new Anthropic() // ANTHROPIC_API_KEY (supabase secrets)
const auth = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)
const ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5180,http://127.0.0.1:5180').split(',')

const corsHeaders = (req: Request) => {
  const origin = req.headers.get('origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    // SDK 가 보내는 x-stainless-*, anthropic-* 헤더를 그대로 허용
    'Access-Control-Allow-Headers': req.headers.get('access-control-request-headers') ?? 'authorization, content-type',
    'Access-Control-Expose-Headers': 'request-id',
    Vary: 'Origin',
  }
}

/** Anthropic API 와 같은 모양의 오류 — 브라우저 SDK 가 타입 있는 오류로 받는다 */
const apiError = (status: number, type: string, message: string, cors: Record<string, string>) =>
  new Response(JSON.stringify({ type: 'error', error: { type, message } }), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  })

Deno.serve(async (req) => {
  const cors = corsHeaders(req)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST' || !new URL(req.url).pathname.endsWith('/v1/messages'))
    return apiError(404, 'not_found_error', 'POST /v1/messages 만 받습니다.', cors)

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const { data, error } = token ? await auth.auth.getUser(token) : { data: null, error: true }
  if (error || !data?.user) return apiError(401, 'authentication_error', '로그인이 필요합니다.', cors)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return apiError(400, 'invalid_request_error', '요청 본문이 JSON 이 아닙니다.', cors)
  }
  if (!Array.isArray(body.messages)) return apiError(400, 'invalid_request_error', 'messages 가 없습니다.', cors)

  const effort = (body.output_config as { effort?: string } | undefined)?.effort
  const params = {
    model: MODEL,
    max_tokens: Math.min(Number(body.max_tokens) || 16000, MAX_TOKENS),
    messages: body.messages,
    ...(body.system !== undefined ? { system: body.system } : {}),
    ...(Array.isArray(body.tools) ? { tools: body.tools } : {}),
    ...(body.cache_control ? { cache_control: body.cache_control } : {}),
    output_config: { effort: EFFORTS.includes(effort as (typeof EFFORTS)[number]) ? effort : 'medium' },
    stream: body.stream === true,
    // 안전 분류기가 거절하면 Anthropic 이 권하는 다른 모델로 서버에서 다시 시도한다
    fallbacks: 'default',
    betas: ['server-side-fallback-2026-07-01'],
  } as unknown as Anthropic.Beta.Messages.MessageCreateParams

  try {
    const res = await anthropic.beta.messages.create(params).asResponse()
    return new Response(res.body, {
      status: res.status,
      headers: {
        ...cors,
        'content-type': res.headers.get('content-type') ?? 'application/json',
        'request-id': res.headers.get('request-id') ?? '',
      },
    })
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      const err = (e.error as { error?: { type?: string; message?: string } } | undefined)?.error
      return apiError(e.status ?? 502, err?.type ?? 'api_error', err?.message ?? e.message, cors)
    }
    console.error(e)
    return apiError(502, 'api_error', 'Claude 에 연결하지 못했습니다.', cors)
  }
})

import Anthropic from '@anthropic-ai/sdk'
import { supabase } from '@/store/supabase/client.ts'

/** 실제 모델·effort 는 프록시(supabase/functions/claude)가 정한다. 여기 값은 SDK 요청 모양을 맞추는 용도 */
export const MODEL = 'claude-opus-5-5'

/**
 * Supabase Edge Function 을 거쳐 Claude 를 부르는 SDK 클라이언트.
 * 브라우저에는 Anthropic API 키가 없고, Supabase 로그인 토큰만 보낸다(프록시가 확인 후 키를 붙인다).
 * 그래서 dangerouslyAllowBrowser 를 켜도 비밀 키가 노출되지 않는다.
 */
export async function createChatClient() {
  if (!supabase) throw new Error('Supabase 설정이 없어 채팅을 쓸 수 없습니다.')
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('로그인이 필요합니다.')
  return new Anthropic({
    baseURL: import.meta.env.VITE_SUPABASE_URL + '/functions/v1/claude',
    apiKey: null,
    authToken: token,
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
  })
}

/** 사용자에게 보여 줄 오류 문구 */
export function chatErrorMessage(e: unknown) {
  if (e instanceof Anthropic.AuthenticationError) return '로그인이 만료됐어요. 새로고침한 뒤 다시 보내 주세요.'
  if (e instanceof Anthropic.RateLimitError) return '요청이 많아 잠시 후 다시 보내 주세요.'
  if (e instanceof Anthropic.BadRequestError) return '요청을 처리하지 못했어요: ' + e.message
  if (e instanceof Anthropic.APIConnectionError) return 'Claude 에 연결하지 못했어요. 네트워크를 확인해 주세요.'
  if (e instanceof Anthropic.APIError) return '응답을 받지 못했습니다 (' + e.status + '): ' + e.message
  return '응답을 받지 못했습니다: ' + (e instanceof Error ? e.message : String(e))
}

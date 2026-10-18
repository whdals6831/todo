import type Anthropic from '@anthropic-ai/sdk'
import { create } from 'zustand'
import { chatErrorMessage, createChatClient, MODEL } from './client.ts'
import type { PendingImage } from './images.ts'
import { buildSystem } from './prompt.ts'
import { runTool, TOOL_LABEL, TOOLS } from './tools.ts'

/** 화면에 보이는 한 줄 */
export type ChatLine =
  | { role: 'user'; text: string; images: string[] }
  | { role: 'assistant'; text: string }
  | { role: 'sys'; text: string }

interface ChatState {
  lines: ChatLine[]
  busy: boolean
  /** API 에 보내는 대화 기록 — 덧붙이기만 한다 (고치면 이전 thinking 블록이 무효가 된다) */
  history: Anthropic.Beta.BetaMessageParam[]
  /** 대화를 시작할 때 고정한 시스템 프롬프트 */
  system: Anthropic.Beta.BetaTextBlockParam[] | null
}

export const useChat = create<ChatState>()(() => ({ lines: [], busy: false, history: [], system: null }))

/** 한 번의 사용자 메시지에 대해 도구를 부르며 오갈 수 있는 최대 횟수 */
const MAX_STEPS = 12

const say = (line: ChatLine) => useChat.setState((s) => ({ lines: [...s.lines, line] }))
/** 마지막 Claude 말풍선에 글자를 덧붙인다 */
const appendText = (delta: string) =>
  useChat.setState((s) => {
    const lines = [...s.lines]
    const last = lines[lines.length - 1]
    if (last?.role === 'assistant') lines[lines.length - 1] = { ...last, text: last.text + delta }
    else lines.push({ role: 'assistant', text: delta })
    return { lines }
  })

export function newChat() {
  const s = useChat.getState()
  if (s.busy) return
  for (const l of s.lines) if (l.role === 'user') l.images.forEach((u) => URL.revokeObjectURL(u))
  useChat.setState({ lines: [], history: [], system: null })
}

/**
 * 메시지를 보내고, Claude 가 도구를 부르면 브라우저에서 실행해 결과를 돌려주기를
 * 끝날 때까지 반복한다 (스트리밍 수동 루프).
 */
export async function send(text: string, images: PendingImage[]) {
  const st = useChat.getState()
  if (st.busy || (!text.trim() && !images.length)) return
  const body = text.trim() || '첨부한 이미지를 확인해줘.'
  const note = images.length ? '\n\n(이미지 ' + images.length + '장 첨부: 사용자가 이 메시지에 붙인 스크린샷/사진입니다. 내용을 읽고 요청에 맞게 처리하세요.)' : ''
  const history = [...st.history, { role: 'user' as const, content: [...images.map((i) => i.block), { type: 'text' as const, text: body + note }] }]
  const system = st.system ?? buildSystem()
  useChat.setState({ busy: true, history, system })
  say({ role: 'user', text: body, images: images.map((i) => i.url) })

  try {
    const client = await createChatClient()
    for (let step = 0; step < MAX_STEPS; step++) {
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        system,
        tools: TOOLS,
        messages: useChat.getState().history,
        cache_control: { type: 'ephemeral' },
        output_config: { effort: 'medium' },
      })
      let started = false
      stream.on('text', (delta) => {
        if (!started) {
          started = true
          /* 도구를 부른 뒤 이어지는 답이 같은 말풍선에 붙으면 문단을 띄운다 */
          const last = useChat.getState().lines.at(-1)
          if (step > 0 && last?.role === 'assistant' && last.text) appendText('\n\n')
        }
        appendText(delta)
      })
      const message = await stream.finalMessage()

      if (message.stop_reason === 'refusal') {
        say({ role: 'sys', text: 'Claude 가 이 요청에는 답하지 않았어요. 표현을 바꿔 다시 보내 주세요.' })
        break
      }
      const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
      /* 도구 입력이 길이 제한에 잘렸으면 실행하지 않는다 (잘린 입력도 그럴듯한 객체로 보일 수 있다) */
      if (message.stop_reason === 'max_tokens' && toolUses.length) {
        say({ role: 'sys', text: '응답이 너무 길어 중간에 끊겼어요. 나눠서 다시 요청해 주세요.' })
        break
      }
      useChat.setState((s) => ({ history: [...s.history, { role: 'assistant', content: message.content }] }))
      if (message.stop_reason === 'pause_turn') continue
      if (!toolUses.length) break

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
      for (const tu of toolUses) {
        const input = (tu.input ?? {}) as Record<string, unknown>
        try {
          const out = await runTool(tu.name, input)
          if (tu.name !== 'list_items') say({ role: 'sys', text: (TOOL_LABEL[tu.name]?.(input) ?? tu.name) })
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: out })
        } catch (e) {
          results.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: e instanceof Error ? e.message : String(e) })
        }
      }
      useChat.setState((s) => ({ history: [...s.history, { role: 'user', content: results }] }))
      if (step === MAX_STEPS - 1) say({ role: 'sys', text: '작업 단계가 많아 여기서 멈췄어요. 이어서 하려면 다시 말씀해 주세요.' })
    }
  } catch (e) {
    say({ role: 'sys', text: chatErrorMessage(e) })
  } finally {
    /* 글자 없이 끝난 빈 말풍선은 지운다 */
    useChat.setState((s) => ({ busy: false, lines: s.lines.filter((l) => !(l.role === 'assistant' && !l.text)) }))
  }
}

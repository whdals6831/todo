import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { pipeline } from '@supabase/middleware'
import { withOAuthProtectedResource, withSupabase } from '@supabase/server'
import { z } from 'zod'
import { TYPES } from '../../../src/domain/constants.ts'
import { setTimeZone } from '../../../src/domain/date.ts'
import { INSTRUCTIONS, runTool, withData, type ToolName } from '../../../src/mcp/tools.ts'
import { createSupabaseRepository } from '../../../src/store/supabase/supabaseRepository.ts'

/*
 * claude.ai 커넥터용 MCP 서버.
 * claude.ai 는 Supabase Auth(OAuth 2.1)에서 받은 사용자 토큰으로 부르고, 도구는 그 사용자의 데이터(RLS)만 다룬다.
 * 토큰이 없으면 401 과 함께 인증 서버 위치(oauth-protected-resource)를 알려 준다.
 * 도구 동작은 앱과 같은 코드(src/mcp/tools.ts → src/store/actions.ts)를 쓴다.
 */

/* 서버는 UTC 라서 "오늘"을 한국 시간으로 센다 */
setTimeZone('Asia/Seoul')

const date = z.string().describe('YYYY-MM-DD')
const optDate = z.string().optional().describe('YYYY-MM-DD 또는 빈 문자열')

Deno.serve(
  pipeline([withOAuthProtectedResource(), withSupabase({ auth: 'user' })], async (req, { supabase, userClaims }) => {
    const userId = userClaims!.id
    /** 요청마다 그 사용자의 데이터를 새로 읽어 실행한다 */
    const run = async (name: ToolName, input: Record<string, unknown> = {}) => {
      try {
        const text = await withData(createSupabaseRepository(supabase, userId), () => runTool(name, input))
        return { content: [{ type: 'text' as const, text }] }
      } catch (e) {
        return { content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }], isError: true }
      }
    }

    const handler = createMcpHandler(
      () => {
        const server = new McpServer({ name: 'todo', title: 'To Do', version: '1.0.0' }, { instructions: INSTRUCTIONS })
        const read = { readOnlyHint: true, openWorldHint: false }
        const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }

        server.registerTool(
          'get_overview',
          {
            title: '오늘 기준 일정·할 일 보기',
            description: '오늘 날짜(한국 시간), 사용 안내, 과제 목록, 기한 규칙, 오늘 기준 -21일 ~ +60일의 일정과 열린 할 일을 돌려줍니다. 일정·할 일 질문에 답하거나 바꾸기 전에 먼저 부르세요.',
            annotations: read,
          },
          () => run('get_overview'),
        )
        server.registerTool(
          'list_items',
          {
            title: '기간 안의 일정·할 일 보기',
            description: '기간 안의 일정과 (마감일 기준) 할 일을 돌려줍니다. get_overview 범위 밖의 날짜를 보거나, 바꾼 뒤 다시 확인할 때 쓰세요.',
            inputSchema: z.object({ from: date, to: date }),
            annotations: read,
          },
          (i) => run('list_items', i),
        )
        server.registerTool(
          'list_deadlines',
          {
            title: '마감 줄 보기',
            description:
              '앱 캘린더의 마감 줄(PMP 마감, OMF·비용청구·QC처럼 마감으로 보는 할 일) 중 아직 끝내지 않은 것을 돌려줍니다 (지난 14일 ~ 앞으로 60일). 시간이 없는 마감은 18:00. 구글 캘린더 알림 동기화에 쓰며, sync_id 는 마감·날짜·시간마다 달라 일정 설명에 넣어 같은 마감인지 비교합니다.',
            annotations: read,
          },
          () => run('list_deadlines'),
        )
        server.registerTool(
          'add_visit',
          {
            title: '일정 추가',
            description: '일정을 추가합니다. kind=visit(외근, 기본값)이면 project·site·type이 필요하고 기한 규칙에 따라 할 일이 자동 생성됩니다. kind=meeting(회의)·training(교육)·leave(휴가)는 title을 쓰고 자동 할 일은 없습니다. 여러 날이면 endDate.',
            inputSchema: z.object({
              kind: z.enum(['visit', 'meeting', 'training', 'leave']).optional(),
              date,
              endDate: optDate,
              time: z.string().optional().describe('HH:MM'),
              title: z.string().optional(),
              project: z.string().optional().describe('과제 이름 (get_overview 의 projects 중 하나)'),
              site: z.string().optional().describe('기관'),
              type: z.enum(TYPES).optional().describe('방문 종류'),
              memo: z.string().optional(),
            }),
            annotations: write,
          },
          (i) => run('add_visit', i),
        )
        server.registerTool(
          'add_todo',
          {
            title: '할 일 추가',
            description: '할 일을 직접 추가합니다. 제목에 "내일", "10/21 14시"처럼 날짜를 쓰면 앱이 읽어 마감일로 씁니다.',
            inputSchema: z.object({ title: z.string(), due: optDate, start: optDate, project: z.string().optional(), note: z.string().optional() }),
            annotations: write,
          },
          (i) => run('add_todo', i),
        )
        server.registerTool(
          'update_todo',
          {
            title: '할 일 수정',
            description: '할 일의 제목, 마감일(due), 착수일(start), 완료 여부, 완료일(doneDay)을 바꿉니다. 며칠 전에 끝낸 일을 뒤늦게 완료 처리할 때는 done:true와 함께 doneDay를 주세요. id는 get_overview·list_items 에서 가져옵니다.',
            inputSchema: z.object({
              id: z.string(),
              title: z.string().optional(),
              due: optDate,
              start: optDate,
              done: z.boolean().optional(),
              doneDay: z.string().optional().describe('완료한 날짜 YYYY-MM-DD (오늘 이전만)'),
            }),
            annotations: { ...write, idempotentHint: true },
          },
          (i) => run('update_todo', i),
        )
        server.registerTool(
          'update_visit',
          {
            title: '외근 수정',
            description: '외근의 날짜·시간·기관·종류·과제·메모를 바꿉니다. 바꾸면 미완료 자동 할 일의 기한이 다시 계산됩니다.',
            inputSchema: z.object({
              id: z.string(),
              date: optDate,
              time: z.string().optional(),
              project: z.string().optional(),
              site: z.string().optional(),
              type: z.enum(TYPES).optional(),
              memo: z.string().optional(),
            }),
            annotations: { ...write, idempotentHint: true },
          },
          (i) => run('update_visit', i),
        )
        server.registerTool(
          'delete_todo',
          {
            title: '할 일 삭제',
            description: '할 일을 삭제합니다. 사용자가 이 대화에서 삭제를 확인한 뒤에만 부르세요. 자동 할 일을 지우면 그 외근에서 다시 생기지 않습니다.',
            inputSchema: z.object({ id: z.string() }),
            annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
          },
          (i) => run('delete_todo', i),
        )
        return server
      },
      { onerror: (error) => console.error('MCP request failed', error) },
    )
    return handler.fetch(req)
  }),
)

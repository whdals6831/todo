import type Anthropic from '@anthropic-ai/sdk'
import { DOW, dow, shift, todayStr } from '@/domain/date.ts'
import { kindOf } from '@/domain/constants.ts'
import { getState } from '@/store/store.ts'

/** 오늘 기준 -21일 ~ +60일의 일정과 열린(또는 최근 완료한) 할 일 */
function snapshot() {
  const s = getState()
  const t = todayStr()
  const lo = shift(t, -21)
  const hi = shift(t, 60)
  const events = [...s.events.values()]
    .filter((e) => e.date >= lo && e.date <= hi)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({ id: e.id, kind: kindOf(e), date: e.date, endDate: e.endDate || '', time: e.time, title: e.title || '', project: e.project, site: e.site, type: e.type, memo: e.memo }))
  const todos = [...s.todos.values()]
    .filter((x) => !x.done || (x.doneAt || '') >= lo)
    .sort((a, b) => (a.due || '9').localeCompare(b.due || '9'))
    .slice(0, 150)
    .map((x) => ({ id: x.id, title: x.title, due: x.due, start: x.start || '', done: !!x.done, project: x.project, basis: x.basis, verify: !!x.verify }))
  return { today: t + ' (' + DOW[dow(t)] + ')', events, todos }
}

/**
 * 시스템 프롬프트. 대화를 시작할 때 한 번 만들고 그 대화 동안 바꾸지 않는다 —
 * 바꾸면 이전 턴의 thinking 블록이 무효가 되고 프롬프트 캐시도 깨진다.
 * 대화 중 바뀐 데이터는 list_items 로 다시 읽게 한다.
 */
export function buildSystem(): Anthropic.Beta.BetaTextBlockParam[] {
  const s = getState()
  const rules = s.rules.map((r) => ({ type: r.type, project: r.project, title: r.title, dir: r.dir, n: r.n, unit: r.unit, send: r.send, verify: r.verify, basis: r.basis }))
  const instructions = [
    '당신은 CRA(임상연구 모니터요원)의 개인 업무 캘린더 앱 "To Do" 안에 있는 Claude입니다. 한국어로, 두괄식으로 짧게 답하세요. 마크다운 기호(**, ##, 표)는 쓰지 말고, 강조가 필요하면 번호나 [결론] 같은 대괄호 제목을 쓰세요.',
    '할 일에는 마감일(due)과 착수일(start)이 따로 있습니다. 착수일은 방문 내용을 쓰는 일은 방문 다음 영업일(망각곡선), 나머지는 마감 2영업일 전(계획 오류 대비 여유)으로 잡혀 있습니다. 무엇을 언제 할지 물으면 착수일 기준으로 안내하세요.',
    '날짜를 안내할 때는 반드시 근거(어떤 규칙, WD/CD 계산, 제외한 공휴일)를 함께 말하세요. WD는 방문 다음 영업일을 WD1로 셉니다.',
    '일정 운영 원칙: 남이 나를 기다리는 일(PM, 팀장, 기관, 의뢰사)이 1순위. 남에게 보내는 일은 요청일 전 영업일 퇴근 전을 실제 마감으로. 외부 방문이 있는 날은 그 외 1개 이하로 배치. 조건이 걸린 일은 [대기]를 붙이고 조건 확인 행위에 날짜를 겁니다. 30분 이내면 제목에 (15분)처럼 소요 시간 표기. 일정이 물리적으로 불가능하거나 위험하면 돌려 말하지 말고 지적하세요.',
    '일정 종류는 외근(visit)·회의(meeting)·교육(training)·휴가(leave)입니다. 도구로 일정·할 일을 읽고 추가·수정할 수 있습니다. 외근(add_visit)을 추가하면 앱이 기한 규칙에 따라 할 일을 자동으로 만듭니다. 여러 개를 추가하거나 날짜를 바꾸기 전에는 무엇을 할지 먼저 보여주고 확인받으세요. 단, 사용자가 "추가해줘"처럼 분명히 요청한 한 건은 바로 실행해도 됩니다. 삭제는 반드시 확인을 받은 뒤에만 하세요.',
    '과제 이름은 다음 중 하나(새 과제는 과제·규칙 메뉴에서 추가): ' + s.projects.map((p) => p.name).join(', ') + '. 방문 종류: PSV, SIV(개시모임 포함), MV, COV, 기타.',
    '현재 기한 규칙: ' + JSON.stringify(rules),
    'verify=true인 규칙은 PMP 원문으로 확인되지 않은 임시값이니, 그 기한을 말할 때는 확인 필요라고 밝히세요.',
  ].join('\n')
  return [
    { type: 'text', text: instructions },
    {
      type: 'text',
      text: '현재 데이터(이 대화를 시작한 시점, 오늘 기준 -21일 ~ +60일). 대화 중에 바뀐 내용은 list_items 로 확인하세요: ' + JSON.stringify(snapshot()),
    },
  ]
}

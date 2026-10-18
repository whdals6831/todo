# To Do

CRA 업무용 캘린더·할 일 앱. 외근을 등록하면 기한 규칙(WD/CD, 공휴일 제외)에 따라 할 일이 자동으로 생긴다.
원래 claude.ai 아티팩트(`protocol.html`)로 만든 것을 React + TypeScript 로 옮겼다.

## 실행

```bash
npm install
npm run dev      # http://localhost:5180
npm test         # 도메인 로직·저장 큐 테스트
npm run build
```

`.env.local` 이 없으면 데이터는 이 브라우저(localStorage)에만 저장된다.
과제·규칙 설정 → 데이터 가져오기에서 내보낸 JSON(`protocol-data.json` 형식)을 불러올 수 있다.

## Supabase 에 저장하기

1. Supabase 프로젝트를 만든다 (리전: Northeast Asia (Seoul)).
2. 스키마를 올린다.
   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>   # DB 비밀번호를 묻는다
   npx supabase db push                            # supabase/migrations 적용
   ```
3. 대시보드 Authentication 설정
   - Sign In / Providers → Email 켜기, **Allow new users to sign up 끄기** (본인 계정만 쓴다)
   - Users → Add user → Create new user 로 내 이메일·비밀번호 계정을 만든다 (Auto Confirm). 비밀번호는 앱의 과제·규칙 → 계정에서 바꾼다
   - URL Configuration → Site URL 과 Redirect URLs 에 앱 주소(`http://localhost:5180` 등)를 넣는다 (`npx supabase config push` 로도 된다)
4. `.env.example` 을 `.env.local` 로 복사하고 Project URL 과 Publishable key 를 넣는다.
5. `npm run dev` → 이메일·비밀번호로 로그인 → 과제·규칙 설정에서 JSON 을 가져온다.

모든 표는 RLS 로 로그인한 본인 행만 읽고 쓴다. 쓰기는 모아서 보내고, 실패하면 연결될 때 다시 보낸다.
다른 기기·탭의 변경은 Realtime 으로 받는다.

## 배포 (Cloudflare Workers)

https://todo.whdals6831.workers.dev — GitHub `main` 에 push 하면 Cloudflare 가 빌드해서 자동으로 배포한다.

- Worker 설정 → Build → 빌드 명령 `npm run build`
- Build variables and secrets 에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` 를 넣는다.
  빌드할 때 코드에 들어가는 값이라 런타임 Variables & Secrets 에 넣으면 적용되지 않는다. 바꾼 뒤에는 다시 빌드해야 한다
- `supabase/config.toml` 의 `site_url` 이 배포 주소여야 Claude 연결 동의 화면이 열린다

## Claude 연결 (claude.ai 커넥터)

Claude 구독(claude.ai)으로 쓴다. API 키는 필요 없다.
이 앱의 일정·할 일 도구를 MCP 서버(`supabase/functions/mcp`)로 열어 두고, claude.ai 가 커넥터로 붙는다.
claude.ai 는 Supabase Auth 의 OAuth 2.1 서버로 로그인하고, 이 앱의 동의 화면(`/oauth/consent`)에서 허용해야 접근한다.

1. Supabase 설정을 올리고 함수를 배포한다.
   ```bash
   npx supabase config push                 # OAuth 서버·동적 클라이언트 등록 켜기 (config.toml [auth.oauth_server])
   npx supabase functions deploy mcp --use-api
   ```
   프로젝트가 비대칭 JWT 서명 키(ES256·RS256)를 써야 한다 (Authentication → JWT Keys).
2. 동의 화면은 Site URL + `/oauth/consent`(배포 주소)에 열린다. 개발 서버를 켜 둘 필요는 없다.
3. claude.ai → 설정 → 커넥터 → 사용자 지정 커넥터 추가 → 주소에 `https://<project-ref>.supabase.co/functions/v1/mcp` → 연결 → 앱 화면에서 허용.
4. 끊으려면 claude.ai 에서 커넥터를 연결 해제하거나, 앱의 과제·규칙 설정 → Claude 연결에서 연결 끊기.

도구는 `src/mcp/tools.ts` 에 있고 앱과 같은 `src/store/actions.ts` 로 데이터를 바꾼다
(요청마다 그 사용자의 데이터를 읽어 실행하고 저장까지 마친 뒤 응답한다). 함수는 UTC 에서 돌아서 "오늘"을 한국 시간으로 센다.

## 구조

- `src/domain` — React 와 무관한 업무 로직 (날짜 파싱, 기한 규칙, 정렬). 원본과 결과가 같은지 비교·테스트했다
- `src/store` — 상태(Zustand)와 저장소. `repository.ts` 인터페이스 뒤에 localStorage·Supabase 구현이 있다
- `src/components/ui` — 공통 컴포넌트, `src/styles/tokens.css` — 디자인 토큰
- `src/features` — 화면
- `src/mcp` — claude.ai 커넥터 도구, `supabase/functions/mcp` — 그 MCP 서버
- `supabase/migrations` — DB 스키마

## 글꼴

- 영문·숫자: [Seshat](https://dotcolon.net/font/seshat) (CC0)
- 한글: [함렛 Hahmlet](https://fonts.google.com/specimen/Hahmlet) (OFL, Google Fonts)

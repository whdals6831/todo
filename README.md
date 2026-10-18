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
   - Users → Add user → Create new user 로 내 이메일 계정을 만든다 (Auto Confirm)
   - URL Configuration → Site URL 과 Redirect URLs 에 앱 주소(`http://localhost:5180` 등)를 넣는다 (`npx supabase config push` 로도 된다)
   - (선택) Emails → Magic Link 템플릿에 `{{ .Token }}` 을 넣으면 메일의 인증 코드로도 로그인할 수 있다
4. `.env.example` 을 `.env.local` 로 복사하고 Project URL 과 Publishable key 를 넣는다.
5. `npm run dev` → 이메일로 로그인 → 과제·규칙 설정에서 JSON 을 가져온다.

모든 표는 RLS 로 로그인한 본인 행만 읽고 쓴다. 쓰기는 모아서 보내고, 실패하면 연결될 때 다시 보낸다.
다른 기기·탭의 변경은 Realtime 으로 받는다.

## 구조

- `src/domain` — React 와 무관한 업무 로직 (날짜 파싱, 기한 규칙, 정렬). 원본과 결과가 같은지 비교·테스트했다
- `src/store` — 상태(Zustand)와 저장소. `repository.ts` 인터페이스 뒤에 localStorage·Supabase 구현이 있다
- `src/components/ui` — 공통 컴포넌트, `src/styles/tokens.css` — 디자인 토큰
- `src/features` — 화면
- `supabase/migrations` — DB 스키마

## 글꼴

- 영문·숫자: [Seshat](https://dotcolon.net/font/seshat) (CC0)
- 한글: [함렛 Hahmlet](https://fonts.google.com/specimen/Hahmlet) (OFL, Google Fonts)

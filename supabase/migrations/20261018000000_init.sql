-- To Do 초기 스키마
--
-- 문서 id 는 text 다. 자동 할 일은 "a_<외근 id>_<규칙 id>" 처럼 정해진 id 를 써서
-- 두 기기가 동시에 맞춰도 같은 행을 덮어쓰고 중복되지 않는다 (uuid 로 바꾸면 안 된다).
-- 기본키에 user_id 를 넣어 사용자마다 id 공간이 따로이고, Realtime 삭제 알림에도 user_id 가 실린다.
--
-- 외래키를 걸지 않는다: 일정을 지워도 완료한 할 일은 기록으로 남고(앱이 정리한다),
-- 할 일 사이의 연결(parent_id, follow_of …)도 앱이 관리한다.

create table public.events (
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id           text not null,
  kind         text check (kind in ('visit', 'meeting', 'training', 'leave')), -- null = 외근
  date         date not null,
  end_date     date,
  time         text,                 -- 'HH:MM'
  project      text,
  site         text,
  type         text,                 -- 방문 종류 (외근)
  title        text,                 -- 외근이 아닌 일정의 제목
  memo         text,
  skip         text[],               -- 직접 지운 자동 할 일의 규칙 id
  gen_key      text,                 -- 자동 할 일을 맞춘 입력의 서명
  created_date date,
  source       text,                 -- 외부에서 가져온 일정 (예: gcal)
  updated_at   timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.todos (
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id            text not null,
  title         text not null,
  project       text,
  due           date,                -- null = TBD 또는 Someday
  time          text,                -- 'HH:MM'
  start         date,
  tbd           boolean,
  someday       boolean,
  auto_due      boolean,
  done          boolean not null default false,
  done_at       timestamptz,
  rank          double precision,    -- 직접 정한 순서 (사이에 끼우면 소수)
  rolled        integer,
  orig_due      date,
  basis         text,
  start_basis   text,
  note          text,
  verify        boolean,
  event_id      text,
  rule_id       text,                -- '-manual' 로 끝나면 직접 고친 할 일
  parent_id     text,
  own_date      boolean,
  follow_of     text,
  ful_id        text,
  prep_key      text,
  prep_site     text,
  approved_site text,
  created       timestamptz,
  source        text,
  updated_at    timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.fuls (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         text not null,
  project    text not null,
  site       text not null,
  type       text not null default '*',
  text       text not null,
  created    timestamptz not null,
  done       boolean,
  todo_id    text,
  event_id   text,
  linked_at  date,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- 설정은 화면에서 목록을 통째로 저장하므로 사용자당 한 행에 jsonb 로 둔다
create table public.settings (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  rules      jsonb not null default '[]',
  projects   jsonb not null default '[]',
  companions jsonb not null default '[]',
  holidays   jsonb not null default '{}',
  notes      jsonb,
  mig        text[] not null default '{}',
  updated_at timestamptz not null default now()
);

/* ---------- updated_at ---------- */

create function public.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger events_touch before update on public.events for each row execute function public.touch_updated_at();
create trigger todos_touch before update on public.todos for each row execute function public.touch_updated_at();
create trigger fuls_touch before update on public.fuls for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.settings for each row execute function public.touch_updated_at();

/* ---------- 권한: 로그인한 본인 행만 ---------- */

alter table public.events enable row level security;
alter table public.todos enable row level security;
alter table public.fuls enable row level security;
alter table public.settings enable row level security;

create policy "본인 일정" on public.events for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "본인 할 일" on public.todos for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "본인 FUL 메모" on public.fuls for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "본인 설정" on public.settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.events, public.todos, public.fuls, public.settings from anon;
grant select, insert, update, delete on public.events, public.todos, public.fuls, public.settings to authenticated;

/* ---------- 가져오기: 본인 데이터를 한 번에 바꾼다 (한 트랜잭션) ---------- */

create function public.replace_all_data(p_events jsonb, p_todos jsonb, p_fuls jsonb, p_settings jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  stamp jsonb := jsonb_build_object('user_id', uid, 'updated_at', now());
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  delete from public.events where user_id = uid;
  delete from public.todos where user_id = uid;
  delete from public.fuls where user_id = uid;

  insert into public.events
  select r.* from jsonb_array_elements(coalesce(p_events, '[]')) as e,
    lateral jsonb_populate_record(null::public.events, e || stamp) as r;
  insert into public.todos
  select r.* from jsonb_array_elements(coalesce(p_todos, '[]')) as t,
    lateral jsonb_populate_record(null::public.todos, t || stamp) as r;
  insert into public.fuls
  select r.* from jsonb_array_elements(coalesce(p_fuls, '[]')) as f,
    lateral jsonb_populate_record(null::public.fuls, f || stamp) as r;

  if p_settings is null then
    delete from public.settings where user_id = uid;
  else
    insert into public.settings (user_id, rules, projects, companions, holidays, notes, mig)
    values (
      uid,
      coalesce(p_settings -> 'rules', '[]'),
      coalesce(p_settings -> 'projects', '[]'),
      coalesce(p_settings -> 'companions', '[]'),
      coalesce(p_settings -> 'holidays', '{}'),
      p_settings -> 'notes',
      coalesce(array(select jsonb_array_elements_text(p_settings -> 'mig')), '{}')
    )
    on conflict (user_id) do update set
      rules = excluded.rules,
      projects = excluded.projects,
      companions = excluded.companions,
      holidays = excluded.holidays,
      notes = excluded.notes,
      mig = excluded.mig;
  end if;
end;
$$;

revoke all on function public.replace_all_data(jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.replace_all_data(jsonb, jsonb, jsonb, jsonb) to authenticated;

/* ---------- Realtime: 다른 기기·탭의 변경을 받는다 ---------- */

alter publication supabase_realtime add table public.events, public.todos, public.fuls, public.settings;

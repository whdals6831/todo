-- 할 일 아래에 직접 단 하위 항목 (체크한 것은 checks 에)
alter table public.todos add column if not exists subs text[];

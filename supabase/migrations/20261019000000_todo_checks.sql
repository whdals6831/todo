-- 서명문서 체크리스트에서 체크한 문서 이름
alter table public.todos add column if not exists checks text[];

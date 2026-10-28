-- 체크리스트(하위 항목)를 체크한 시각 (이름 → 시각). 브리핑에 그날 체크한 하위 항목을 보여 준다
alter table public.todos add column if not exists check_at jsonb;

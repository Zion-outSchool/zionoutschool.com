alter table public.graduation_plan_entries
    add column if not exists final_grade text;

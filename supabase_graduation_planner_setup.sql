drop policy if exists "Users can read their own portal profile" on public.portal_users;
create policy "Users can read their own portal profile"
on public.portal_users
for select
to authenticated
using (
    id = auth.uid()
    or public.current_portal_role() in ('admin', 'teacher', 'staff')
);

drop policy if exists "Staff can create student files" on public.students;
create policy "Staff can create student files"
on public.students
for insert
to authenticated
with check (
    public.current_portal_role() = 'admin'
);

drop policy if exists "Staff can update student files" on public.students;
create policy "Staff can update student files"
on public.students
for update
to authenticated
using (
    public.current_portal_role() = 'admin'
)
with check (
    public.current_portal_role() = 'admin'
);

create table if not exists public.graduation_plan_entries (
    id uuid primary key default gen_random_uuid(),
    student_id uuid not null references public.students(id) on delete cascade,
    requirement_key text not null,
    grade_level text not null,
    course_name text,
    credits numeric(4, 2),
    status text not null default 'not_started',
    notes text,
    updated_by uuid references auth.users(id),
    updated_at timestamptz not null default now(),
    constraint graduation_plan_entries_grade_check check (grade_level in ('8', '9', '10', '11', '12')),
    constraint graduation_plan_entries_status_check check (status in ('not_started', 'planned', 'in_progress', 'completed', 'waived')),
    constraint graduation_plan_entries_unique unique (student_id, requirement_key, grade_level)
);

create table if not exists public.graduation_milestones (
    id uuid primary key default gen_random_uuid(),
    student_id uuid not null references public.students(id) on delete cascade,
    milestone_key text not null,
    status text not null default 'not_started',
    completed_on date,
    notes text,
    updated_by uuid references auth.users(id),
    updated_at timestamptz not null default now(),
    constraint graduation_milestones_status_check check (status in ('not_started', 'in_progress', 'completed', 'waived')),
    constraint graduation_milestones_unique unique (student_id, milestone_key)
);

alter table public.graduation_plan_entries enable row level security;
alter table public.graduation_milestones enable row level security;

drop policy if exists "Portal users can read allowed graduation plan entries" on public.graduation_plan_entries;
create policy "Portal users can read allowed graduation plan entries"
on public.graduation_plan_entries
for select
to authenticated
using (
    public.current_portal_role() in ('admin', 'teacher', 'staff')
    or exists (
        select 1
        from public.students
        where students.id = graduation_plan_entries.student_id
        and students.family_id = auth.uid()
    )
);

drop policy if exists "Staff can insert graduation plan entries" on public.graduation_plan_entries;
create policy "Staff can insert graduation plan entries"
on public.graduation_plan_entries
for insert
to authenticated
with check (
    public.current_portal_role() in ('admin', 'teacher', 'staff')
);

drop policy if exists "Staff can update graduation plan entries" on public.graduation_plan_entries;
create policy "Staff can update graduation plan entries"
on public.graduation_plan_entries
for update
to authenticated
using (
    public.current_portal_role() in ('admin', 'teacher', 'staff')
)
with check (
    public.current_portal_role() in ('admin', 'teacher', 'staff')
);

drop policy if exists "Portal users can read allowed graduation milestones" on public.graduation_milestones;
create policy "Portal users can read allowed graduation milestones"
on public.graduation_milestones
for select
to authenticated
using (
    public.current_portal_role() in ('admin', 'teacher', 'staff')
    or exists (
        select 1
        from public.students
        where students.id = graduation_milestones.student_id
        and students.family_id = auth.uid()
    )
);

drop policy if exists "Staff can insert graduation milestones" on public.graduation_milestones;
create policy "Staff can insert graduation milestones"
on public.graduation_milestones
for insert
to authenticated
with check (
    public.current_portal_role() in ('admin', 'teacher', 'staff')
);

drop policy if exists "Staff can update graduation milestones" on public.graduation_milestones;
create policy "Staff can update graduation milestones"
on public.graduation_milestones
for update
to authenticated
using (
    public.current_portal_role() in ('admin', 'teacher', 'staff')
)
with check (
    public.current_portal_role() in ('admin', 'teacher', 'staff')
);

drop policy if exists "Portal users can read allowed students" on public.students;
create policy "Portal users can read allowed students"
on public.students
for select
to authenticated
using (
    family_id = auth.uid()
    or public.current_portal_role() in ('admin', 'teacher', 'staff')
);

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

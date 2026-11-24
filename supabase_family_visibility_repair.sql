begin;

drop policy if exists "Portal users can read allowed students" on public.students;
create policy "Portal users can read allowed students"
on public.students for select to authenticated
using (
    public.current_portal_role() in ('admin', 'teacher', 'staff')
    or (public.current_portal_role() = 'family' and family_id = auth.uid())
);

drop policy if exists "Portal users can read allowed published reports" on public.grade_reports;
create policy "Portal users can read allowed published reports"
on public.grade_reports for select to authenticated
using (
    status = 'published'
    and exists (select 1 from public.students s where s.id = grade_reports.student_id)
);

drop policy if exists "Portal users can read allowed graduation plan entries" on public.graduation_plan_entries;
create policy "Portal users can read allowed graduation plan entries"
on public.graduation_plan_entries for select to authenticated
using (exists (select 1 from public.students s where s.id = graduation_plan_entries.student_id));

drop policy if exists "Portal users can read allowed graduation milestones" on public.graduation_milestones;
create policy "Portal users can read allowed graduation milestones"
on public.graduation_milestones for select to authenticated
using (exists (select 1 from public.students s where s.id = graduation_milestones.student_id));

insert into storage.buckets (id, name, public)
values ('grade-reports', 'grade-reports', false)
on conflict (id) do update set public = false;

drop policy if exists "Portal users can read allowed grade report files" on storage.objects;
create policy "Portal users can read allowed grade report files"
on storage.objects for select to authenticated
using (
    bucket_id = 'grade-reports'
    and exists (
        select 1 from public.grade_reports r
        where coalesce(r.storage_bucket, 'grade-reports') = storage.objects.bucket_id
        and r.storage_path = storage.objects.name
    )
);

commit;

-- Run after the portal migrations in a disposable Supabase-compatible database.
begin;

insert into auth.users (id, email) values
    ('70000000-0000-0000-0000-000000000001', 'access-family-a@example.com'),
    ('70000000-0000-0000-0000-000000000002', 'access-family-b@example.com'),
    ('70000000-0000-0000-0000-000000000003', 'access-admin@example.com');
insert into public.portal_users (id, display_name, role) values
    ('70000000-0000-0000-0000-000000000001', 'Family A', 'family'),
    ('70000000-0000-0000-0000-000000000002', 'Family B', 'family'),
    ('70000000-0000-0000-0000-000000000003', 'Admin', 'admin');
insert into public.students (id, family_id, first_name, last_name) values
    ('71000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'Student', 'A'),
    ('71000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000002', 'Student', 'B');
insert into public.grade_reports (student_id, title, status, storage_bucket, storage_path) values
    ('71000000-0000-0000-0000-000000000001', 'Published A', 'published', 'grade-reports', 'portal-access-test/a.pdf'),
    ('71000000-0000-0000-0000-000000000001', 'Draft A', 'draft', 'grade-reports', 'portal-access-test/draft.pdf'),
    ('71000000-0000-0000-0000-000000000001', 'Other bucket A', 'published', 'other-bucket', 'portal-access-test/other-bucket.pdf'),
    ('71000000-0000-0000-0000-000000000002', 'Published B', 'published', 'grade-reports', 'portal-access-test/b.pdf');
insert into public.graduation_plan_entries (student_id, requirement_key, grade_level)
    select id, 'algebra_i', '9' from public.students where id::text like '71000000-%';
insert into public.graduation_milestones (student_id, milestone_key)
    select id, 'cpr_training' from public.students where id::text like '71000000-%';
insert into storage.objects (bucket_id, name) values
    ('grade-reports', 'portal-access-test/a.pdf'),
    ('grade-reports', 'portal-access-test/b.pdf'),
    ('grade-reports', 'portal-access-test/draft.pdf'),
    ('grade-reports', 'portal-access-test/other-bucket.pdf'),
    ('grade-reports', 'portal-access-test/unlinked.pdf');

set local role authenticated;
select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000001', true);
do $$
begin
    if (select array_agg(last_name) from public.students where id::text like '71000000-%')
           is distinct from array['A']
       or (select count(*) from public.grade_reports where storage_path like 'portal-access-test/%') <> 2
       or (select count(*) from public.graduation_plan_entries where student_id::text like '71000000-%') <> 1
       or (select count(*) from public.graduation_milestones where student_id::text like '71000000-%') <> 1
       or (select array_agg(name) from storage.objects where name like 'portal-access-test/%')
           is distinct from array['portal-access-test/a.pdf'] then
        raise exception 'Active family should see only their linked student and authorized published PDFs';
    end if;
end;
$$;

select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000002', true);
do $$
begin
    if (select array_agg(last_name) from public.students where id::text like '71000000-%')
           is distinct from array['B']
       or (select array_agg(name) from storage.objects where name like 'portal-access-test/%')
           is distinct from array['portal-access-test/b.pdf'] then
        raise exception 'Second family should see only their own student and PDF';
    end if;
end;
$$;

reset role;
update public.portal_users set active = false where id = '70000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000001', true);
do $$
begin
    if exists (select 1 from public.students where id::text like '71000000-%')
       or exists (select 1 from public.grade_reports where storage_path like 'portal-access-test/%')
       or exists (select 1 from public.graduation_plan_entries where student_id::text like '71000000-%')
       or exists (select 1 from public.graduation_milestones where student_id::text like '71000000-%')
       or exists (select 1 from storage.objects where name like 'portal-access-test/%') then
        raise exception 'Inactive family must lose all student and report access';
    end if;
end;
$$;

select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000003', true);
do $$
begin
    if (select count(*) from public.students where id::text like '71000000-%') <> 2
       or (select array_agg(name order by name) from storage.objects where name like 'portal-access-test/%')
           is distinct from array['portal-access-test/a.pdf', 'portal-access-test/b.pdf'] then
        raise exception 'Admin must retain roster access and be able to open published PDFs';
    end if;
end;
$$;

rollback;

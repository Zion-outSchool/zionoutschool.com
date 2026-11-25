-- Run against a disposable database with supabase_classroom_access.sql applied.
begin;

insert into auth.users (id, email, email_confirmed_at) values
    ('73000000-0000-0000-0000-000000000001', 'classroom-parent-a@example.com', now()),
    ('73000000-0000-0000-0000-000000000002', 'classroom-parent-b@example.com', now()),
    ('73000000-0000-0000-0000-000000000003', 'classroom-teacher-a@example.com', now()),
    ('73000000-0000-0000-0000-000000000004', 'classroom-teacher-b@example.com', now()),
    ('73000000-0000-0000-0000-000000000005', 'classroom-admin@example.com', now());
insert into public.portal_users (id, display_name, role) values
    ('73000000-0000-0000-0000-000000000001', 'Family A', 'family'),
    ('73000000-0000-0000-0000-000000000002', 'Family B', 'family'),
    ('73000000-0000-0000-0000-000000000003', 'Teacher A', 'teacher'),
    ('73000000-0000-0000-0000-000000000004', 'Teacher B', 'teacher'),
    ('73000000-0000-0000-0000-000000000005', 'Administrator', 'admin');
insert into public.students (id, family_id, first_name, last_name) values
    ('73100000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000001', 'Student', 'A'),
    ('73100000-0000-0000-0000-000000000002', '73000000-0000-0000-0000-000000000002', 'Student', 'B'),
    ('73100000-0000-0000-0000-000000000003', '73000000-0000-0000-0000-000000000001', 'Sibling', 'A');
insert into public.gradebook_courses (id, teacher_id, name, term, weighting, missing_is_zero, categories, scale) values
    ('73200000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000003',
        'Class A', 'Fall', 'points', false, '{"General":0}', '{"A":90,"F":0}'),
    ('73200000-0000-0000-0000-000000000002', '73000000-0000-0000-0000-000000000004',
        'Class B', 'Fall', 'points', false, '{"General":0}', '{"A":90,"F":0}');
insert into public.gradebook_enrollments (course_id, student_id, grade_level, credits) values
    ('73200000-0000-0000-0000-000000000001', '73100000-0000-0000-0000-000000000001', '9', 0),
    ('73200000-0000-0000-0000-000000000001', '73100000-0000-0000-0000-000000000003', '9', 0),
    ('73200000-0000-0000-0000-000000000002', '73100000-0000-0000-0000-000000000002', '9', 0);

set local role authenticated;
select set_config('request.jwt.claim.sub', '73000000-0000-0000-0000-000000000003', true);
do $$
begin
    if (select count(*) from public.students) <> 2
        or exists (select 1 from public.students where id = '73100000-0000-0000-0000-000000000002')
        or (select count(*) from public.gradebook_enrollments) <> 2
        or (select email_count from public.communication_class_audience('73200000-0000-0000-0000-000000000001')) <> 1 then
        raise exception 'Teacher roster or household deduplication failed';
    end if;
    begin
        insert into public.gradebook_enrollments (course_id, student_id, grade_level, credits)
        values ('73200000-0000-0000-0000-000000000001', '73100000-0000-0000-0000-000000000002', '9', 0);
        raise exception 'Teacher modified their roster';
    exception when insufficient_privilege then null; end;
    begin
        insert into public.graduation_plan_entries (student_id, requirement_key, grade_level)
        values ('73100000-0000-0000-0000-000000000002', 'algebra_i', '9');
        raise exception 'Teacher wrote to another classroom’s student';
    exception when insufficient_privilege then null; end;
    begin
        perform public.communication_class_audience('73200000-0000-0000-0000-000000000002');
        raise exception 'Teacher previewed a different classroom audience';
    exception when insufficient_privilege then null; end;
    begin
        perform public.communication_publish_class(gen_random_uuid(), '73200000-0000-0000-0000-000000000002',
            'announcement', 'Wrong class', 'Private text', true);
        raise exception 'Teacher published to a different classroom';
    exception when insufficient_privilege then null; end;
    if public.communication_publish_class('73300000-0000-0000-0000-000000000001', '73200000-0000-0000-0000-000000000001',
        'news', 'Class news', 'Private text', true) <> 1 then
        raise exception 'The update should queue one email for siblings in the same family';
    end if;
    if public.communication_publish_class('73300000-0000-0000-0000-000000000001', '73200000-0000-0000-0000-000000000001',
        'news', 'Class news', 'Private text', true) <> 1 then
        raise exception 'The same publication request should be safe to retry';
    end if;
end;
$$;

select set_config('request.jwt.claim.sub', '73000000-0000-0000-0000-000000000001', true);
do $$
begin
    if not exists (select 1 from public.communication_posts where id = '73300000-0000-0000-0000-000000000001') then
        raise exception 'A linked family could not see its classroom update';
    end if;
end;
$$;
select set_config('request.jwt.claim.sub', '73000000-0000-0000-0000-000000000002', true);
do $$
begin
    if exists (select 1 from public.communication_posts where id = '73300000-0000-0000-0000-000000000001') then
        raise exception 'An unrelated family could see the classroom update';
    end if;
end;
$$;
reset role;
delete from public.gradebook_enrollments where course_id = '73200000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', '73000000-0000-0000-0000-000000000001', true);
do $$
begin
    if exists (select 1 from public.communication_posts where id = '73300000-0000-0000-0000-000000000001') then
        raise exception 'A family kept classroom access after removal from the roster';
    end if;
end;
$$;
set local role service_role;
select count(*) from public.communication_claim_delivery();
do $$
begin
    if (select count(*) from public.communication_delivery where
        post_id = '73300000-0000-0000-0000-000000000001' and state = 'cancelled') <> 1 then
        raise exception 'Delivery to the former classroom family was not cancelled';
    end if;
end;
$$;

rollback;

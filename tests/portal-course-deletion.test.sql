-- Run in a disposable database with the portal migrations applied.
begin;

insert into auth.users (id, email) values
    ('78100000-0000-0000-0000-000000000001', 'course-admin@example.com'),
    ('78100000-0000-0000-0000-000000000002', 'course-teacher@example.com'),
    ('78100000-0000-0000-0000-000000000003', 'course-family@example.com');
insert into public.portal_users (id, display_name, role) values
    ('78100000-0000-0000-0000-000000000001', 'Test Administrator', 'admin'),
    ('78100000-0000-0000-0000-000000000002', 'Test Teacher', 'teacher'),
    ('78100000-0000-0000-0000-000000000003', 'Test Family', 'family');
insert into public.students (id, family_id, first_name, last_name) values
    ('78200000-0000-0000-0000-000000000001', '78100000-0000-0000-0000-000000000003', 'Test', 'Student');

insert into public.gradebook_courses (id, teacher_id, name, term, weighting, missing_is_zero, categories, scale) values
    ('78300000-0000-0000-0000-000000000001', '78100000-0000-0000-0000-000000000002', 'Studio', 'Fall', 'points', false, '{"General":0}', '{"A":90,"F":0}'),
    ('78300000-0000-0000-0000-000000000002', '78100000-0000-0000-0000-000000000002', 'Science', 'Fall', 'points', false, '{"General":0}', '{"A":90,"F":0}');
insert into public.gradebook_enrollments (id, course_id, student_id, requirement_key, grade_level, credits) values
    ('78400000-0000-0000-0000-000000000001', '78300000-0000-0000-0000-000000000001', '78200000-0000-0000-0000-000000000001', 'fine_arts', '9', 1),
    ('78400000-0000-0000-0000-000000000002', '78300000-0000-0000-0000-000000000002', '78200000-0000-0000-0000-000000000001', 'biology', '9', 1);
insert into public.gradebook_assignments (id, course_id, title, category, points) values
    ('78500000-0000-0000-0000-000000000001', '78300000-0000-0000-0000-000000000001', 'Portfolio', 'General', 10);
insert into public.gradebook_marks (enrollment_id, assignment_id, course_id, state, score) values
    ('78400000-0000-0000-0000-000000000001', '78500000-0000-0000-0000-000000000001', '78300000-0000-0000-0000-000000000001', 'scored', 10);
insert into public.gradebook_google_courses (course_id, source_course, source_name) values
    ('78300000-0000-0000-0000-000000000001', 'google-course', 'Studio');
insert into public.gradebook_google_assignments (course_id, source_assignment, assignment_id) values
    ('78300000-0000-0000-0000-000000000001', 'google-assignment', '78500000-0000-0000-0000-000000000001');
insert into public.gradebook_google_scores (enrollment_id, assignment_id, score, source_updated_at) values
    ('78400000-0000-0000-0000-000000000001', '78500000-0000-0000-0000-000000000001', 10, now());
insert into public.communication_posts (id, kind, title, body, course_id) values
    ('78600000-0000-0000-0000-000000000001', 'announcement', 'Studio News', 'Class update', '78300000-0000-0000-0000-000000000001'),
    ('78600000-0000-0000-0000-000000000002', 'announcement', 'School News', 'School-wide update', null);
insert into public.communication_delivery (post_id, family_id) values
    ('78600000-0000-0000-0000-000000000001', '78100000-0000-0000-0000-000000000003');

set local role authenticated;
select set_config('request.jwt.claim.sub', '78100000-0000-0000-0000-000000000002', true);
select public.gradebook_finalize('78400000-0000-0000-0000-000000000001', 1);
do $$
begin
    perform public.portal_delete_course('78300000-0000-0000-0000-000000000001');
    raise exception 'A teacher could delete their own class';
exception when insufficient_privilege then null;
end;
$$;

select set_config('request.jwt.claim.sub', '78100000-0000-0000-0000-000000000001', true);
select public.portal_delete_course('78300000-0000-0000-0000-000000000001');
reset role;

do $$
declare
    deleted_course constant uuid := '78300000-0000-0000-0000-000000000001';
    deleted_enrollment constant uuid := '78400000-0000-0000-0000-000000000001';
    deleted_post constant uuid := '78600000-0000-0000-0000-000000000001';
begin
    if exists (select 1 from public.gradebook_courses where id = deleted_course)
        or exists (select 1 from public.gradebook_enrollments where course_id = deleted_course)
        or exists (select 1 from public.gradebook_assignments where course_id = deleted_course)
        or exists (select 1 from public.gradebook_marks where course_id = deleted_course)
        or exists (select 1 from public.gradebook_final_courses where course_id = deleted_course)
        or exists (select 1 from public.gradebook_history where course_id = deleted_course)
        or exists (select 1 from public.gradebook_google_courses where course_id = deleted_course)
        or exists (select 1 from public.gradebook_google_assignments where course_id = deleted_course)
        or exists (select 1 from public.gradebook_google_scores where enrollment_id = deleted_enrollment)
        or exists (select 1 from public.communication_posts where id = deleted_post)
        or exists (select 1 from public.communication_delivery where post_id = deleted_post) then
        raise exception 'Class deletion left dependent records';
    end if;
    if not exists (select 1 from public.students where id = '78200000-0000-0000-0000-000000000001')
        or not exists (select 1 from public.gradebook_enrollments where id = '78400000-0000-0000-0000-000000000002')
        or not exists (select 1 from public.communication_posts where id = '78600000-0000-0000-0000-000000000002') then
        raise exception 'Class deletion affected unrelated records';
    end if;
end;
$$;

rollback;

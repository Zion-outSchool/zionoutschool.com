-- Run in a disposable database after the gradebook and class dates migrations.
begin;

insert into auth.users (id, email) values
    ('80100000-0000-0000-0000-000000000001', 'course-dates-teacher@example.com');
insert into public.portal_users (id, display_name, role) values
    ('80100000-0000-0000-0000-000000000001', 'Test Teacher', 'teacher');
insert into public.students (id, first_name, last_name) values
    ('80200000-0000-0000-0000-000000000001', 'Test', 'Student');
insert into public.gradebook_courses (id, teacher_id, name, term, weighting, missing_is_zero, categories, scale) values
    ('80300000-0000-0000-0000-000000000001', '80100000-0000-0000-0000-000000000001',
        'Studio', 'Fall', 'points', false, '{"General":0}', '{"A":90,"F":0}');
insert into public.gradebook_enrollments (id, course_id, student_id, grade_level, credits) values
    ('80400000-0000-0000-0000-000000000001', '80300000-0000-0000-0000-000000000001',
        '80200000-0000-0000-0000-000000000001', '9', 0);
insert into public.gradebook_assignments (id, course_id, title, category, points) values
    ('80500000-0000-0000-0000-000000000001', '80300000-0000-0000-0000-000000000001', 'Portfolio', 'General', 10);
insert into public.gradebook_marks (enrollment_id, assignment_id, course_id, state, score) values
    ('80400000-0000-0000-0000-000000000001', '80500000-0000-0000-0000-000000000001',
        '80300000-0000-0000-0000-000000000001', 'scored', 10);

set local role authenticated;
select set_config('request.jwt.claim.sub', '80100000-0000-0000-0000-000000000001', true);
do $$
declare
    target_course constant uuid := '80300000-0000-0000-0000-000000000001';
    target_enrollment constant uuid := '80400000-0000-0000-0000-000000000001';
    school_day date := (clock_timestamp() at time zone 'America/New_York')::date;
begin
    begin
        perform public.gradebook_finalize(target_enrollment, 0);
        raise exception 'A legacy class without dates could finalize a new grade';
    exception when invalid_parameter_value then null;
    end;
    begin
        update public.gradebook_courses set starts_on = school_day where id = target_course;
        raise exception 'A single date was accepted';
    exception when check_violation then null;
    end;
    begin
        update public.gradebook_courses set starts_on = school_day, ends_on = school_day - 1 where id = target_course;
        raise exception 'An end date before the start date was accepted';
    exception when check_violation then null;
    end;
    update public.gradebook_courses set starts_on = school_day, ends_on = school_day where id = target_course;
    begin
        perform public.gradebook_finalize(target_enrollment, 0);
        raise exception 'A grade was finalized on the class end date';
    exception when invalid_parameter_value then null;
    end;
    update public.gradebook_courses set starts_on = school_day - 2, ends_on = school_day - 1 where id = target_course;
    if (public.gradebook_finalize(target_enrollment, 0)).final_grade is distinct from 'A' then
        raise exception 'A completed class could not finalize a grade';
    end if;
    update public.gradebook_courses set ends_on = school_day + 1 where id = target_course;
    if (public.gradebook_finalize(target_enrollment, 0)).final_grade is distinct from 'A' then
        raise exception 'An existing finalized grade was lost';
    end if;
    perform public.gradebook_reopen(target_enrollment, 'Test reopening');
    begin
        perform public.gradebook_finalize(target_enrollment, 0);
        raise exception 'A reopened grade could be finalized before the class ends';
    exception when invalid_parameter_value then null;
    end;
end;
$$;

rollback;

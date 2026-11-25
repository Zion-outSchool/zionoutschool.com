-- Run after the base portal, gradebook and Google Classroom import migrations.
begin;

insert into auth.users (id,email) values
 ('76100000-0000-0000-0000-000000000001','google-teacher@example.com'),
 ('76100000-0000-0000-0000-000000000002','other-google-teacher@example.com');
insert into public.portal_users (id,display_name,role) values
 ('76100000-0000-0000-0000-000000000001','Google Teacher','teacher'),
 ('76100000-0000-0000-0000-000000000002','Other Teacher','teacher');
insert into public.students (id,first_name,last_name) values
 ('76200000-0000-0000-0000-000000000001','Student','One');
insert into public.gradebook_courses (id,teacher_id,name,term,weighting,missing_is_zero,categories,scale)
values ('76300000-0000-0000-0000-000000000001','76100000-0000-0000-0000-000000000001',
    'Studio','Fall 2026','points',false,'{"General":0}','{"A":90,"F":0}');
insert into public.gradebook_enrollments (id,course_id,student_id,grade_level,credits)
values ('76400000-0000-0000-0000-000000000001','76300000-0000-0000-0000-000000000001','76200000-0000-0000-0000-000000000001','9',0);
update public.gradebook_google_settings set client_id = 'fictional-google-client.apps.googleusercontent.com';

set local role authenticated;
select set_config('request.jwt.claim.sub','76100000-0000-0000-0000-000000000002',true);
do $$
begin
    begin
        perform public.gradebook_google_context('76300000-0000-0000-0000-000000000001');
        raise exception 'Teacher could access another course connection';
    exception when insufficient_privilege then null;
    end;
end;
$$;

select set_config('request.jwt.claim.sub','76100000-0000-0000-0000-000000000001',true);
do $$
declare
    zion_course uuid := '76300000-0000-0000-0000-000000000001';
    roster jsonb := '{"student-google":"76400000-0000-0000-0000-000000000001"}';
    assignments jsonb := '[{"source_id":"work-1","title":"Portfolio","points":10}]';
    grades jsonb := '[{"source_id":"work-1","google_student":"student-google","score":0,"updated_at":"2026-10-01T12:00:00Z"}]';
    outcome jsonb;
    saved_mark public.gradebook_marks;
begin
    outcome := public.gradebook_google_import(zion_course,'google-class','Google Studio',roster,'General',assignments,grades);
    if outcome->>'new_assignments' <> '1' or outcome->>'updated_scores' <> '1' then
        raise exception 'First import did not add the assignment and grade';
    end if;
    select * into saved_mark from public.gradebook_marks m where m.course_id = zion_course;
    if saved_mark.state <> 'scored' or saved_mark.score <> 0 then raise exception 'Returned zero was lost'; end if;
    outcome := public.gradebook_google_import(zion_course,'google-class','Google Studio',roster,'General',assignments,grades);
    if outcome->>'new_assignments' <> '0' or outcome->>'updated_scores' <> '0' then raise exception 'Replay was not idempotent'; end if;

    grades := '[{"source_id":"work-1","google_student":"student-google","score":8,"updated_at":"2026-10-02T12:00:00Z"}]';
    outcome := public.gradebook_google_import(zion_course,'google-class','Google Studio',roster,'General',assignments,grades);
    if outcome->>'updated_scores' <> '1' then raise exception 'A newer grade did not update its imported score'; end if;
    select * into saved_mark from public.gradebook_marks m where m.course_id = zion_course;
    perform public.gradebook_save_marks(zion_course, jsonb_build_array(to_jsonb(saved_mark) ||
        '{"state":"excused","score":null,"family_feedback":"Waived in Zion"}'::jsonb));
    grades := '[{"source_id":"work-1","google_student":"student-google","score":9,"updated_at":"2026-10-03T12:00:00Z"}]';
    outcome := public.gradebook_google_import(zion_course,'google-class','Google Studio',roster,'General',assignments,grades);
    if outcome->>'updated_scores' <> '0'
        or not exists (select 1 from public.gradebook_marks m where m.state = 'excused' and m.family_feedback = 'Waived in Zion') then
        raise exception 'A local waiver or feedback was overwritten';
    end if;
    begin
        perform public.gradebook_google_import(zion_course,'different-class','Different',roster,'General',assignments,grades);
        raise exception 'A different course replaced the original binding';
    exception when invalid_parameter_value then null;
    end;
end;
$$;

rollback;

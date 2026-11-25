-- Run in a disposable database with the portal migrations applied.
begin;

insert into auth.users (id,email) values
 ('77100000-0000-0000-0000-000000000001','delete-admin@example.com'),
 ('77100000-0000-0000-0000-000000000002','delete-teacher@example.com'),
 ('77100000-0000-0000-0000-000000000003','delete-family@example.com');
insert into public.portal_users (id,display_name,role) values
 ('77100000-0000-0000-0000-000000000001','Test Administrator','admin'),
 ('77100000-0000-0000-0000-000000000002','Test Teacher','teacher'),
 ('77100000-0000-0000-0000-000000000003','Test Family','family');
insert into public.students (id,family_id,first_name,last_name) values
 ('77200000-0000-0000-0000-000000000001','77100000-0000-0000-0000-000000000003','Test','Student'),
 ('77200000-0000-0000-0000-000000000002','77100000-0000-0000-0000-000000000003','Test','Sibling');

insert into public.gradebook_courses (id,teacher_id,name,term,weighting,missing_is_zero,categories,scale)
values ('77300000-0000-0000-0000-000000000001','77100000-0000-0000-0000-000000000002',
    'Studio','Fall','points',false,'{"General":0}','{"A":90,"F":0}');
insert into public.gradebook_enrollments (id,course_id,student_id,grade_level,credits)
values ('77400000-0000-0000-0000-000000000001','77300000-0000-0000-0000-000000000001','77200000-0000-0000-0000-000000000001','9',0);
insert into public.gradebook_assignments (id,course_id,title,category,points)
values ('77500000-0000-0000-0000-000000000001','77300000-0000-0000-0000-000000000001','Portfolio','General',10);
insert into public.gradebook_marks (enrollment_id,assignment_id,course_id,state,score)
values ('77400000-0000-0000-0000-000000000001','77500000-0000-0000-0000-000000000001','77300000-0000-0000-0000-000000000001','scored',10);
insert into public.gradebook_google_courses (course_id,source_course,source_name,student_matches)
values ('77300000-0000-0000-0000-000000000001','sample-course','Sample','{"sample-google-student":"77400000-0000-0000-0000-000000000001"}');
insert into public.gradebook_google_scores (enrollment_id,assignment_id,score,source_updated_at)
values ('77400000-0000-0000-0000-000000000001','77500000-0000-0000-0000-000000000001',10,now());
insert into public.grade_reports (student_id,title,file_url)
values ('77200000-0000-0000-0000-000000000001','Example report','https://example.com/report.pdf');
insert into public.graduation_plan_entries (student_id,grade_level,requirement_key)
values ('77200000-0000-0000-0000-000000000001','9','english_i');
insert into public.communication_threads (id, student_id, subject, channel)
values ('77600000-0000-0000-0000-000000000001','77200000-0000-0000-0000-000000000001','Test message','portal');
insert into public.communication_messages (thread_id,author_name,source,body)
values ('77600000-0000-0000-0000-000000000001','Test Teacher','portal','Message body');
insert into public.registration_records (id,student_id,drive_folder_id,classroom_record,administrator_record)
values ('77700000-0000-0000-0000-000000000001','77200000-0000-0000-0000-000000000001','original-test-folder','{}','{}');
insert into public.registration_change_requests (id,student_id,record_id,requested_by,request_note)
values ('77800000-0000-0000-0000-000000000001','77200000-0000-0000-0000-000000000001',
    '77700000-0000-0000-0000-000000000001','77100000-0000-0000-0000-000000000002','Test request');
insert into public.registration_review_emails(request_id,recipient_id)
values ('77800000-0000-0000-0000-000000000001','77100000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub','77100000-0000-0000-0000-000000000002',true);
select public.gradebook_finalize('77400000-0000-0000-0000-000000000001',0);
do $$
begin
    begin
        perform public.portal_delete_student('77200000-0000-0000-0000-000000000001');
        raise exception 'A teacher could delete an assigned student';
    exception when insufficient_privilege then null;
    end;
end;
$$;

select set_config('request.jwt.claim.sub','77100000-0000-0000-0000-000000000001',true);
select public.portal_delete_student('77200000-0000-0000-0000-000000000001');
reset role;

do $$
begin
    if exists (select 1 from public.students where id = '77200000-0000-0000-0000-000000000001')
        or exists (select 1 from public.gradebook_marks where enrollment_id = '77400000-0000-0000-0000-000000000001')
        or exists (select 1 from public.gradebook_final_courses where enrollment_id = '77400000-0000-0000-0000-000000000001')
        or exists (select 1 from public.gradebook_google_scores where enrollment_id = '77400000-0000-0000-0000-000000000001')
        or exists (select 1 from public.grade_reports where student_id = '77200000-0000-0000-0000-000000000001')
        or exists (select 1 from public.graduation_plan_entries where student_id = '77200000-0000-0000-0000-000000000001')
        or exists (select 1 from public.communication_messages where thread_id = '77600000-0000-0000-0000-000000000001')
        or exists (select 1 from public.registration_change_requests where id = '77800000-0000-0000-0000-000000000001') then
        raise exception 'Student deletion left dependent records';
    end if;
    if not exists (select 1 from public.registration_records where id = '77700000-0000-0000-0000-000000000001'
                    and student_id is null and drive_folder_id = 'original-test-folder')
        or not exists (select 1 from public.students where id = '77200000-0000-0000-0000-000000000002'
                    and family_id = '77100000-0000-0000-0000-000000000003')
        or not exists (select 1 from public.gradebook_google_courses where course_id = '77300000-0000-0000-0000-000000000001'
                    and student_matches = '{}')
        or not exists (select 1 from public.gradebook_assignments where id = '77500000-0000-0000-0000-000000000001') then
        raise exception 'Deletion was broader than the student record';
    end if;
end;
$$;

rollback;

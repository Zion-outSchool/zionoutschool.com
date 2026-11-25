-- Run in a disposable database after the gradebook and Classroom import migrations.
begin;

insert into auth.users (id, email, email_confirmed_at) values
    ('79100000-0000-0000-0000-000000000001', 'grades-teacher@example.com', now()),
    ('79100000-0000-0000-0000-000000000002', 'grades-family@example.com', now()),
    ('79100000-0000-0000-0000-000000000003', 'other-grades-family@example.com', now());
insert into public.portal_users (id, display_name, role) values
    ('79100000-0000-0000-0000-000000000001', 'Test Teacher', 'teacher'),
    ('79100000-0000-0000-0000-000000000002', 'Test Family', 'family'),
    ('79100000-0000-0000-0000-000000000003', 'Other Family', 'family');
insert into public.students (id, family_id, first_name, last_name) values
    ('79200000-0000-0000-0000-000000000001', '79100000-0000-0000-0000-000000000002', 'Test', 'Student');
insert into public.gradebook_courses (id, teacher_id, name, term, weighting, missing_is_zero, categories, scale) values
    ('79300000-0000-0000-0000-000000000001', '79100000-0000-0000-0000-000000000001',
        'Studio', 'Fall', 'points', false, '{"General":0}', '{"A":90,"B":80,"C":70,"F":0}'),
    ('79300000-0000-0000-0000-000000000002', '79100000-0000-0000-0000-000000000001',
        'Science', 'Fall', 'points', false, '{"General":0}', '{"A":90,"B":80,"C":70,"F":0}');
insert into public.gradebook_enrollments (id, course_id, student_id, requirement_key, grade_level, credits) values
    ('79400000-0000-0000-0000-000000000001', '79300000-0000-0000-0000-000000000001', '79200000-0000-0000-0000-000000000001', 'fine_arts', '9', 1),
    ('79400000-0000-0000-0000-000000000002', '79300000-0000-0000-0000-000000000002', '79200000-0000-0000-0000-000000000001', 'biology', '9', 1);
insert into public.gradebook_assignments (id, course_id, title, category, points, due_on) values
    ('79500000-0000-0000-0000-000000000001', '79300000-0000-0000-0000-000000000001', 'Portfolio', 'General', 10, '2026-11-01'),
    ('79500000-0000-0000-0000-000000000002', '79300000-0000-0000-0000-000000000001', 'Sketches', 'General', 10, '2026-11-02'),
    ('79500000-0000-0000-0000-000000000003', '79300000-0000-0000-0000-000000000001', 'Draft project', 'General', 10, '2026-11-03');
insert into public.gradebook_marks (course_id, enrollment_id, assignment_id, state, score)
values ('79300000-0000-0000-0000-000000000001', '79400000-0000-0000-0000-000000000001',
    '79500000-0000-0000-0000-000000000001', 'scored', 9);
update public.gradebook_google_settings set client_id = 'example-google-client.apps.googleusercontent.com';

set local role authenticated;
select set_config('request.jwt.claim.sub', '79100000-0000-0000-0000-000000000002', true);
do $$
begin
    if public.gradebook_family_alert_preference() <> 'off' then raise exception 'Email default was not off'; end if;
    if not exists (
        select 1 from public.gradebook_family_courses('79200000-0000-0000-0000-000000000001')
        where course_name = 'Studio' and percent = 90 and letter = 'A' and not finalized
    ) then raise exception 'Existing saved grades were not visible after upgrade'; end if;
    perform public.gradebook_family_set_alert_preference('as_posted');
end;
$$;
reset role;
do $$
begin
    if exists (select 1 from public.gradebook_alert_events) then raise exception 'Opt-in backfilled existing grades'; end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '79100000-0000-0000-0000-000000000001', true);
select public.gradebook_save_marks('79300000-0000-0000-0000-000000000001', '[
    {"enrollment_id":"79400000-0000-0000-0000-000000000001","assignment_id":"79500000-0000-0000-0000-000000000002",
     "state":"scored","score":7,"rubric_scores":{},"family_feedback":"Good progress","private_note":"Staff only"},
    {"enrollment_id":"79400000-0000-0000-0000-000000000001","assignment_id":"79500000-0000-0000-0000-000000000003",
     "state":"ungraded","rubric_scores":{},"family_feedback":"","private_note":"Draft"}
]');
select public.gradebook_google_import(
    '79300000-0000-0000-0000-000000000002', 'google-test', 'Google Science',
    '{"google-student":"79400000-0000-0000-0000-000000000002"}', 'General',
    '[{"source_id":"lab","title":"Lab","points":10}]',
    '[{"source_id":"lab","google_student":"google-student","score":0,"updated_at":"2026-11-01T12:00:00Z"}]'
);
select set_config('request.jwt.claim.sub', '79100000-0000-0000-0000-000000000003', true);
do $$
begin
    if exists (select 1 from public.gradebook_family_courses('79200000-0000-0000-0000-000000000001'))
        or exists (select 1 from public.gradebook_family_assignments('79400000-0000-0000-0000-000000000001')) then
        raise exception 'A different family could read a student’s grades';
    end if;
    begin
        perform public.gradebook_claim_alerts();
        raise exception 'A browser account could claim an email';
    exception when insufficient_privilege then null;
    end;
end;
$$;

select set_config('request.jwt.claim.sub', '79100000-0000-0000-0000-000000000002', true);
do $$
begin
    if not exists (
        select 1 from public.gradebook_family_courses('79200000-0000-0000-0000-000000000001')
        where course_name = 'Studio' and percent = 80 and letter = 'B'
            and jsonb_array_length(recent_assignments) = 2
            and not (recent_assignments->0 ? 'private_note')
    ) then raise exception 'Course average or recent assignment privacy is incorrect'; end if;
    if not exists (
        select 1 from public.gradebook_family_assignments('79400000-0000-0000-0000-000000000001')
        where title = 'Sketches' and score = 7 and family_feedback = 'Good progress'
    ) or exists (
        select 1 from public.gradebook_family_assignments('79400000-0000-0000-0000-000000000001') where title = 'Draft project'
    ) then raise exception 'Posted feedback is missing or a private draft was exposed'; end if;
    if not exists (
        select 1 from public.gradebook_family_assignments('79400000-0000-0000-0000-000000000002')
        where title = 'Lab' and score = 0
    ) then raise exception 'Returned zero from Classroom was not shown'; end if;
end;
$$;
reset role;

do $$
begin
    if (select count(*) from public.gradebook_alert_events) <> 2 then
        raise exception 'Manual and Google saves did not queue both course updates';
    end if;
    if exists (select 1 from public.gradebook_claim_alerts()) then
        raise exception 'Alert was sent before the batch window';
    end if;
    if public.gradebook_alert_send_after('daily', '2026-11-24 21:00:00+00') <> '2026-11-24 23:00:00+00'
        or public.gradebook_alert_send_after('daily', '2026-07-24 23:00:00+00') <> '2026-07-25 22:00:00+00' then
        raise exception 'Daily cutoff is incorrect across time changes';
    end if;
end;
$$;

update public.gradebook_alert_events set send_after = clock_timestamp() - interval '1 second';
set local role service_role;
do $$
declare
    delivery uuid;
    attempt integer;
begin
    select id, attempts into strict delivery, attempt from public.gradebook_claim_alerts();
    if attempt <> 1 or not exists (
        select 1 from public.gradebook_alert_recipient(delivery, attempt)
        where recipient = 'grades-family@example.com' and course_count = 2
    ) then
        raise exception 'Grouped email was not addressed to the linked family';
    end if;
    if exists (select 1 from public.gradebook_claim_alerts()) then raise exception 'Claimed email was reissued'; end if;
    perform public.gradebook_finish_alert(delivery, attempt, 'accepted');
end;
$$;
reset role;

update public.gradebook_marks set private_note = 'Only the private note changed'
where assignment_id = '79500000-0000-0000-0000-000000000002';
do $$
begin
    if exists (select 1 from public.gradebook_alert_events)
        or not exists (select 1 from public.gradebook_alert_deliveries where state = 'accepted' and cardinality(enrollment_ids) = 2) then
        raise exception 'The delivery did not group both courses or private note generated an alert';
    end if;
end;
$$;

update public.gradebook_marks set state = 'excused', score = null
where assignment_id = '79500000-0000-0000-0000-000000000002';
update public.gradebook_alert_events set send_after = clock_timestamp() - interval '1 second';
select * from public.gradebook_claim_alerts();
update public.students set family_id = '79100000-0000-0000-0000-000000000003'
where id = '79200000-0000-0000-0000-000000000001';
do $$
begin
    if not exists (select 1 from public.gradebook_alert_deliveries where state = 'sending')
        or exists (select 1 from public.gradebook_alert_deliveries d
            cross join lateral public.gradebook_alert_recipient(d.id, d.attempts) where d.state = 'sending') then
        raise exception 'Queued email would go to a family that lost access';
    end if;
end;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub', '79100000-0000-0000-0000-000000000002', true);
select public.gradebook_family_set_alert_preference('off');
reset role;
do $$
begin
    if exists (select 1 from public.gradebook_alert_deliveries where state in ('sending', 'pending'))
        or exists (select 1 from public.gradebook_alert_events) then
        raise exception 'Opt-out did not cancel queued emails';
    end if;
end;
$$;

rollback;

-- Run after the portal, gradebook, communications, and newsletter SQL in a disposable database.
begin;

insert into auth.users (id, email, email_confirmed_at) values
    ('73100000-0000-0000-0000-000000000001', 'news-parent-a@example.com', now()),
    ('73100000-0000-0000-0000-000000000002', 'news-parent-b@example.com', now()),
    ('73100000-0000-0000-0000-000000000003', 'news-teacher@example.com', now()),
    ('73100000-0000-0000-0000-000000000004', 'news-unconfirmed@example.com', null);
insert into public.portal_users (id, display_name, role) values
    ('73100000-0000-0000-0000-000000000001', 'Parent A', 'family'),
    ('73100000-0000-0000-0000-000000000002', 'Parent B', 'family'),
    ('73100000-0000-0000-0000-000000000003', 'Teacher', 'teacher'),
    ('73100000-0000-0000-0000-000000000004', 'Unconfirmed family', 'family');

insert into public.students (id, family_id, first_name, last_name) values
    ('73200000-0000-0000-0000-000000000001', '73100000-0000-0000-0000-000000000001', 'Student', 'A'),
    ('73200000-0000-0000-0000-000000000002', '73100000-0000-0000-0000-000000000002', 'Student', 'B');
insert into public.gradebook_courses (id, teacher_id, name, term, weighting, missing_is_zero, categories, scale)
values ('73300000-0000-0000-0000-000000000001', '73100000-0000-0000-0000-000000000003',
    'Reading', 'Fall', 'points', false, '{"General":0}', '{"A":90,"F":0}');
insert into public.gradebook_enrollments (course_id, student_id, grade_level, credits)
values ('73300000-0000-0000-0000-000000000001', '73200000-0000-0000-0000-000000000001', '9', 0);

insert into storage.objects (bucket_id, name) values
    ('portal-news-photos', '73100000-0000-0000-0000-000000000003/73500000-0000-0000-0000-000000000001'),
    ('portal-news-photos', '73100000-0000-0000-0000-000000000003/73500000-0000-0000-0000-000000000002');

do $$
begin
    if public.newsletter_issue_for('2026-03-05 21:59+00', '2026-03-06') <> date '2026-03-06'
        or public.newsletter_issue_for('2026-03-05 22:00+00', '2026-03-06') <> date '2026-03-13'
        or public.newsletter_deadline('2026-03-13') <> '2026-03-12 21:00+00'::timestamptz
        or public.newsletter_send_time('2026-03-13') <> '2026-03-13 13:00+00'::timestamptz then
        raise exception 'Weekly deadlines must honor Eastern time and daylight saving';
    end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '73100000-0000-0000-0000-000000000003', true);
do $$
begin
    if (select issue_on from public.newsletter_submission_window()) is not null then
        raise exception 'The newsletter started enabled';
    end if;
    begin
        perform public.news_save_submission(gen_random_uuid(), null, null,
            array['73200000-0000-0000-0000-000000000002'::uuid], 'Wrong roster', 'Body', '[]', '[]');
        raise exception 'Teacher was able to target a student outside their roster';
    exception when insufficient_privilege then null;
    end;
end;
$$;

select public.news_save_submission('73400000-0000-0000-0000-000000000001', null, null,
    array['73200000-0000-0000-0000-000000000001'::uuid], 'Private update', 'First draft', '[]',
    '[{"path":"73100000-0000-0000-0000-000000000003/73500000-0000-0000-0000-000000000001","alt":"Private photo"}]');

select public.news_save_submission('73400000-0000-0000-0000-000000000001',
    (select updated_at from public.news_submissions where id = '73400000-0000-0000-0000-000000000001'), null,
    array['73200000-0000-0000-0000-000000000001'::uuid], 'Private update', 'Revised draft', '[]',
    '[{"path":"73100000-0000-0000-0000-000000000003/73500000-0000-0000-0000-000000000001","alt":"Private photo"}]');

reset role;
update public.newsletter_settings set first_issue_on = date '2026-01-02' where singleton;
set local role authenticated;
select set_config('request.jwt.claim.sub', '73100000-0000-0000-0000-000000000003', true);
select public.news_save_submission('73400000-0000-0000-0000-000000000002', null,
    (select issue_on from public.newsletter_submission_window()),
    array['73200000-0000-0000-0000-000000000001'::uuid], 'Science fair', 'Projects on display',
    '[{"url":"https://example.com/fair","label":"Fair details"}]',
    '[{"path":"73100000-0000-0000-0000-000000000003/73500000-0000-0000-0000-000000000002","alt":"Science project"}]');

select set_config('request.jwt.claim.sub', '73100000-0000-0000-0000-000000000001', true);
do $$
begin
    if (select count(*) from public.student_news_for('73200000-0000-0000-0000-000000000001')) <> 2
        or not exists (select 1 from public.student_news_for('73200000-0000-0000-0000-000000000001') where body = 'Revised draft')
        or exists (select 1 from public.news_submissions)
        or not public.news_can_read_photo('73100000-0000-0000-0000-000000000003/73500000-0000-0000-0000-000000000001')
        or exists (select 1 from public.newsletter_issues) then
        raise exception 'Family does not have the expected selected student feed and photo access';
    end if;
end;
$$;

select set_config('request.jwt.claim.sub', '73100000-0000-0000-0000-000000000002', true);
do $$
begin
    if exists (select 1 from public.student_news_for('73200000-0000-0000-0000-000000000001'))
        or public.news_can_read_photo('73100000-0000-0000-0000-000000000003/73500000-0000-0000-0000-000000000001')
        or public.news_can_read_photo('73100000-0000-0000-0000-000000000003/73500000-0000-0000-0000-000000000002') then
        raise exception 'Other family saw private student news or unpublished photos';
    end if;
    begin
        perform public.newsletter_publish_due();
        raise exception 'Browser role could run the newsletter publisher';
    exception when insufficient_privilege then null;
    end;
end;
$$;

reset role;
do $$
begin
    if public.newsletter_publish_due() <> 0 then raise exception 'Queued before the send time'; end if;
end;
$$;
update public.news_submissions set issue_on = date '2026-01-02'
where id = '73400000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', '73100000-0000-0000-0000-000000000003', true);
do $$
begin
    begin
        perform public.news_save_submission('73400000-0000-0000-0000-000000000002',
            (select updated_at from public.news_submissions where id = '73400000-0000-0000-0000-000000000002'),
            null, array['73200000-0000-0000-0000-000000000001'::uuid], 'Too late', 'Changed', '[]', '[]');
        raise exception 'Teacher edited after the deadline';
    exception when invalid_parameter_value then null;
    end;
end;
$$;


select public.news_withdraw_submission('73400000-0000-0000-0000-000000000002',
    (select updated_at from public.news_submissions where id = '73400000-0000-0000-0000-000000000002'), true);
do $$
begin
    if exists (select 1 from public.student_news_for('73200000-0000-0000-0000-000000000001') where title = 'Science fair')
        or not exists (select 1 from public.news_submissions where issue_on = '2026-01-02'
            and public.newsletter_cutoff(news_submissions) <= clock_timestamp()) then
        raise exception 'Removing a locked submission from Student News must preserve the newsletter entry';
    end if;
end;
$$;

reset role;
do $$
declare queued integer;
begin
    perform public.newsletter_publish_due();
    select count(*) into queued
    from public.communication_delivery d where d.post_id in (select id from public.newsletter_issues where issue_on = '2026-01-02')
        and d.family_id in ('73100000-0000-0000-0000-000000000001', '73100000-0000-0000-0000-000000000002');
    if queued <> 2 or public.newsletter_publish_due() <> 0
        or exists (select 1 from public.communication_delivery where family_id = '73100000-0000-0000-0000-000000000004') then
        raise exception 'Newsletter delivery must queue once per confirmed family';
    end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '73100000-0000-0000-0000-000000000002', true);
do $$
declare digest jsonb;
begin
    select entries into digest from public.newsletter_issues where issue_on = '2026-01-02';
    if digest is null or jsonb_array_length(digest) <> 1 or digest->0->>'title' <> 'Science fair'
        or digest->0 ? 'student_ids' or digest->0 ? 'news_student_targets'
        or not public.news_can_read_photo('73100000-0000-0000-0000-000000000003/73500000-0000-0000-0000-000000000002')
        or public.news_can_read_photo('73100000-0000-0000-0000-000000000003/73500000-0000-0000-0000-000000000001') then
        raise exception 'Archive includes private data or does not grant published photo access';
    end if;
end;
$$;

rollback;

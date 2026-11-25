-- Run in a disposable database after the newsletter and PDF attachment migrations.
begin;

insert into auth.users (id, email, email_confirmed_at) values
    ('81100000-0000-0000-0000-000000000001', 'pdf-teacher@example.com', now()),
    ('81100000-0000-0000-0000-000000000002', 'pdf-family@example.com', now()),
    ('81100000-0000-0000-0000-000000000003', 'pdf-other-family@example.com', now());
insert into public.portal_users (id, display_name, role) values
    ('81100000-0000-0000-0000-000000000001', 'Test Teacher', 'teacher'),
    ('81100000-0000-0000-0000-000000000002', 'Selected Family', 'family'),
    ('81100000-0000-0000-0000-000000000003', 'Other Family', 'family');

insert into public.students (id, family_id, first_name, last_name) values
    ('81200000-0000-0000-0000-000000000001', '81100000-0000-0000-0000-000000000002', 'Test', 'Student');
insert into public.gradebook_courses (id, teacher_id, name, term, weighting, missing_is_zero, categories, scale) values
    ('81300000-0000-0000-0000-000000000001', '81100000-0000-0000-0000-000000000001',
     'Art', 'Fall', 'points', false, '{"General":0}', '{"A":90,"F":0}');
insert into public.gradebook_enrollments (course_id, student_id, grade_level, credits) values
    ('81300000-0000-0000-0000-000000000001', '81200000-0000-0000-0000-000000000001', '9', 0);

update public.newsletter_settings set first_issue_on = '2026-01-02';
set local role authenticated;
select set_config('request.jwt.claim.sub', '81100000-0000-0000-0000-000000000001', true);
insert into storage.objects (bucket_id, name) values
    ('portal-news-pdfs', '81100000-0000-0000-0000-000000000001/81500000-0000-0000-0000-000000000001'),
    ('portal-news-pdfs', '81100000-0000-0000-0000-000000000001/81500000-0000-0000-0000-000000000002');
do $$
declare
    student_ids constant uuid[] := array['81200000-0000-0000-0000-000000000001'::uuid];
    private_update constant uuid := '81400000-0000-0000-0000-000000000001';
    school_update constant uuid := '81400000-0000-0000-0000-000000000002';
    private_path constant text := '81100000-0000-0000-0000-000000000001/81500000-0000-0000-0000-000000000001';
    school_path constant text := '81100000-0000-0000-0000-000000000001/81500000-0000-0000-0000-000000000002';
    private_docs jsonb := jsonb_build_array(jsonb_build_object('path', private_path, 'label', ' Private handout ', 'ignored', 'value'));
    school_docs jsonb := jsonb_build_array(jsonb_build_object('path', school_path, 'label', 'School flyer'));
begin
    begin
        perform public.news_save_submission_with_documents(private_update, null, null, student_ids, 'Broken update', 'Body',
            '[]', '[]', '[{"path":"missing","label":"Missing file"}]');
        raise exception 'A missing PDF was accepted';
    exception when invalid_parameter_value then null;
    end;
    if exists (select 1 from public.news_submissions where id = private_update) then
        raise exception 'An attachment failure did not roll back the submission';
    end if;
    perform public.news_save_submission_with_documents(private_update, null, null, student_ids, 'Private update', 'Body',
        '[]', '[]', private_docs);
    if (select documents from public.news_submissions where id = private_update)
        is distinct from '[{"label":"Private handout","path":"81100000-0000-0000-0000-000000000001/81500000-0000-0000-0000-000000000001"}]'::jsonb then
        raise exception 'Unexpected fields or untrimmed label were retained';
    end if;
    perform public.news_save_submission_with_documents(school_update, null, (select issue_on from public.newsletter_submission_window()),
        '{}'::uuid[], 'School update', 'Body', '[]', '[]', school_docs);
end;
$$;

select set_config('request.jwt.claim.sub', '81100000-0000-0000-0000-000000000002', true);
do $$
begin
    if not exists (
        select 1 from public.student_news_for('81200000-0000-0000-0000-000000000001')
        where documents->0->>'label' = 'Private handout'
    ) or (select count(*) from storage.objects where bucket_id = 'portal-news-pdfs') <> 1 then
        raise exception 'The selected family did not receive just its own attached PDF';
    end if;
    begin
        insert into storage.objects (bucket_id, name) values
            ('portal-news-pdfs', '81100000-0000-0000-0000-000000000002/81500000-0000-0000-0000-000000000003');
        raise exception 'A family could upload media';
    exception when insufficient_privilege then null;
    end;
end;
$$;
select set_config('request.jwt.claim.sub', '81100000-0000-0000-0000-000000000003', true);
do $$
begin
    if exists (select 1 from storage.objects where bucket_id = 'portal-news-pdfs') then
        raise exception 'An unrelated family could read a private or unpublished PDF';
    end if;
end;
$$;
reset role;
update public.news_submissions set issue_on = '2026-01-02' where id = '81400000-0000-0000-0000-000000000002';
select public.newsletter_publish_due();

set local role authenticated;
do $$
begin
    if not exists (select 1 from public.newsletter_issues
        where issue_on = '2026-01-02' and entries->0->'documents'->0->>'label' = 'School flyer')
        or (select count(*) from storage.objects where bucket_id = 'portal-news-pdfs') <> 1
        or not exists (select 1 from storage.objects where bucket_id = 'portal-news-pdfs' and name like '%000000000002') then
        raise exception 'Only the published newsletter PDF should be available to this family';
    end if;
end;
$$;

select set_config('request.jwt.claim.sub', '81100000-0000-0000-0000-000000000001', true);
select public.news_save_submission_with_documents('81400000-0000-0000-0000-000000000001',
    (select updated_at from public.news_submissions where id = '81400000-0000-0000-0000-000000000001'), null,
    array['81200000-0000-0000-0000-000000000001'::uuid], 'Private update', 'Revised', '[]', '[]', '[]');

select set_config('request.jwt.claim.sub', '81100000-0000-0000-0000-000000000002', true);
do $$
begin
    if exists (select 1 from storage.objects where bucket_id = 'portal-news-pdfs' and name like '%000000000001') then
        raise exception 'The removed PDF stayed visible to the family';
    end if;
end;
$$;
rollback;

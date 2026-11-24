-- Run in a disposable database after the portal, gradebook and communications updates.
begin;

insert into auth.users (id, email, email_confirmed_at) values
    ('72000000-0000-0000-0000-000000000001', 'parent-a@example.com', now()),
    ('72000000-0000-0000-0000-000000000002', 'parent-b@example.com', now()),
    ('72000000-0000-0000-0000-000000000003', 'teacher-a@example.com', now()),
    ('72000000-0000-0000-0000-000000000004', 'teacher-b@example.com', now()),
    ('72000000-0000-0000-0000-000000000005', 'school-admin@example.com', now());

insert into public.portal_users (id, display_name, role) values
    ('72000000-0000-0000-0000-000000000001', 'Parent A', 'family'),
    ('72000000-0000-0000-0000-000000000002', 'Parent B', 'family'),
    ('72000000-0000-0000-0000-000000000003', 'Teacher A', 'teacher'),
    ('72000000-0000-0000-0000-000000000004', 'Teacher B', 'teacher'),
    ('72000000-0000-0000-0000-000000000005', 'School Admin', 'admin');

insert into public.students (id, family_id, first_name, last_name) values
    ('72100000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001', 'Student', 'A'),
    ('72100000-0000-0000-0000-000000000002', '72000000-0000-0000-0000-000000000002', 'Student', 'B');

insert into public.gradebook_courses (id, teacher_id, name, term, weighting, missing_is_zero, categories, scale)
values ('72200000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000003',
        'Class A', 'Fall', 'points', false, '{"General":0}', '{"A":90,"F":0}');
insert into public.gradebook_enrollments (course_id, student_id, grade_level, credits)
values ('72200000-0000-0000-0000-000000000001', '72100000-0000-0000-0000-000000000001', '9', 0);

set local role authenticated;
select set_config('request.jwt.claim.sub', '72000000-0000-0000-0000-000000000003', true);
do $$
begin
    if (select count(*) from public.communication_students()) <> 1 then raise exception 'Teacher roster filtering failed'; end if;
    begin
        perform public.communication_send(gen_random_uuid(), '72100000-0000-0000-0000-000000000002',
            null, 'Wrong roster', 'Private message', 'both');
        raise exception 'Teacher sent to someone outside their roster';
    exception when insufficient_privilege then null; end;
    begin
        perform public.communication_publish(gen_random_uuid(), 'news', 'Unauthorized', 'Body', null, true);
        raise exception 'A teacher was able to send a school-wide bulletin';
    exception when insufficient_privilege then null; end;
end;
$$;

select public.communication_send('72300000-0000-0000-0000-000000000001',
    '72100000-0000-0000-0000-000000000001', null, 'Check in', 'Student progress', 'both');
select public.communication_send('72300000-0000-0000-0000-000000000001',
    '72100000-0000-0000-0000-000000000001', null, 'Check in', 'Student progress', 'both');
select public.communication_send('72300000-0000-0000-0000-000000000002',
    '72100000-0000-0000-0000-000000000001', null, 'Email only', 'Direct email', 'email');
select public.communication_send('72300000-0000-0000-0000-000000000003',
    '72100000-0000-0000-0000-000000000001', null, 'Portal only', 'Portal message', 'portal');

select set_config('request.jwt.claim.sub', '72000000-0000-0000-0000-000000000001', true);
do $$
begin
    if (select count(*) from public.communication_threads) <> 2
        or (select count(id) from public.communication_messages) <> 2 then
        raise exception 'Family must see only portal-enabled conversations';
    end if;
    begin
        perform public.communication_send(gen_random_uuid(), null, '72300000-0000-0000-0000-000000000002',
            null, 'Inaccessible email-only thread', null);
        raise exception 'Family was able to reply to an email-only conversation through the portal';
    exception when insufficient_privilege then null; end;
    begin
        perform token from public.communication_reply_keys;
        raise exception 'Browser role can read reply tokens';
    exception when insufficient_privilege then null; end;
    begin
        perform public.communication_claim_delivery();
        raise exception 'Browser role can claim email deliveries';
    exception when insufficient_privilege then null; end;
end;
$$;
select public.communication_send('72400000-0000-0000-0000-000000000001',
    null, '72300000-0000-0000-0000-000000000001', null, 'Parent portal reply', null);

select set_config('request.jwt.claim.sub', '72000000-0000-0000-0000-000000000002', true);
do $$
begin
    if exists(select 1 from public.communication_threads) or exists(select id from public.communication_messages) then
        raise exception 'Other family saw private messages';
    end if;
end;
$$;

reset role;
insert into storage.objects (bucket_id,name)
values ('portal-documents','72500000-0000-0000-0000-000000000001/document.pdf');
set local role authenticated;
select set_config('request.jwt.claim.sub', '72000000-0000-0000-0000-000000000005', true);
do $$
begin
    if public.communication_publish('72500000-0000-0000-0000-000000000001',
        'document', 'School handbook', 'Handbook summary', 'handbook.pdf', true) <> 2 then
        raise exception 'The bulletin must queue exactly one email per active family';
    end if;
end;
$$;

set local role service_role;
do $$
declare
    sent record;
    reply_key text;
    deliveries integer := 0;
begin
    for sent in select * from public.communication_claim_delivery() loop
        deliveries := deliveries + 1;
        if sent.subject = 'Check in' then reply_key := sent.token; end if;
        if sent.post_kind = 'document' and sent.body like '%Handbook summary%' then
            raise exception 'Document email exposed the private document summary';
        end if;
        perform public.communication_finish_delivery(sent.id, sent.attempts, 'accepted', 'fictional-id');
    end loop;
    if deliveries <> 4 or reply_key is null then raise exception 'Wrong email queue count or missing reply token'; end if;
    if public.communication_email_reply(reply_key, 'parent-b@example.com', 'Wrong sender', 'reply-1') then
        raise exception 'Accepted a reply from a different family';
    end if;
    if not public.communication_email_reply(reply_key, 'PARENT-A@example.com', 'Parent email reply', 'reply-1')
       or not public.communication_email_reply(reply_key, 'parent-a@example.com', 'Retry', 'reply-1') then
        raise exception 'Valid email reply or retry failed';
    end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '72000000-0000-0000-0000-000000000003', true);
do $$
begin
    if (select count(id) from public.communication_messages
        where thread_id = '72300000-0000-0000-0000-000000000001') <> 3
        or (select count(id) from public.communication_messages where source = 'email' and body = 'Parent email reply') <> 1
        or (select count(*) from public.communication_delivery_status('72300000-0000-0000-0000-000000000001')
            where state = 'accepted') <> 1 then
        raise exception 'Portal and email replies must share one student history';
    end if;
end;
$$;

select set_config('request.jwt.claim.sub', '72000000-0000-0000-0000-000000000004', true);
do $$
begin
    if exists(select 1 from public.communication_threads) then
        raise exception 'Unassigned teacher saw a student conversation';
    end if;
end;
$$;

reset role;
update public.students set family_id = '72000000-0000-0000-0000-000000000002'
where id = '72100000-0000-0000-0000-000000000001';
update public.portal_users set active = false where id = '72000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '72000000-0000-0000-0000-000000000002', true);
do $$
begin
    if exists(select 1 from public.communication_threads)
       or not exists(select 1 from storage.objects where bucket_id = 'portal-documents') then
        raise exception 'Relinking exposed prior conversations or prevented active family from opening published PDF';
    end if;
end;
$$;

select set_config('request.jwt.claim.sub', '72000000-0000-0000-0000-000000000001', true);
do $$
begin
    if exists(select 1 from public.communication_posts)
       or exists(select 1 from storage.objects where bucket_id = 'portal-documents') then
        raise exception 'Inactive account retained school updates or documents';
    end if;
end;
$$;
select set_config('request.jwt.claim.sub', '72000000-0000-0000-0000-000000000005', true);
select public.communication_archive('72500000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub', '72000000-0000-0000-0000-000000000002', true);
do $$
begin
    if exists(select 1 from public.communication_posts)
       or exists(select 1 from storage.objects where bucket_id = 'portal-documents') then
        raise exception 'Archived post or PDF is still visible';
    end if;
end;
$$;

rollback;

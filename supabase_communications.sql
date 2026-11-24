begin;

create table if not exists public.communication_threads (
    id uuid primary key default gen_random_uuid(),
    student_id uuid not null references public.students(id) on delete cascade,
    family_id uuid references public.portal_users(id) on delete set null,
    subject text not null check (length(btrim(subject)) between 1 and 120 and subject !~ '[[:cntrl:]]'),
    channel text not null check (channel in ('portal', 'email', 'both')),
    updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.communication_messages (
    id uuid primary key default gen_random_uuid(),
    thread_id uuid not null references public.communication_threads(id) on delete cascade,
    author_id uuid references public.portal_users(id) on delete set null,
    author_name text not null,
    source text not null check (source in ('portal', 'email')),
    body text not null check (length(btrim(body)) between 1 and 10000),
    created_at timestamptz not null default clock_timestamp(),
    email_reference text,
    unique (thread_id, email_reference)
);

create table if not exists public.communication_posts (
    id uuid primary key,
    kind text not null check (kind in ('news', 'announcement', 'document')),
    title text not null check (length(btrim(title)) between 1 and 120 and title !~ '[[:cntrl:]]'),
    body text not null check (length(btrim(body)) between 1 and 10000),
    document_name text,
    created_at timestamptz not null default clock_timestamp(),
    archived_at timestamptz,
    check ((kind = 'document') = (document_name is not null)),
    check (document_name is null or length(document_name) between 1 and 200)
);

create table if not exists public.communication_reply_keys (
    thread_id uuid primary key references public.communication_threads(id) on delete cascade,
    token text not null unique default replace(gen_random_uuid()::text, '-', '')
        check (token ~ '^[0-9a-f]{32}$')
);

create table if not exists public.communication_delivery (
    id uuid primary key default gen_random_uuid(),
    message_id uuid references public.communication_messages(id) on delete cascade,
    post_id uuid references public.communication_posts(id) on delete cascade,
    family_id uuid not null references public.portal_users(id) on delete cascade,
    state text not null default 'pending'
        check (state in ('pending', 'sending', 'accepted', 'failed', 'uncertain', 'cancelled')),
    attempts integer not null default 0,
    next_attempt_at timestamptz not null default clock_timestamp(),
    claimed_at timestamptz,
    provider_reference text,
    check ((message_id is null) <> (post_id is null)),
    unique (message_id, family_id),
    unique (post_id, family_id)
);

create index if not exists communication_threads_student_idx on public.communication_threads(student_id, updated_at desc);
create index if not exists communication_threads_family_idx on public.communication_threads(family_id, updated_at desc);
create index if not exists communication_messages_thread_idx on public.communication_messages(thread_id, created_at desc, id);
create index if not exists communication_delivery_pending_idx on public.communication_delivery(next_attempt_at)
    where state = 'pending';

alter table public.communication_threads enable row level security;
alter table public.communication_messages enable row level security;
alter table public.communication_posts enable row level security;
alter table public.communication_reply_keys enable row level security;
alter table public.communication_delivery enable row level security;

revoke all on public.communication_threads, public.communication_messages, public.communication_posts,
    public.communication_reply_keys, public.communication_delivery from public, anon, authenticated;
grant select on public.communication_threads, public.communication_posts to authenticated;
grant select (id, thread_id, author_name, source, body, created_at) on public.communication_messages to authenticated;

create or replace function public.communication_staff_can_access(target_student uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
    select coalesce(public.current_portal_role() = 'admin' or (
        public.current_portal_role() = 'teacher' and exists (
            select 1 from public.gradebook_enrollments e
            join public.gradebook_courses c on c.id = e.course_id
            where e.student_id = target_student and c.teacher_id = auth.uid()
        )
    ), false);
$$;

create or replace function public.communication_family_can_access(target_student uuid, target_family uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
    select coalesce(public.current_portal_role() = 'family' and target_family = auth.uid() and exists (
        select 1 from public.students s where s.id = target_student and s.family_id = target_family
    ), false);
$$;

drop policy if exists communication_threads_read on public.communication_threads;
create policy communication_threads_read on public.communication_threads for select to authenticated using (
    public.communication_staff_can_access(student_id) or
    (channel <> 'email' and public.communication_family_can_access(student_id, family_id))
);

drop policy if exists communication_messages_read on public.communication_messages;
create policy communication_messages_read on public.communication_messages for select to authenticated using (
    exists (select 1 from public.communication_threads t where t.id = communication_messages.thread_id)
);

drop policy if exists communication_posts_read on public.communication_posts;
create policy communication_posts_read on public.communication_posts for select to authenticated using (
    archived_at is null and public.current_portal_role() in ('family', 'teacher', 'staff', 'admin')
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portal-documents', 'portal-documents', false, 10485760, array['application/pdf'])
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists communication_documents_read on storage.objects;
create policy communication_documents_read on storage.objects for select to authenticated using (
    bucket_id = 'portal-documents' and exists (
        select 1 from public.communication_posts p
        where p.kind = 'document' and storage.objects.name = p.id::text || '/document.pdf'
    )
);
drop policy if exists communication_documents_upload on storage.objects;
create policy communication_documents_upload on storage.objects for insert to authenticated with check (
    bucket_id = 'portal-documents' and public.current_portal_role() = 'admin'
    and name ~ '^[0-9a-f-]{36}/document[.]pdf$'
);

create or replace function public.communication_students()
returns table (id uuid, display_name text, email_available boolean)
language sql stable security definer set search_path = ''
as $$
    select s.id, concat_ws(' ', coalesce(nullif(s.preferred_name, ''), s.first_name), s.last_name),
        coalesce(f.active and f.role = 'family' and u.email_confirmed_at is not null and nullif(u.email,'') is not null, false)
    from public.students s
    left join public.portal_users f on f.id = s.family_id
    left join auth.users u on u.id = f.id
    where public.communication_staff_can_access(s.id) or public.communication_family_can_access(s.id, s.family_id)
    order by s.last_name, s.first_name, s.id;
$$;

create or replace function public.communication_send(
    request_id uuid, target_student uuid, target_thread uuid, message_subject text, message_body text, delivery_channel text
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare
    actor uuid := auth.uid();
    actor_name text;
    actor_role text := public.current_portal_role();
    student_family uuid;
    thread public.communication_threads;
    staff_access boolean;
begin
    if actor_role is null or actor_role not in ('admin', 'teacher', 'family') or request_id is null
        or message_body is null or length(btrim(message_body)) not between 1 and 10000 then
        raise exception 'An active account and a valid message are required.' using errcode = '22023';
    end if;

    if target_thread is not null then
        select * into thread from public.communication_threads t where t.id = target_thread for update;
        if not found then raise exception 'Conversation unavailable.' using errcode = '42501'; end if;
        target_student := thread.student_id;
    end if;
    select s.family_id into student_family from public.students s where s.id = target_student for share;
    staff_access := public.communication_staff_can_access(target_student);
    if not found or not (staff_access or (
        target_thread is not null and thread.channel <> 'email'
        and public.communication_family_can_access(target_student, thread.family_id)
    )) then raise exception 'Student access required.' using errcode = '42501'; end if;

    if target_thread is not null and (thread.family_id is null or thread.family_id is distinct from student_family) then
        raise exception 'The family linked to this conversation has changed. Start a new conversation.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.portal_users p where p.id = student_family and p.role = 'family' and p.active) then
        raise exception 'Link an active family account before sending.' using errcode = '22023';
    end if;
    if staff_access and (case when target_thread is null then delivery_channel else thread.channel end) in ('email', 'both')
        and not exists (select 1 from auth.users u where u.id = student_family and u.email_confirmed_at is not null and nullif(u.email,'') is not null) then
        raise exception 'This family needs a confirmed email address.' using errcode = '22023';
    end if;

    if target_thread is null then
        if delivery_channel is null or delivery_channel not in ('portal', 'email', 'both') then
            raise exception 'Choose a delivery method.' using errcode = '22023';
        end if;
        insert into public.communication_threads (id, student_id, family_id, subject, channel)
        values (request_id, target_student, student_family, btrim(message_subject), delivery_channel)
        on conflict (id) do nothing;
        select * into thread from public.communication_threads t where t.id = request_id for update;
        if thread.student_id is distinct from target_student or thread.family_id is distinct from student_family
            or thread.subject is distinct from btrim(message_subject) or thread.channel is distinct from delivery_channel then
            raise exception 'This message could not be saved.' using errcode = '22023';
        end if;
    end if;

    select display_name into actor_name from public.portal_users where id = actor;
    insert into public.communication_messages (id, thread_id, author_id, author_name, source, body)
    values (request_id, thread.id, actor, actor_name, 'portal', btrim(message_body))
    on conflict (id) do nothing;
    if not found then
        if exists (select 1 from public.communication_messages m where m.id = request_id
            and m.thread_id = thread.id and m.author_id = actor and m.body = btrim(message_body)) then
            return thread.id;
        end if;
        raise exception 'This message could not be saved.' using errcode = '22023';
    end if;

    update public.communication_threads set updated_at = clock_timestamp() where id = thread.id;
    if staff_access and thread.channel in ('email', 'both') then
        insert into public.communication_reply_keys (thread_id) values (thread.id) on conflict (thread_id) do nothing;
        insert into public.communication_delivery (message_id, family_id) values (request_id, student_family);
    end if;
    return thread.id;
end;
$$;

create or replace function public.communication_publish(
    post_id uuid, post_kind text, post_title text, post_body text, file_name text, email_families boolean
) returns integer language plpgsql security definer set search_path = ''
as $$
declare queued integer := 0;
begin
    if public.current_portal_role() is distinct from 'admin' then
        raise exception 'Administrator access required.' using errcode = '42501';
    end if;
    if post_kind = 'document' and not exists (select 1 from storage.objects o
        where o.bucket_id = 'portal-documents' and o.name = post_id::text || '/document.pdf') then
        raise exception 'Upload the PDF before publishing.' using errcode = '22023';
    end if;
    insert into public.communication_posts (id, kind, title, body, document_name)
    values (post_id, post_kind, btrim(post_title), btrim(post_body), nullif(btrim(file_name), ''))
    on conflict (id) do nothing;
    if not found then
        if not exists (select 1 from public.communication_posts p where p.id = post_id and p.kind = post_kind
            and p.title = btrim(post_title) and p.body = btrim(post_body)
            and p.document_name is not distinct from nullif(btrim(file_name), '')) then
            raise exception 'This post could not be saved.' using errcode = '22023';
        end if;
        return (select count(*)::integer from public.communication_delivery d where d.post_id = communication_publish.post_id);
    end if;
    if email_families then
        insert into public.communication_delivery (post_id, family_id)
        select communication_publish.post_id, p.id
        from public.portal_users p join auth.users u on u.id = p.id
        where p.active and p.role = 'family' and u.email_confirmed_at is not null and nullif(u.email,'') is not null;
        get diagnostics queued = row_count;
    end if;
    return queued;
end;
$$;

create or replace function public.communication_archive(target_post uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
    if public.current_portal_role() is distinct from 'admin' then
        raise exception 'Administrator access required.' using errcode = '42501';
    end if;
    update public.communication_posts set archived_at = clock_timestamp()
    where id = target_post and archived_at is null;
    update public.communication_delivery set state = 'cancelled'
    where post_id = target_post and state = 'pending';
end;
$$;

create or replace function public.communication_delivery_status(target_thread uuid)
returns table (message_id uuid, state text)
language sql stable security definer set search_path = ''
as $$
    select d.message_id, d.state
    from public.communication_delivery d
    join public.communication_messages m on m.id = d.message_id
    join public.communication_threads t on t.id = m.thread_id
    where t.id = target_thread and public.communication_staff_can_access(t.student_id);
$$;

create or replace function public.communication_claim_delivery()
returns table (id uuid, recipient text, subject text, body text, token text, post_kind text, attempts integer)
language plpgsql security definer set search_path = ''
as $$
begin
    update public.communication_delivery d set state = 'uncertain'
    where d.state = 'sending' and d.claimed_at < clock_timestamp() - interval '15 minutes';

    update public.communication_delivery d set state = 'cancelled' where d.state = 'pending' and not exists (
        select 1 from public.portal_users f join auth.users u on u.id = f.id
        where f.id = d.family_id and f.active and f.role = 'family' and u.email_confirmed_at is not null and nullif(u.email,'') is not null
        and (exists (select 1 from public.communication_posts p where p.id = d.post_id and p.archived_at is null)
             or exists (select 1 from public.communication_messages m
                join public.communication_threads t on t.id = m.thread_id
                join public.students s on s.id = t.student_id
                where m.id = d.message_id and t.family_id = d.family_id and s.family_id = d.family_id))
    );

    return query
    with batch as (
        select d.id from public.communication_delivery d
        where d.state = 'pending' and d.next_attempt_at <= clock_timestamp()
        order by d.next_attempt_at, d.id limit 10 for update skip locked
    ), claimed as (
        update public.communication_delivery d
        set state = 'sending', attempts = d.attempts + 1, claimed_at = clock_timestamp()
        from batch where d.id = batch.id returning d.*
    )
    select d.id, u.email::text, coalesce(t.subject, p.title),
        case when p.kind = 'document' then 'A document is available in the Family Portal.'
             else coalesce(m.body, p.body) end,
        k.token, p.kind, d.attempts
    from claimed d
    join auth.users u on u.id = d.family_id
    left join public.communication_messages m on m.id = d.message_id
    left join public.communication_threads t on t.id = m.thread_id
    left join public.communication_reply_keys k on k.thread_id = t.id
    left join public.communication_posts p on p.id = d.post_id;
end;
$$;

create or replace function public.communication_finish_delivery(
    delivery_id uuid, claim_attempt integer, result_state text, reference text
) returns void language plpgsql security definer set search_path = ''
as $$
begin
    if result_state is null or result_state not in ('pending', 'accepted', 'failed', 'uncertain') then
        raise exception 'Invalid delivery state.' using errcode = '22023';
    end if;
    update public.communication_delivery
    set state = case when result_state = 'pending' and attempts >= 5 then 'failed' else result_state end,
        next_attempt_at = clock_timestamp() + make_interval(mins => attempts * 2),
        provider_reference = left(reference, 256)
    where id = delivery_id and state = 'sending' and attempts = claim_attempt;
end;
$$;

create or replace function public.communication_email_reply(reply_token text, sender text, message_body text, message_reference text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
    target uuid;
    family uuid;
    family_name text;
begin
    if message_body is null or length(btrim(message_body)) not between 1 and 10000
       or message_reference is null or length(message_reference) not between 1 and 250 then
        return false;
    end if;
    select t.id, f.id, f.display_name into target, family, family_name
    from public.communication_reply_keys k
    join public.communication_threads t on t.id = k.thread_id
    join public.students s on s.id = t.student_id and s.family_id = t.family_id
    join public.portal_users f on f.id = t.family_id and f.active and f.role = 'family'
    join auth.users u on u.id = f.id and u.email_confirmed_at is not null
    where k.token = reply_token and lower(u.email) = lower(btrim(sender))
    for update of t for share of s, f, u;
    if not found then return false; end if;

    insert into public.communication_messages (thread_id, author_id, author_name, source, body, email_reference)
    values (target, family, family_name, 'email', btrim(message_body), message_reference)
    on conflict (thread_id, email_reference) do nothing;
    if found then
        update public.communication_threads set updated_at = clock_timestamp() where id = target;
    end if;
    return true;
end;
$$;

revoke all on function public.communication_staff_can_access(uuid), public.communication_family_can_access(uuid, uuid),
    public.communication_students(), public.communication_send(uuid, uuid, uuid, text, text, text),
    public.communication_publish(uuid, text, text, text, text, boolean), public.communication_archive(uuid),
    public.communication_delivery_status(uuid)
from public, anon, authenticated;
grant execute on function public.communication_staff_can_access(uuid), public.communication_family_can_access(uuid, uuid),
    public.communication_students(), public.communication_send(uuid, uuid, uuid, text, text, text),
    public.communication_publish(uuid, text, text, text, text, boolean), public.communication_archive(uuid),
    public.communication_delivery_status(uuid) to authenticated;

revoke all on function public.communication_claim_delivery(), public.communication_finish_delivery(uuid, integer, text, text),
    public.communication_email_reply(text, text, text, text) from public, anon, authenticated;
grant execute on function public.communication_claim_delivery(), public.communication_finish_delivery(uuid, integer, text, text),
    public.communication_email_reply(text, text, text, text) to service_role;

commit;

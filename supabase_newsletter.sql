begin;

alter table public.communication_posts drop constraint if exists communication_posts_kind_check;
alter table public.communication_posts add constraint communication_posts_kind_check
    check (kind in ('news', 'announcement', 'document', 'newsletter'));

create table if not exists public.newsletter_settings (
    singleton boolean primary key default true check (singleton),
    first_issue_on date check (extract(isodow from first_issue_on) = 5)
);
insert into public.newsletter_settings default values on conflict do nothing;

create table if not exists public.news_submissions (
    id uuid primary key,
    author_id uuid references public.portal_users(id) on delete set null,
    author_name text not null,
    title text not null check (length(btrim(title)) between 1 and 120 and title !~ '[[:cntrl:]]'),
    body text not null check (length(btrim(body)) between 1 and 1600),
    links jsonb not null,
    photos jsonb not null,
    issue_on date check (extract(isodow from issue_on) = 5),
    updated_at timestamptz not null default clock_timestamp()
);
create index if not exists news_submissions_issue_idx on public.news_submissions(issue_on);
create index if not exists news_submissions_author_idx on public.news_submissions(author_id, updated_at desc);

create table if not exists public.news_student_targets (
    submission_id uuid not null references public.news_submissions(id) on delete cascade,
    student_id uuid not null references public.students(id) on delete cascade,
    primary key (submission_id, student_id)
);
create index if not exists news_student_targets_student_idx on public.news_student_targets(student_id);

create table if not exists public.newsletter_issues (
    id uuid primary key references public.communication_posts(id) on delete cascade,
    issue_on date not null unique,
    entries jsonb not null
);

alter table public.newsletter_settings enable row level security;
alter table public.news_submissions enable row level security;
alter table public.news_student_targets enable row level security;
alter table public.newsletter_issues enable row level security;
revoke all on public.newsletter_settings, public.news_submissions, public.news_student_targets,
    public.newsletter_issues from public, anon, authenticated;
grant select on public.news_submissions, public.news_student_targets, public.newsletter_issues to authenticated;

drop policy if exists news_submissions_owner on public.news_submissions;
create policy news_submissions_owner on public.news_submissions for select to authenticated using (
    public.current_portal_role() = 'admin' or
    (public.current_portal_role() = 'teacher' and author_id = auth.uid())
);
drop policy if exists news_student_targets_owner on public.news_student_targets;
create policy news_student_targets_owner on public.news_student_targets for select to authenticated using (
    exists (select 1 from public.news_submissions n where n.id = submission_id)
);
drop policy if exists newsletter_issues_read on public.newsletter_issues;
create policy newsletter_issues_read on public.newsletter_issues for select to authenticated using (
    exists (select 1 from public.communication_posts p where p.id = newsletter_issues.id)
);

create or replace function public.newsletter_deadline(issue_date date)
returns timestamptz language sql stable set search_path = ''
as $$ select (issue_date - 1 + time '17:00') at time zone 'America/New_York'; $$;

create or replace function public.newsletter_cutoff(submission public.news_submissions)
returns timestamptz language sql stable set search_path = ''
as $$ select public.newsletter_deadline(submission.issue_on); $$;

create or replace function public.newsletter_send_time(issue_date date)
returns timestamptz language sql stable set search_path = ''
as $$ select (issue_date + time '09:00') at time zone 'America/New_York'; $$;

create or replace function public.newsletter_issue_for(at_time timestamptz, first_issue date)
returns date language sql stable set search_path = ''
as $$
    select case when first_issue is null then null
        when at_time >= public.newsletter_deadline(friday) then greatest(friday + 7, first_issue)
        else greatest(friday, first_issue) end
    from (select date_trunc('week', at_time at time zone 'America/New_York')::date + 4 as friday) week;
$$;

create or replace function public.newsletter_submission_window()
returns table (issue_on date, deadline timestamptz, send_at timestamptz, checked_at timestamptz)
language sql stable security definer set search_path = ''
as $$
    select w.issue_date, public.newsletter_deadline(w.issue_date), public.newsletter_send_time(w.issue_date), statement_timestamp()
    from public.newsletter_settings s
    cross join lateral (select public.newsletter_issue_for(statement_timestamp(), s.first_issue_on) as issue_date) w
    where public.current_portal_role() in ('teacher', 'admin');
$$;

create or replace function public.student_news_for(target_student uuid, start_at integer default 0)
returns table (id uuid, title text, body text, author_name text, links jsonb, photos jsonb, updated_at timestamptz)
language sql stable security definer set search_path = ''
as $$
    select n.id, n.title, n.body, n.author_name, n.links, n.photos, n.updated_at
    from public.news_student_targets t
    join public.news_submissions n on n.id = t.submission_id
    join public.students s on s.id = t.student_id
    where t.student_id = target_student and (
        public.communication_staff_can_access(s.id) or public.communication_family_can_access(s.id, s.family_id)
    )
    order by n.updated_at desc, n.id desc offset greatest(start_at, 0) limit 15;
$$;

create or replace function public.news_save_submission(
    submission_id uuid, expected_update timestamptz, expected_issue date, student_ids uuid[],
    headline text, details text, submitted_links jsonb, submitted_photos jsonb
) returns void language plpgsql security definer set search_path = ''
as $$
declare
    actor uuid := auth.uid();
    actor_role text := public.current_portal_role();
    previous public.news_submissions%rowtype;
    author_label text;
    open_issue date;
    now_at timestamptz;
    media jsonb;
begin
    if actor_role is null or actor_role not in ('teacher', 'admin') then
        raise exception 'Teacher or administrator access required.' using errcode = '42501';
    end if;
    -- The publisher takes the same lock before it snapshots submissions and queues email.
    perform pg_catalog.pg_advisory_xact_lock(92002, 1);
    now_at := clock_timestamp();
    select * into previous from public.news_submissions n where n.id = submission_id;

    if previous.id is not null and previous.author_id is distinct from actor and actor_role <> 'admin' then
        raise exception 'Only the author or a school administrator can edit this submission.' using errcode = '42501';
    end if;
    if previous.id is not null and public.newsletter_deadline(previous.issue_on) <= now_at then
        raise exception 'That newsletter deadline has passed. Start a new submission for further updates.' using errcode = '22023';
    end if;
    if previous.updated_at is distinct from expected_update then
        raise exception 'This submission changed. Reload to see the latest version.' using errcode = '22023';
    end if;
    if expected_issue is not null and expected_issue is distinct from previous.issue_on then
        select public.newsletter_issue_for(now_at, s.first_issue_on) into open_issue from public.newsletter_settings s;
        if expected_issue is distinct from open_issue then
            raise exception 'The newsletter deadline or schedule changed. Reload to choose the current issue.' using errcode = '22023';
        end if;
    end if;

    if not coalesce(cardinality(student_ids) > 0, false) and expected_issue is null then
        raise exception 'Select students or choose the school-wide newsletter.' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(student_ids) as selected(id)
               where not public.communication_staff_can_access(selected.id) or
                   not exists (select 1 from public.students s where s.id = selected.id)) then
        raise exception 'Some selected students are outside your roster.' using errcode = '42501';
    end if;

    if coalesce(jsonb_typeof(submitted_links), '') <> 'array'
        or coalesce(jsonb_typeof(submitted_photos), '') <> 'array' then
        raise exception 'Check the links and photos.' using errcode = '22023';
    end if;
    if jsonb_array_length(submitted_links) > 4 or jsonb_array_length(submitted_photos) > 3 then
        raise exception 'Use up to four links and three photos.' using errcode = '22023';
    end if;
    for media in select value from jsonb_array_elements(submitted_links) loop
        if coalesce(jsonb_typeof(media->'label'), '') <> 'string'
            or coalesce(jsonb_typeof(media->'url'), '') <> 'string'
            or length(btrim(media->>'label')) not between 1 and 80
            or length(media->>'url') > 1000
            or (media->>'url') !~* '^https://[^/?#[:space:][:cntrl:]]+([/?#][^[:space:][:cntrl:]]*)?$' then
            raise exception 'Each link needs a label and a valid HTTPS URL.' using errcode = '22023';
        end if;
    end loop;
    for media in select value from jsonb_array_elements(submitted_photos) loop
        if coalesce(jsonb_typeof(media->'alt'), '') <> 'string'
            or length(btrim(media->>'alt')) not between 1 and 150
            or not exists (
                select 1 from storage.objects o where o.bucket_id = 'portal-news-photos' and o.name = media->>'path'
                and (split_part(o.name, '/', 1) = actor::text
                    or exists (select 1 from jsonb_array_elements(previous.photos) photo
                        where photo->>'path' = o.name))
            ) then
            raise exception 'Each photo needs a description and a completed upload.' using errcode = '22023';
        end if;
    end loop;

    -- Store only the displayed fields. In particular, do not carry arbitrary JSON into the school-wide digest.
    select coalesce(jsonb_agg(jsonb_build_object('label', btrim(m->>'label'), 'url', m->>'url') order by position), '[]')
    into submitted_links from jsonb_array_elements(submitted_links) with ordinality as links(m, position);
    select coalesce(jsonb_agg(jsonb_build_object('alt', btrim(m->>'alt'), 'path', m->>'path') order by position), '[]')
    into submitted_photos from jsonb_array_elements(submitted_photos) with ordinality as photos(m, position);
    select coalesce(nullif(btrim(display_name), ''), 'Zion outSchool') into author_label
    from public.portal_users where id = actor;

    insert into public.news_submissions as n (id, author_id, author_name, title, body, links, photos, issue_on, updated_at)
    values (submission_id, actor, author_label, btrim(headline), btrim(details), submitted_links, submitted_photos, expected_issue, now_at)
    on conflict (id) do update set
        title = excluded.title, body = excluded.body, links = excluded.links, photos = excluded.photos,
        issue_on = excluded.issue_on, updated_at = excluded.updated_at;

    delete from public.news_student_targets t where t.submission_id = news_save_submission.submission_id;
    insert into public.news_student_targets (submission_id, student_id)
    select distinct news_save_submission.submission_id, students.id from unnest(student_ids) students(id);
end;
$$;

create or replace function public.news_withdraw_submission(target_submission uuid, expected_update timestamptz, student_news_only boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare
    actor_role text := public.current_portal_role();
    previous public.news_submissions%rowtype;
begin
    if actor_role is null or actor_role not in ('teacher', 'admin') then
        raise exception 'Teacher or administrator access required.' using errcode = '42501';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(92002, 1);
    select * into previous from public.news_submissions where id = target_submission;
    if previous.id is null or (actor_role <> 'admin' and previous.author_id is distinct from auth.uid()) then
        raise exception 'You cannot withdraw this submission.' using errcode = '42501';
    end if;
    if previous.updated_at is distinct from expected_update then
        raise exception 'This submission changed. Reload to see the latest version.' using errcode = '22023';
    end if;
    -- At cutoff, preserve the newsletter entry and only clear the student feed.
    if student_news_only is distinct from coalesce(public.newsletter_deadline(previous.issue_on) <= clock_timestamp(), false) then
        raise exception 'The newsletter deadline has changed. Reload before removing this update.' using errcode = '22023';
    end if;
    if student_news_only then
        delete from public.news_student_targets where submission_id = target_submission;
        update public.news_submissions set updated_at = clock_timestamp() where id = target_submission;
    else
        delete from public.news_submissions where id = target_submission;
    end if;
end;
$$;

create or replace function public.newsletter_publish_due()
returns integer language plpgsql security definer set search_path = ''
as $$
declare
    first_issue date;
    due_issue date;
    issue_id uuid;
    entries jsonb;
    queued integer := 0;
    inserted integer;
begin
    perform pg_catalog.pg_advisory_xact_lock(92002, 1);
    select first_issue_on into first_issue from public.newsletter_settings;
    if first_issue is null then return 0; end if;
    for due_issue in
        select distinct n.issue_on from public.news_submissions n
        where n.issue_on >= first_issue and public.newsletter_send_time(n.issue_on) <= clock_timestamp()
        and not exists (select 1 from public.newsletter_issues i where i.issue_on = n.issue_on)
        order by n.issue_on
    loop
        select jsonb_agg(jsonb_build_object('title', n.title, 'body', n.body, 'author_name', n.author_name,
            'links', n.links, 'photos', n.photos) order by n.title, n.id)
        into entries
        from public.news_submissions n
        join public.portal_users p on p.id = n.author_id and p.active and p.role in ('admin', 'teacher')
        where n.issue_on = due_issue;
        if entries is null then continue; end if;

        issue_id := gen_random_uuid();
        insert into public.communication_posts (id, kind, title, body)
        values (issue_id, 'newsletter', 'Zion Weekly Newsletter • ' || to_char(due_issue, 'Mon FMDD, YYYY'),
            'School news and highlights from Zion outSchool.');
        insert into public.newsletter_issues (id, issue_on, entries) values (issue_id, due_issue, entries);
        insert into public.communication_delivery (post_id, family_id)
        select issue_id, p.id from public.portal_users p join auth.users u on u.id = p.id
        where p.active and p.role = 'family' and u.email_confirmed_at is not null and nullif(u.email, '') is not null;
        get diagnostics inserted = row_count;
        queued := queued + inserted;
    end loop;
    return queued;
end;
$$;

create or replace function public.newsletter_delivery_content(target_delivery uuid)
returns table (id uuid, entries jsonb)
language sql stable security definer set search_path = ''
as $$
    select i.id, i.entries
    from public.communication_delivery d
    join public.newsletter_issues i on i.id = d.post_id
    join public.communication_posts p on p.id = i.id
    where d.id = target_delivery and d.state = 'sending' and p.archived_at is null;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portal-news-photos', 'portal-news-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.news_can_read_photo(photo_path text)
returns boolean language sql stable security definer set search_path = ''
as $$
    select
        public.current_portal_role() = 'admin'
        or (public.current_portal_role() = 'teacher' and split_part(photo_path, '/', 1) = auth.uid()::text)
        or exists (
            select 1 from public.news_submissions n
            join public.news_student_targets t on t.submission_id = n.id
            join public.students s on s.id = t.student_id
            where n.photos @> jsonb_build_array(jsonb_build_object('path', photo_path))
                and (public.communication_staff_can_access(s.id) or public.communication_family_can_access(s.id, s.family_id))
        )
        or (public.current_portal_role() in ('admin', 'teacher', 'family', 'staff') and exists (
            select 1 from public.newsletter_issues i join public.communication_posts p on p.id = i.id
            where p.archived_at is null and i.entries @> jsonb_build_array(
                jsonb_build_object('photos', jsonb_build_array(jsonb_build_object('path', photo_path))))
        ));
$$;

drop policy if exists news_photo_read on storage.objects;
create policy news_photo_read on storage.objects for select to authenticated using (
    bucket_id = 'portal-news-photos' and public.news_can_read_photo(name)
);
drop policy if exists news_photo_upload on storage.objects;
create policy news_photo_upload on storage.objects for insert to authenticated with check (
    bucket_id = 'portal-news-photos' and public.current_portal_role() in ('admin', 'teacher')
    and name ~ ('^' || auth.uid()::text || '/[0-9a-f-]{36}$')
);

revoke all on function public.newsletter_deadline(date), public.newsletter_send_time(date),
    public.newsletter_issue_for(timestamptz, date) from public, anon, authenticated;
revoke all on function public.newsletter_cutoff(public.news_submissions), public.newsletter_submission_window(), public.student_news_for(uuid, integer),
    public.news_save_submission(uuid, timestamptz, date, uuid[], text, text, jsonb, jsonb),
    public.news_withdraw_submission(uuid, timestamptz, boolean), public.news_can_read_photo(text) from public, anon;
grant execute on function public.newsletter_deadline(date), public.newsletter_cutoff(public.news_submissions), public.newsletter_submission_window(), public.student_news_for(uuid, integer),
    public.news_save_submission(uuid, timestamptz, date, uuid[], text, text, jsonb, jsonb),
    public.news_withdraw_submission(uuid, timestamptz, boolean), public.news_can_read_photo(text) to authenticated;
revoke all on function public.newsletter_publish_due(), public.newsletter_delivery_content(uuid)
    from public, anon, authenticated;
grant execute on function public.newsletter_publish_due(), public.newsletter_delivery_content(uuid) to service_role;

commit;

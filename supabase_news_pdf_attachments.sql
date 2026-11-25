begin;

alter table public.news_submissions add column if not exists documents jsonb not null default '[]';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portal-news-pdfs', 'portal-news-pdfs', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Release the attachments with the same audience and deadline checks as the update itself.
create or replace function public.news_save_submission_with_documents(
    submission_id uuid, expected_update timestamptz, expected_issue date, student_ids uuid[],
    headline text, details text, submitted_links jsonb, submitted_photos jsonb, submitted_documents jsonb
) returns void language plpgsql security definer set search_path = ''
as $$
declare
    previous_documents jsonb;
begin
    perform public.news_save_submission(submission_id, expected_update, expected_issue, student_ids,
        headline, details, submitted_links, submitted_photos);

    if coalesce(jsonb_typeof(submitted_documents), '') <> 'array' then
        raise exception 'Check the PDF attachments.' using errcode = '22023';
    end if;
    if jsonb_array_length(submitted_documents) > 3 then
        raise exception 'Use up to three PDF attachments.' using errcode = '22023';
    end if;
    select n.documents into previous_documents from public.news_submissions n where n.id = submission_id;
    if exists (
        select 1 from jsonb_array_elements(submitted_documents) doc
        where coalesce(jsonb_typeof(doc->'label'), '') <> 'string'
            or coalesce(jsonb_typeof(doc->'path'), '') <> 'string'
            or length(btrim(doc->>'label')) not between 1 and 120
            or (doc->>'label') ~ '[[:cntrl:]]'
            or not exists (
                select 1 from storage.objects o
                where o.bucket_id = 'portal-news-pdfs' and o.name = doc->>'path'
                    and (split_part(o.name, '/', 1) = auth.uid()::text
                        or previous_documents @> jsonb_build_array(jsonb_build_object('path', o.name)))
            )
    ) then
        raise exception 'Each PDF needs a title and a completed upload.' using errcode = '22023';
    end if;

    update public.news_submissions n
    set documents = coalesce((
        select jsonb_agg(jsonb_build_object('label', btrim(doc->>'label'), 'path', doc->>'path') order by position)
        from jsonb_array_elements(submitted_documents) with ordinality as items(doc, position)
    ), '[]')
    where n.id = submission_id;
end;
$$;

drop function if exists public.student_news_for(uuid, integer);
create or replace function public.student_news_for(target_student uuid, start_at integer default 0)
returns table (id uuid, title text, body text, author_name text, links jsonb, photos jsonb, updated_at timestamptz, documents jsonb)
language sql stable security definer set search_path = ''
as $$
    select n.id, n.title, n.body, n.author_name, n.links, n.photos, n.updated_at, n.documents
    from public.news_student_targets t
    join public.news_submissions n on n.id = t.submission_id
    join public.students s on s.id = t.student_id
    where t.student_id = target_student and (
        public.communication_staff_can_access(s.id) or public.communication_family_can_access(s.id, s.family_id)
    )
    order by n.updated_at desc, n.id desc offset greatest(start_at, 0) limit 15;
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
            'links', n.links, 'photos', n.photos, 'documents', n.documents) order by n.title, n.id)
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

create or replace function public.news_can_read_pdf(pdf_path text)
returns boolean language sql stable security definer set search_path = ''
as $$
    select
        public.current_portal_role() = 'admin'
        or (public.current_portal_role() = 'teacher' and split_part(pdf_path, '/', 1) = auth.uid()::text)
        or exists (
            select 1 from public.news_submissions n
            join public.news_student_targets t on t.submission_id = n.id
            join public.students s on s.id = t.student_id
            where n.documents @> jsonb_build_array(jsonb_build_object('path', pdf_path))
                and (public.communication_staff_can_access(s.id) or public.communication_family_can_access(s.id, s.family_id))
        )
        or (public.current_portal_role() in ('admin', 'teacher', 'family', 'staff') and exists (
            select 1 from public.newsletter_issues i join public.communication_posts p on p.id = i.id
            where p.archived_at is null and i.entries @> jsonb_build_array(
                jsonb_build_object('documents', jsonb_build_array(jsonb_build_object('path', pdf_path))))
        ));
$$;

drop policy if exists news_pdf_read on storage.objects;
create policy news_pdf_read on storage.objects for select to authenticated using (
    bucket_id = 'portal-news-pdfs' and public.news_can_read_pdf(name)
);
drop policy if exists news_pdf_upload on storage.objects;
create policy news_pdf_upload on storage.objects for insert to authenticated with check (
    bucket_id = 'portal-news-pdfs' and public.current_portal_role() in ('admin', 'teacher')
    and name ~ ('^' || auth.uid()::text || '/[0-9a-f-]{36}$')
);

revoke all on function public.news_save_submission_with_documents(uuid, timestamptz, date, uuid[], text, text, jsonb, jsonb, jsonb),
    public.student_news_for(uuid, integer), public.news_can_read_pdf(text) from public, anon, authenticated;
grant execute on function public.news_save_submission_with_documents(uuid, timestamptz, date, uuid[], text, text, jsonb, jsonb, jsonb),
    public.student_news_for(uuid, integer), public.news_can_read_pdf(text) to authenticated;

commit;

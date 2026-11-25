begin;

-- The family endpoints expose saved results for the signed-in family's own students.
create or replace function public.gradebook_family_courses(target_student uuid)
returns table (enrollment_id uuid, course_name text, term text, percent numeric, letter text,
    finalized boolean, earned_credits numeric, recent_assignments jsonb)
language sql stable security definer set search_path = ''
as $$
    select e.id, coalesce(f.course_name, c.name), coalesce(f.term, c.term),
        coalesce(f.calculated_percent, grade.percent),
        coalesce(f.final_grade, grade.letter), f.enrollment_id is not null,
        case when f.requirement_key is not null then f.credits end,
        coalesce(recent.items, '[]'::jsonb)
    from public.students s
    join public.gradebook_enrollments e on e.student_id = s.id
    join public.gradebook_courses c on c.id = e.course_id
    left join public.gradebook_final_courses f on f.enrollment_id = e.id
    left join lateral public.gradebook_calculate(e.id) grade on f.enrollment_id is null
    left join lateral (
        select jsonb_agg(to_jsonb(a) order by a.due_on desc nulls last, a.assignment_id desc) as items
        from (
            select m.assignment_id, a.title, a.due_on, a.points, m.state, m.score, m.family_feedback
            from public.gradebook_marks m join public.gradebook_assignments a on a.id = m.assignment_id
            where m.enrollment_id = e.id and (m.state <> 'ungraded' or btrim(m.family_feedback) <> '')
            order by a.due_on desc nulls last, m.assignment_id desc limit 3
        ) a
    ) recent on true
    where s.id = target_student and s.family_id = auth.uid() and public.current_portal_role() = 'family'
    order by f.enrollment_id is not null, c.term desc, c.name, e.id;
$$;

create or replace function public.gradebook_family_assignments(target_enrollment uuid, page_offset integer default 0)
returns table (assignment_id uuid, title text, due_on date, points numeric, state text, score numeric, family_feedback text)
language sql stable security definer set search_path = ''
as $$
    select a.id, a.title, a.due_on, a.points, m.state, m.score, m.family_feedback
    from public.gradebook_enrollments e
    join public.students s on s.id = e.student_id
    join public.gradebook_marks m on m.enrollment_id = e.id
    join public.gradebook_assignments a on a.id = m.assignment_id
    where e.id = target_enrollment and s.family_id = auth.uid() and public.current_portal_role() = 'family'
        and (m.state <> 'ungraded' or btrim(m.family_feedback) <> '')
    order by a.due_on desc nulls last, a.id desc
    limit 51 offset greatest(page_offset, 0);
$$;

create table if not exists public.gradebook_alert_preferences (
    family_id uuid primary key references public.portal_users(id) on delete cascade,
    frequency text not null check (frequency in ('as_posted', 'daily', 'off'))
);
create table if not exists public.gradebook_alert_events (
    family_id uuid not null references public.gradebook_alert_preferences(family_id) on delete cascade,
    enrollment_id uuid not null references public.gradebook_enrollments(id) on delete cascade,
    send_after timestamptz not null,
    primary key (family_id, enrollment_id)
);
create index if not exists gradebook_alert_events_enrollment_idx on public.gradebook_alert_events (enrollment_id);
create table if not exists public.gradebook_alert_deliveries (
    id uuid primary key default gen_random_uuid(),
    family_id uuid not null references public.gradebook_alert_preferences(family_id) on delete cascade,
    enrollment_ids uuid[] not null,
    state text not null default 'pending' check (state in ('pending', 'sending', 'accepted', 'failed', 'uncertain', 'cancelled')),
    attempts integer not null default 0,
    next_attempt_at timestamptz not null default clock_timestamp(),
    claimed_at timestamptz
);
create unique index if not exists gradebook_alert_active_delivery_idx
    on public.gradebook_alert_deliveries (family_id) where state in ('pending', 'sending');

alter table public.gradebook_alert_preferences enable row level security;
alter table public.gradebook_alert_events enable row level security;
alter table public.gradebook_alert_deliveries enable row level security;
revoke all on public.gradebook_alert_preferences, public.gradebook_alert_events, public.gradebook_alert_deliveries
    from public, anon, authenticated;

create or replace function public.gradebook_alert_send_after(frequency text, changed_at timestamptz)
returns timestamptz language sql stable set search_path = ''
as $$
    with cutoff as (
        select date_trunc('day', changed_at at time zone 'America/New_York') + interval '18 hours' as local_time
    )
    select case when frequency = 'as_posted' then changed_at + interval '1 minute'
        when changed_at < (local_time at time zone 'America/New_York') then local_time at time zone 'America/New_York'
        else (local_time + interval '1 day') at time zone 'America/New_York' end
    from cutoff;
$$;

create or replace function public.gradebook_family_alert_preference()
returns text language sql stable security definer set search_path = ''
as $$
    select coalesce((select frequency from public.gradebook_alert_preferences where family_id = auth.uid()), 'off')
    where public.current_portal_role() = 'family';
$$;

create or replace function public.gradebook_family_set_alert_preference(new_frequency text)
returns text language plpgsql security definer set search_path = ''
as $$
begin
    if public.current_portal_role() is distinct from 'family' then
        raise exception 'Family access is required.' using errcode = '42501';
    end if;
    if new_frequency is null or new_frequency not in ('as_posted', 'daily', 'off') then
        raise exception 'Choose a grade email frequency.' using errcode = '22023';
    end if;
    insert into public.gradebook_alert_preferences (family_id, frequency) values (auth.uid(), new_frequency)
    on conflict (family_id) do update set frequency = excluded.frequency
    where public.gradebook_alert_preferences.frequency is distinct from excluded.frequency;
    if not found then return new_frequency; end if;

    if new_frequency = 'off' then
        delete from public.gradebook_alert_events where family_id = auth.uid();
        update public.gradebook_alert_deliveries set state = 'cancelled'
        where family_id = auth.uid() and state in ('pending', 'sending');
    else
        update public.gradebook_alert_events
        set send_after = public.gradebook_alert_send_after(new_frequency, statement_timestamp())
        where family_id = auth.uid();
    end if;
    return new_frequency;
end;
$$;

create or replace function public.gradebook_queue_alert(target_course uuid, target_enrollment uuid default null)
returns void language sql security definer set search_path = ''
as $$
    insert into public.gradebook_alert_events as queued (family_id, enrollment_id, send_after)
    select p.family_id, e.id, public.gradebook_alert_send_after(p.frequency, statement_timestamp())
    from public.gradebook_enrollments e
    join public.students s on s.id = e.student_id
    join public.gradebook_alert_preferences p on p.family_id = s.family_id
    where e.course_id = target_course and (target_enrollment is null or e.id = target_enrollment)
        and p.frequency <> 'off'
        and (target_enrollment is not null or exists (
            select 1 from public.gradebook_marks m
            where m.enrollment_id = e.id and m.state in ('scored', 'missing')
        ))
        and (target_enrollment is not null or not exists (
            select 1 from public.gradebook_final_courses f where f.enrollment_id = e.id
        ))
    order by p.family_id, e.id
    on conflict (family_id, enrollment_id) do update
        set send_after = least(queued.send_after, excluded.send_after);
$$;

create or replace function public.gradebook_alert_mark_changed()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
    if tg_op = 'UPDATE' then
        if (new.state, new.score, btrim(new.family_feedback))
            is not distinct from (old.state, old.score, btrim(old.family_feedback)) then return null; end if;
    elsif new.state = 'ungraded' and btrim(new.family_feedback) = '' then
        return null;
    end if;
    perform public.gradebook_queue_alert(new.course_id, new.enrollment_id);
    return null;
end;
$$;

create or replace function public.gradebook_alert_course_changed()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
    if tg_table_name = 'gradebook_courses' then
        perform public.gradebook_queue_alert(new.id);
    else
        perform public.gradebook_queue_alert(new.course_id);
    end if;
    return null;
end;
$$;

create or replace function public.gradebook_alert_final_changed()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
    if tg_op = 'INSERT' then
        perform public.gradebook_queue_alert(new.course_id, new.enrollment_id);
    else
        perform public.gradebook_queue_alert(old.course_id, old.enrollment_id);
    end if;
    return null;
end;
$$;

drop trigger if exists gradebook_alert_mark_changed on public.gradebook_marks;
create trigger gradebook_alert_mark_changed after insert or update on public.gradebook_marks
for each row execute function public.gradebook_alert_mark_changed();

drop trigger if exists gradebook_alert_rules_changed on public.gradebook_courses;
create trigger gradebook_alert_rules_changed after update on public.gradebook_courses
for each row when ((old.weighting, old.missing_is_zero, old.categories, old.scale)
    is distinct from (new.weighting, new.missing_is_zero, new.categories, new.scale))
execute function public.gradebook_alert_course_changed();

drop trigger if exists gradebook_alert_assignment_changed on public.gradebook_assignments;
create trigger gradebook_alert_assignment_changed after update on public.gradebook_assignments
for each row when ((old.category, old.points) is distinct from (new.category, new.points))
execute function public.gradebook_alert_course_changed();

drop trigger if exists gradebook_alert_final_changed on public.gradebook_final_courses;
create trigger gradebook_alert_final_changed after insert or delete on public.gradebook_final_courses
for each row execute function public.gradebook_alert_final_changed();

create or replace function public.gradebook_claim_alerts()
returns table (id uuid, attempts integer)
language plpgsql security definer set search_path = ''
as $$
declare
    recipient_family uuid;
    claimed_enrollments uuid[];
    pending_id uuid;
    due_at timestamptz := clock_timestamp();
begin
    update public.gradebook_alert_deliveries d set state = 'uncertain'
    where d.state = 'sending' and d.claimed_at < due_at - interval '15 minutes';

    delete from public.gradebook_alert_deliveries d
    where d.state not in ('pending', 'sending') and d.next_attempt_at < due_at - interval '30 days';

    for recipient_family in
        select p.family_id from public.gradebook_alert_preferences p
        left join public.gradebook_alert_deliveries d on d.family_id = p.family_id and d.state in ('pending', 'sending')
        where (d.state = 'pending' and d.next_attempt_at <= due_at) or (
            d.id is null and p.frequency <> 'off' and exists (
                select 1 from public.gradebook_alert_events e
                where e.family_id = p.family_id and e.send_after <= due_at
            ))
        order by coalesce(d.next_attempt_at, (
            select min(e.send_after) from public.gradebook_alert_events e where e.family_id = p.family_id
        )), p.family_id
        limit 5 for update of p skip locked
    loop
        select d.id into pending_id from public.gradebook_alert_deliveries d
        where d.family_id = recipient_family and d.state in ('pending', 'sending');
        if pending_id is null then
            with claimed as (
                delete from public.gradebook_alert_events e
                where e.family_id = recipient_family and e.send_after <= due_at
                returning e.enrollment_id
            )
            select array_agg(enrollment_id) into claimed_enrollments from claimed;
            if claimed_enrollments is null then continue; end if;
            insert into public.gradebook_alert_deliveries as d (family_id, enrollment_ids)
            values (recipient_family, claimed_enrollments) returning d.id into pending_id;
        end if;
        return query update public.gradebook_alert_deliveries d
        set state = 'sending', attempts = d.attempts + 1, claimed_at = due_at
        where d.id = pending_id and d.state = 'pending' and d.next_attempt_at <= clock_timestamp()
        returning d.id, d.attempts;
    end loop;
end;
$$;

create or replace function public.gradebook_alert_recipient(delivery_id uuid, claim_attempt integer)
returns table (recipient text, course_count bigint)
language sql stable security definer set search_path = ''
as $$
    select u.email::text, count(distinct e.course_id)
    from public.gradebook_alert_deliveries d
    join public.gradebook_alert_preferences p on p.family_id = d.family_id
    join public.portal_users f on f.id = d.family_id
    join auth.users u on u.id = f.id
    join public.gradebook_enrollments e on e.id = any(d.enrollment_ids)
    join public.students s on s.id = e.student_id and s.family_id = d.family_id
    where d.id = delivery_id and d.state = 'sending' and d.attempts = claim_attempt
        and p.frequency <> 'off' and f.role = 'family' and f.active
        and u.email_confirmed_at is not null and nullif(u.email, '') is not null
    group by u.email;
$$;

create or replace function public.gradebook_finish_alert(delivery_id uuid, claim_attempt integer, result_state text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
    if result_state is null or result_state not in ('pending', 'accepted', 'failed', 'uncertain', 'cancelled') then
        raise exception 'Invalid delivery state.' using errcode = '22023';
    end if;
    update public.gradebook_alert_deliveries d
    set state = case when result_state = 'pending' and d.attempts >= 5 then 'failed' else result_state end,
        next_attempt_at = clock_timestamp() + make_interval(mins => d.attempts * 2)
    where d.id = delivery_id and d.state = 'sending' and d.attempts = claim_attempt;
end;
$$;

revoke all on function public.gradebook_family_courses(uuid), public.gradebook_family_assignments(uuid, integer),
    public.gradebook_family_alert_preference(), public.gradebook_family_set_alert_preference(text)
    from public, anon, authenticated;
grant execute on function public.gradebook_family_courses(uuid), public.gradebook_family_assignments(uuid, integer),
    public.gradebook_family_alert_preference(), public.gradebook_family_set_alert_preference(text) to authenticated;

revoke all on function public.gradebook_alert_send_after(text, timestamptz), public.gradebook_queue_alert(uuid, uuid),
    public.gradebook_alert_mark_changed(), public.gradebook_alert_course_changed(), public.gradebook_alert_final_changed(),
    public.gradebook_claim_alerts(), public.gradebook_alert_recipient(uuid, integer), public.gradebook_finish_alert(uuid, integer, text)
    from public, anon, authenticated;
grant execute on function public.gradebook_claim_alerts(), public.gradebook_alert_recipient(uuid, integer),
    public.gradebook_finish_alert(uuid, integer, text) to service_role;

commit;

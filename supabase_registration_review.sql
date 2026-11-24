begin;

alter table public.registration_records
    alter column drive_folder_id drop not null,
    add column if not exists approved_classroom_record jsonb,
    add column if not exists approved_revision integer not null default 0;

create table if not exists public.registration_change_requests (
    id uuid primary key,
    student_id uuid not null references public.students(id),
    record_id uuid references public.registration_records(id),
    requested_by uuid not null references public.portal_users(id),
    requested_at timestamptz not null default now(),
    base_revision integer,
    before_values jsonb not null default '{}',
    changes jsonb not null default '{}',
    request_note text not null,
    state text not null default 'pending' check (state in ('pending','approved','rejected','returned')),
    decided_by uuid references public.portal_users(id),
    decided_at timestamptz,
    review_note text,
    applied_against jsonb
);
create index if not exists registration_change_review_idx
    on public.registration_change_requests(state, requested_at desc);
create table if not exists public.registration_review_emails (
    id uuid primary key default gen_random_uuid(),
    request_id uuid not null references public.registration_change_requests(id),
    recipient_id uuid not null references public.portal_users(id),
    state text not null default 'pending' check (state in ('pending','sending','accepted','failed','uncertain','cancelled')),
    attempts integer not null default 0,
    next_attempt_at timestamptz not null default now(),
    claimed_at timestamptz,
    unique (request_id, recipient_id)
);
alter table public.registration_change_requests enable row level security;
alter table public.registration_review_emails enable row level security;
revoke all on public.registration_change_requests, public.registration_review_emails from public, anon, authenticated;

create or replace function public.registration_edit_values(source jsonb)
returns jsonb language sql immutable set search_path = ''
as $$
    select jsonb_build_object(
        'firstName',coalesce(source->>'firstName',''), 'lastName',coalesce(source->>'lastName',''),
        'preferredName',coalesce(source->>'preferredName',''), 'gradeLevel',coalesce(source->>'gradeLevel',''),
        'guardian1Name',coalesce(source->'guardians'->0->>'name',''),
        'guardian1Phone',coalesce(source->'guardians'->0->>'phone',''),
        'guardian1Email',coalesce(source->'guardians'->0->>'email',''),
        'guardian2Name',coalesce(source->'guardians'->1->>'name',''),
        'guardian2Phone',coalesce(source->'guardians'->1->>'phone',''),
        'guardian2Email',coalesce(source->'guardians'->1->>'email','')
    );
$$;

create or replace function public.registration_apply_values(source jsonb, changes jsonb)
returns jsonb language plpgsql immutable set search_path = ''
as $$
declare
    updated jsonb := source;
    guardians jsonb := case when jsonb_typeof(source->'guardians')='array' then source->'guardians' else '[]' end;
    contact_item jsonb;
    i integer;
    field text;
    key text;
begin
    foreach field in array array['firstName','lastName','preferredName','gradeLevel'] loop
        if changes ? field then updated := jsonb_set(updated,array[field],changes->field,true); end if;
    end loop;
    for i in 0..1 loop
        contact_item := case when jsonb_typeof(guardians->i)='object' then guardians->i else '{}' end;
        foreach field in array array['Name','Phone','Email'] loop
            key := 'guardian' || (i+1)::text || field;
            if changes ? key then contact_item := jsonb_set(contact_item,array[lower(field)],changes->key,true); end if;
        end loop;
        if contact_item <> '{}' then
            while jsonb_array_length(guardians) <= i loop guardians := guardians || '[{}]'::jsonb; end loop;
            guardians := jsonb_set(guardians,array[i::text],contact_item,true);
        end if;
    end loop;
    return jsonb_set(updated,'{guardians}',guardians,true);
end;
$$;

create or replace function public.registration_validate_values(changes jsonb, admin boolean)
returns void language plpgsql immutable set search_path = ''
as $$
declare
    item record;
    allowed text[] := array['preferredName','guardian1Name','guardian1Phone','guardian1Email','guardian2Name','guardian2Phone','guardian2Email'];
begin
    if changes is null or jsonb_typeof(changes) <> 'object' then
        raise exception 'Enter registration changes in the form.' using errcode='22023';
    end if;
    if admin then allowed := allowed || array['firstName','lastName','gradeLevel']; end if;
    for item in select key, value from jsonb_each(changes) loop
        if not (item.key = any(allowed)) or jsonb_typeof(item.value) <> 'string'
            or length(item.value #>> '{}') > (case when item.key like '%Email' then 254 when item.key like '%Phone' then 60 else 120 end) then
            raise exception 'One of the fields is too long or can only be changed by the school office.' using errcode='22023';
        end if;
        if item.key in ('firstName','lastName') and btrim(item.value #>> '{}')='' then
            raise exception 'First and last names are required.' using errcode='22023';
        elsif item.key='gradeLevel' and (item.value #>> '{}') !~ '^(K|[1-9]|1[0-2])$' then
            raise exception 'Choose a grade from kindergarten through 12.' using errcode='22023';
        elsif item.key like '%Email' and (item.value #>> '{}') <> '' and (item.value #>> '{}') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
            raise exception 'Check the contact email address before saving.' using errcode='22023';
        end if;
    end loop;
end;
$$;

create or replace function public.read_registration_record(target_record uuid)
returns table (id uuid, student_id uuid, received_at timestamptz, classroom_record jsonb, administrator_record jsonb, drive_folder_id text)
language sql stable security definer set search_path = ''
as $$
    select r.id, r.student_id, r.received_at, coalesce(r.approved_classroom_record,r.classroom_record),
        case when public.current_portal_role()='admin' then r.administrator_record end,
        case when public.current_portal_role()='admin' then r.drive_folder_id end
    from public.registration_records r
    where r.id=target_record and public.can_read_registration_record(r.student_id)
      and (public.current_portal_role()='admin' or not exists (
          select 1 from public.registration_records n where n.student_id=r.student_id
            and (n.received_at,n.id)>(r.received_at,r.id)
      ));
$$;

create or replace function public.list_registration_records()
returns table (id uuid, student_id uuid, student_name text, grade_level text, received_at timestamptz)
language sql stable security definer set search_path = ''
as $$
    select r.id, r.student_id,
        concat_ws(' ',coalesce(nullif(working.record->>'preferredName',''),working.record->>'firstName'),working.record->>'lastName'),
        working.record->>'gradeLevel',r.received_at
    from public.registration_records r
    cross join lateral (select coalesce(r.approved_classroom_record,r.classroom_record) as record) working
    where public.can_read_registration_record(r.student_id)
      and (public.current_portal_role()='admin' or not exists (
          select 1 from public.registration_records n where n.student_id=r.student_id
            and (n.received_at,n.id)>(r.received_at,r.id)
      ))
    order by r.received_at desc,r.id desc;
$$;

create or replace function public.registration_edit_context(target_student uuid, target_record uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
    student public.students;
    registration public.registration_records;
    source jsonb;
begin
    if target_student is null or public.can_read_registration_record(target_student) is not true then
        raise exception 'Select a student on your classroom roster.' using errcode='42501';
    end if;
    select * into student from public.students where id=target_student;
    if not found then raise exception 'Reload the directory and select a current student.' using errcode='22023'; end if;
    if target_record is not null then
        select * into registration from public.registration_records r where r.id=target_record and r.student_id=target_student;
        if not found or not exists (select 1 from public.read_registration_record(target_record)) then
            raise exception 'This registration has changed. Reload the student’s latest record.' using errcode='22023';
        end if;
        source := coalesce(registration.approved_classroom_record,registration.classroom_record);
    else
        if exists (select 1 from public.registration_records r where r.student_id=target_student) then
            raise exception 'This student has a registration. Select it before adding a correction.' using errcode='22023';
        end if;
        source := jsonb_build_object('firstName',student.first_name,'lastName',student.last_name,
            'preferredName',student.preferred_name,'gradeLevel',student.grade_level);
    end if;
    return jsonb_build_object('revision',registration.approved_revision,'values',public.registration_edit_values(source));
end;
$$;

create or replace function public.registration_submit_change(
    request_id uuid, target_student uuid, target_record uuid, expected_revision integer, changes jsonb, note text
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare
    actor uuid := auth.uid();
    admin boolean := public.current_portal_role()='admin';
    context jsonb;
    prior jsonb;
    source jsonb;
    saved_record uuid := target_record;
begin
    if public.current_portal_role() not in ('admin','teacher') or public.current_portal_role() is null
        or public.can_read_registration_record(target_student) is not true then
        raise exception 'You can only submit or edit registrations for students you can access.' using errcode='42501';
    end if;
    if request_id is null or note is null or length(btrim(note)) not between 1 and 1000 then
        raise exception 'Add a short reason for the requested change.' using errcode='22023';
    end if;
    perform public.registration_validate_values(changes,admin);
    if not admin and target_record is null and changes <> '{}' then
        raise exception 'Flag the missing registration with a note so an administrator can create it.' using errcode='22023';
    end if;
    perform 1 from public.students where id=target_student for update;
    if target_record is not null then
        perform 1 from public.registration_records where id=target_record for update;
    end if;
    if exists (select 1 from public.registration_change_requests r where r.id=request_id
        and r.requested_by=actor and r.student_id=target_student and r.changes=registration_submit_change.changes and r.request_note=btrim(note)
        and (r.record_id is not distinct from target_record or (target_record is null and admin and r.base_revision is null))) then return request_id; end if;

    context := public.registration_edit_context(target_student,target_record);
    if (context->>'revision')::integer is distinct from expected_revision then
        raise exception 'The approved record changed. Reopen it and review your edits before saving.' using errcode='22023';
    end if;
    prior := context->'values';
    if target_record is not null and not exists (
        select 1 from jsonb_each(changes) item where prior->item.key is distinct from item.value
    ) then
        raise exception 'Change at least one field before submitting.' using errcode='22023';
    end if;

    if admin then
        if target_record is null then
            insert into public.registration_records(student_id,classroom_record,administrator_record,approved_classroom_record,approved_revision)
            values (target_student, public.registration_apply_values(prior,'{}'), '{}',public.registration_apply_values(prior,changes),1)
            returning id into saved_record;
        else
            select coalesce(r.approved_classroom_record,r.classroom_record) into source from public.registration_records r where r.id=target_record;
            update public.registration_records set approved_classroom_record=public.registration_apply_values(source,changes),
                approved_revision=approved_revision+1 where id=target_record;
        end if;
    end if;
    insert into public.registration_change_requests(id,student_id,record_id,requested_by,base_revision,before_values,changes,request_note,state,decided_by,decided_at,applied_against)
    values (request_id,target_student,saved_record,actor,expected_revision,prior,changes,btrim(note),
        case when admin then 'approved' else 'pending' end,case when admin then actor end,
        case when admin then now() end,case when admin then prior end);
    if not admin then
        insert into public.registration_review_emails(request_id,recipient_id)
        select request_id,p.id from public.portal_users p join auth.users u on u.id=p.id
        where p.active and p.role='admin' and u.email_confirmed_at is not null and nullif(u.email,'') is not null;
    end if;
    return request_id;
end;
$$;

create or replace function public.registration_review_list(target_request uuid default null,target_student uuid default null)
returns table (id uuid, student_id uuid, record_id uuid, student_name text, requested_by text, requested_at timestamptz,
    state text, changes jsonb, before_values jsonb, current_values jsonb, base_revision integer, current_revision integer,
    request_note text, review_note text, decided_by text, decided_at timestamptz, record_available boolean, applied_against jsonb)
language sql stable security definer set search_path = ''
as $$
    select q.id,q.student_id,q.record_id,concat_ws(' ',coalesce(nullif(s.preferred_name,''),s.first_name),s.last_name),
        author.display_name,q.requested_at,q.state,q.changes,q.before_values,
        case when public.current_portal_role()='admin' and r.id is not null then
            public.registration_edit_values(coalesce(r.approved_classroom_record,r.classroom_record)) end,
        q.base_revision,r.approved_revision,q.request_note,q.review_note,reviewer.display_name,q.decided_at,
        case when q.record_id is null then not exists(select 1 from public.registration_records previous where previous.student_id=q.student_id)
            else r.student_id is not distinct from q.student_id and not exists (
                select 1 from public.registration_records newer where newer.student_id=q.student_id
                  and (newer.received_at,newer.id)>(r.received_at,r.id)
            ) end,q.applied_against
    from public.registration_change_requests q
    join public.students s on s.id=q.student_id
    join public.portal_users author on author.id=q.requested_by
    left join public.portal_users reviewer on reviewer.id=q.decided_by
    left join public.registration_records r on r.id=q.record_id
    where (target_request is null or q.id=target_request) and (target_student is null or q.student_id=target_student)
      and (public.current_portal_role()='admin' or (
        public.current_portal_role()='teacher' and q.requested_by=auth.uid()
        and public.can_read_registration_record(q.student_id)
      ))
    order by (q.state='pending') desc,q.requested_at desc,q.id desc;
$$;

create or replace function public.registration_decide_change(
    target_request uuid, decision text, note text, reviewed_revision integer, acknowledge_newer boolean
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare
    review public.registration_change_requests;
    registration public.registration_records;
    student public.students;
    saved_record_id uuid;
    source jsonb;
    previous jsonb;
begin
    if public.current_portal_role() is distinct from 'admin' then
        raise exception 'Only an administrator can decide a registration request.' using errcode='42501';
    end if;
    if decision is null or decision not in ('approved','rejected','returned')
        or length(coalesce(note,''))>1000 or (decision<>'approved' and nullif(btrim(note),'') is null) then
        raise exception 'Choose an outcome and include a note when rejecting or returning a request.' using errcode='22023';
    end if;
    select * into review from public.registration_change_requests where id=target_request for update;
    if not found or review.state<>'pending' then
        raise exception 'This request was already handled or is missing. Refresh the review queue.' using errcode='22023';
    end if;
    saved_record_id := review.record_id;
    if decision='approved' then
        select * into student from public.students where id=review.student_id for update;
        if saved_record_id is null then
            if exists (select 1 from public.registration_records where student_id=student.id) then
                raise exception 'A registration already exists. Open it in Student Records and return or reject this request.' using errcode='22023';
            end if;
            source := jsonb_build_object('firstName',student.first_name,'lastName',student.last_name,
                'preferredName',student.preferred_name,'gradeLevel',student.grade_level);
            previous := public.registration_edit_values(source);
            insert into public.registration_records(student_id,classroom_record,administrator_record,approved_classroom_record,approved_revision)
            values(student.id,source,'{}',public.registration_apply_values(source,review.changes),1)
            returning id into saved_record_id;
        else
            select * into registration from public.registration_records where id=saved_record_id for update;
            if not found or registration.student_id is distinct from student.id then
                raise exception 'This registration was moved. Open Student Records to check the link before continuing.' using errcode='22023';
            end if;
            if exists(select 1 from public.registration_records newer where newer.student_id=student.id
                and (newer.received_at,newer.id)>(registration.received_at,registration.id)) then
                raise exception 'A newer registration is on file. Open it in Student Records before deciding this request.' using errcode='22023';
            end if;
            if registration.approved_revision is distinct from reviewed_revision
                or (registration.approved_revision is distinct from review.base_revision and acknowledge_newer is not true) then
                raise exception 'A newer approved version exists. Refresh the request and compare the original, current, and proposed values.' using errcode='22023';
            end if;
            source := coalesce(registration.approved_classroom_record,registration.classroom_record);
            previous := public.registration_edit_values(source);
            update public.registration_records set approved_classroom_record=public.registration_apply_values(source,review.changes),
                approved_revision=approved_revision+1 where id=saved_record_id;
        end if;
    end if;
    update public.registration_change_requests set state=decision,record_id=saved_record_id,
        decided_by=auth.uid(),decided_at=now(),review_note=nullif(btrim(note),''),applied_against=previous
    where id=target_request;
    return saved_record_id;
end;
$$;

create or replace function public.registration_claim_notifications()
returns table(id uuid,request_id uuid,recipient text,attempts integer)
language plpgsql security definer set search_path = ''
as $$
begin
    update public.registration_review_emails e set state='uncertain'
    where e.state='sending' and e.claimed_at<now()-interval '15 minutes';
    update public.registration_review_emails e set state='cancelled'
    where e.state='pending' and not exists (
        select 1 from public.registration_change_requests q
        join public.portal_users p on p.id=e.recipient_id
        join auth.users u on u.id=p.id
        where q.id=e.request_id and q.state='pending' and p.active and p.role='admin'
          and u.email_confirmed_at is not null and nullif(u.email,'') is not null
    );
    return query with batch as (
        select e.id from public.registration_review_emails e where e.state='pending' and e.next_attempt_at<=now()
        order by e.next_attempt_at,e.id limit 10 for update skip locked
    ), claimed as (
        update public.registration_review_emails e set state='sending',attempts=e.attempts+1,claimed_at=now()
        from batch where e.id=batch.id returning e.*
    )
    select e.id,e.request_id,u.email::text,e.attempts from claimed e join auth.users u on u.id=e.recipient_id;
end;
$$;

create or replace function public.registration_finish_notification(delivery_id uuid, claim_attempt integer, result_state text)
returns void language sql security definer set search_path = ''
as $$
    update public.registration_review_emails e
    set state=case when result_state='pending' and e.attempts>=5 then 'failed' else result_state end,
        next_attempt_at=now()+make_interval(mins=>least(e.attempts*2,15))
    where e.id=delivery_id and e.state='sending' and e.attempts=claim_attempt
        and result_state in ('pending','accepted','failed','uncertain');
$$;

revoke all on function public.registration_edit_values(jsonb),public.registration_apply_values(jsonb,jsonb),
    public.registration_validate_values(jsonb,boolean),public.registration_edit_context(uuid,uuid),
    public.registration_submit_change(uuid,uuid,uuid,integer,jsonb,text),public.registration_review_list(uuid,uuid),
    public.registration_decide_change(uuid,text,text,integer,boolean),
    public.registration_claim_notifications(),public.registration_finish_notification(uuid,integer,text)
from public,anon,authenticated;
grant execute on function public.registration_edit_context(uuid,uuid),
    public.registration_submit_change(uuid,uuid,uuid,integer,jsonb,text), public.registration_review_list(uuid,uuid),
    public.registration_decide_change(uuid,text,text,integer,boolean) to authenticated;
grant execute on function public.registration_claim_notifications(),public.registration_finish_notification(uuid,integer,text) to service_role;

commit;

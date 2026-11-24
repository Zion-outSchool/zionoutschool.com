begin;

create table if not exists public.registration_records (
    id uuid primary key default gen_random_uuid(),
    drive_folder_id text not null unique check (drive_folder_id ~ '^[A-Za-z0-9_-]{10,128}$'),
    received_at timestamptz not null default now(),
    student_id uuid references public.students(id),
    classroom_record jsonb not null check (jsonb_typeof(classroom_record) = 'object'),
    administrator_record jsonb not null check (jsonb_typeof(administrator_record) = 'object')
);

alter table public.registration_records enable row level security;
revoke all on public.registration_records from public, anon, authenticated;
grant select, insert on public.registration_records to service_role;

create index if not exists registration_records_student_idx
    on public.registration_records (student_id, received_at desc) where student_id is not null;

create or replace function public.can_read_registration_record(target_student uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
    select public.current_portal_role() = 'admin'
        or (public.current_portal_role() = 'teacher' and exists (
            select from public.gradebook_enrollments e
            join public.gradebook_courses c on c.id = e.course_id
            where e.student_id = target_student and c.teacher_id = auth.uid()
        ));
$$;

create or replace function public.list_registration_records()
returns table (id uuid, student_id uuid, student_name text, grade_level text, received_at timestamptz)
language sql stable security definer set search_path = ''
as $$
    select r.id, r.student_id,
        concat_ws(' ', coalesce(nullif(r.classroom_record ->> 'preferredName', ''), r.classroom_record ->> 'firstName'),
            r.classroom_record ->> 'lastName'),
        r.classroom_record ->> 'gradeLevel', r.received_at
    from public.registration_records r
    where public.can_read_registration_record(r.student_id)
        and (public.current_portal_role() = 'admin' or not exists (
            select from public.registration_records newer where newer.student_id = r.student_id
                and (newer.received_at, newer.id) > (r.received_at, r.id)
        ))
    order by r.received_at desc, r.id desc;
$$;

create or replace function public.read_registration_record(target_record uuid)
returns table (
    id uuid, student_id uuid, received_at timestamptz, classroom_record jsonb,
    administrator_record jsonb, drive_folder_id text
)
language sql stable security definer set search_path = ''
as $$
    select r.id, r.student_id, r.received_at, r.classroom_record,
        case when public.current_portal_role() = 'admin' then r.administrator_record end,
        case when public.current_portal_role() = 'admin' then r.drive_folder_id end
    from public.registration_records r
    where r.id = target_record and public.can_read_registration_record(r.student_id)
        and (public.current_portal_role() = 'admin' or not exists (
            select from public.registration_records newer where newer.student_id = r.student_id
                and (newer.received_at, newer.id) > (r.received_at, r.id)
        ));
$$;

create or replace function public.link_registration_record(
    target_record uuid, existing_student uuid default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
    registration public.registration_records;
    linked_student uuid := existing_student;
begin
    if public.current_portal_role() is distinct from 'admin' then
        raise exception 'Administrator access is required.' using errcode = '42501';
    end if;
    select * into registration from public.registration_records where id = target_record for update;
    if not found then
        raise exception 'This registration could not be found.' using errcode = '22023';
    end if;
    if registration.student_id is not null then
        if existing_student is not null and existing_student <> registration.student_id then
            raise exception 'This registration is already linked to a student.' using errcode = '22023';
        end if;
        return registration.student_id;
    end if;

    if linked_student is null then
        insert into public.students (first_name, last_name, preferred_name, grade_level)
        values (registration.classroom_record ->> 'firstName',
            registration.classroom_record ->> 'lastName',
            nullif(registration.classroom_record ->> 'preferredName', ''),
            registration.classroom_record ->> 'gradeLevel')
        returning id into linked_student;
    elsif not exists (select from public.students where id = linked_student) then
        raise exception 'The selected student could not be found.' using errcode = '22023';
    end if;
    update public.registration_records set student_id = linked_student where id = target_record;
    return linked_student;
end;
$$;

revoke all on function public.can_read_registration_record(uuid),
    public.list_registration_records(), public.read_registration_record(uuid),
    public.link_registration_record(uuid, uuid) from public, anon, authenticated;
grant execute on function public.list_registration_records(), public.read_registration_record(uuid),
    public.link_registration_record(uuid, uuid) to authenticated;

commit;

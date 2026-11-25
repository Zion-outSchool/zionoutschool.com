begin;

create table if not exists public.gradebook_google_settings (
    singleton boolean primary key default true check (singleton),
    client_id text check (length(client_id) <= 256 and client_id ~ '^[A-Za-z0-9_-]+[.]apps[.]googleusercontent[.]com$')
);
insert into public.gradebook_google_settings default values on conflict do nothing;

create table if not exists public.gradebook_google_courses (
    course_id uuid primary key references public.gradebook_courses(id) on delete cascade,
    source_course text not null,
    source_name text not null,
    student_matches jsonb not null default '{}'
);

create table if not exists public.gradebook_google_assignments (
    course_id uuid not null references public.gradebook_google_courses(course_id) on delete cascade,
    source_assignment text not null,
    assignment_id uuid not null unique,
    primary key (course_id, source_assignment),
    foreign key (assignment_id, course_id) references public.gradebook_assignments(id, course_id) on delete cascade
);

create table if not exists public.gradebook_google_scores (
    enrollment_id uuid not null,
    assignment_id uuid not null,
    score numeric(9, 2) not null,
    source_updated_at timestamptz not null,
    primary key (enrollment_id, assignment_id),
    foreign key (enrollment_id, assignment_id)
        references public.gradebook_marks(enrollment_id, assignment_id) on delete cascade
);

alter table public.gradebook_google_settings enable row level security;
alter table public.gradebook_google_courses enable row level security;
alter table public.gradebook_google_assignments enable row level security;
alter table public.gradebook_google_scores enable row level security;
revoke all on public.gradebook_google_settings, public.gradebook_google_courses,
    public.gradebook_google_assignments, public.gradebook_google_scores from public, anon, authenticated;

create or replace function public.gradebook_google_context(target_course uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
    result jsonb;
begin
    if public.gradebook_can_manage(target_course) is distinct from true then
        raise exception 'Course access required.' using errcode = '42501';
    end if;
    select jsonb_build_object('client_id', s.client_id, 'source_course', c.source_course, 'source_name', c.source_name,
        'matches', coalesce(c.student_matches, '{}')) into result
    from public.gradebook_google_settings s
    left join public.gradebook_google_courses c on c.course_id = target_course;
    return result;
end;
$$;

create or replace function public.gradebook_google_import(
    target_course uuid, google_course text, google_name text, matched_students jsonb,
    target_category text, selected_assignments jsonb, returned_scores jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    course public.gradebook_courses;
    connection public.gradebook_google_courses;
    assignment public.gradebook_assignments;
    mark public.gradebook_marks;
    previous public.gradebook_google_scores;
    item record;
    saved_matches jsonb;
    usable_assignments jsonb := '{}';
    current_assignment uuid;
    current_enrollment uuid;
    new_assignments integer := 0;
    new_scores integer := 0;
    skipped_assignments integer := 0;
    skipped_scores integer := 0;
begin
    if public.gradebook_can_manage(target_course) is distinct from true then
        raise exception 'Course access required.' using errcode = '42501';
    end if;
    select * into course from public.gradebook_courses where id = target_course for update;
    if course.id is null or public.gradebook_can_manage(target_course) is distinct from true then
        raise exception 'Course access required.' using errcode = '42501';
    end if;
    if not exists (select 1 from public.gradebook_google_settings where client_id is not null) then
        raise exception 'Google Classroom import is not configured.' using errcode = '22023';
    end if;
    if google_course is null or google_course !~ '^[A-Za-z0-9_-]{1,128}$'
        or nullif(btrim(google_name), '') is null or length(google_name) > 250
        or target_category is null or not (course.categories ? target_category)
        or jsonb_typeof(matched_students) is distinct from 'object'
        or jsonb_typeof(selected_assignments) is distinct from 'array'
        or jsonb_typeof(returned_scores) is distinct from 'array' then
        raise exception 'Check the class, roster matches, assignments and grading category.' using errcode = '22023';
    end if;
    if jsonb_array_length(selected_assignments) not between 1 and 500
        or jsonb_array_length(returned_scores) > 10000
        or matched_students = '{}' or (select count(*) from jsonb_object_keys(matched_students)) > 2000 then
        raise exception 'Match at least one student and select up to 500 assignments and 10,000 scores per import.' using errcode = '22023';
    end if;

    select * into connection from public.gradebook_google_courses where course_id = target_course;
    if connection.source_course is not null and connection.source_course <> google_course then
        raise exception 'This gradebook is already linked to a different Google Classroom course.' using errcode = '22023';
    end if;
    saved_matches := coalesce(connection.student_matches, '{}') || matched_students;
    if exists (
        select 1 from jsonb_each_text(matched_students) m
        where m.key !~ '^[A-Za-z0-9_-]{1,128}$' or not exists (
            select 1 from public.gradebook_enrollments e
            where e.course_id = target_course and e.id::text = m.value
        )
        or (connection.student_matches ? m.key and connection.student_matches->>m.key <> m.value)
    ) or exists (
        select 1 from jsonb_each_text(saved_matches) m group by m.value having count(*) > 1
    ) then
        raise exception 'Match each Google student to a different Zion enrollment. Previously imported matches are locked.' using errcode = '22023';
    end if;
    insert into public.gradebook_google_courses (course_id, source_course, source_name, student_matches)
    values (target_course, google_course, btrim(google_name), saved_matches)
    on conflict (course_id) do update set source_name = excluded.source_name, student_matches = excluded.student_matches;

    for item in select * from jsonb_to_recordset(selected_assignments)
        as x(source_id text, title text, points numeric, due_on date)
    loop
        if item.source_id is null or item.source_id !~ '^[A-Za-z0-9_-]{1,128}$'
            or nullif(btrim(item.title), '') is null or length(item.title) > 120
            or item.points is null or item.points <= 0 or item.points > 9999999.99 or round(item.points,2) <> item.points
            or usable_assignments ? item.source_id then
            raise exception 'An assignment has an invalid title, point limit or ID.' using errcode = '22023';
        end if;
        select a.* into assignment from public.gradebook_google_assignments g
        join public.gradebook_assignments a on a.id = g.assignment_id
        where g.course_id = target_course and g.source_assignment = item.source_id;
        if assignment.id is null then
            if exists (select 1 from public.gradebook_final_courses f where f.course_id = target_course)
                or exists (select 1 from public.gradebook_assignments a where a.course_id = target_course
                    and lower(btrim(a.title)) = lower(btrim(item.title))
                    and not exists (select 1 from public.gradebook_google_assignments g where g.assignment_id = a.id)) then
                skipped_assignments := skipped_assignments + 1;
                continue;
            end if;
            insert into public.gradebook_assignments (course_id, title, category, due_on, points)
            values (target_course, btrim(item.title), target_category, item.due_on, item.points)
            returning * into assignment;
            insert into public.gradebook_google_assignments (course_id, source_assignment, assignment_id)
            values (target_course, item.source_id, assignment.id);
            new_assignments := new_assignments + 1;
        elsif assignment.points <> item.points then
            skipped_assignments := skipped_assignments + 1;
            continue;
        end if;
        usable_assignments := usable_assignments || jsonb_build_object(item.source_id, assignment.id);
    end loop;

    for item in select * from jsonb_to_recordset(returned_scores)
        as x(source_id text, google_student text, score numeric, updated_at timestamptz)
    loop
        current_assignment := (usable_assignments->>item.source_id)::uuid;
        current_enrollment := (matched_students->>item.google_student)::uuid;
        if current_assignment is null or current_enrollment is null then
            skipped_scores := skipped_scores + 1;
            continue;
        end if;
        if item.score is null or item.score < 0 or round(item.score,2) <> item.score or item.updated_at is null
            or item.score > (select a.points from public.gradebook_assignments a where a.id = current_assignment)
            or exists (select 1 from public.gradebook_final_courses f where f.enrollment_id = current_enrollment) then
            skipped_scores := skipped_scores + 1;
            continue;
        end if;
        select * into mark from public.gradebook_marks m
        where m.enrollment_id = current_enrollment and m.assignment_id = current_assignment;
        select * into previous from public.gradebook_google_scores g
        where g.enrollment_id = current_enrollment and g.assignment_id = current_assignment;
        if (previous.assignment_id is not null and item.updated_at <= previous.source_updated_at)
            or (mark.assignment_id is not null and (mark.rubric_scores <> '{}' or
                (mark.state <> 'ungraded' and (previous.assignment_id is null
                    or mark.state <> 'scored' or mark.score <> previous.score))
                or (mark.state = 'ungraded' and previous.assignment_id is not null))) then
            skipped_scores := skipped_scores + 1;
            continue;
        end if;
        if mark.state is distinct from 'scored' or mark.score is distinct from item.score then
            insert into public.gradebook_marks (course_id, enrollment_id, assignment_id, state, score)
            values (target_course, current_enrollment, current_assignment, 'scored', item.score)
            on conflict (enrollment_id, assignment_id) do update set score = excluded.score, state = excluded.state;
            new_scores := new_scores + 1;
        end if;
        insert into public.gradebook_google_scores (enrollment_id, assignment_id, score, source_updated_at)
        values (current_enrollment, current_assignment, item.score, item.updated_at)
        on conflict (enrollment_id, assignment_id) do update
        set score = excluded.score, source_updated_at = excluded.source_updated_at;
    end loop;
    return jsonb_build_object('new_assignments', new_assignments, 'updated_scores', new_scores,
        'skipped_assignments', skipped_assignments, 'skipped_scores', skipped_scores);
end;
$$;

revoke all on function public.gradebook_google_context(uuid),
    public.gradebook_google_import(uuid, text, text, jsonb, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.gradebook_google_context(uuid),
    public.gradebook_google_import(uuid, text, text, jsonb, text, jsonb, jsonb) to authenticated;

commit;

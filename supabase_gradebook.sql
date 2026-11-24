begin;

create table if not exists public.gradebook_courses (
    id uuid primary key default gen_random_uuid(),
    teacher_id uuid not null default auth.uid() references public.portal_users(id),
    name text not null check (length(btrim(name)) between 1 and 120),
    term text not null check (length(btrim(term)) between 1 and 60),
    weighting text not null check (weighting in ('points', 'weighted')),
    missing_is_zero boolean not null,
    categories jsonb not null check (jsonb_typeof(categories) = 'object'),
    scale jsonb not null check (jsonb_typeof(scale) = 'object')
);

create table if not exists public.gradebook_enrollments (
    id uuid primary key default gen_random_uuid(),
    course_id uuid not null references public.gradebook_courses(id),
    student_id uuid not null references public.students(id),
    requirement_key text check (requirement_key in (
        'english_i', 'english_ii', 'english_iii', 'english_iv', 'algebra_i', 'geometry',
        'algebra_ii_quantitative', 'math_cs_flex', 'biology', 'physical_science',
        'science_cs_flex', 'world_history', 'us_history', 'civics', 'economics_finance',
        'physical_education', 'fine_arts', 'oral_communication', 'health_safety', 'career_focus_electives'
    )),
    grade_level text not null check (grade_level in ('K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12')),
    credits numeric(4, 2) not null check (credits >= 0),
    check ((requirement_key is null and credits = 0)
        or (requirement_key is not null and grade_level in ('8', '9', '10', '11', '12'))),
    unique (course_id, student_id),
    unique (id, course_id)
);

create table if not exists public.gradebook_assignments (
    id uuid primary key default gen_random_uuid(),
    course_id uuid not null references public.gradebook_courses(id),
    title text not null check (length(btrim(title)) between 1 and 120),
    category text not null,
    due_on date,
    points numeric(9, 2) not null check (points > 0),
    rubric jsonb not null default '{}' check (jsonb_typeof(rubric) = 'object'),
    unique (id, course_id)
);

create table if not exists public.gradebook_marks (
    course_id uuid not null,
    enrollment_id uuid not null,
    assignment_id uuid not null,
    state text not null check (state in ('ungraded', 'scored', 'missing', 'excused')),
    score numeric(9, 2) check (score >= 0),
    rubric_scores jsonb not null default '{}' check (jsonb_typeof(rubric_scores) = 'object'),
    family_feedback text not null default '',
    private_note text not null default '',
    updated_at timestamptz not null default clock_timestamp(),
    primary key (enrollment_id, assignment_id),
    foreign key (enrollment_id, course_id) references public.gradebook_enrollments(id, course_id),
    foreign key (assignment_id, course_id) references public.gradebook_assignments(id, course_id),
    check ((state = 'scored') = (score is not null))
);

create table if not exists public.gradebook_final_courses (
    enrollment_id uuid primary key references public.gradebook_enrollments(id),
    course_id uuid not null references public.gradebook_courses(id),
    student_id uuid not null references public.students(id),
    course_name text not null,
    term text not null,
    requirement_key text,
    grade_level text not null,
    credits numeric(4, 2) not null,
    final_grade text not null,
    calculated_percent numeric(5, 2) not null,
    finalized_at timestamptz not null default clock_timestamp()
);

create table if not exists public.gradebook_history (
    id bigint generated always as identity primary key,
    course_id uuid not null references public.gradebook_courses(id),
    enrollment_id uuid not null references public.gradebook_enrollments(id),
    actor_id uuid not null references public.portal_users(id),
    action text not null check (action in ('finalized', 'reopened')),
    details jsonb not null,
    reason text,
    recorded_at timestamptz not null default clock_timestamp()
);

create index if not exists gradebook_final_courses_student_idx on public.gradebook_final_courses (student_id);
create index if not exists gradebook_final_courses_course_idx on public.gradebook_final_courses (course_id);
create index if not exists gradebook_history_enrollment_idx on public.gradebook_history (enrollment_id, recorded_at);
create index if not exists gradebook_marks_course_idx on public.gradebook_marks (course_id, enrollment_id, assignment_id);

create or replace function public.gradebook_can_manage(target_course uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
    select public.current_portal_role() = 'admin' or (
        public.current_portal_role() = 'teacher'
        and exists (
            select from public.gradebook_courses
            where id = target_course and teacher_id = auth.uid()
        )
    );
$$;

revoke all on function public.gradebook_can_manage(uuid) from public;
grant execute on function public.gradebook_can_manage(uuid) to authenticated;

alter table public.gradebook_courses enable row level security;
alter table public.gradebook_enrollments enable row level security;
alter table public.gradebook_assignments enable row level security;
alter table public.gradebook_marks enable row level security;
alter table public.gradebook_final_courses enable row level security;
alter table public.gradebook_history enable row level security;

drop policy if exists gradebook_course_read on public.gradebook_courses;
create policy gradebook_course_read on public.gradebook_courses for select to authenticated
using (public.gradebook_can_manage(id));
drop policy if exists gradebook_course_create on public.gradebook_courses;
create policy gradebook_course_create on public.gradebook_courses for insert to authenticated
with check (public.current_portal_role() = 'admin'
    or (teacher_id = auth.uid() and public.current_portal_role() = 'teacher'));
drop policy if exists gradebook_course_edit on public.gradebook_courses;
create policy gradebook_course_edit on public.gradebook_courses for update to authenticated
using (public.gradebook_can_manage(id))
with check (public.gradebook_can_manage(id)
    and (public.current_portal_role() = 'admin' or teacher_id = auth.uid()));

drop policy if exists gradebook_enrollment_manage on public.gradebook_enrollments;
create policy gradebook_enrollment_manage on public.gradebook_enrollments for all to authenticated
using (public.gradebook_can_manage(course_id)) with check (public.gradebook_can_manage(course_id));
drop policy if exists gradebook_assignment_manage on public.gradebook_assignments;
create policy gradebook_assignment_manage on public.gradebook_assignments for all to authenticated
using (public.gradebook_can_manage(course_id)) with check (public.gradebook_can_manage(course_id));
drop policy if exists gradebook_mark_manage on public.gradebook_marks;
create policy gradebook_mark_manage on public.gradebook_marks for all to authenticated
using (public.gradebook_can_manage(course_id)) with check (public.gradebook_can_manage(course_id));

drop policy if exists gradebook_finals_read on public.gradebook_final_courses;
create policy gradebook_finals_read on public.gradebook_final_courses for select to authenticated
using (public.current_portal_role() in ('admin', 'teacher', 'staff') or exists (
    select from public.students where id = student_id and family_id = auth.uid()
        and public.current_portal_role() = 'family'
));
drop policy if exists gradebook_history_read on public.gradebook_history;
create policy gradebook_history_read on public.gradebook_history for select to authenticated
using (public.gradebook_can_manage(course_id));

revoke all on public.gradebook_courses, public.gradebook_enrollments, public.gradebook_assignments,
    public.gradebook_marks, public.gradebook_final_courses, public.gradebook_history
from anon, authenticated;
grant select, insert on public.gradebook_courses to authenticated;
grant update (teacher_id, name, term, weighting, missing_is_zero, categories, scale) on public.gradebook_courses to authenticated;
grant select, insert on public.gradebook_enrollments to authenticated;
grant update (requirement_key, grade_level, credits) on public.gradebook_enrollments to authenticated;
grant select, insert on public.gradebook_assignments to authenticated;
grant update (title, category, due_on, points, rubric) on public.gradebook_assignments to authenticated;
grant select on public.gradebook_marks to authenticated;
grant select on public.gradebook_final_courses, public.gradebook_history to authenticated;

create or replace function public.gradebook_validate_course()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
    if not exists (
        select from public.portal_users where id = new.teacher_id and active and role in ('teacher', 'admin')
    ) then raise exception 'Assign an active teacher or administrator.'; end if;
    if new.categories = '{}' or exists (
        select from jsonb_each_text(new.categories) as c(label, weight)
        where btrim(label) = '' or coalesce(weight, '') !~ '^[0-9]+(\.[0-9]+)?$'
    ) then raise exception 'Enter at least one category with a numeric weight.'; end if;
    if new.weighting = 'weighted' and (
        (select sum(value::numeric) from jsonb_each_text(new.categories)) <> 100
        or exists (select from jsonb_each_text(new.categories) where value::numeric <= 0)
    ) then raise exception 'Category weights must be positive and total 100.'; end if;
    if new.scale = '{}' or exists (
        select from jsonb_each_text(new.scale) as s(label, floor)
        where btrim(label) = '' or coalesce(floor, '') !~ '^[0-9]+(\.[0-9]+)?$'
    ) then raise exception 'Enter grade thresholds as numbers.'; end if;
    if (select min(value::numeric) from jsonb_each_text(new.scale)) <> 0
        or exists (select from jsonb_each_text(new.scale) where value::numeric > 100)
        or (select count(*) <> count(distinct value::numeric) from jsonb_each_text(new.scale))
    then raise exception 'Grade thresholds must be distinct, between 0 and 100, and include 0.'; end if;
    if tg_op = 'UPDATE' and exists (
        select from public.gradebook_final_courses where course_id = old.id
    ) and (new.name, new.term, new.weighting, new.missing_is_zero, new.categories, new.scale)
        is distinct from (old.name, old.term, old.weighting, old.missing_is_zero, old.categories, old.scale)
    then raise exception 'Reopen finalized grades before changing course settings.'; end if;
    if tg_op = 'UPDATE' and exists (
        select from public.gradebook_assignments where course_id = old.id
            and not (new.categories ? category)
    ) then raise exception 'Keep categories already used by assignments.'; end if;
    return new;
end;
$$;

drop trigger if exists gradebook_validate_course on public.gradebook_courses;
create trigger gradebook_validate_course before insert or update on public.gradebook_courses
for each row execute function public.gradebook_validate_course();

create or replace function public.gradebook_validate_assignment()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare course public.gradebook_courses;
begin
    select * into course from public.gradebook_courses where id = new.course_id for update;
    if tg_op = 'UPDATE' and (new.id, new.course_id) is distinct from (old.id, old.course_id)
    then raise exception 'Assignment identity cannot change.'; end if;
    if exists (select from public.gradebook_final_courses where course_id = new.course_id)
    then raise exception 'Reopen finalized grades before changing assignments.'; end if;
    if not (course.categories ? new.category)
    then raise exception 'Choose a category defined for this course.'; end if;
    if exists (
        select from jsonb_each_text(new.rubric) as r(label, points)
        where btrim(label) = '' or coalesce(points, '') !~ '^[0-9]+(\.[0-9]{1,2})?$'
    ) then raise exception 'Rubric criteria need names and point values.'; end if;
    if new.rubric <> '{}' and (
        (select sum(value::numeric) from jsonb_each_text(new.rubric)) <> new.points
        or exists (select from jsonb_each_text(new.rubric) where value::numeric <= 0)
    ) then raise exception 'Rubric criteria must be positive and add up to the assignment points.'; end if;
    if tg_op = 'UPDATE' and (new.points, new.rubric) is distinct from (old.points, old.rubric)
        and exists (select from public.gradebook_marks where assignment_id = old.id and state = 'scored')
    then raise exception 'Clear existing scores before changing assignment points or its rubric.'; end if;
    return new;
end;
$$;

drop trigger if exists gradebook_validate_assignment on public.gradebook_assignments;
create trigger gradebook_validate_assignment before insert or update on public.gradebook_assignments
for each row execute function public.gradebook_validate_assignment();

create or replace function public.gradebook_validate_enrollment()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
    perform from public.gradebook_courses where id = old.course_id for update;
    if exists (select from public.gradebook_final_courses where enrollment_id = old.id)
    then raise exception 'Reopen this grade before editing its enrollment.'; end if;
    return new;
end;
$$;

drop trigger if exists gradebook_validate_enrollment on public.gradebook_enrollments;
create trigger gradebook_validate_enrollment before update on public.gradebook_enrollments
for each row execute function public.gradebook_validate_enrollment();
revoke all on function public.gradebook_validate_enrollment() from public;

create or replace function public.gradebook_validate_mark()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare assignment public.gradebook_assignments;
begin
    -- The same course lock serializes scores, assignment settings and finalization.
    perform from public.gradebook_courses where id = new.course_id for update;
    if tg_op = 'UPDATE' and (new.enrollment_id, new.assignment_id, new.course_id)
        is distinct from (old.enrollment_id, old.assignment_id, old.course_id)
    then raise exception 'Score identity cannot change.'; end if;
    if exists (select from public.gradebook_final_courses where enrollment_id = new.enrollment_id)
    then raise exception 'Reopen this grade before editing scores.'; end if;
    select * into assignment from public.gradebook_assignments
        where id = new.assignment_id and course_id = new.course_id;
    if new.rubric_scores <> '{}' then
        if new.state <> 'scored' or exists (
            select from jsonb_each_text(new.rubric_scores) as r(label, points)
            where not (assignment.rubric ? label) or coalesce(points, '') !~ '^[0-9]+(\.[0-9]{1,2})?$'
        ) or (select count(*) from jsonb_object_keys(new.rubric_scores))
            <> (select count(*) from jsonb_object_keys(assignment.rubric))
        then raise exception 'Enter scores for every rubric criterion.'; end if;
        if exists (
            select from jsonb_each_text(new.rubric_scores) as r(label, points)
            where points::numeric > (assignment.rubric ->> label)::numeric
        ) then raise exception 'A rubric score exceeds its point limit.'; end if;
        new.score := (select sum(value::numeric) from jsonb_each_text(new.rubric_scores));
    end if;
    if new.score > assignment.points then raise exception 'A score exceeds the assignment points.'; end if;
    new.updated_at := clock_timestamp();
    return new;
end;
$$;

drop trigger if exists gradebook_validate_mark on public.gradebook_marks;
create trigger gradebook_validate_mark before insert or update on public.gradebook_marks
for each row execute function public.gradebook_validate_mark();

revoke all on function public.gradebook_validate_course(), public.gradebook_validate_assignment(),
    public.gradebook_validate_mark() from public;

create or replace function public.gradebook_calculate(target_enrollment uuid)
returns table (percent numeric, unresolved bigint, letter text)
language sql stable security invoker set search_path = ''
as $$
    with course as (
        select c.* from public.gradebook_courses c join public.gradebook_enrollments e on c.id = e.course_id
        where e.id = target_enrollment
    ), scores as (
        select a.category, a.points, m.score, coalesce(m.state, 'ungraded') as state
        from course c join public.gradebook_assignments a on a.course_id = c.id
        left join public.gradebook_marks m on m.assignment_id = a.id and m.enrollment_id = target_enrollment
    ), totals as (
        select s.category, sum(coalesce(s.score, 0)) as earned, sum(s.points) as possible
        from scores s cross join course c
        where s.state = 'scored' or (s.state = 'missing' and c.missing_is_zero)
        group by s.category
    ), calculated as (
        select round(100 * case when c.weighting = 'weighted' then
            (select sum(t.earned / t.possible * (c.categories ->> t.category)::numeric)
                / nullif(sum((c.categories ->> t.category)::numeric), 0) from totals t)
            else (select sum(earned) / nullif(sum(possible), 0) from totals) end, 2) as percent, c.scale
        from course c
    )
    select c.percent, (select count(*) from scores where state = 'ungraded'),
        (select key from jsonb_each_text(c.scale) where value::numeric <= c.percent order by value::numeric desc limit 1)
    from calculated c;
$$;

revoke all on function public.gradebook_calculate(uuid) from public;
grant execute on function public.gradebook_calculate(uuid) to authenticated;

create or replace function public.gradebook_save_marks(target_course uuid, changes jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare
    change public.gradebook_marks;
    prior_timestamp timestamptz;
begin
    if not coalesce(public.gradebook_can_manage(target_course), false)
    then raise exception 'Course access required.'; end if;
    perform from public.gradebook_courses where id = target_course for update;
    if not coalesce(public.gradebook_can_manage(target_course), false)
    then raise exception 'Course access required.'; end if;
    for change in select * from jsonb_populate_recordset(null::public.gradebook_marks, changes)
    loop
        if not exists (select from public.gradebook_enrollments where id = change.enrollment_id and course_id = target_course)
            or not exists (select from public.gradebook_assignments where id = change.assignment_id and course_id = target_course)
        then raise exception 'Each score must belong to the selected course.'; end if;
        select updated_at into prior_timestamp from public.gradebook_marks
        where enrollment_id = change.enrollment_id and assignment_id = change.assignment_id;
        if prior_timestamp is distinct from change.updated_at
        then raise exception 'Another session changed a score. Reload the course before saving again.'; end if;

        insert into public.gradebook_marks
            (course_id, enrollment_id, assignment_id, state, score, rubric_scores, family_feedback, private_note)
        values (target_course, change.enrollment_id, change.assignment_id, change.state, change.score,
            change.rubric_scores, change.family_feedback, change.private_note)
        on conflict (enrollment_id, assignment_id) do update
        set state = excluded.state, score = excluded.score, rubric_scores = excluded.rubric_scores,
            family_feedback = excluded.family_feedback, private_note = excluded.private_note;
    end loop;
end;
$$;

revoke all on function public.gradebook_save_marks(uuid, jsonb) from public;
grant execute on function public.gradebook_save_marks(uuid, jsonb) to authenticated;

create or replace function public.gradebook_finalize(
    target_enrollment uuid, earned_credits numeric, override_grade text default null, reason text default null
) returns public.gradebook_final_courses
language plpgsql security definer set search_path = ''
as $$
declare
    enrollment public.gradebook_enrollments;
    course public.gradebook_courses;
    result public.gradebook_final_courses;
    grade record;
begin
    select c.* into course from public.gradebook_courses c
    join public.gradebook_enrollments e on e.course_id = c.id
    where e.id = target_enrollment and public.gradebook_can_manage(c.id)
    for update of c;
    if course.id is null or not coalesce(public.gradebook_can_manage(course.id), false)
    then raise exception 'Course access required.'; end if;
    select * into enrollment from public.gradebook_enrollments where id = target_enrollment;
    select * into result from public.gradebook_final_courses where enrollment_id = target_enrollment;
    if result.enrollment_id is not null then return result; end if;

    select * into grade from public.gradebook_calculate(target_enrollment);
    if grade.unresolved <> 0 or grade.percent is null
    then raise exception 'Resolve all ungraded assignments and enter at least one countable score before finalizing.'; end if;
    override_grade := nullif(btrim(override_grade), '');
    if earned_credits is null or earned_credits < 0 or earned_credits > enrollment.credits
        or round(earned_credits, 2) <> earned_credits
    then raise exception 'Enter earned credits between zero and the maximum course credits.'; end if;
    if override_grade is not null and (not (course.scale ? override_grade) or nullif(btrim(reason), '') is null)
    then raise exception 'An override needs a grade from the course scale and a reason.'; end if;

    insert into public.gradebook_final_courses
        (enrollment_id, course_id, student_id, course_name, term, requirement_key, grade_level, credits, final_grade, calculated_percent)
    values
        (enrollment.id, course.id, enrollment.student_id, course.name, course.term, enrollment.requirement_key,
         enrollment.grade_level, earned_credits, coalesce(override_grade, grade.letter), grade.percent)
    returning * into result;
    insert into public.gradebook_history (course_id, enrollment_id, actor_id, action, details, reason)
        values (course.id, enrollment.id, auth.uid(), 'finalized',
            to_jsonb(result) || jsonb_build_object('calculated_grade', grade.letter), nullif(btrim(reason), ''));
    return result;
end;
$$;

create or replace function public.gradebook_reopen(target_enrollment uuid, reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare result public.gradebook_final_courses;
begin
    if nullif(btrim(reason), '') is null then raise exception 'Enter a reason to reopen this grade.'; end if;
    select * into result from public.gradebook_final_courses where enrollment_id = target_enrollment;
    if result.enrollment_id is null or not coalesce(public.gradebook_can_manage(result.course_id), false)
    then raise exception 'A finalized grade and course access are required.'; end if;
    perform from public.gradebook_courses where id = result.course_id for update;
    if not coalesce(public.gradebook_can_manage(result.course_id), false)
    then raise exception 'Course access required.'; end if;
    delete from public.gradebook_final_courses where enrollment_id = target_enrollment returning * into result;
    if result.enrollment_id is null then raise exception 'This grade was already reopened.'; end if;
    insert into public.gradebook_history (course_id, enrollment_id, actor_id, action, details, reason)
        values (result.course_id, result.enrollment_id, auth.uid(), 'reopened', to_jsonb(result), btrim(reason));
end;
$$;

create or replace function public.gradebook_family_feedback(target_student uuid)
returns table (course_name text, term text, assignment_title text, feedback text)
language sql stable security definer set search_path = ''
as $$
    select f.course_name, f.term, a.title, m.family_feedback
    from public.gradebook_final_courses f
    join public.students s on s.id = f.student_id
    join public.gradebook_marks m on m.enrollment_id = f.enrollment_id
    join public.gradebook_assignments a on a.id = m.assignment_id
    where s.id = target_student and s.family_id = auth.uid()
        and public.current_portal_role() = 'family' and btrim(m.family_feedback) <> ''
    order by f.course_name, a.due_on, a.title;
$$;

revoke all on function public.gradebook_finalize(uuid, numeric, text, text), public.gradebook_reopen(uuid, text),
    public.gradebook_family_feedback(uuid) from public;
grant execute on function public.gradebook_finalize(uuid, numeric, text, text), public.gradebook_reopen(uuid, text),
    public.gradebook_family_feedback(uuid) to authenticated;

commit;

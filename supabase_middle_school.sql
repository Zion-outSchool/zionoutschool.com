begin;

create table public.ms_settings (
    id boolean primary key default true check (id),
    school_name text not null default 'Zion Outschool' check (length(btrim(school_name)) between 1 and 180),
    school_contact text not null default '' check (length(school_contact) <= 500),
    grading_key text not null default '' check (length(grading_key) <= 3000),
    current_school_year text check (current_school_year ~ '^[0-9]{4}-[0-9]{4}$'),
    credit_policy text not null default '' check (length(credit_policy) <= 3000)
);
insert into public.ms_settings default values;

create table public.ms_course_map (
    id uuid primary key default gen_random_uuid(),
    area text not null check (length(btrim(area)) between 1 and 100),
    title text not null check (length(btrim(title)) between 1 and 180),
    grade smallint check (grade between 0 and 8),
    term text check (length(term) <= 100),
    mode text not null default 'standalone' check (mode in ('standalone', 'rotation', 'integrated')),
    standards_url text check (standards_url ~ '^https?://' and length(standards_url) <= 2048),
    unit_mapping text check (length(unit_mapping) <= 5000),
    math_codes text[] not null default '{}',
    active boolean not null default true
);

insert into public.ms_course_map(area, title, grade)
select area, area || ' ' || case when grade=0 then 'Kindergarten' else grade::text end, grade
from unnest(array['English Language Arts','Math','Science','Social Studies']) area
cross join generate_series(0, 8) grade;
update public.ms_course_map m set standards_url =
    'https://dese.ade.arkansas.gov/Files/AR_2023_K-8%2C_Alg%2C_Geo_Math_Standards_LS_6.21.23_LS.pdf#page=' || l.first_page
from public.k8_math_levels l where m.area='Math' and l.grade=case when m.grade=0 then 'K' else m.grade::text end;
insert into public.ms_course_map(area, title, mode) values
    ('Fine Arts', 'Fine Arts', 'rotation'), ('Health', 'Health', 'standalone'),
    ('Physical Education', 'Physical Education', 'standalone'),
    ('Career Exploration', 'Career Exploration', 'integrated'), ('Arkansas History', 'Arkansas History', 'standalone'),
    ('Math', 'Algebra I', 'standalone');

create table public.ms_years (
    id uuid primary key default gen_random_uuid(),
    student_id uuid not null references public.students(id) on delete cascade,
    school_year text not null check (school_year ~ '^[0-9]{4}-[0-9]{4}$'),
    enrolled_grade smallint not null check (enrolled_grade between 0 and 8),
    legal_name text check (length(legal_name) <= 240),
    entered_on date,
    withdrawn_on date,
    progression text check (length(progression) <= 240),
    unique (student_id, school_year),
    check (entered_on is null or withdrawn_on is null or entered_on <= withdrawn_on)
);

create table public.ms_courses (
    id uuid primary key default gen_random_uuid(),
    year_id uuid not null references public.ms_years(id) on delete cascade,
    map_id uuid references public.ms_course_map(id) on delete set null,
    area text not null check (length(btrim(area)) between 1 and 100),
    title text not null check (length(btrim(title)) between 1 and 180),
    instructional_level text not null check (length(btrim(instructional_level)) between 1 and 100),
    term text check (length(term) <= 100),
    starts_on date,
    ends_on date,
    course_status text not null check (course_status in ('planned', 'in_progress', 'completed', 'withdrawn')),
    math_codes text[] not null default '{}',
    high_school_level boolean not null default false,
    credit_decision text check (credit_decision in ('pending', 'awarded', 'no_credit')),
    units numeric(4,2) check (units > 0),
    hs_requirement text,
    add_to_transcript boolean not null default false,
    credit_decided_by uuid,
    credit_decided_at timestamptz,
    check (nullif(btrim(term), '') is not null or (starts_on is not null and ends_on is not null)),
    check (starts_on is null or ends_on is null or starts_on <= ends_on),
    check (high_school_level = (credit_decision is not null)),
    check ((units is not null) = coalesce(credit_decision = 'awarded', false)),
    check (not add_to_transcript or (credit_decision = 'awarded' and nullif(hs_requirement, '') is not null))
);
create index ms_courses_year on public.ms_courses(year_id);

create table public.ms_results (
    id uuid primary key default gen_random_uuid(),
    course_id uuid not null references public.ms_courses(id) on delete cascade,
    period text not null check (length(btrim(period)) between 1 and 100),
    period_end date not null,
    result_kind text not null check (result_kind in ('term', 'final', 'interim')),
    as_of date,
    mark text not null check (length(btrim(mark)) between 1 and 100),
    next_step text check (length(next_step) <= 2000),
    evidence_url text check (evidence_url ~ '^https?://' and length(evidence_url) <= 2048),
    math_codes text[] not null default '{}',
    gradebook_enrollment_id uuid unique,
    verification text not null default 'pending' check (verification in ('pending','verified')),
    version integer not null default 1,
    updated_by uuid not null,
    updated_at timestamptz not null default now(),
    verified_by uuid,
    published jsonb,
    unique (course_id, period),
    check ((result_kind = 'interim') = (as_of is not null))
);

create table public.ms_requests (
    id uuid primary key default gen_random_uuid(),
    student_id uuid not null references public.students(id) on delete cascade,
    requested_by uuid not null,
    requested_at timestamptz not null default now(),
    status text not null default 'requested' check (status in ('requested','in_review','issued','declined'))
);
create unique index ms_one_open_request on public.ms_requests(student_id,requested_by)
    where status in ('requested','in_review');

-- Retain the certified record even if the student's operational record is later removed.
create table public.ms_transcripts (
    id uuid primary key default gen_random_uuid(),
    student_id uuid not null,
    request_id uuid unique,
    issued_by uuid not null,
    issued_at timestamptz not null default now(),
    snapshot jsonb not null,
    pdf bytea not null check (octet_length(pdf) between 8 and 1500000),
    released boolean not null default false
);
create index ms_transcripts_student on public.ms_transcripts(student_id,issued_at);

alter table public.ms_settings enable row level security;
alter table public.ms_course_map enable row level security;
alter table public.ms_years enable row level security;
alter table public.ms_courses enable row level security;
alter table public.ms_results enable row level security;
alter table public.ms_requests enable row level security;
alter table public.ms_transcripts enable row level security;
revoke all on public.ms_settings,public.ms_course_map,public.ms_years,public.ms_courses,
    public.ms_results,public.ms_requests,public.ms_transcripts from public,anon,authenticated;

create function public.ms_can_access(p_student uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
    select exists (
        select 1 from public.students s where s.id=p_student and (
            public.current_portal_role()='admin'
            or (public.current_portal_role()='family' and s.family_id=auth.uid())
            or (public.current_portal_role()='teacher' and exists (
                select 1 from public.gradebook_enrollments e
                join public.gradebook_courses c on c.id=e.course_id
                where e.student_id=s.id and c.teacher_id=auth.uid()
            ))
        )
    );
$$;

create function public.ms_high_school_courses(target_student uuid)
returns table(course_name text, term text, requirement_key text, grade_level text, credits numeric, final_grade text)
language sql stable security definer set search_path = ''
as $$
    select c.title, concat_ws(' · ',y.school_year,c.term), c.hs_requirement, y.enrolled_grade::text, c.units, r.published->>'mark'
    from public.ms_years y
    join public.ms_courses c on c.year_id=y.id
    join lateral (
        select published from public.ms_results
        where course_id=c.id and published->>'result_kind'='final'
        order by (published->>'period_end') desc, id desc limit 1
    ) r on true
    where y.student_id=target_student and y.enrolled_grade>=6 and public.ms_can_access(target_student)
        and c.credit_decision='awarded' and c.add_to_transcript;
$$;

create function public.ms_transcript_snapshot(p_student uuid, p_results jsonb, p_legal_name text,
    p_signer text, p_signer_title text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
    settings public.ms_settings%rowtype;
    selected jsonb;
    years jsonb;
begin
    if public.current_portal_role() is distinct from 'admin' or not public.ms_can_access(p_student) then
        raise exception 'Office access is required.' using errcode='42501';
    end if;
    if jsonb_typeof(p_results) is distinct from 'array' then
        raise exception 'Select verified results.' using errcode='22023';
    end if;
    if jsonb_array_length(p_results) not between 1 and 120
        or coalesce(length(btrim(p_legal_name)),0) not between 1 and 240
        or coalesce(length(btrim(p_signer)),0) not between 1 and 120
        or coalesce(length(btrim(p_signer_title)),0) not between 1 and 120 then
        raise exception 'Provide the legal name, authorized signer and title, and select one to 120 verified results.' using errcode='22023';
    end if;
    select * into settings from public.ms_settings;
    if btrim(settings.school_name)='' or btrim(settings.school_contact)='' or btrim(settings.grading_key)='' then
        raise exception 'Save the school contact and approved grading key in Office settings before issuing a transcript.' using errcode='22023';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
        'id',r.id,'course_id',c.id,'year_id',y.id,'school_year',y.school_year,'enrolled_grade',y.enrolled_grade,
        'title',c.title,'area',c.area,'instructional_level',c.instructional_level,'term',c.term,
        'starts_on',c.starts_on,'ends_on',c.ends_on,'course_status',c.course_status,
        'period',r.published->>'period','period_end',r.published->>'period_end',
        'result_kind',r.published->>'result_kind','mark',r.published->>'mark','as_of',r.published->>'as_of',
        'credit_decision',c.credit_decision,'units',case when c.credit_decision='awarded' then c.units end
    ) order by y.school_year,c.title,r.published->>'period_end',r.id),'[]'::jsonb)
    into selected
    from public.ms_results r join public.ms_courses c on c.id=r.course_id
        join public.ms_years y on y.id=c.year_id
    where y.student_id=p_student and r.published is not null and p_results ? r.id::text;
    if jsonb_array_length(selected) <> jsonb_array_length(p_results) then
        raise exception 'One or more selected results is unavailable for this student.' using errcode='22023';
    end if;
    select jsonb_agg(jsonb_build_object('id',y.id,'year',y.school_year,'grade',y.enrolled_grade,
        'entered_on',y.entered_on,'withdrawn_on',y.withdrawn_on,'progression',y.progression) order by y.school_year)
    into years from public.ms_years y where y.student_id=p_student and exists (
        select 1 from jsonb_array_elements(selected) entry where entry->>'year_id'=y.id::text
    );
    return jsonb_build_object('legal_name',btrim(p_legal_name),'issuer',settings.school_name,
        'contact',settings.school_contact,'grading_key',settings.grading_key,'years',years,'results',selected,
        'document_title',case when exists (select 1 from jsonb_array_elements(years) y where (y->>'grade')::int<6)
            then 'K–8 Learning Transcript' else 'Middle School Transcript' end,
        'signer',btrim(p_signer),'signer_title',btrim(p_signer_title),
        'issued_on',(now() at time zone 'America/Chicago')::date);
end;
$$;

create function public.middle_school(p_action text, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    actor uuid := auth.uid();
    actor_role text := public.current_portal_role();
    student uuid := nullif(p_data->>'student_id','')::uuid;
    item uuid := nullif(p_data->>'id','')::uuid;
    related uuid;
    course public.ms_courses%rowtype;
    final public.gradebook_final_courses%rowtype;
    year_row public.ms_years%rowtype;
    result_row public.ms_results%rowtype;
    request_row public.ms_requests%rowtype;
    transcript_row public.ms_transcripts%rowtype;
    output jsonb;
    snapshot jsonb;
    decision text;
    credit_units numeric;
    add_credit boolean;
begin
    if actor is null or coalesce(actor_role,'') not in ('admin','teacher','family') then
        raise exception 'K–8 portal access is required.' using errcode='42501';
    end if;
    if p_action='roster' then
        return coalesce((
            select jsonb_agg(to_jsonb(s) order by s.last_name,s.first_name)
            from (select id,first_name,last_name,preferred_name,grade_level from public.students) s
            where public.ms_can_access(s.id) and (
                lower(btrim(s.grade_level)) ~ '^(k|kindergarten|(grade[ ]*)?[1-8](st|nd|rd|th)?)$'
                or exists(select 1 from public.ms_years y where y.student_id=s.id)
            )
        ),'[]'::jsonb);
    end if;

    if p_action='record' then
        if not public.ms_can_access(student) then
            raise exception 'This student record is unavailable.' using errcode='42501';
        end if;
        return jsonb_build_object(
          'current_school_year', (select coalesce(current_school_year,
             case when extract(month from current_date)>=7 then extract(year from current_date)::int || '-' || (extract(year from current_date)::int+1)
             else (extract(year from current_date)::int-1) || '-' || extract(year from current_date)::int end) from public.ms_settings),
          'years',coalesce((select jsonb_agg(case when actor_role='family' then jsonb_build_object(
                  'id',y.id,'school_year',y.school_year,'enrolled_grade',y.enrolled_grade,'withdrawn_on',y.withdrawn_on)
              else to_jsonb(y) end order by y.school_year desc)
              from public.ms_years y where y.student_id=student),'[]'::jsonb),
          'courses',coalesce((select jsonb_agg(
              case when actor_role='family' then jsonb_build_object('id',c.id,'year_id',c.year_id,'area',c.area,
                  'title',c.title,'instructional_level',c.instructional_level,'term',c.term,'starts_on',c.starts_on,
                  'ends_on',c.ends_on,'course_status',c.course_status,'credit_decision',c.credit_decision,'units',c.units,
                  'math_topics',(select coalesce(jsonb_agg(distinct s.topic order by s.topic),'[]'::jsonb)
                      from public.k8_math_standards s where s.code=any(c.math_codes)))
              else to_jsonb(c) end order by c.title,c.term)
              from public.ms_courses c join public.ms_years y on y.id=c.year_id where y.student_id=student),'[]'::jsonb),
          'results',coalesce((select jsonb_agg(
              case when actor_role='family' then r.published || jsonb_build_object('id',r.id,'course_id',r.course_id)
              else to_jsonb(r) end order by
                  case when actor_role='family' then (r.published->>'period_end')::date else r.period_end end desc,r.id)
              from public.ms_results r join public.ms_courses c on c.id=r.course_id join public.ms_years y on y.id=c.year_id
              where y.student_id=student and (actor_role<>'family' or r.published is not null)),'[]'::jsonb),
          'gradebook_finals',case when actor_role='family' then '[]'::jsonb else coalesce((
              select jsonb_agg(jsonb_build_object('id',f.enrollment_id,'title',f.course_name,'term',f.term,
                  'mark',f.final_grade,'grade',f.grade_level,'finalized_at',f.finalized_at) order by f.finalized_at desc)
              from public.gradebook_final_courses f where f.student_id=student
                  and public.gradebook_can_manage(f.course_id)),'[]'::jsonb) end,
          'requests',case when actor_role='teacher' then '[]'::jsonb else coalesce((select jsonb_agg(
              to_jsonb(q)-'requested_by' order by q.requested_at desc) from public.ms_requests q
              where q.student_id=student and (actor_role='admin' or q.requested_by=actor)),'[]'::jsonb) end,
          'transcripts',case when actor_role='teacher' then '[]'::jsonb else coalesce((select jsonb_agg(
              jsonb_build_object('id',t.id,'issued_at',t.issued_at,'released',t.released) order by t.issued_at desc)
              from public.ms_transcripts t where t.student_id=student and (actor_role='admin' or t.released)),'[]'::jsonb) end
        );
    end if;

    if p_action='request' then
        if actor_role<>'family' or not public.ms_can_access(student) or not exists
            (select 1 from public.ms_years y where y.student_id=student) then
            raise exception 'A linked K–8 enrollment is required to request a transcript.' using errcode='42501';
        end if;
        insert into public.ms_requests(student_id,requested_by) values(student,actor)
            on conflict (student_id,requested_by) where status in ('requested','in_review') do nothing;
        return jsonb_build_object('ok',true);
    end if;

    if p_action='download' then
        select * into transcript_row from public.ms_transcripts where id=item;
        if not found or not (actor_role='admin' or (actor_role='family' and transcript_row.released
            and public.ms_can_access(transcript_row.student_id))) then
            raise exception 'This transcript is unavailable.' using errcode='42501';
        end if;
        return jsonb_build_object('file',encode(transcript_row.pdf,'base64'),'issued_at',transcript_row.issued_at);
    end if;

    if actor_role='family' then raise exception 'Staff access is required.' using errcode='42501'; end if;
    if p_action='map' then
        return coalesce((select jsonb_agg(to_jsonb(m) order by m.area,m.grade,m.title)
            from public.ms_course_map m where m.active or actor_role='admin'),'[]'::jsonb);
    end if;

    if p_action='course-save' then
        select * into year_row from public.ms_years where id=(p_data->>'year_id')::uuid;
        if not found or not public.ms_can_access(year_row.student_id) then
            raise exception 'This enrollment is unavailable.' using errcode='42501';
        end if;
        if item is null then
            insert into public.ms_courses(year_id,map_id,area,title,instructional_level,term,starts_on,ends_on,course_status,high_school_level,credit_decision,math_codes)
            values(year_row.id,nullif(p_data->>'map_id','')::uuid,btrim(p_data->>'area'),btrim(p_data->>'title'),
                btrim(p_data->>'instructional_level'),nullif(btrim(p_data->>'term'),''),
                nullif(p_data->>'starts_on','')::date,nullif(p_data->>'ends_on','')::date,p_data->>'course_status',
                year_row.enrolled_grade>=6 and coalesce((p_data->>'high_school_level')::boolean,false),
                case when year_row.enrolled_grade>=6 and coalesce((p_data->>'high_school_level')::boolean,false) then 'pending' end,
                public.k8_math_codes(p_data->'math_codes'))
            returning id into item;
        else
            select * into course from public.ms_courses where id=item and year_id=year_row.id for update;
            if not found then raise exception 'This course is unavailable.' using errcode='42501'; end if;
            if actor_role='teacher' and course.credit_decided_at is not null then
                raise exception 'The office must edit a course after recording its credit decision.' using errcode='42501';
            end if;
            update public.ms_courses set map_id=nullif(p_data->>'map_id','')::uuid,area=btrim(p_data->>'area'),
                title=btrim(p_data->>'title'),instructional_level=btrim(p_data->>'instructional_level'),
                term=nullif(btrim(p_data->>'term'),''),starts_on=nullif(p_data->>'starts_on','')::date,
                ends_on=nullif(p_data->>'ends_on','')::date,course_status=p_data->>'course_status',
                math_codes=public.k8_math_codes(p_data->'math_codes'),
                high_school_level=case when credit_decided_at is not null then high_school_level else
                    year_row.enrolled_grade>=6 and coalesce((p_data->>'high_school_level')::boolean,false) end,
                credit_decision=case when credit_decided_at is not null then credit_decision
                    when year_row.enrolled_grade>=6 and coalesce((p_data->>'high_school_level')::boolean,false) then 'pending' end
            where id=item;
        end if;
        return jsonb_build_object('id',item);
    end if;

    if p_action='result-save' then
        related := (p_data->>'course_id')::uuid;
        select y.* into year_row from public.ms_courses c join public.ms_years y on y.id=c.year_id where c.id=related;
        if not found or not public.ms_can_access(year_row.student_id) then
            raise exception 'This course is unavailable.' using errcode='42501';
        end if;
        if item is null then
            insert into public.ms_results(course_id,period,period_end,result_kind,as_of,mark,next_step,evidence_url,math_codes,updated_by)
            values(related,btrim(p_data->>'period'),(p_data->>'period_end')::date,p_data->>'result_kind',
                nullif(p_data->>'as_of','')::date,btrim(p_data->>'mark'),nullif(btrim(p_data->>'next_step'),''),
                nullif(btrim(p_data->>'evidence_url'),''),public.k8_math_codes(p_data->'math_codes'),actor) returning id into item;
        else
            update public.ms_results set period=btrim(p_data->>'period'),period_end=(p_data->>'period_end')::date,
                result_kind=case when gradebook_enrollment_id is null then p_data->>'result_kind' else 'final' end,
                as_of=case when gradebook_enrollment_id is null then nullif(p_data->>'as_of','')::date end,
                mark=case when gradebook_enrollment_id is null then btrim(p_data->>'mark') else mark end,
                next_step=nullif(btrim(p_data->>'next_step'),''),evidence_url=nullif(btrim(p_data->>'evidence_url'),''),
                math_codes=public.k8_math_codes(p_data->'math_codes'),
                verification='pending',version=version+1,updated_by=actor,updated_at=now()
            where id=item and course_id=related and version=(p_data->>'version')::integer;
            if not found then raise exception 'This result has changed. Reload it before saving.' using errcode='22023'; end if;
        end if;
        return jsonb_build_object('id',item);
    end if;

    if p_action='gradebook-import' then
        related := (p_data->>'course_id')::uuid;
        select y.* into year_row from public.ms_courses c join public.ms_years y on y.id=c.year_id where c.id=related;
        if not found or not public.ms_can_access(year_row.student_id) then
            raise exception 'This course is unavailable.' using errcode='42501';
        end if;
        select * into final from public.gradebook_final_courses f
        where f.enrollment_id=item and f.student_id=year_row.student_id
            and f.grade_level=case when year_row.enrolled_grade=0 then 'K' else year_row.enrolled_grade::text end
            and public.gradebook_can_manage(f.course_id);
        if not found then raise exception 'This finalized grade is unavailable for this student and grade.' using errcode='42501'; end if;
        insert into public.ms_results as r(course_id,period,period_end,result_kind,mark,gradebook_enrollment_id,updated_by)
        values(related,'Final gradebook result', (final.finalized_at at time zone 'America/Chicago')::date,
            'final',final.final_grade,final.enrollment_id,actor)
        on conflict (gradebook_enrollment_id) do update set mark=excluded.mark,period_end=excluded.period_end,
            verification='pending',version=r.version+1,updated_by=actor,updated_at=now()
        where r.course_id=related and r.mark is distinct from excluded.mark;
        if not found and not exists (
            select 1 from public.ms_results r where r.gradebook_enrollment_id=item and r.course_id=related
        ) then raise exception 'This Gradebook result is already linked to another learning course.' using errcode='22023'; end if;
        return jsonb_build_object('ok',true);
    end if;

    if actor_role<>'admin' then raise exception 'Office access is required.' using errcode='42501'; end if;

    case p_action
    when 'settings' then
        return (select to_jsonb(s)-'id' from public.ms_settings s);
    when 'office' then
        return jsonb_build_object('pending_results',coalesce((select jsonb_agg(to_jsonb(p)) from (
                select r.id,r.period,r.updated_at,c.title,y.student_id,s.first_name,s.last_name
                from public.ms_results r join public.ms_courses c on c.id=r.course_id
                join public.ms_years y on y.id=c.year_id join public.students s on s.id=y.student_id
                where r.verification='pending' order by r.updated_at
            ) p),'[]'::jsonb),
            'requests',coalesce((select jsonb_agg(to_jsonb(p)) from (
                select q.id,q.student_id,q.status,q.requested_at,s.first_name,s.last_name
                from public.ms_requests q join public.students s on s.id=q.student_id
                where q.status in ('requested','in_review') order by q.requested_at
            ) p),'[]'::jsonb),
            'issued',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'issued_at',t.issued_at,
                'legal_name',t.snapshot->>'legal_name','released',t.released) order by t.issued_at desc)
                from public.ms_transcripts t),'[]'::jsonb));
    when 'settings-save' then
        update public.ms_settings set school_name=btrim(p_data->>'school_name'),
            school_contact=btrim(p_data->>'school_contact'),grading_key=btrim(p_data->>'grading_key'),
            current_school_year=nullif(p_data->>'current_school_year',''),credit_policy=btrim(p_data->>'credit_policy');
    when 'map-save' then
        if item is null then
            insert into public.ms_course_map(area,title,grade,term,mode,standards_url,unit_mapping,math_codes,active)
            values(btrim(p_data->>'area'),btrim(p_data->>'title'),nullif(p_data->>'grade','')::smallint,
                nullif(btrim(p_data->>'term'),''),p_data->>'mode',nullif(btrim(p_data->>'standards_url'),''),
                nullif(btrim(p_data->>'unit_mapping'),''),public.k8_math_codes(p_data->'math_codes'),coalesce((p_data->>'active')::boolean,true));
        else
            update public.ms_course_map set area=btrim(p_data->>'area'),title=btrim(p_data->>'title'),
                grade=nullif(p_data->>'grade','')::smallint,term=nullif(btrim(p_data->>'term'),''),mode=p_data->>'mode',
                standards_url=nullif(btrim(p_data->>'standards_url'),''),unit_mapping=nullif(btrim(p_data->>'unit_mapping'),''),
                math_codes=public.k8_math_codes(p_data->'math_codes'),
                active=coalesce((p_data->>'active')::boolean,true) where id=item;
        end if;
    when 'year-save' then
        if not public.ms_can_access(student) then raise exception 'This student is unavailable.' using errcode='42501'; end if;
        if item is null then
            insert into public.ms_years(student_id,school_year,enrolled_grade,legal_name,entered_on,withdrawn_on,progression)
            values(student,p_data->>'school_year',(p_data->>'enrolled_grade')::smallint,nullif(btrim(p_data->>'legal_name'),''),
                nullif(p_data->>'entered_on','')::date,nullif(p_data->>'withdrawn_on','')::date,nullif(btrim(p_data->>'progression'),''))
            returning id into item;
        else
            if (p_data->>'enrolled_grade')::smallint<6 and exists (
                select 1 from public.ms_courses c join public.ms_years y on y.id=c.year_id
                where y.id=item and y.student_id=student and c.high_school_level
            ) then raise exception 'Resolve high-school credit courses before changing this enrollment to an elementary grade.'
                using errcode='22023'; end if;
            update public.ms_years set school_year=p_data->>'school_year',enrolled_grade=(p_data->>'enrolled_grade')::smallint,
                legal_name=nullif(btrim(p_data->>'legal_name'),''),entered_on=nullif(p_data->>'entered_on','')::date,
                withdrawn_on=nullif(p_data->>'withdrawn_on','')::date,progression=nullif(btrim(p_data->>'progression'),'')
                where id=item and student_id=student;
            if not found then raise exception 'This enrollment is unavailable.' using errcode='42501'; end if;
        end if;
        return jsonb_build_object('id',item);
    when 'verify' then
        update public.ms_results r set verification='verified',
            published=jsonb_build_object('period',r.period,'period_end',r.period_end,'result_kind',r.result_kind,
                'as_of',r.as_of,'mark',r.mark,
                'next_step',case when (p_data->>'share_next_step')::boolean then r.next_step end,
                'math_standards',(select coalesce(jsonb_agg(jsonb_build_object('code',s.code,'topic',s.topic) order by s.code),'[]'::jsonb)
                    from public.k8_math_standards s where s.code=any(r.math_codes)),
                'verified_at',now()),verified_by=actor,version=r.version+1
            where id=item and verification='pending' and version=(p_data->>'version')::integer;
        if not found then raise exception 'The result changed. Reload it before verifying.' using errcode='22023'; end if;
    when 'credit-save' then
        select * into course from public.ms_courses where id=item for update;
        if not found or not course.high_school_level
            or not exists(select 1 from public.ms_years y where y.id=course.year_id and y.enrolled_grade>=6) then
            raise exception 'Select a high-school-level course.' using errcode='22023';
        end if;
        decision := p_data->>'decision';
        add_credit := coalesce((p_data->>'add_to_transcript')::boolean,false);
        credit_units := case when decision='awarded' then nullif(p_data->>'units','')::numeric end;
        if coalesce(decision,'') not in ('pending','awarded','no_credit')
            or (decision='awarded' and (credit_units is null or credit_units<=0 or not exists
                (select 1 from public.ms_settings s where btrim(s.credit_policy)<>'')
                or not exists(select 1 from public.ms_results r where r.course_id=item and r.published->>'result_kind'='final'))) then
            raise exception 'Awarding credit requires an adopted policy, a verified final result, and positive units.' using errcode='22023';
        end if;
        if add_credit and (decision<>'awarded' or nullif(btrim(p_data->>'hs_requirement'),'') is null) then
            raise exception 'Award credit and select a high school requirement before adding this class to the transcript.' using errcode='22023';
        end if;
        update public.ms_courses set credit_decision=decision,units=credit_units,add_to_transcript=add_credit,
            hs_requirement=case when add_credit then btrim(p_data->>'hs_requirement') end,
            credit_decided_at=case when decision<>'pending' then now() end,
            credit_decided_by=case when decision<>'pending' then actor end where id=item;
    when 'request-update' then
        if coalesce(p_data->>'status','') not in ('in_review','declined') then
            raise exception 'Choose an available request status.' using errcode='22023';
        end if;
        update public.ms_requests set status=p_data->>'status' where id=item and status in ('requested','in_review');
        if not found then raise exception 'This request is already closed.' using errcode='22023'; end if;
    when 'release' then
        update public.ms_transcripts t set released=true where id=item
            and exists(select 1 from public.students s where s.id=t.student_id and s.family_id is not null);
        if not found then raise exception 'A linked family is required before releasing a transcript.' using errcode='22023'; end if;
    when 'preview','issue' then
        snapshot := public.ms_transcript_snapshot(student,p_data->'results',p_data->>'legal_name',p_data->>'signer',p_data->>'signer_title');
        if p_action='preview' then
            return jsonb_build_object('snapshot',snapshot,'revision',md5(snapshot::text));
        end if;
        if p_data->>'revision' is distinct from md5(snapshot::text) or p_data->'certify' is distinct from 'true'::jsonb then
            raise exception 'The record changed or certification was omitted. Preview the transcript again before issuing it.' using errcode='22023';
        end if;
        related := nullif(p_data->>'request_id','')::uuid;
        if related is not null then
            select * into request_row from public.ms_requests where id=related and student_id=student
                and status in ('requested','in_review') for update;
            if not found then raise exception 'This request is already closed or belongs to another student.' using errcode='22023'; end if;
        end if;
        if coalesce(length(p_data->>'pdf'),0) not between 12 and 2000000
            or left(p_data->>'pdf',6)<>'JVBERi' then
            raise exception 'Provide the certified PDF from the current preview.' using errcode='22023';
        end if;
        insert into public.ms_transcripts(student_id,request_id,issued_by,snapshot,pdf,released)
        values(student,related,actor,snapshot,decode(p_data->>'pdf','base64'),coalesce((p_data->>'release')::boolean,false))
        returning id into item;
        if related is not null then update public.ms_requests set status='issued' where id=related; end if;
        return jsonb_build_object('id',item);
    else
        raise exception 'Unknown middle school action.' using errcode='22023';
    end case;
    return jsonb_build_object('ok',true);
end;
$$;

revoke all on function public.ms_can_access(uuid),public.ms_transcript_snapshot(uuid,jsonb,text,text,text),
    public.ms_high_school_courses(uuid),public.middle_school(text,jsonb) from public,anon,authenticated;
grant execute on function public.ms_high_school_courses(uuid),public.middle_school(text,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;

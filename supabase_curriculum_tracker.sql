begin;

create table public.ct_catalogs (
    key text primary key, subject text not null, title text not null, publisher text not null,
    level text not null, edition text not null, source text not null, suggested_grades smallint[] not null default '{}',
    inventory_complete boolean not null default false,
    unique (publisher, subject, level, edition)
);
create table public.ct_items (
    catalog_key text references public.ct_catalogs, key text, unit text not null, sort_order integer not null,
    title text not null, kind text not null check (kind in ('lesson','section','assignment','assessment','supplement')),
    page_ref text, online_ref text, source text not null, provisional boolean not null default false,
    primary key (catalog_key,key)
);
create table public.ct_standards (
    key text primary key, subject text not null, grade smallint not null check (grade between 0 and 12),
    code text not null, edition text not null, source text not null, family_description text,
    unique (subject,code,edition)
);
create index ct_standards_grade on public.ct_standards(grade,subject);
create table public.ct_components (
    standard_key text references public.ct_standards, key text, label text not null,
    primary key (standard_key,key)
);
create table public.ct_reviews (
    key text primary key, standard_key text not null references public.ct_standards,
    catalog_key text not null references public.ct_catalogs, item_key text,
    disposition text not null check (disposition in ('candidate','partial','search','supplement','checkpoint','needed','unreviewed')),
    covered text, evidence_needed text, source text not null,
    foreign key (catalog_key,item_key) references public.ct_items
);
create index ct_reviews_standard on public.ct_reviews(standard_key);
create table public.ct_mappings (
    id bigint generated always as identity primary key,
    school_year text not null check (school_year ~ '^[0-9]{4}-[0-9]{4}$'),
    review_key text not null references public.ct_reviews,
    catalog_key text not null, item_key text not null, standard_key text not null,
    component_key text not null, effect text not null check (effect in ('taught','checkpoint','disabled')),
    rationale text not null, reviewed_by uuid not null, reviewed_at timestamptz not null default now(),
    foreign key (catalog_key,item_key) references public.ct_items,
    foreign key (standard_key,component_key) references public.ct_components
);
create index ct_mappings_revision on public.ct_mappings(school_year,review_key,catalog_key,item_key,component_key,id desc);
create view public.ct_current_mappings with (security_invoker=true) as
select distinct on (school_year,review_key,catalog_key,item_key,component_key) *
from public.ct_mappings order by school_year,review_key,catalog_key,item_key,component_key,id desc;

create table public.ct_periods (
    id uuid primary key default gen_random_uuid(), school_year text not null check (school_year ~ '^[0-9]{4}-[0-9]{4}$'),
    name text not null check (length(name) between 1 and 100), starts_on date not null, ends_on date not null,
    check (starts_on <= ends_on), unique (school_year,name)
);
create table public.ct_year_settings (
    school_year text primary key check (school_year ~ '^[0-9]{4}-[0-9]{4}$'),
    scale jsonb not null, grading_key text check (length(grading_key)<=3000)
);
create function public.ct_policy(p_year text) returns jsonb
language sql stable set search_path='' as $$
    select jsonb_build_object(
        'scale',coalesce(y.scale,'[
            {"key":"beginning","label":"Beginning","description":"The student is starting to show the skill and needs substantial support."},
            {"key":"developing","label":"Developing","description":"The student shows part of the skill or still needs prompts."},
            {"key":"meets","label":"Meets","description":"The student independently demonstrates the full grade-level expectation."},
            {"key":"extends","label":"Extends","description":"The student has met the expectation and independently applies it in a more complex or unfamiliar situation."}
        ]'::jsonb),
        'grading_key',coalesce(y.grading_key,nullif(btrim(m.grading_key),'')))
    from public.ms_settings m left join public.ct_year_settings y on y.school_year=p_year;
$$;
create table public.ct_studies (
    id uuid primary key default gen_random_uuid(), year_id uuid not null references public.ms_years on delete cascade,
    subject text not null, catalog_key text not null references public.ct_catalogs, delivery text not null
        check (delivery in ('books','online','both','other')),
    starts_in uuid not null references public.ct_periods, ends_in uuid references public.ct_periods,
    unique (id,catalog_key)
);
create unique index ct_primary_study on public.ct_studies(year_id,subject) where ends_in is null;
create table public.ct_work (
    id uuid primary key default gen_random_uuid(), study_id uuid not null, catalog_key text not null, item_key text not null,
    period_id uuid not null references public.ct_periods,
    completed boolean not null default false, result text check (length(result) between 1 and 100),
    result_kind text check (result_kind in ('grade','proficiency')),
    completed_on date, result_on date, gradebook_assignment_id uuid,
    updated_by uuid not null, updated_at timestamptz not null default now(),
    check ((result is null) = (result_kind is null)),
    foreign key (study_id,catalog_key) references public.ct_studies(id,catalog_key) on delete cascade,
    foreign key (catalog_key,item_key) references public.ct_items,
    unique (study_id,item_key,period_id)
);
create table public.ct_work_mappings (
    work_id uuid references public.ct_work on delete cascade,
    mapping_id bigint references public.ct_mappings, primary key(work_id,mapping_id)
);
create table public.ct_supplements (
    id uuid primary key default gen_random_uuid(), year_id uuid not null references public.ms_years on delete cascade,
    period_id uuid not null references public.ct_periods, standard_key text not null references public.ct_standards,
    title text not null check (length(title) between 1 and 180), instructions text, source_review text references public.ct_reviews,
    assigned_by uuid not null, completed boolean not null default false
);
create table public.ct_evidence (
    id uuid primary key default gen_random_uuid(), year_id uuid not null references public.ms_years on delete cascade,
    period_id uuid not null references public.ct_periods,
    standard_key text not null, component_key text not null,
    kind text not null check (kind in ('observation','work_sample','supplement','checkpoint')),
    description text not null check (length(description) between 1 and 2000), source_url text check (source_url ~ '^https?://'),
    work_id uuid references public.ct_work on delete cascade, mapping_id bigint references public.ct_mappings,
    supplement_id uuid references public.ct_supplements on delete cascade,
    observed_on date not null, independent boolean not null default false,
    verified_by uuid not null, verified_at timestamptz not null default now(),
    foreign key (standard_key,component_key) references public.ct_components,
    check ((kind='checkpoint') = (work_id is not null and mapping_id is not null)),
    check ((kind='supplement') = (supplement_id is not null)), unique(work_id,mapping_id)
);
create index ct_evidence_year on public.ct_evidence(year_id,period_id,standard_key);
create table public.ct_marks (
    year_id uuid references public.ms_years on delete cascade,
    period_id uuid not null references public.ct_periods,
    standard_key text references public.ct_standards,
    assessed_on date,
    mark text check (mark in ('beginning','developing','meets','extends')),
    extension_note text check (length(extension_note)<=2000),
    assessed_by uuid not null,
    primary key (year_id,standard_key,assessed_on),
    check ((mark is not distinct from 'extends') = (extension_note is not null))
);
create table public.ct_published (
    id uuid primary key default gen_random_uuid(), year_id uuid not null references public.ms_years on delete cascade,
    period_id uuid not null references public.ct_periods, published_by uuid not null,
    published_at timestamptz not null default now(), snapshot jsonb not null,
    unique(year_id,period_id)
);
-- An issued copy is retained independently of the operational record.
create table public.ct_reports (
    id uuid primary key default gen_random_uuid(), student_id uuid not null, issued_by uuid not null,
    issued_at timestamptz not null default now(), released boolean not null,
    snapshot jsonb not null, pdf bytea not null check (octet_length(pdf) between 8 and 1500000)
);
create index ct_reports_student on public.ct_reports(student_id,issued_at);

do $$
declare relation text;
begin
    foreach relation in array array['catalogs','items','standards','components','reviews','mappings','periods','year_settings','marks',
        'studies','work','work_mappings','supplements','evidence','published','reports'] loop
        execute format('alter table public.ct_%I enable row level security',relation);
        execute format('revoke all on public.ct_%I from public,anon,authenticated',relation);
    end loop;
end;
$$;
revoke all on public.ct_current_mappings from public,anon,authenticated;

-- Only insert new source records. A new source revision uses its own review key.
create function public.ct_import(p_batch jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare catalogs int; items int; standards int; reviews int;
begin
    insert into public.ct_catalogs
        select * from jsonb_populate_recordset(null::public.ct_catalogs,coalesce(p_batch->'catalogs','[]'))
    on conflict do nothing;
    get diagnostics catalogs=row_count;
    insert into public.ct_items
        select * from jsonb_populate_recordset(null::public.ct_items,coalesce(p_batch->'items','[]'))
    on conflict (catalog_key,key) do update set
        unit=excluded.unit, sort_order=excluded.sort_order, title=excluded.title, kind=excluded.kind,
        page_ref=excluded.page_ref, online_ref=excluded.online_ref, source=excluded.source, provisional=false
    where ct_items.provisional and not excluded.provisional
      and not exists (select 1 from public.ct_work w where w.catalog_key=excluded.catalog_key and w.item_key=excluded.key)
      and not exists (select 1 from public.ct_mappings m where m.catalog_key=excluded.catalog_key and m.item_key=excluded.key);
    get diagnostics items=row_count;
    insert into public.ct_standards
        select * from jsonb_populate_recordset(null::public.ct_standards,coalesce(p_batch->'standards','[]'))
    on conflict do nothing;
    get diagnostics standards=row_count;
    insert into public.ct_components(standard_key,key,label)
    select s.key,'full','Full official expectation' from public.ct_standards s
    where not exists(select 1 from public.ct_components c where c.standard_key=s.key)
    on conflict do nothing;
    insert into public.ct_reviews
        select * from jsonb_populate_recordset(null::public.ct_reviews,coalesce(p_batch->'reviews','[]'))
    on conflict do nothing;
    get diagnostics reviews=row_count;
    update public.ct_catalogs c set inventory_complete=true
    where not c.inventory_complete
      and c.key in (select j->>'key' from jsonb_array_elements(coalesce(p_batch->'catalogs','[]')) j
                   where (j->>'inventory_complete')::boolean)
      and exists (select 1 from public.ct_items i where i.catalog_key=c.key and not i.provisional);
    return jsonb_build_object('catalogs',catalogs,'items',items,'standards',standards,'reviews',reviews);
end;
$$;

-- All statuses are scoped to a student enrollment and a reporting cutoff.
create function public.ct_gradebook_scores(p_student uuid,p_period uuid)
returns table(id uuid, title text, course text, result text)
language sql stable set search_path='' as $$
    select a.id,a.title,c.name,trim_scale(m.score)::text || ' / ' || trim_scale(a.points)::text
    from public.gradebook_enrollments e
    join public.gradebook_courses c on c.id=e.course_id
    join public.gradebook_marks m on m.enrollment_id=e.id
    join public.gradebook_assignments a on a.id=m.assignment_id
    join public.ct_periods p on p.id=p_period
    where e.student_id=p_student and m.state='scored' and public.gradebook_can_manage(c.id)
      and (a.due_on between p.starts_on and p.ends_on or (a.due_on is null and lower(c.term)=lower(p.name)));
$$;

create function public.ct_standard_progress(p_year uuid,p_period uuid,p_as_of date) returns setof jsonb
language sql stable set search_path='' as $$
    with bounds as (
        select y.enrolled_grade,y.school_year,coalesce(p_as_of,p.ends_on) as cutoff,p.ends_on from public.ms_years y cross join public.ct_periods p
        where y.id=p_year and p.id=p_period and y.school_year=p.school_year
    ), taught as (
        select distinct m.standard_key,m.component_key from public.ct_work_mappings wm
        join public.ct_work w on w.id=wm.work_id join public.ct_mappings m on m.id=wm.mapping_id
        join public.ct_studies c on c.id=w.study_id
        where c.year_id=p_year and w.completed and w.completed_on <= (select cutoff from bounds)
    ), evidence as (
        select e.standard_key,e.component_key,bool_or(e.independent) as independent
        from public.ct_evidence e
        where e.year_id=p_year and e.observed_on <= (select cutoff from bounds)
        group by e.standard_key,e.component_key
    ), assessed as (
        select distinct on (a.standard_key) a.standard_key,a.mark,a.assessed_on
        from public.ct_marks a where a.year_id=p_year and a.assessed_on <= (select cutoff from bounds)
        order by a.standard_key,a.assessed_on desc
    ), mapped as (
        select distinct m.standard_key,m.component_key from public.ct_current_mappings m
        join public.ct_studies c on c.catalog_key=m.catalog_key
        join public.ct_periods first on first.id=c.starts_in
        left join public.ct_periods last on last.id=c.ends_in
        where c.year_id=p_year and m.effect<>'disabled' and m.school_year=(select school_year from bounds)
          and first.ends_on <= (select ends_on from bounds)
          and (last.id is null or last.ends_on >= (select ends_on from bounds))
    ), components as (
        select c.standard_key,c.key,c.label,
            t.standard_key is not null as taught, coalesce(e.independent,false) as demonstrated,
            e.standard_key is not null as has_evidence,
            m.standard_key is not null as mapped
        from public.ct_components c
        left join taught t on (t.standard_key,t.component_key)=(c.standard_key,c.key)
        left join evidence e on (e.standard_key,e.component_key)=(c.standard_key,c.key)
        left join mapped m on (m.standard_key,m.component_key)=(c.standard_key,c.key)
    )
    select jsonb_build_object('key',s.key,'code',s.code,'grade',s.grade,'subject',s.subject,
        'edition',s.edition,'source',s.source,'description',s.family_description,
        'taught',coalesce(bool_and(c.taught),false),
        'demonstrated',coalesce(bool_and(c.demonstrated),false),
        'mapped',coalesce(bool_and(c.mapped),false),
        'mark',case when a.mark in ('meets','extends') and coalesce(bool_and(c.demonstrated),false) then a.mark
            when a.mark in ('beginning','developing') and coalesce(bool_or(c.has_evidence),false) then a.mark end,
        'assessed_on',a.assessed_on,
        'has_evidence',coalesce(bool_or(c.has_evidence),false),
        'has_mapped_parts',coalesce(bool_or(c.mapped),false),
        'components',coalesce(jsonb_agg(jsonb_build_object('key',c.key,'label',c.label,'taught',c.taught,
            'demonstrated',c.demonstrated,'mapped',c.mapped) order by c.key) filter (where c.key is not null),'[]'))
    from public.ct_standards s cross join bounds b left join components c on c.standard_key=s.key left join assessed a on a.standard_key=s.key
    where (s.grade=b.enrolled_grade or exists(select 1 from taught t where t.standard_key=s.key)
           or exists(select 1 from evidence e where e.standard_key=s.key))
    group by s.key,a.mark,a.assessed_on order by s.grade,s.subject,s.code;
$$;

create function public.ct_publication(p_year uuid,p_period uuid,p_data jsonb) returns jsonb
language sql stable set search_path='' as $$
    select public.ct_policy(y.school_year) || jsonb_build_object('year',y.school_year,'grade',y.enrolled_grade,
        'period',p.name,'period_end',p.ends_on,'as_of',p_data->>'as_of','purpose',p_data->>'purpose',
        'accomplishment',nullif(btrim(p_data->>'accomplishment'),''),'next_step',nullif(btrim(p_data->>'next_step'),''),
        'courses',coalesce((select jsonb_agg(jsonb_build_object('title',c.title,'subject',c.subject,'level',c.level,
            'edition',c.edition,'delivery',s.delivery,'status',case when l.ends_on<=bounds.cutoff then 'Ended' else 'In use' end,
            'completed', (select count(distinct w.item_key) from public.ct_work w
                where w.study_id=s.id and w.completed and w.completed_on<=bounds.cutoff),
            'results',coalesce((select jsonb_agg(jsonb_build_object('title',i.title,'result',w.result,'kind',w.result_kind)
                order by i.sort_order,i.key) from public.ct_work w join public.ct_items i on (i.catalog_key,i.key)=(w.catalog_key,w.item_key)
                where w.study_id=s.id and w.period_id=p.id and w.result is not null and w.result_on<=bounds.cutoff
                  and coalesce(p_data->'result_ids','[]') ? w.id::text),'[]')
            ) order by c.subject,f.starts_on,s.id)
            from public.ct_studies s join public.ct_catalogs c on c.key=s.catalog_key
            join public.ct_periods f on f.id=s.starts_in left join public.ct_periods l on l.id=s.ends_in
            where s.year_id=y.id and f.starts_on<=bounds.cutoff),'[]'),
        'standards',case when coalesce((p_data->>'include_standards')::boolean,false) then coalesce(
            (select jsonb_agg(jsonb_build_object('code',v->'code','subject',v->'subject','grade',v->'grade',
                'edition',v->'edition','description',v->'description','mark',v->'mark','taught',v->'taught') order by v->>'code')
             from public.ct_standard_progress(y.id,p.id,bounds.cutoff) v
             where v->>'mark' is not null or (v->>'taught')::boolean or (v->>'has_evidence')::boolean),'[]') else '[]'::jsonb end)
    from public.ms_years y join public.ct_periods p on p.school_year=y.school_year
    cross join lateral (select coalesce((p_data->>'as_of')::date,p.ends_on) as cutoff) bounds
    where y.id=p_year and p.id=p_period;
$$;

revoke all on function public.ct_import(jsonb),public.ct_gradebook_scores(uuid,uuid),public.ct_standard_progress(uuid,uuid,date),public.ct_policy(text),
    public.ct_publication(uuid,uuid,jsonb) from public,anon,authenticated;

create function public.curriculum_tracker(p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare
    actor uuid:=auth.uid();
    role_name text:=public.current_portal_role();
    student uuid;
    year_row public.ms_years%rowtype;
    period_row public.ct_periods%rowtype;
    study public.ct_studies%rowtype;
    work public.ct_work%rowtype;
    mapping public.ct_current_mappings%rowtype;
    review public.ct_reviews%rowtype;
    report public.ct_reports%rowtype;
    lesson public.ct_items%rowtype;
    standard text:=nullif(p_data->>'standard_key','');
    component text;
    requested_id uuid;
    first_date date;
    last_date date;
    payload jsonb;
    checkpoint jsonb;
    completed boolean;
    previous_work public.ct_work%rowtype;
    result_mark text;
    result_type text;
    gradebook_assignment uuid;
    pdf_bytes bytea;
    activity_date date;
    mark_code text;
    progress jsonb;
    policy_scale jsonb;
    report_kind text;
    report_entries jsonb;
    official_date date:=(clock_timestamp() at time zone 'America/New_York')::date;
begin
    if actor is null or coalesce(role_name,'') not in ('admin','teacher','family') then
        raise exception 'Portal sign-in is required.' using errcode='42501';
    end if;

    if p_action='roster' then
        return public.middle_school('roster');
    end if;
    if p_action in ('import','import-reference','standard-description','components-save','mapping-save','period-save','policy','policy-save','publish-preview','publish','report-preview','issue')
       and role_name<>'admin' then
        raise exception 'Admin access is required.' using errcode='42501';
    end if;
    if p_action='import' then
        return public.ct_import(p_data);
    elsif p_action='import-reference' then
        return jsonb_build_object('standards',coalesce((select jsonb_agg(to_jsonb(s)) from public.ct_standards s),'[]'),
            'reviews',coalesce((select jsonb_agg(to_jsonb(r)) from public.ct_reviews r where r.key like 'zion-pdf-%'),'[]'));
    elsif p_action='catalog' and role_name<>'family' then
        return jsonb_build_object('catalogs',(select jsonb_agg(to_jsonb(c) order by subject,level,edition) from public.ct_catalogs c),
            'periods',coalesce((select jsonb_agg(to_jsonb(p) order by starts_on desc,name) from public.ct_periods p),'[]'));
    elsif p_action in ('policy','policy-save') then
        if coalesce(p_data->>'school_year','') !~ '^[0-9]{4}-[0-9]{4}$' then
            raise exception 'Choose a school year in YYYY-YYYY format.';
        end if;
        if p_action='policy' then
            return public.ct_policy(p_data->>'school_year') || jsonb_build_object('grading_key_override',
                (select grading_key from public.ct_year_settings where school_year=p_data->>'school_year'));
        end if;
        policy_scale:=p_data->'scale';
        if coalesce(jsonb_array_length(policy_scale),0)<>4 or (
            select array_agg(v->>'key' order by v->>'key') from jsonb_array_elements(policy_scale) v
        ) is distinct from array['beginning','developing','extends','meets'] or exists(
            select 1 from jsonb_array_elements(policy_scale) v where
            coalesce(length(btrim(v->>'label')),0) not between 1 and 60 or
            coalesce(length(btrim(v->>'description')),0) not between 1 and 450
        ) or (select count(distinct lower(btrim(v->>'label'))) from jsonb_array_elements(policy_scale) v)<>4 then
            raise exception 'Enter a distinct label and description for each of the four proficiency levels.';
        end if;
        insert into public.ct_year_settings(school_year,scale,grading_key)
        values (p_data->>'school_year',policy_scale,nullif(btrim(p_data->>'grading_key'),''))
        on conflict (school_year) do update set scale=excluded.scale,grading_key=excluded.grading_key;
        return public.ct_policy(p_data->>'school_year');
    elsif p_action='period-save' then
        insert into public.ct_periods(school_year,name,starts_on,ends_on)
        values (p_data->>'school_year',btrim(p_data->>'name'),(p_data->>'starts_on')::date,(p_data->>'ends_on')::date)
        returning id into requested_id;
        return to_jsonb(requested_id);
    elsif p_action='review' and role_name<>'family' then
        return jsonb_build_object(
            'standards',coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object('components',
                (select coalesce(jsonb_agg(to_jsonb(c) order by c.key),'[]') from public.ct_components c where c.standard_key=s.key))
                order by s.grade,s.code) from public.ct_standards s
                where (not p_data ? 'subject' or s.subject=p_data->>'subject')
                  and (not p_data ? 'grade' or s.grade=(p_data->>'grade')::smallint)),'[]'),
            'reviews',coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('item_title',i.title,
                'revisions',(select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]')
                from public.ct_current_mappings m where m.review_key=r.key and m.school_year=p_data->>'school_year')) order by r.key)
                from public.ct_reviews r left join public.ct_items i on (i.catalog_key,i.key)=(r.catalog_key,r.item_key)
                where r.standard_key=standard),'[]'),
            'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.sort_order,i.key)
                from public.ct_items i where i.catalog_key=p_data->>'catalog_key'),'[]'));
    elsif p_action='standard-description' then
        if length(p_data->>'family_description')>300 then raise exception 'Keep the family description under 300 characters.'; end if;
        update public.ct_standards set family_description=nullif(btrim(p_data->>'family_description'),'') where key=standard;
        if not found then raise exception 'Choose an existing standard.'; end if;
        return '{}'::jsonb;
    elsif p_action='components-save' then
        perform 1 from public.ct_standards where key=standard for update;
        if not found then raise exception 'Choose an existing standard.'; end if;
        if exists(select 1 from public.ct_mappings where standard_key=standard)
           or exists(select 1 from public.ct_evidence where standard_key=standard) then
            raise exception 'Components are fixed once a mapping or evidence uses them.';
        end if;
        if coalesce(jsonb_array_length(p_data->'labels'),0) not between 1 and 30
           or exists(select 1 from jsonb_array_elements_text(p_data->'labels') v where length(btrim(v)) not between 1 and 300) then
            raise exception 'Enter between one and 30 component descriptions.';
        end if;
        delete from public.ct_components where standard_key=standard;
        insert into public.ct_components(standard_key,key,label)
        select standard, 'part-' || lpad(n::text,2,'0'), btrim(v)
        from jsonb_array_elements_text(p_data->'labels') with ordinality as x(v,n);
        return '{}'::jsonb;
    elsif p_action='mapping-save' then
        select * into review from public.ct_reviews where key=p_data->>'review_key';
        if not found and p_data->>'review_key' is null then
            insert into public.ct_reviews(key,standard_key,catalog_key,item_key,disposition,source)
            values ('zion:' || gen_random_uuid(),standard,p_data->>'catalog_key',p_data->>'item_key','unreviewed','Zion staff review')
            returning * into review;
        end if;
        if review.key is null then raise exception 'Choose a mapping to review.'; end if;
        if review.disposition='search' then
            raise exception 'Keep the search lead in review. Add a separately reviewed mapping after checking the assignment.';
        end if;
        perform 1 from public.ct_standards where key=review.standard_key for update;
        if coalesce(length(btrim(p_data->>'rationale')),0) not between 1 and 2000 then
            raise exception 'Describe the coverage or the required evidence.';
        end if;
        if review.item_key is not null and p_data->>'item_key' is distinct from review.item_key then
            raise exception 'Choose the curriculum item on the review record.';
        end if;
        if review.disposition='partial' and p_data->>'effect'<>'disabled' and p_data->>'component_key'='full' then
            raise exception 'Define the separate components before approving a partial link.';
        end if;
        if not exists(select 1 from public.ct_periods where school_year=p_data->>'school_year') then
            raise exception 'Choose a school year with a configured reporting period.';
        end if;
        insert into public.ct_mappings(school_year,review_key,catalog_key,item_key,standard_key,component_key,effect,rationale,reviewed_by)
        values (p_data->>'school_year',review.key,review.catalog_key,p_data->>'item_key',review.standard_key,p_data->>'component_key',
            p_data->>'effect',btrim(p_data->>'rationale'),actor);
        return '{}'::jsonb;
    end if;

    student:=nullif(p_data->>'student_id','')::uuid;
    if not public.ms_can_access(student) then
        raise exception 'This student record is unavailable.' using errcode='42501';
    end if;

    if p_action in ('family','report-download') then
        if p_action='report-download' then
            select * into report from public.ct_reports where id=(p_data->>'id')::uuid and student_id=student
                and (role_name='admin' or (role_name='family' and released));
            if not found then raise exception 'This report is unavailable.' using errcode='42501'; end if;
            return jsonb_build_object('id',report.id,'pdf',encode(report.pdf,'base64'),'kind',report.snapshot->>'document_title');
        end if;
        return jsonb_build_object(
            'publications',coalesce((select jsonb_agg(p.snapshot || jsonb_build_object('published_at',p.published_at)
                order by y.school_year desc, p.snapshot->>'period_end' desc)
                from public.ct_published p join public.ms_years y on y.id=p.year_id where y.student_id=student),'[]'),
            'reports',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'issued_at',r.issued_at,
                'released',r.released,'title',r.snapshot->>'document_title') order by r.issued_at desc)
                from public.ct_reports r where r.student_id=student and (r.released or role_name='admin') and role_name<>'teacher'),'[]'));
    end if;
    if role_name='family' then raise exception 'Staff access is required.' using errcode='42501'; end if;

    if p_action='years' then
        return jsonb_build_object(
            'years',coalesce((select jsonb_agg(to_jsonb(y) order by y.school_year desc) from public.ms_years y
                where y.student_id=student),'[]'),
            'terms',coalesce((select jsonb_agg(distinct c.term order by c.term)
                from public.gradebook_courses c join public.gradebook_enrollments e on e.course_id=c.id
                where e.student_id=student and public.gradebook_can_manage(c.id)),'[]'));
    end if;
    select * into year_row from public.ms_years where id=(p_data->>'year_id')::uuid and student_id=student for update;
    if not found then raise exception 'Choose an enrollment year for this student.'; end if;
    select * into period_row from public.ct_periods where id=(p_data->>'period_id')::uuid and school_year=year_row.school_year;
    if not found then raise exception 'Choose a reporting period for this enrollment year.'; end if;

    activity_date:=coalesce(nullif(p_data->>'activity_on','')::date,least(official_date,period_row.ends_on));
    if p_action in ('work-save','evidence-save','mark-save') and
       (activity_date<period_row.starts_on or activity_date>least(official_date,period_row.ends_on)) then
        raise exception 'Choose an activity date in the selected reporting period on or before today.';
    end if;

    if p_action='record' then
        return public.ct_policy(year_row.school_year) || jsonb_build_object(
            'studies',coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object('starts_on',f.starts_on,'ends_on',l.ends_on)
                order by f.starts_on desc,s.id)
                from public.ct_studies s join public.ct_periods f on f.id=s.starts_in
                left join public.ct_periods l on l.id=s.ends_in where s.year_id=year_row.id),'[]'),
            'work',coalesce((select jsonb_agg(to_jsonb(w) || jsonb_build_object('title',i.title))
                from public.ct_work w join public.ct_studies s on s.id=w.study_id
                join public.ct_items i on (i.catalog_key,i.key)=(w.catalog_key,w.item_key)
                join public.ct_periods p on p.id=w.period_id
                where s.year_id=year_row.id and p.ends_on<=period_row.ends_on),'[]'),
            'standards',coalesce((select jsonb_agg(v) from public.ct_standard_progress(year_row.id,period_row.id,null) v),'[]'),
            'evidence',coalesce((select jsonb_agg(to_jsonb(e) order by e.verified_at desc) from public.ct_evidence e
                join public.ct_periods p on p.id=e.period_id where e.year_id=year_row.id and p.ends_on<=period_row.ends_on),'[]'),
            'supplements',coalesce((select jsonb_agg(to_jsonb(x) order by x.title) from public.ct_supplements x
                join public.ct_periods p on p.id=x.period_id where x.year_id=year_row.id and p.ends_on<=period_row.ends_on),'[]'),
            'supplement_templates',coalesce((select jsonb_agg(to_jsonb(r) order by r.key) from public.ct_reviews r
                join public.ct_standards s on s.key=r.standard_key
                where s.grade=year_row.enrolled_grade and r.disposition in ('supplement','checkpoint')),'[]'));
    elsif p_action='study-start' then
        if exists(select 1 from public.ct_studies s join public.ct_periods p on p.id=s.starts_in
            where s.year_id=year_row.id and s.subject=(select subject from public.ct_catalogs where key=p_data->>'catalog_key')
            and (s.ends_in is null and p.starts_on>period_row.starts_on
                or exists(select 1 from public.ct_work w join public.ct_periods later on later.id=w.period_id
                    where w.study_id=s.id and s.ends_in is null and later.ends_on>period_row.ends_on))) then
            raise exception 'The current course has a later start or later work. Choose a later period for the switch.';
        end if;
        select s.* into study from public.ct_studies s join public.ct_catalogs c on c.subject=s.subject
        where s.year_id=year_row.id and s.ends_in is null and c.key=p_data->>'catalog_key';
        if found and study.catalog_key=p_data->>'catalog_key' and study.delivery=p_data->>'delivery' then
            return to_jsonb(study.id);
        end if;
        update public.ct_studies set ends_in=period_row.id where id=study.id;
        insert into public.ct_studies(year_id,subject,catalog_key,delivery,starts_in)
        values (year_row.id,(select subject from public.ct_catalogs where key=p_data->>'catalog_key'),
            p_data->>'catalog_key',p_data->>'delivery',period_row.id) returning id into requested_id;
        return to_jsonb(requested_id);
    elsif p_action in ('checklist','work-save') then
        select s.* into study
        from public.ct_studies s
        where s.id=(p_data->>'study_id')::uuid and s.year_id=year_row.id;
        if not found then raise exception 'Choose an active course for this student.'; end if;
        select f.starts_on,l.ends_on into first_date,last_date from public.ct_periods f
        left join public.ct_periods l on l.id=study.ends_in where f.id=study.starts_in;
        if first_date>period_row.starts_on or last_date<period_row.ends_on then
            raise exception 'This course was outside the selected reporting period.';
        end if;
        if p_action='checklist' then
            return jsonb_build_object(
                'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.sort_order,i.key)
                    from public.ct_items i where i.catalog_key=study.catalog_key),'[]'),
                'checkpoints',coalesce((select jsonb_agg(to_jsonb(m) || jsonb_build_object('code',s.code,'label',c.label)
                    order by m.item_key,m.id)
                    from public.ct_current_mappings m join public.ct_standards s on s.key=m.standard_key
                    join public.ct_components c on (c.standard_key,c.key)=(m.standard_key,m.component_key)
                    where m.catalog_key=study.catalog_key and m.school_year=year_row.school_year and m.effect='checkpoint'),'[]'),
                'gradebook_scores',coalesce((select jsonb_agg(to_jsonb(g) order by g.course,g.title,g.id)
                    from public.ct_gradebook_scores(student,period_row.id) g),'[]'));
        end if;
        select * into lesson from public.ct_items where catalog_key=study.catalog_key and key=p_data->>'item_key';
        if not found then raise exception 'Choose an item from this course edition.'; end if;
        select * into previous_work from public.ct_work w
        where w.study_id=study.id and w.item_key=lesson.key and w.period_id=period_row.id;
        completed:=coalesce((p_data->>'completed')::boolean,previous_work.completed,false);
        if p_data ? 'result' then
            result_mark:=nullif(btrim(p_data->>'result'),'');
            result_type:=case when result_mark is not null then 'grade' end;
        else
            result_mark:=previous_work.result;
            result_type:=previous_work.result_kind;
        end if;
        gradebook_assignment:=nullif(p_data->>'gradebook_assignment_id','')::uuid;
        if gradebook_assignment is not null then
            select g.result into result_mark from public.ct_gradebook_scores(student,period_row.id) g
            where g.id=gradebook_assignment;
            if not found then raise exception 'Choose an available Gradebook score for this student and period.'; end if;
            result_type:='grade';
        elsif result_mark=previous_work.result and result_type=previous_work.result_kind then
            gradebook_assignment:=previous_work.gradebook_assignment_id;
        end if;
        insert into public.ct_work(study_id,catalog_key,item_key,period_id,completed,result,result_kind,gradebook_assignment_id,completed_on,result_on,updated_by)
        values (study.id,study.catalog_key,lesson.key,period_row.id,completed,result_mark,result_type,gradebook_assignment,
            case when completed then coalesce(previous_work.completed_on,activity_date) end,
            case when result_mark is not null then
                case when result_mark=previous_work.result and gradebook_assignment is not distinct from previous_work.gradebook_assignment_id
                    then coalesce(previous_work.result_on,activity_date) else activity_date end
            end,actor)
        on conflict (study_id,item_key,period_id) do update set completed=excluded.completed,result=excluded.result,
            result_kind=excluded.result_kind,gradebook_assignment_id=excluded.gradebook_assignment_id,completed_on=excluded.completed_on,result_on=excluded.result_on,
            updated_by=actor,updated_at=clock_timestamp()
        returning * into work;
        if completed and not coalesce(previous_work.completed,false) then
            insert into public.ct_work_mappings(work_id,mapping_id)
            select work.id,m.id from public.ct_current_mappings m
            where (m.catalog_key,m.item_key)=(study.catalog_key,lesson.key) and m.school_year=year_row.school_year and m.effect='taught';
        elsif not completed then
            delete from public.ct_work_mappings where work_id=work.id;
            delete from public.ct_evidence where work_id=work.id;
        end if;
        for checkpoint in select value from jsonb_array_elements(coalesce(p_data->'checkpoints','[]')) loop
            select * into mapping from public.ct_current_mappings
            where id=(checkpoint->>'mapping_id')::bigint and effect='checkpoint' and school_year=year_row.school_year
                and (catalog_key,item_key)=(study.catalog_key,lesson.key);
            if not found or not completed then
                raise exception 'Finish the lesson and select a currently approved checkpoint.';
            end if;
            insert into public.ct_evidence(year_id,period_id,standard_key,component_key,kind,description,work_id,mapping_id,observed_on,independent,verified_by)
            values (year_row.id,period_row.id,mapping.standard_key,mapping.component_key,'checkpoint',
                btrim(checkpoint->>'description'),work.id,mapping.id,activity_date,coalesce((checkpoint->>'independent')::boolean,false),actor)
            on conflict(work_id,mapping_id) do update set description=excluded.description,independent=excluded.independent,observed_on=excluded.observed_on,verified_by=actor,verified_at=now();
        end loop;
        return to_jsonb(work.id);
    elsif p_action='supplement-save' then
        select * into review from public.ct_reviews where key=p_data->>'source_review' and standard_key=standard
            and disposition in ('supplement','checkpoint');
        if p_data ? 'source_review' and not found then raise exception 'Choose a valid planning reference.'; end if;
        insert into public.ct_supplements(year_id,period_id,standard_key,title,instructions,source_review,assigned_by)
        values (year_row.id,period_row.id,standard,btrim(p_data->>'title'),nullif(btrim(p_data->>'instructions'),''),review.key,actor)
        returning id into requested_id;
        return to_jsonb(requested_id);
    elsif p_action='supplement-complete' then
        update public.ct_supplements set completed=(p_data->>'completed')::boolean
        where id=(p_data->>'id')::uuid and year_id=year_row.id and period_id=period_row.id;
        if not found then raise exception 'Choose a supplement in this reporting period.'; end if;
        if not (p_data->>'completed')::boolean then
            delete from public.ct_evidence where supplement_id=(p_data->>'id')::uuid;
        end if;
        return '{}'::jsonb;
    elsif p_action='evidence-save' then
        perform 1 from public.ct_standards where key=standard for update;
        requested_id:=(p_data->>'supplement_id')::uuid;
        if p_data->>'kind' not in ('observation','work_sample','supplement') then raise exception 'Choose an evidence type.'; end if;
        if requested_id is not null and not exists(select 1 from public.ct_supplements x
            where x.id=requested_id and x.year_id=year_row.id and x.period_id=period_row.id
                and x.standard_key=standard and x.completed) then
            raise exception 'First complete the supplemental activity for this reporting period.';
        end if;
        insert into public.ct_evidence(year_id,period_id,standard_key,component_key,kind,description,source_url,supplement_id,observed_on,independent,verified_by)
        values (year_row.id,period_row.id,standard,p_data->>'component_key',p_data->>'kind',
            btrim(p_data->>'description'),nullif(btrim(p_data->>'source_url'),''),requested_id,activity_date,coalesce((p_data->>'independent')::boolean,false),actor);
        return '{}'::jsonb;
    elsif p_action='mark-save' then
        mark_code:=nullif(p_data->>'mark','');
        select v into progress from public.ct_standard_progress(year_row.id,period_row.id,activity_date) v
        where v->>'key'=standard;
        if mark_code is not null and not coalesce((progress->>'has_evidence')::boolean,false) then
            raise exception 'Verify evidence for this standard before assigning a mark.';
        end if;
        if mark_code in ('meets','extends') and not coalesce((progress->>'demonstrated')::boolean,false) then
            raise exception 'Verify independent demonstration of every component before recording Meets or Extends.';
        end if;
        if mark_code='extends' and coalesce(length(btrim(p_data->>'extension_note')),0) not between 1 and 2000 then
            raise exception 'Describe the more complex or unfamiliar application the student demonstrated independently.';
        end if;
        insert into public.ct_marks(year_id,period_id,standard_key,assessed_on,mark,extension_note,assessed_by)
        values (year_row.id,period_row.id,standard,activity_date,mark_code,
            case when mark_code='extends' then btrim(p_data->>'extension_note') end,actor)
        on conflict (year_id,standard_key,assessed_on) do update set
            period_id=excluded.period_id,mark=excluded.mark,extension_note=excluded.extension_note,assessed_by=actor;
        return '{}'::jsonb;
    elsif p_action='evidence-remove' then
        delete from public.ct_evidence where id=(p_data->>'id')::uuid and year_id=year_row.id and period_id=period_row.id;
        if not found then raise exception 'Choose evidence from this reporting period.'; end if;
        return '{}'::jsonb;
    elsif p_action in ('publish-preview','publish') then
        if greatest(length(p_data->>'accomplishment'),length(p_data->>'next_step'))>2000 then
            raise exception 'Keep each family note under 2,000 characters.';
        end if;
        if official_date<period_row.ends_on then
            raise exception 'The reporting period is still open. Use an interim report for a midyear update.';
        end if;
        payload:=public.ct_publication(year_row.id,period_row.id,p_data-'as_of'-'purpose');
        if p_action='publish-preview' then return payload; end if;
        if payload is distinct from p_data->'preview' then raise exception 'Records changed. Preview the family record again.'; end if;
        insert into public.ct_published(year_id,period_id,published_by,snapshot)
        values (year_row.id,period_row.id,actor,payload)
        on conflict(year_id,period_id) do update set snapshot=excluded.snapshot,published_by=actor,published_at=clock_timestamp();
        return payload;
    elsif p_action in ('report-preview','issue') then
        if coalesce(length(btrim(p_data->>'signer')),0) not between 1 and 180 then
            raise exception 'Enter the office signer name.';
        end if;
        report_kind:=coalesce(p_data->>'kind','progress');
        if report_kind not in ('progress','transfer','interim_council','interim_transfer') then
            raise exception 'Choose a report type.';
        end if;
        if report_kind in ('interim_council','interim_transfer') then
            activity_date:=nullif(p_data->>'as_of','')::date;
            if activity_date is null or activity_date not between period_row.starts_on and least(period_row.ends_on,official_date) then
                raise exception 'Choose an as-of date in the selected reporting period on or before today.';
            end if;
            if greatest(length(p_data->>'accomplishment'),length(p_data->>'next_step'))>2000 then
                raise exception 'Keep each family note under 2,000 characters.';
            end if;
        end if;
        select coalesce(jsonb_agg(x.snapshot || case when coalesce((p_data->>'include_standards')::boolean,false)
            then '{}'::jsonb else jsonb_build_object('standards','[]'::jsonb) end order by sp.ends_on,sp.name),'[]')
        into report_entries
        from public.ct_published x join public.ct_periods sp on sp.id=x.period_id
        join public.ms_years enrollment on enrollment.id=x.year_id
        where enrollment.student_id=student and (
            report_kind='progress' and x.year_id=year_row.id and x.period_id=period_row.id
            or report_kind='transfer' and sp.ends_on<=period_row.ends_on
            or report_kind='interim_transfer' and sp.ends_on<activity_date and x.period_id<>period_row.id);
        if report_kind in ('interim_council','interim_transfer') then
            report_entries:=report_entries || jsonb_build_array(public.ct_publication(year_row.id,period_row.id,
                p_data || jsonb_build_object('purpose',case when report_kind='interim_council'
                    then 'Parent Partnership Council' else 'Midyear transfer' end)));
        end if;
        payload:=(select jsonb_build_object('document_title',case report_kind
                when 'transfer' then 'Elementary Transfer Record'
                when 'interim_transfer' then 'Interim Elementary Transfer Record'
                when 'interim_council' then 'Interim Elementary Progress Record' else 'Elementary Progress Record' end,
            'curriculum_record',true,'issuer',cfg.school_name,'contact',cfg.school_contact,
            'legal_name',coalesce(nullif(year_row.legal_name,''),concat_ws(' ',s.first_name,s.last_name)),
            'issued_on',official_date,'signer',btrim(p_data->>'signer'),'signer_title','School office','publications',report_entries)
            from public.students s cross join public.ms_settings cfg where s.id=student);
        if jsonb_array_length(payload->'publications')=0 then raise exception 'Publish a family record before issuing a report.'; end if;
        if p_action='report-preview' then return payload; end if;
        if payload is distinct from p_data->'preview' then raise exception 'The report changed. Preview it again before issuing.'; end if;
        pdf_bytes:=decode(p_data->>'pdf','base64');
        if substring(pdf_bytes for 5) is distinct from convert_to('%PDF-','UTF8') then raise exception 'A generated PDF is required.'; end if;
        insert into public.ct_reports(student_id,issued_by,released,snapshot,pdf)
        values (student,actor,coalesce((p_data->>'release')::boolean,false),payload,pdf_bytes)
        returning id into requested_id;
        return to_jsonb(requested_id);
    end if;
    raise exception 'Unknown curriculum tracker action.';
end;
$$;
revoke all on function public.curriculum_tracker(text,jsonb) from public,anon,authenticated;
grant execute on function public.curriculum_tracker(text,jsonb) to authenticated;

commit;

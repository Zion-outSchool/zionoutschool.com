begin;

alter table public.gradebook_courses
    add column if not exists starts_on date,
    add column if not exists ends_on date;

alter table public.gradebook_courses drop constraint if exists gradebook_course_date_range;
alter table public.gradebook_courses add constraint gradebook_course_date_range check (
    (starts_on is null and ends_on is null)
    or (starts_on is not null and ends_on is not null
        and starts_on >= date '0001-01-01' and ends_on <= date '9999-12-31'
        and starts_on <= ends_on)
);

grant update (starts_on, ends_on) on public.gradebook_courses to authenticated;

create or replace function public.gradebook_check_finalization_date()
returns trigger language plpgsql set search_path = ''
as $$
declare
    end_date date;
begin
    select c.ends_on into end_date
    from public.gradebook_courses c where c.id = new.course_id
    for update;

    if end_date is null then
        raise exception 'Set the class start and end dates in Course settings before finalizing grades.'
            using errcode = '22023';
    end if;
    if end_date >= (clock_timestamp() at time zone 'America/New_York')::date then
        raise exception 'Grades can be finalized starting the day after % (Eastern time).', to_char(end_date, 'Mon FMDD, YYYY')
            using errcode = '22023';
    end if;
    return new;
end;
$$;

drop trigger if exists gradebook_check_finalization_date on public.gradebook_final_courses;
create trigger gradebook_check_finalization_date before insert on public.gradebook_final_courses
for each row execute function public.gradebook_check_finalization_date();

revoke all on function public.gradebook_check_finalization_date() from public, anon, authenticated;

commit;

begin;

create or replace function public.portal_lookup_account(target_email text)
returns table (display_name text, role text, active boolean, confirmed boolean, student_count integer, course_count integer,
    is_current_account boolean, school_admin_email text, school_admin_confirmed boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
    if public.current_portal_role() is distinct from 'admin' then
        raise exception 'Sign in with an active administrator account to look up a portal login.' using errcode = '42501';
    end if;
    return query
    select p.display_name, p.role, p.active, u.email_confirmed_at is not null,
        (select count(*)::integer from public.students s where s.family_id = u.id),
        (select count(*)::integer from public.gradebook_courses c where c.teacher_id = u.id),
        u.id = auth.uid(), alternative.email, alternative.confirmed
    from auth.users u
    left join public.portal_users p on p.id = u.id
    left join lateral (
        select staff.email::text, staff.email_confirmed_at is not null
        from public.portal_users other
        join auth.users staff on staff.id = other.id
        where p.role = 'admin' and other.role = 'admin' and other.active and other.id <> p.id
            and lower(btrim(other.display_name)) = lower(btrim(p.display_name))
            and lower(staff.email) like '%@zionoutschool.com'
        order by staff.email_confirmed_at desc nulls last, other.id
        limit 1
    ) as alternative(email, confirmed) on true
    where lower(u.email) = lower(btrim(target_email));
end;
$$;

create or replace function public.portal_reactivate_account(target_email text, expected_role text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
    if public.current_portal_role() is distinct from 'admin' then
        raise exception 'Sign in as an administrator to reactivate this account.' using errcode = '42501';
    end if;
    update public.portal_users p set active = true
    from auth.users u
    where p.id = u.id and lower(u.email) = lower(btrim(target_email)) and p.role = expected_role;
    if not found then
        raise exception 'The account or its role changed. Check the email again before reactivating it.' using errcode = '22023';
    end if;
end;
$$;

create or replace function public.portal_list_family_logins()
returns table (id uuid, display_name text, email text, active boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
    if public.current_portal_role() is distinct from 'admin' then
        raise exception 'Use an administrator account to review family links.' using errcode = '42501';
    end if;
    return query select p.id, p.display_name, u.email::text, p.active
    from public.portal_users p join auth.users u on u.id = p.id
    where p.role = 'family'
    order by p.display_name, p.id;
end;
$$;

create or replace function public.portal_change_invitation_role(
    target_email text, expected_role text, new_role text, selected_students uuid[]
) returns integer language plpgsql security definer set search_path = ''
as $$
declare
    actor uuid := auth.uid();
    account public.portal_users;
begin
    if public.current_portal_role() is distinct from 'admin' then
        raise exception 'Sign in as an administrator to change an account role.' using errcode = '42501';
    end if;
    if new_role is null or new_role not in ('family', 'teacher') or new_role = expected_role then
        raise exception 'Choose a different role in the invitation form.' using errcode = '22023';
    end if;

    -- Keep roster links and course assignments stable through the role change.
    lock table public.students, public.gradebook_courses, public.portal_users in exclusive mode;
    if public.current_portal_role() is distinct from 'admin' or not exists (
        select 1 from auth.users u where u.id = actor and u.email_confirmed_at is not null
    ) then
        raise exception 'Use a verified, active administrator login to change another account’s role.' using errcode = '42501';
    end if;
    select p.* into account
    from public.portal_users p join auth.users u on u.id = p.id
    where lower(u.email) = lower(btrim(target_email));
    if account.id is null or account.role is distinct from expected_role then
        raise exception 'The account or its role changed. Check the email again before continuing.' using errcode = '22023';
    end if;
    if account.id = actor then
        raise exception 'You cannot change the role you are signed in with. Use another administrator login.' using errcode = '22023';
    end if;
    if not account.active or not exists (
        select 1 from auth.users u where u.id = account.id and u.email_confirmed_at is not null
    ) then
        raise exception 'Reactivate the account and have its owner verify the email before changing its role.' using errcode = '22023';
    end if;
    if exists (select 1 from public.students s where s.family_id = account.id) then
        raise exception 'This account has linked students. Move each student to the correct family login in Student Records first.' using errcode = '22023';
    end if;
    if exists (select 1 from public.gradebook_courses c where c.teacher_id = account.id) then
        raise exception 'This account is assigned to classrooms. Reassign those classrooms in the gradebook first.' using errcode = '22023';
    end if;

    update public.portal_users set role = new_role where id = account.id;
    return public.portal_complete_invitation(actor, account.id, target_email, account.display_name, new_role, selected_students);
end;
$$;

revoke all on function public.portal_lookup_account(text), public.portal_reactivate_account(text, text), public.portal_list_family_logins(),
    public.portal_change_invitation_role(text, text, text, uuid[]) from public, anon;
grant execute on function public.portal_lookup_account(text), public.portal_reactivate_account(text, text), public.portal_list_family_logins(),
    public.portal_change_invitation_role(text, text, text, uuid[]) to authenticated;

commit;

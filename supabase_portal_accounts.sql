begin;

-- Existing family links remain valid. A student can be rostered before a parent is invited.
alter table public.students alter column family_id drop not null;
alter table public.students drop constraint if exists students_family_id_fkey;
alter table public.students add constraint students_family_id_fkey
    foreign key (family_id) references public.portal_users (id) on delete set null;

create or replace function public.portal_validate_family_link()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
    if new.family_id is not null and not exists (
        select from public.portal_users p where p.id = new.family_id and p.role = 'family' and p.active
    ) then
        raise exception 'Select an active family account.' using errcode = '22023';
    end if;
    return new;
end;
$$;

revoke all on function public.portal_validate_family_link() from public;
drop trigger if exists portal_validate_family_link on public.students;
create trigger portal_validate_family_link before insert or update of family_id on public.students
for each row execute function public.portal_validate_family_link();

-- Only the invitation function's server client can call this. The actor is the
-- administrator whose session the Edge Function verified with Supabase Auth.
create or replace function public.portal_prepare_invitation(
    actor_id uuid, invite_email text, invite_role text, student_ids uuid[]
) returns table (account_id uuid, confirmed boolean)
language plpgsql security definer set search_path = ''
as $$
declare
    account uuid;
    email_confirmed boolean;
    existing_profile public.portal_users;
    student_count bigint;
begin
    if not exists (
        select from public.portal_users p where p.id = actor_id and p.active and p.role = 'admin'
    ) then
        raise exception 'Administrator access is required.' using errcode = '42501';
    end if;
    if invite_role is null or invite_role not in ('family', 'teacher') then
        raise exception 'Choose a family or teacher account.' using errcode = '22023';
    end if;
    if student_ids is null or cardinality(student_ids) > 50
        or (invite_role = 'teacher' and cardinality(student_ids) <> 0)
        or (invite_role = 'family' and cardinality(student_ids) = 0) then
        raise exception 'Select at least one student for a family invitation.' using errcode = '22023';
    end if;

    select u.id, u.email_confirmed_at is not null into account, email_confirmed
    from auth.users u where lower(u.email) = lower(btrim(invite_email));
    if account is not null then
        select p.* into existing_profile from public.portal_users p where p.id = account;
        if found and (existing_profile.role <> invite_role or not existing_profile.active) then
            raise exception 'This email belongs to an account with a different role or inactive status.' using errcode = '22023';
        end if;
    end if;
    select count(*) into student_count from public.students s where s.id = any(student_ids);
    if student_count <> cardinality(student_ids) then
        raise exception 'One or more selected student records are missing.' using errcode = '22023';
    end if;
    if exists (
        select from public.students s
        where s.id = any(student_ids) and s.family_id is not null and s.family_id is distinct from account
    ) then
        raise exception 'A selected student already belongs to a different family login.' using errcode = '22023';
    end if;
    return query select account, coalesce(email_confirmed, false);
end;
$$;

create or replace function public.portal_complete_invitation(
    actor_id uuid, target_account uuid, invite_email text, account_name text,
    invite_role text, student_ids uuid[]
) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
    verified_account uuid;
    linked_count integer;
begin
    -- Lock students in a consistent order so competing invitations cannot reassign them.
    perform from public.students s where s.id = any(student_ids) order by s.id for update;
    select p.account_id into verified_account
    from public.portal_prepare_invitation(actor_id, invite_email, invite_role, student_ids) p;
    if verified_account is null or verified_account is distinct from target_account then
        raise exception 'The invited account could not be verified.' using errcode = '22023';
    end if;
    if account_name is null or length(btrim(account_name)) not between 1 and 120 then
        raise exception 'Enter a display name.' using errcode = '22023';
    end if;

    insert into public.portal_users (id, display_name, role)
    values (target_account, btrim(account_name), invite_role)
    on conflict (id) do nothing;

    -- Also recheck and lock the profile after a concurrent insert.
    perform from public.portal_users p
    where p.id = target_account and p.role = invite_role and p.active for update;
    if not found then
        raise exception 'This email belongs to an account with a different role or inactive status.' using errcode = '22023';
    end if;

    update public.students s set family_id = target_account
    where s.id = any(student_ids) and s.family_id is null;
    get diagnostics linked_count = row_count;
    return linked_count;
end;
$$;

revoke all on function public.portal_prepare_invitation(uuid, text, text, uuid[]),
    public.portal_complete_invitation(uuid, uuid, text, text, text, uuid[])
from public, anon, authenticated;
grant execute on function public.portal_prepare_invitation(uuid, text, text, uuid[]),
    public.portal_complete_invitation(uuid, uuid, text, text, text, uuid[])
to service_role;

commit;

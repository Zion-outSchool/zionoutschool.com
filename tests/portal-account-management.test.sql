-- Run on a disposable database after the portal account and registration scripts.
begin;

insert into auth.users (id,email,email_confirmed_at) values
    ('74000000-0000-0000-0000-000000000001','repair-actor@example.com',now()),
    ('74000000-0000-0000-0000-000000000002','repair-admin@example.com',now()),
    ('74000000-0000-0000-0000-000000000003','repair-alt@zionoutschool.com',null),
    ('74000000-0000-0000-0000-000000000004','repair-teacher@example.com',now()),
    ('74000000-0000-0000-0000-000000000005','repair-family@example.com',now());
insert into public.portal_users (id,display_name,role,active) values
    ('74000000-0000-0000-0000-000000000001','Acting Admin','admin',true),
    ('74000000-0000-0000-0000-000000000002','Example Administrator','admin',true),
    ('74000000-0000-0000-0000-000000000003','Example Administrator','admin',true),
    ('74000000-0000-0000-0000-000000000004','Example Teacher','teacher',true),
    ('74000000-0000-0000-0000-000000000005','Example Family','family',false);
insert into public.students (id,first_name,last_name) values
    ('74100000-0000-0000-0000-000000000001','Test','One'),
    ('74100000-0000-0000-0000-000000000002','Test','Two');
insert into public.registration_records (id,student_id,drive_folder_id,classroom_record,administrator_record)
values ('74200000-0000-0000-0000-000000000001','74100000-0000-0000-0000-000000000001',
    'fictional-repair-folder','{"firstName":"Test","lastName":"One"}','{}');

set local role authenticated;
select set_config('request.jwt.claim.sub','74000000-0000-0000-0000-000000000004',true);
do $$
begin
    begin
        perform public.portal_lookup_account('repair-admin@example.com');
        raise exception 'A teacher could inspect another account';
    exception when insufficient_privilege then null; end;
    begin
        perform public.move_registration_record('74200000-0000-0000-0000-000000000001',
            '74100000-0000-0000-0000-000000000001','74100000-0000-0000-0000-000000000002');
        raise exception 'A teacher could move a registration';
    exception when insufficient_privilege then null; end;
end;
$$;

set local role service_role;
do $$
begin
    begin
        perform public.portal_prepare_invitation('74000000-0000-0000-0000-000000000001',
            'repair-admin@example.com','family',array['74100000-0000-0000-0000-000000000001'::uuid]);
        raise exception 'Invitation changed an existing role';
    exception when sqlstate 'PA001' then null; end;
    begin
        perform public.portal_prepare_invitation('74000000-0000-0000-0000-000000000001',
            'repair-family@example.com','family',array['74100000-0000-0000-0000-000000000001'::uuid]);
        raise exception 'Invitation accepted an inactive login';
    exception when sqlstate 'PA002' then null; end;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','74000000-0000-0000-0000-000000000001',true);
do $$
begin
    if not exists(select 1 from public.portal_lookup_account(' REPAIR-ADMIN@example.com ')
        where role='admin' and active and school_admin_email='repair-alt@zionoutschool.com'
            and school_admin_confirmed=false) then
        raise exception 'Missing current role or replacement login details';
    end if;
    perform public.portal_reactivate_account('repair-family@example.com','family');
    if not exists(select 1 from public.portal_list_family_logins() where active and email='repair-family@example.com') then
        raise exception 'Reactivate did not restore family access';
    end if;
    begin
        perform public.portal_change_invitation_role('repair-actor@example.com','admin','teacher',array[]::uuid[]);
        raise exception 'An administrator could change their own role';
    exception when invalid_parameter_value then null; end;
    if public.portal_change_invitation_role('repair-admin@example.com','admin','family',
        array['74100000-0000-0000-0000-000000000001'::uuid]) <> 1 then
        raise exception 'Role change did not link the selected student';
    end if;
    if not exists(select 1 from public.students where id='74100000-0000-0000-0000-000000000001'
        and family_id='74000000-0000-0000-0000-000000000002') then
        raise exception 'Family was linked to an incorrect account';
    end if;
    begin
        perform public.portal_change_invitation_role('repair-admin@example.com','family','teacher',array[]::uuid[]);
        raise exception 'A family with linked students was converted';
    exception when invalid_parameter_value then null; end;
    perform public.move_registration_record('74200000-0000-0000-0000-000000000001',
        '74100000-0000-0000-0000-000000000001','74100000-0000-0000-0000-000000000002');
    if not exists(select 1 from public.read_registration_record('74200000-0000-0000-0000-000000000001')
        where student_id='74100000-0000-0000-0000-000000000002' and drive_folder_id='fictional-repair-folder') then
        raise exception 'The registration and its documents were not moved together';
    end if;
end;
$$;

rollback;

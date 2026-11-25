begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('75000000-0000-0000-0000-000000000001','review-admin@example.com',now()),
 ('75000000-0000-0000-0000-000000000002','review-teacher@example.com',now()),
 ('75000000-0000-0000-0000-000000000003','other-teacher@example.com',now());
insert into public.portal_users(id,display_name,role) values
 ('75000000-0000-0000-0000-000000000001','Review Admin','admin'),
 ('75000000-0000-0000-0000-000000000002','Assigned Teacher','teacher'),
 ('75000000-0000-0000-0000-000000000003','Other Teacher','teacher');
insert into public.students(id,first_name,last_name,grade_level) values
 ('75100000-0000-0000-0000-000000000001','First','Fixture','5'),
 ('75100000-0000-0000-0000-000000000002','Second','Fixture','5'),
 ('75100000-0000-0000-0000-000000000003','Third','Fixture','5');
insert into public.gradebook_courses(id,teacher_id,name,term,weighting,missing_is_zero,categories,scale)
values ('75200000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000002','Class','Fall','points',false,'{"General":0}','{"A":90,"F":0}');
insert into public.gradebook_enrollments(course_id,student_id,grade_level,credits)
select '75200000-0000-0000-0000-000000000001',id,'5',0 from public.students where id::text like '75100000-%';
insert into public.registration_records(id,student_id,drive_folder_id,classroom_record,administrator_record)
values ('75300000-0000-0000-0000-000000000001','75100000-0000-0000-0000-000000000001','original-review-fixture',
 '{"firstName":"First","lastName":"Fixture","preferredName":"Before","guardians":[{"name":"Guardian","phone":"555-1000","relationship":"Parent"}]}','{"iepStatus":"Reserved"}');
set local role authenticated;
select set_config('request.jwt.claim.sub','75000000-0000-0000-0000-000000000002',true);
select public.registration_submit_change('75400000-0000-0000-0000-000000000001','75100000-0000-0000-0000-000000000001',
 '75300000-0000-0000-0000-000000000001',0,'{"preferredName":"Proposed","guardian1Phone":"555-2000"}','Verified correction');
select public.registration_submit_change('75400000-0000-0000-0000-000000000001','75100000-0000-0000-0000-000000000001',
 '75300000-0000-0000-0000-000000000001',0,'{"preferredName":"Proposed","guardian1Phone":"555-2000"}','Verified correction');
select public.registration_submit_change('75400000-0000-0000-0000-000000000002','75100000-0000-0000-0000-000000000002',
 null,null,'{}','Registration is missing');
do $$
declare
 field_details text;
begin
 if not exists(select 1 from public.read_registration_record('75300000-0000-0000-0000-000000000001')
    where classroom_record->>'preferredName'='Before' and administrator_record is null and drive_folder_id is null) then
    raise exception 'A pending request changed approved data or exposed the original';
 end if;
 begin
   perform public.registration_decide_change('75400000-0000-0000-0000-000000000001','approved','',0,false);
   raise exception 'Teacher could approve';
 exception when insufficient_privilege then null; end;
 begin
   perform public.registration_submit_change(gen_random_uuid(),'75100000-0000-0000-0000-000000000001',
    '75300000-0000-0000-0000-000000000001',0,'{"pickupRestriction":"Changed"}','Reserved');
   raise exception 'Teacher edited an office field';
 exception when invalid_parameter_value then
   get stacked diagnostics field_details = pg_exception_detail;
   if field_details::jsonb->>'field' is distinct from 'pickupRestriction' then
     raise exception 'The rejected office field was not identified';
   end if;
 end;
end $$;
select set_config('request.jwt.claim.sub','75000000-0000-0000-0000-000000000003',true);
do $$
begin
 if exists(select 1 from public.registration_review_list()) then raise exception 'Unassigned teacher saw requests'; end if;
 begin
  perform public.registration_edit_context('75100000-0000-0000-0000-000000000001','75300000-0000-0000-0000-000000000001');
  raise exception 'Unassigned teacher saw registration fields';
 exception when insufficient_privilege then null; end;
end $$;
set local role service_role;
do $$
begin
 if (select count(*) from public.registration_claim_notifications() where recipient='review-admin@example.com') <> 2 then
    raise exception 'Expected one email per request and active administrator';
 end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','75000000-0000-0000-0000-000000000001',true);
select public.registration_submit_change('75400000-0000-0000-0000-000000000003','75100000-0000-0000-0000-000000000001',
 '75300000-0000-0000-0000-000000000001',0,
 '{"preferredName":"Current","dateOfBirth":"2014-02-28","guardian2Address":"Second guardian address",
 "ec2Medical":"Yes","pickup3Name":"Third pickup","medicationDetails":"Updated medication instructions",
 "siblingNames":"Sibling on file","classWallet":"Not yet — still setting up"}','Admin correction');
select public.registration_submit_change('75400000-0000-0000-0000-000000000004','75100000-0000-0000-0000-000000000003',
 null,null,'{"dateOfBirth":"2014-02-28","guardian1Address":"Sample address","guardian2Email":"guardian@example.com"}','Create registration');
do $$
declare
 field_details text;
begin
 begin
   perform public.registration_decide_change('75400000-0000-0000-0000-000000000001','approved','',0,false);
   raise exception 'A stale request was approved';
 exception when invalid_parameter_value then null; end;
 perform public.registration_decide_change('75400000-0000-0000-0000-000000000001','approved','Reviewed both versions',1,true);
 perform public.registration_decide_change('75400000-0000-0000-0000-000000000002','approved','Verified missing registration',null,false);
 if not exists (select 1 from public.read_registration_record('75300000-0000-0000-0000-000000000001')
    where classroom_record->>'preferredName'='Proposed' and classroom_record->'guardians'->0->>'phone'='555-2000'
    and classroom_record->'guardians'->0->>'relationship'='Parent' and administrator_record->>'iepStatus'='Reserved'
    and administrator_record->>'dateOfBirth'='2014-02-28'
    and administrator_record->'guardianAddresses'->>1='Second guardian address'
    and administrator_record->>'medicationDetails'='Updated medication instructions'
    and administrator_record->>'siblingNames'='Sibling on file'
    and administrator_record->>'classWallet'='Not yet — still setting up'
    and classroom_record->'emergencyContacts'->1->>'medicalPermission'='Yes'
    and classroom_record->'authorizedPickup'->2->>'name'='Third pickup'
    and drive_folder_id='original-review-fixture') then raise exception 'Approved registration was not merged safely'; end if;
 if not exists (select 1 from public.registration_edit_context(
    '75100000-0000-0000-0000-000000000001','75300000-0000-0000-0000-000000000001') as edit_context
    where edit_context->'values'->>'guardian2Address'='Second guardian address'
      and edit_context->'values'->>'pickup3Name'='Third pickup') then
    raise exception 'Approved registration values did not round trip to the editor';
 end if;
 begin
   perform public.registration_submit_change(gen_random_uuid(),'75100000-0000-0000-0000-000000000001',
    '75300000-0000-0000-0000-000000000001',2,'{"dateOfBirth":"2014-02-30"}','Invalid date');
   raise exception 'An impossible birth date was accepted';
 exception when invalid_parameter_value then
   get stacked diagnostics field_details = pg_exception_detail;
   if field_details::jsonb->>'field' is distinct from 'dateOfBirth' then
     raise exception 'The invalid date field was not identified';
   end if;
 end;
 begin
   perform public.registration_submit_change(gen_random_uuid(),'75100000-0000-0000-0000-000000000001',
    '75300000-0000-0000-0000-000000000001',2,jsonb_build_object('guardian2Address', repeat('x',501)),'Invalid address');
   raise exception 'An address longer than the allowed limit was accepted';
 exception when invalid_parameter_value then
   get stacked diagnostics field_details = pg_exception_detail;
   if field_details::jsonb->>'field' is distinct from 'guardian2Address'
       or field_details::jsonb->>'message' is distinct from 'Use 500 characters or fewer.' then
     raise exception 'The field name and character limit were not reported';
   end if;
 end;
end $$;
select set_config('request.jwt.claim.sub','75000000-0000-0000-0000-000000000002',true);
do $$
begin
 if exists (select 1 from public.read_registration_record('75300000-0000-0000-0000-000000000001')
    where administrator_record is not null or drive_folder_id is not null)
    or (public.registration_edit_context('75100000-0000-0000-0000-000000000001',
       '75300000-0000-0000-0000-000000000001')->'values') ? 'medicationDetails' then
    raise exception 'Teacher saw restricted registration fields or a Drive link';
 end if;
end $$;
reset role;
do $$
begin
 if not exists (select 1 from public.registration_records where id='75300000-0000-0000-0000-000000000001'
    and classroom_record->>'preferredName'='Before' and administrator_record='{"iepStatus":"Reserved"}' and approved_revision=2) then raise exception 'Original registration was modified'; end if;
 if not exists (select 1 from public.registration_records where student_id='75100000-0000-0000-0000-000000000002'
    and drive_folder_id is null) then raise exception 'Approved missing registration was not created'; end if;
 if not exists (select 1 from public.registration_records where student_id='75100000-0000-0000-0000-000000000003'
    and approved_administrator_record->>'dateOfBirth'='2014-02-28'
    and approved_administrator_record->'guardianAddresses'->>0='Sample address'
    and approved_classroom_record->'guardians'->1->>'email'='guardian@example.com') then
    raise exception 'An administrator could not save the full new registration';
 end if;
end $$;
rollback;

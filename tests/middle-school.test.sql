-- Run after supabase_k8_math_standards.sql and supabase_middle_school.sql on a disposable portal database.
begin;

insert into auth.users(id,email) values
 ('90100000-0000-0000-0000-000000000001','office@example.test'),
 ('90100000-0000-0000-0000-000000000002','teacher@example.test'),
 ('90100000-0000-0000-0000-000000000003','linked-family@example.test'),
 ('90100000-0000-0000-0000-000000000004','unrelated-family@example.test');
insert into public.portal_users(id,display_name,role) values
 ('90100000-0000-0000-0000-000000000001','Fictional office','admin'),
 ('90100000-0000-0000-0000-000000000002','Fictional teacher','teacher'),
 ('90100000-0000-0000-0000-000000000003','Fictional family','family'),
 ('90100000-0000-0000-0000-000000000004','Other fictional family','family');
insert into public.students(id,family_id,first_name,last_name,grade_level) values
 ('90200000-0000-0000-0000-000000000001','90100000-0000-0000-0000-000000000003','Jamie','Example','8'),
 ('90200000-0000-0000-0000-000000000002','90100000-0000-0000-0000-000000000003','Avery','Example','6'),
 ('90200000-0000-0000-0000-000000000003','90100000-0000-0000-0000-000000000004','Riley','Sample','7');
insert into public.gradebook_courses(id,teacher_id,name,term,weighting,missing_is_zero,categories,scale)
values ('90300000-0000-0000-0000-000000000001','90100000-0000-0000-0000-000000000002',
 'Fictional mixed-age class','Fall','points',false,'{"General":0}','{"A":90,"F":0}');
insert into public.gradebook_enrollments(course_id,student_id,grade_level,credits)
values ('90300000-0000-0000-0000-000000000001','90200000-0000-0000-0000-000000000001','8',0);

set local role authenticated;
do $$
declare
    staff text := '90100000-0000-0000-0000-000000000001';
    teacher text := '90100000-0000-0000-0000-000000000002';
    family text := '90100000-0000-0000-0000-000000000003';
    stranger text := '90100000-0000-0000-0000-000000000004';
    student uuid := '90200000-0000-0000-0000-000000000001';
    sibling uuid := '90200000-0000-0000-0000-000000000002';
    year_id uuid;
    algebra uuid;
    science uuid;
    algebra_result uuid;
    science_result uuid;
    request_id uuid;
    receipt uuid;
    data jsonb;
    payload jsonb;
    preview jsonb;
    file text := encode(convert_to(E'%PDF-1.7\n% Fictional fixture bytes\n%%EOF','UTF8'),'base64');
begin
    if has_table_privilege('authenticated','public.ms_results','select')
        or has_table_privilege('authenticated','public.ms_transcripts','select')
        or has_function_privilege('anon','public.middle_school(text,jsonb)','execute') then
        raise exception 'Direct browser access to private fields or files';
    end if;
    perform set_config('request.jwt.claim.sub',staff,true);
    if jsonb_array_length(public.middle_school('map')) <> 42 then raise exception 'Course map seed incomplete'; end if;
    year_id := (public.middle_school('year-save',jsonb_build_object('student_id',student,'school_year','2026-2027',
        'enrolled_grade',8,'entered_on','2026-08-20','withdrawn_on','2026-11-15','legal_name','Jamie Example'))->>'id')::uuid;
    perform public.middle_school('year-save',jsonb_build_object('student_id',sibling,'school_year','2026-2027','enrolled_grade',6));
    perform public.middle_school('settings-save','{"school_name":"Fictional Zion","school_contact":"office@example.test","grading_key":"A = sample mark","current_school_year":"2026-2027","credit_policy":""}');

    perform set_config('request.jwt.claim.sub',teacher,true);
    if jsonb_array_length(public.middle_school('roster')) <> 1 then raise exception 'Teacher roster was not limited'; end if;
    begin
        perform public.middle_school('record',jsonb_build_object('student_id',sibling));
        raise exception 'Teacher read an unassigned student';
    exception when insufficient_privilege then null; end;
    algebra := (public.middle_school('course-save',jsonb_build_object('year_id',year_id,'area','Math','title','Algebra I',
        'instructional_level','High school','term','Fall','course_status','completed','high_school_level',true))->>'id')::uuid;
    science := (public.middle_school('course-save',jsonb_build_object('year_id',year_id,'area','Science','title','Earth Systems',
        'instructional_level','8','term','Fall','course_status','withdrawn'))->>'id')::uuid;
    algebra_result := (public.middle_school('result-save',jsonb_build_object('course_id',algebra,'period','Fall final',
        'period_end','2026-11-15','result_kind','final','mark','A','next_step','Try Geometry',
        'evidence_url','https://example.test/private-evidence'))->>'id')::uuid;
    science_result := (public.middle_school('result-save',jsonb_build_object('course_id',science,'period','Withdrawal',
        'period_end','2026-11-15','result_kind','interim','as_of','2026-11-15','mark','B'))->>'id')::uuid;
    begin
        perform public.middle_school('verify',jsonb_build_object('id',algebra_result,'version',1));
        raise exception 'Teacher published a result';
    exception when insufficient_privilege then null; end;
    begin
        perform public.middle_school('credit-save',jsonb_build_object('id',algebra,'decision','awarded','units',1));
        raise exception 'Teacher awarded credit';
    exception when insufficient_privilege then null; end;

    perform set_config('request.jwt.claim.sub',family,true);
    data := public.middle_school('roster');
    if jsonb_array_length(data) <> 2 or not (data @> jsonb_build_array(jsonb_build_object('id',sibling))) then
        raise exception 'Linked family cannot see both children';
    end if;
    data := public.middle_school('record',jsonb_build_object('student_id',student));
    if jsonb_array_length(data->'results') <> 0 or jsonb_array_length(data->'courses') <> 2
        or not (data->'courses' @> '[{"title":"Algebra I","credit_decision":"pending","units":null}]') then
        raise exception 'Unverified results or unawarded credit leaked';
    end if;
    perform public.middle_school('request',jsonb_build_object('student_id',student));
    perform public.middle_school('request',jsonb_build_object('student_id',student));
    data := public.middle_school('record',jsonb_build_object('student_id',student));
    if jsonb_array_length(data->'requests') <> 1 then raise exception 'Request was not idempotent'; end if;
    request_id := (data->'requests'->0->>'id')::uuid;
    perform set_config('request.jwt.claim.sub',stranger,true);
    begin
        perform public.middle_school('record',jsonb_build_object('student_id',student));
        raise exception 'Unrelated family read a student';
    exception when insufficient_privilege then null; end;
    begin
        perform public.middle_school('request',jsonb_build_object('student_id',student));
        raise exception 'Unrelated family requested a transcript';
    exception when insufficient_privilege then null; end;

    perform set_config('request.jwt.claim.sub',staff,true);
    if jsonb_array_length(public.middle_school('office')->'pending_results') <> 2 then raise exception 'Review queue lost results'; end if;
    perform public.middle_school('verify',jsonb_build_object('id',algebra_result,'version',1,'share_next_step',true));
    perform public.middle_school('verify',jsonb_build_object('id',science_result,'version',1,'share_next_step',false));
    perform public.middle_school('request-update',jsonb_build_object('id',request_id,'status','in_review'));
    if exists(select 1 from public.ms_high_school_courses(student)) then raise exception 'Pending units reached HS transcript'; end if;
    begin
        perform public.middle_school('credit-save',jsonb_build_object('id',algebra,'decision','awarded','units',1));
        raise exception 'Office awarded credit without policy';
    exception when invalid_parameter_value then null; end;
    payload := jsonb_build_object('student_id',student,'request_id',request_id,
        'results',jsonb_build_array(algebra_result,science_result),'legal_name','Jamie Example',
        'signer','Fictional Office','signer_title','Registrar');
    preview := public.middle_school('preview',payload);
    if not (preview->'snapshot'->'results' @> '[{"title":"Algebra I","credit_decision":"pending","units":null},{"title":"Earth Systems","result_kind":"interim","as_of":"2026-11-15"}]')
        or not (preview->'snapshot'->'years' @> '[{"grade":8,"withdrawn_on":"2026-11-15"}]') then
        raise exception 'Transcript preview omitted pending credit or withdrawal evidence';
    end if;
    receipt := (public.middle_school('issue',payload || jsonb_build_object('revision',preview->>'revision',
        'certify',true,'release',false,'pdf',file))->>'id')::uuid;

    perform set_config('request.jwt.claim.sub',family,true);
    data := public.middle_school('record',jsonb_build_object('student_id',student));
    if not (data->'results' @> '[{"mark":"A","next_step":"Try Geometry"}]')
        or data::text like '%private-evidence%' or (data->'requests'->0->>'status') is distinct from 'issued' then
        raise exception 'Family result, evidence privacy, or request status incorrect';
    end if;
    begin
        perform public.middle_school('download',jsonb_build_object('id',receipt));
        raise exception 'Family downloaded an unreleased transcript';
    exception when insufficient_privilege then null; end;

    perform set_config('request.jwt.claim.sub',teacher,true);
    perform public.middle_school('result-save',jsonb_build_object('id',algebra_result,'version',2,'course_id',algebra,
        'period','Fall final','period_end','2026-11-15','result_kind','final','mark','A+','next_step','Draft next step'));
    perform set_config('request.jwt.claim.sub',family,true);
    data := public.middle_school('record',jsonb_build_object('student_id',student));
    if not (data->'results' @> '[{"mark":"A","next_step":"Try Geometry"}]') or data::text like '%Draft next step%' then
        raise exception 'Changing a verified result published the edit without review';
    end if;
    perform set_config('request.jwt.claim.sub',staff,true);
    perform public.middle_school('verify',jsonb_build_object('id',algebra_result,'version',3,'share_next_step',false));
    begin
        perform public.middle_school('issue',(payload-'request_id') || jsonb_build_object('revision',preview->>'revision',
            'certify',true,'release',false,'pdf',file));
        raise exception 'Office issued a stale preview';
    exception when invalid_parameter_value then null; end;
    perform public.middle_school('release',jsonb_build_object('id',receipt));
    perform public.middle_school('settings-save','{"school_name":"Fictional Zion","school_contact":"office@example.test","grading_key":"A = sample mark","current_school_year":"2026-2027","credit_policy":"Synthetic approved policy"}');
    perform public.middle_school('credit-save',jsonb_build_object('id',algebra,'decision','awarded','units',1,
        'add_to_transcript',true,'hs_requirement','algebra_i'));
    if not exists(select 1 from public.ms_high_school_courses(student) where grade_level='8' and credits=1 and final_grade='A+') then
        raise exception 'Awarded early credit was not sent to the high school transcript';
    end if;
    perform set_config('request.jwt.claim.sub',teacher,true);
    begin
        perform public.middle_school('course-save',jsonb_build_object('id',algebra,'year_id',year_id,
            'area','Math','title','Different Course','instructional_level','High school','term','Fall','course_status','completed'));
        raise exception 'Teacher changed the scope of an office-awarded credit';
    exception when insufficient_privilege then null; end;
    perform set_config('request.jwt.claim.sub',family,true);
    if public.middle_school('download',jsonb_build_object('id',receipt))->>'file' is distinct from file then
        raise exception 'Revised live records changed the issued PDF bytes';
    end if;
    data := public.middle_school('record',jsonb_build_object('student_id',student));
    if not (data->'results' @> '[{"mark":"A+","next_step":null}]') then raise exception 'Approved edit not visible'; end if;
    perform set_config('request.jwt.claim.sub',stranger,true);
    if exists(select 1 from public.ms_high_school_courses(student)) then raise exception 'Early credit leaked to unrelated family'; end if;
    begin
        perform public.middle_school('download',jsonb_build_object('id',receipt));
        raise exception 'Other family downloaded the PDF';
    exception when insufficient_privilege then null; end;
end;
$$;
rollback;

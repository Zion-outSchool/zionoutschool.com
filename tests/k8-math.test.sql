-- Run after the gradebook, class dates, K–8 math catalog and Learning Record migrations.
begin;

insert into auth.users(id,email) values
    ('81100000-0000-0000-0000-000000000001','k8-office@example.test'),
    ('81100000-0000-0000-0000-000000000002','k8-teacher@example.test'),
    ('81100000-0000-0000-0000-000000000003','k8-other-teacher@example.test'),
    ('81100000-0000-0000-0000-000000000004','k8-family@example.test');
insert into public.portal_users(id,display_name,role) values
    ('81100000-0000-0000-0000-000000000001','Fictional Office','admin'),
    ('81100000-0000-0000-0000-000000000002','Fictional Teacher','teacher'),
    ('81100000-0000-0000-0000-000000000003','Other Teacher','teacher'),
    ('81100000-0000-0000-0000-000000000004','Fictional Family','family');
insert into public.students(id,family_id,first_name,last_name,grade_level) values
    ('81200000-0000-0000-0000-000000000001','81100000-0000-0000-0000-000000000004','Avery','Example','Kindergarten');
insert into public.gradebook_courses(id,teacher_id,name,term,weighting,missing_is_zero,categories,scale,starts_on,ends_on) values
    ('81300000-0000-0000-0000-000000000001','81100000-0000-0000-0000-000000000002','Mixed-age Math','Fall 2025',
    'points',false,'{"General":0}','{"A":90,"B":80,"F":0}','2025-09-01','2025-12-01');
insert into public.gradebook_enrollments(id,course_id,student_id,grade_level,credits) values
    ('81400000-0000-0000-0000-000000000001','81300000-0000-0000-0000-000000000001','81200000-0000-0000-0000-000000000001','K',0);
insert into public.gradebook_assignments(id,course_id,title,category,points) values
    ('81500000-0000-0000-0000-000000000001','81300000-0000-0000-0000-000000000001','Counting and grouping','General',10);
insert into public.gradebook_marks(enrollment_id,assignment_id,course_id,state,score) values
    ('81400000-0000-0000-0000-000000000001','81500000-0000-0000-0000-000000000001',
     '81300000-0000-0000-0000-000000000001','scored',10);

set local role authenticated;
do $$
declare
    office text := '81100000-0000-0000-0000-000000000001';
    teacher text := '81100000-0000-0000-0000-000000000002';
    other_teacher text := '81100000-0000-0000-0000-000000000003';
    family text := '81100000-0000-0000-0000-000000000004';
    student uuid := '81200000-0000-0000-0000-000000000001';
    enrollment uuid := '81400000-0000-0000-0000-000000000001';
    assignment uuid := '81500000-0000-0000-0000-000000000001';
    year_id uuid;
    course uuid;
    result uuid;
    record jsonb;
    catalog jsonb;
    preview jsonb;
begin
    perform set_config('request.jwt.claim.sub',office,true);
    catalog := public.k8_math_catalog();
    if jsonb_array_length(catalog->'standards') <> 290 or jsonb_array_length(catalog->'levels') <> 9
        or (catalog->>'edition') is distinct from '2023'
        or not (catalog->'standards' @> '[{"code":"K.GM.1","topic":"Shapes","source_page":8}]') then
        raise exception 'The verified standards catalog is incomplete';
    end if;
    if not (public.middle_school('map') @> '[{"title":"Math Kindergarten","grade":0},{"title":"Math 5","grade":5}]') then
        raise exception 'K–5 course maps are missing';
    end if;
    year_id := (public.middle_school('year-save',jsonb_build_object('student_id',student,'school_year','2025-2026',
        'enrolled_grade',0,'entered_on','2025-09-01'))->>'id')::uuid;
    perform public.middle_school('settings-save',
        '{"school_name":"Fictional Zion","school_contact":"office@example.test","grading_key":"A = sample mark","current_school_year":"2025-2026","credit_policy":""}');

    perform set_config('request.jwt.claim.sub',teacher,true);
    if not (public.middle_school('roster') @> jsonb_build_array(jsonb_build_object('id',student))) then
        raise exception 'Kindergarten was excluded from the teacher roster';
    end if;
    if public.k8_math_assignment(assignment,'["K.NPV.1","1.NPV.1","K.NPV.1"]')
        is distinct from array['1.NPV.1','K.NPV.1']::text[] then
        raise exception 'Mixed-age assignment standards were not saved';
    end if;
    begin
        perform public.k8_math_assignment(assignment,'["FABRICATED.1"]');
        raise exception 'An invalid standard was accepted';
    exception when invalid_parameter_value then null; end;
    perform public.gradebook_finalize(enrollment,0);
    course := (public.middle_school('course-save',jsonb_build_object('year_id',year_id,'area','Math','title','Early Math',
        'instructional_level','Kindergarten and grade 1','term','Fall 2025','course_status','completed',
        'high_school_level',true,'math_codes',jsonb_build_array('K.NPV.1','1.NPV.1')))->>'id')::uuid;
    perform public.middle_school('gradebook-import',jsonb_build_object('course_id',course,'id',enrollment));
    perform public.middle_school('gradebook-import',jsonb_build_object('course_id',course,'id',enrollment));
    record := public.middle_school('record',jsonb_build_object('student_id',student));
    if jsonb_array_length(record->'results')<>1
        or not (record->'courses' @> '[{"high_school_level":false,"credit_decision":null,"math_codes":["1.NPV.1","K.NPV.1"]}]')
        or not (record->'results' @> '[{"result_kind":"final","mark":"A","verification":"pending"}]') then
        raise exception 'Kindergarten result import, idempotency, or course credit was incorrect';
    end if;
    result := (record->'results'->0->>'id')::uuid;
    perform public.middle_school('result-save',jsonb_build_object('id',result,'version',1,'course_id',course,
        'period','Fall report','period_end','2025-12-01','result_kind','final','mark','F',
        'next_step','Practice counting aloud','math_codes',jsonb_build_array('K.NPV.1')));
    record := public.middle_school('record',jsonb_build_object('student_id',student));
    if not (record->'results' @> '[{"mark":"A","math_codes":["K.NPV.1"]}]') then
        raise exception 'Learning Record edit overwrote the imported Gradebook mark';
    end if;

    perform set_config('request.jwt.claim.sub',other_teacher,true);
    begin
        perform public.k8_math_assignment(assignment,'[]');
        raise exception 'Teacher edited another teacher’s standards';
    exception when insufficient_privilege then null; end;
    perform set_config('request.jwt.claim.sub',family,true);
    record := public.middle_school('record',jsonb_build_object('student_id',student));
    if jsonb_array_length(record->'results')<>0 or jsonb_array_length(record->'gradebook_finals')<>0 then
        raise exception 'Unverified Gradebook import leaked';
    end if;

    perform set_config('request.jwt.claim.sub',office,true);
    perform public.middle_school('verify',jsonb_build_object('id',result,'version',2,'share_next_step',true));
    preview := public.middle_school('preview',jsonb_build_object('student_id',student,'results',jsonb_build_array(result),
        'legal_name','Avery Example','signer','Fictional Registrar','signer_title','Registrar'));
    if preview->'snapshot'->>'document_title' is distinct from 'K–8 Learning Transcript' then
        raise exception 'Kindergarten document was identified as a middle school transcript';
    end if;
    perform set_config('request.jwt.claim.sub',family,true);
    record := public.middle_school('record',jsonb_build_object('student_id',student));
    if not (record->'results' @> '[{"mark":"A","next_step":"Practice counting aloud","math_standards":[{"code":"K.NPV.1"}]}]')
        or (record->'results')::text like '%1.NPV.1%' then
        raise exception 'Report inferred standards from mixed-age assignment tags or omitted verified standards';
    end if;
    if exists(select 1 from public.ms_high_school_courses(student)) then raise exception 'Kindergarten work reached HS transcript'; end if;
end;
$$;
rollback;

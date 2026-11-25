-- Run on a disposable portal database after the tracker migration and private package import.
begin;

insert into auth.users(id,email) values
 ('80100000-0000-0000-0000-000000000001','curriculum-office@example.test'),
 ('80100000-0000-0000-0000-000000000002','curriculum-teacher@example.test'),
 ('80100000-0000-0000-0000-000000000003','curriculum-family@example.test'),
 ('80100000-0000-0000-0000-000000000004','curriculum-stranger@example.test');
insert into public.portal_users(id,display_name,role) values
 ('80100000-0000-0000-0000-000000000001','Sample office','admin'),
 ('80100000-0000-0000-0000-000000000002','Sample teacher','teacher'),
 ('80100000-0000-0000-0000-000000000003','Sample family','family'),
 ('80100000-0000-0000-0000-000000000004','Sample outsider','family');
insert into public.students(id,family_id,first_name,last_name,grade_level) values
 ('80200000-0000-0000-0000-000000000001','80100000-0000-0000-0000-000000000003','Jamie','Example','4'),
 ('80200000-0000-0000-0000-000000000002','80100000-0000-0000-0000-000000000003','Avery','Example','K'),
 ('80200000-0000-0000-0000-000000000003','80100000-0000-0000-0000-000000000004','Riley','Example','6');
insert into public.gradebook_courses(id,teacher_id,name,term,weighting,missing_is_zero,categories,scale)
values ('80300000-0000-0000-0000-000000000001','80100000-0000-0000-0000-000000000002',
 'Fictional mixed-age class','Fall','points',false,'{"General":0}','{"A":90,"F":0}');
insert into public.gradebook_enrollments(course_id,student_id,grade_level,credits)
values ('80300000-0000-0000-0000-000000000001','80200000-0000-0000-0000-000000000001','4',0),
 ('80300000-0000-0000-0000-000000000001','80200000-0000-0000-0000-000000000002','K',0);

insert into public.gradebook_assignments(id,course_id,title,category,due_on,points)
values ('80310000-0000-0000-0000-000000000001','80300000-0000-0000-0000-000000000001',
 'Example assessment','General','2026-10-15',100);
insert into public.gradebook_marks(course_id,enrollment_id,assignment_id,state,score)
select course_id,id,'80310000-0000-0000-0000-000000000001','scored',96 from public.gradebook_enrollments
where course_id='80300000-0000-0000-0000-000000000001' and student_id='80200000-0000-0000-0000-000000000001';

do $$
begin
    if (select count(*) from public.ct_catalogs where inventory_complete)<>11
        or (select count(*) from public.ct_items)<>1694 or (select count(*) from public.ct_standards)<>607
        or exists(select 1 from public.ct_mappings) then
        raise exception 'Inventory count differs or an imported mapping was enabled';
    end if;
    if has_table_privilege('authenticated','public.ct_reviews','select')
        or has_table_privilege('authenticated','public.ct_evidence','select')
        or has_table_privilege('authenticated','public.ct_reports','select')
        or has_function_privilege('anon','public.curriculum_tracker(text,jsonb)','execute') then
        raise exception 'Private source or student data has direct browser access';
    end if;
end;
$$;

set local role authenticated;
do $$
declare
    office text:='80100000-0000-0000-0000-000000000001';
    teacher text:='80100000-0000-0000-0000-000000000002';
    family text:='80100000-0000-0000-0000-000000000003';
    stranger text:='80100000-0000-0000-0000-000000000004';
    student text:='80200000-0000-0000-0000-000000000001';
    sibling text:='80200000-0000-0000-0000-000000000002';
    outsider text:='80200000-0000-0000-0000-000000000003';
    catalog text:='beast-5-publisher-sequence-accessed-2026-11-25';
    lower_catalog text:='beast-4-publisher-sequence-accessed-2026-11-25';
    standard text:='math:2023:4.NPV.1';
    direct_standard text:='math:2023:4.NPV.2';
    advanced text:='math:2023:6.NCC.1';
    context jsonb;
    winter_context jsonb;
    data jsonb;
    preview jsonb;
    preview_data jsonb;
    checklist jsonb;
    result_data jsonb;
    enrollment text;
    fall text;
    winter text;
    study text;
    work text;
    supplement text;
    report text;
    interim text;
    policy jsonb;
    map_one text;
    map_two text;
    file text:=encode(convert_to(E'%PDF-1.7\n% Synthetic report fixture\n%%EOF','UTF8'),'base64');
    enrolled_grade int;
begin
    perform set_config('request.jwt.claim.sub',office,true);
    enrollment:=public.middle_school('year-save',jsonb_build_object('student_id',student,
        'school_year','2026-2027','enrolled_grade',4))->>'id';
    perform public.middle_school('year-save',jsonb_build_object('student_id',sibling,'school_year','2026-2027','enrolled_grade',0));
    perform public.middle_school('year-save',jsonb_build_object('student_id',outsider,'school_year','2026-2027','enrolled_grade',6));
    fall:=public.curriculum_tracker('period-save','{"school_year":"2026-2027","name":"Fall","starts_on":"2026-08-15","ends_on":"2026-11-20"}')#>>'{}';
    winter:=public.curriculum_tracker('period-save','{"school_year":"2026-2027","name":"Winter","starts_on":"2026-11-21","ends_on":"2027-03-15"}')#>>'{}';
    context:=jsonb_build_object('student_id',student,'year_id',enrollment,'period_id',fall);
    winter_context:=context || jsonb_build_object('period_id',winter);

    perform set_config('request.jwt.claim.sub',teacher,true);
    for enrolled_grade in 0..6 loop
        data:=public.curriculum_tracker('catalog');
        if not exists(select 1 from jsonb_array_elements(data->'catalogs') v
            where (v->'suggested_grades') @> to_jsonb(array[enrolled_grade])) then
            raise exception 'Grade % has no recommended course',enrolled_grade;
        end if;
    end loop;
    begin
        perform public.curriculum_tracker('years',jsonb_build_object('student_id',outsider));
        raise exception 'Teacher accessed an unrelated student';
    exception when insufficient_privilege then null; end;
    begin
        perform public.curriculum_tracker('import-reference');
        raise exception 'Teacher accessed the import controls';
    exception when insufficient_privilege then null; end;
    study:=public.curriculum_tracker('study-start',context || jsonb_build_object('catalog_key',catalog,'delivery','both'))#>>'{}';
    checklist:=public.curriculum_tracker('checklist',context || jsonb_build_object('study_id',study));
    if jsonb_array_length(checklist->'items')<>203 or jsonb_array_length(checklist->'checkpoints')<>0 then
        raise exception 'Fourth grader did not get the selected Level 5 inventory or an unreviewed link got activated';
    end if;
    work:=public.curriculum_tracker('work-save',context || jsonb_build_object('study_id',study,'item_key','BA-5-01-01',
        'completed',true,'activity_on','2026-11-01','gradebook_assignment_id','80310000-0000-0000-0000-000000000001'))#>>'{}';
    data:=public.curriculum_tracker('record',context);
    if (select (s->>'taught')::boolean or (s->>'demonstrated')::boolean
        from jsonb_array_elements(data->'standards') s where s->>'key'=standard) is distinct from false then
        raise exception 'Completion changed grade-level standards through unreviewed mappings';
    end if;
    if exists(select 1 from jsonb_array_elements(data->'standards') s where (s->>'grade')::int<>4) then
        raise exception 'Completing an unreviewed lesson added advanced work to the standards summary';
    end if;

    perform set_config('request.jwt.claim.sub',office,true);
    perform public.curriculum_tracker('components-save',jsonb_build_object('standard_key',standard,
        'labels',jsonb_build_array('Represent the relationship','Explain a new example')));
    perform public.curriculum_tracker('mapping-save',jsonb_build_object('standard_key',standard,'catalog_key',catalog,'school_year','2026-2027',
        'item_key','BA-5-01-02','component_key','part-01','effect','checkpoint','rationale','Verify a representation independently.'));
    perform public.curriculum_tracker('mapping-save',jsonb_build_object('standard_key',standard,'catalog_key',catalog,'school_year','2026-2027',
        'item_key','BA-5-01-03','component_key','part-02','effect','checkpoint','rationale','Verify an explanation with a new example.'));
    perform public.curriculum_tracker('mapping-save',jsonb_build_object('standard_key',advanced,'catalog_key',catalog,'school_year','2026-2027',
        'item_key','BA-5-01-02','component_key','full','effect','taught','rationale','The separate instructional exercise covers this expectation.'));

    perform set_config('request.jwt.claim.sub',teacher,true);
    checklist:=public.curriculum_tracker('checklist',context || jsonb_build_object('study_id',study));
    select m->>'id' into map_one from jsonb_array_elements(checklist->'checkpoints') m where m->>'component_key'='part-01';
    select m->>'id' into map_two from jsonb_array_elements(checklist->'checkpoints') m where m->>'component_key'='part-02';
    perform public.curriculum_tracker('work-save',context || jsonb_build_object('study_id',study,'item_key','BA-5-01-02',
        'completed',true,'result','A','result_kind','grade'));
    data:=public.curriculum_tracker('record',context);
    if (select (s->>'demonstrated')::boolean from jsonb_array_elements(data->'standards') s where s->>'key'=standard) is distinct from false
        or not exists(select 1 from jsonb_array_elements(data->'standards') s where s->>'key'=advanced and (s->>'taught')::boolean) then
        raise exception 'A grade passed the standard or advanced taught status was lost';
    end if;
    perform public.curriculum_tracker('work-save',context || jsonb_build_object('study_id',study,'item_key','BA-5-01-02',
        'completed',true,'checkpoints',jsonb_build_array(jsonb_build_object('mapping_id',map_one,'description','Verified first work sample.','independent',true))));
    data:=public.curriculum_tracker('record',context);
    if not exists(select 1 from jsonb_array_elements(data->'standards') s,
        lateral jsonb_array_elements(s->'components') p where s->>'key'=standard and p->>'key'='part-01' and (p->>'demonstrated')::boolean)
        or exists(select 1 from jsonb_array_elements(data->'standards') s where s->>'key'=standard and (s->>'demonstrated')::boolean) then
        raise exception 'One component did not remain partial';
    end if;
    begin
        perform public.curriculum_tracker('mark-save',context || jsonb_build_object('standard_key',standard,'mark','meets'));
        raise exception 'A partially demonstrated standard was marked Meets';
    exception when raise_exception then
        if sqlerrm not like 'Verify independent demonstration%' then raise; end if;
    end;
    perform public.curriculum_tracker('work-save',context || jsonb_build_object('study_id',study,'item_key','BA-5-01-03',
        'completed',true,'checkpoints',jsonb_build_array(jsonb_build_object('mapping_id',map_two,'description','Verified second work sample.','independent',true))));
    data:=public.curriculum_tracker('record',context);
    if not exists(select 1 from jsonb_array_elements(data->'standards') s where s->>'key'=standard and (s->>'demonstrated')::boolean) then
        raise exception 'Two partial checkpoints did not demonstrate the full standard';
    end if;

    supplement:=public.curriculum_tracker('supplement-save',context || jsonb_build_object('standard_key',direct_standard,
        'title','Fictional applied task','instructions','Staff-only directions'))#>>'{}';
    perform public.curriculum_tracker('supplement-complete',context || jsonb_build_object('id',supplement,'completed',true));
    perform public.curriculum_tracker('evidence-save',context || jsonb_build_object('standard_key',direct_standard,
        'component_key','full','kind','supplement','supplement_id',supplement,'description','Verified the applied task.','independent',true,
        'source_url','https://example.test/private-work'));
    data:=public.curriculum_tracker('record',context);
    if not exists(select 1 from jsonb_array_elements(data->'standards') s where s->>'key'=direct_standard
        and (s->>'demonstrated')::boolean and not (s->>'mapped')::boolean) then
        raise exception 'Supplement failed independently of coverage';
    end if;

    perform public.curriculum_tracker('mark-save',context || jsonb_build_object('standard_key',standard,'mark','extends',
        'extension_note','Independently applied the relationship to a new allocation problem.'));
    if not (public.curriculum_tracker('record',context)->'standards' @> '[{"key":"math:2023:4.NPV.1","mark":"extends","taught":false}]') then
        raise exception 'Checkpoint evidence did not enable Extends independently of instruction tracking';
    end if;
    perform public.curriculum_tracker('mark-save',context || jsonb_build_object('standard_key',standard,'mark','meets'));
    begin
        perform public.curriculum_tracker('mark-save',context || jsonb_build_object('standard_key',standard,'mark','extends'));
        raise exception 'Extended application was not required';
    exception when raise_exception then
        if sqlerrm not like 'Describe the more complex%' then raise; end if;
    end;
    begin
        perform public.curriculum_tracker('mark-save',context || jsonb_build_object('standard_key','math:2023:4.NPV.3','mark','beginning'));
        raise exception 'A mark without evidence was permitted';
    exception when raise_exception then
        if sqlerrm not like 'Verify evidence for this standard%' then raise; end if;
    end;

    perform set_config('request.jwt.claim.sub',family,true);
    if jsonb_array_length(public.curriculum_tracker('roster'))<>2 then raise exception 'Family roster is wrong'; end if;
    if jsonb_array_length(public.curriculum_tracker('family',context)->'publications')<>0 then
        raise exception 'Family saw unpublished progress';
    end if;
    begin
        perform public.curriculum_tracker('record',context);
        raise exception 'Family saw staff record';
    exception when insufficient_privilege then null; end;

    perform set_config('request.jwt.claim.sub',office,true);
    perform public.middle_school('settings-save','{"school_name":"Zion Outschool","school_contact":"office@example.test","grading_key":"Existing middle-school key","current_school_year":"2026-2027","credit_policy":""}');
    policy:=public.curriculum_tracker('policy','{"school_year":"2026-2027"}');
    if policy->>'grading_key'<>'Existing middle-school key' or policy->'scale'->2->>'label'<>'Meets' then
        raise exception 'Default marks or inherited grading key are wrong';
    end if;
    if (clock_timestamp() at time zone 'America/New_York')::date < date '2027-03-15' then
        begin
            perform public.curriculum_tracker('publish-preview',winter_context);
            raise exception 'Open period was publishable';
        exception when raise_exception then
            if sqlerrm not like 'The reporting period is still open%' then raise; end if;
        end;
    end if;
    preview_data:=context || jsonb_build_object('kind','interim_council','as_of','2026-11-10','signer','Sample Office',
        'include_standards',true,'release',true,'result_ids',jsonb_build_array(work));
    preview:=public.curriculum_tracker('report-preview',preview_data);
    if preview->'publications'->0->>'as_of'<>'2026-11-10' or preview::text not like '%Parent Partnership Council%'
        or preview::text not like '%96 / 100%' or preview::text like '%4.NPV.1%' then
        raise exception 'Interim snapshot did not filter to evidence and scores as of the chosen date';
    end if;
    interim:=public.curriculum_tracker('issue',preview_data || jsonb_build_object('preview',preview,'pdf',file))#>>'{}';

    result_data:=context || jsonb_build_object('result_ids',jsonb_build_array(work),
        'include_standards',true,'accomplishment','Solved a new problem','next_step','Continue with a model.');
    preview:=public.curriculum_tracker('publish-preview',result_data);
    perform public.curriculum_tracker('publish',result_data || jsonb_build_object('preview',preview));
    preview_data:=context || jsonb_build_object('kind','transfer','signer','Sample Office','include_standards',true,'release',true);
    preview:=public.curriculum_tracker('report-preview',preview_data);
    report:=public.curriculum_tracker('issue',preview_data || jsonb_build_object('preview',preview,'pdf',file))#>>'{}';
    preview:=public.curriculum_tracker('report-preview',winter_context || jsonb_build_object(
        'kind','interim_transfer','as_of','2026-11-22','signer','Sample Office','include_standards',true));
    if jsonb_array_length(preview->'publications')<>2
        or preview->'publications'->1->>'purpose'<>'Midyear transfer' then
        raise exception 'Interim transfer did not carry forward earlier published periods';
    end if;

    perform public.curriculum_tracker('policy-save',jsonb_build_object('school_year','2026-2027',
        'scale',jsonb_set(policy->'scale','{2,label}','"Proficient"'),'grading_key','New elementary key'));
    if public.curriculum_tracker('policy','{"school_year":"2027-2028"}')->'scale'->2->>'label'<>'Meets' then
        raise exception 'A policy update changed another school year';
    end if;
    preview:=public.curriculum_tracker('report-preview',preview_data || jsonb_build_object('kind','transfer'));
    if preview->'publications'->0->>'grading_key'<>'Existing middle-school key'
       or preview->'publications'->0->'scale'->2->>'label'<>'Meets'
       or not preview->'publications'->0->'standards' @> '[{"code":"4.NPV.1","mark":"meets"}]' then
        raise exception 'A policy update changed a published record or a verified mark was missing';
    end if;

    perform set_config('request.jwt.claim.sub',teacher,true);
    perform public.curriculum_tracker('study-start',winter_context || jsonb_build_object('catalog_key',lower_catalog,'delivery','online'));
    data:=public.curriculum_tracker('record',winter_context);
    if jsonb_array_length(data->'studies')<>2 or jsonb_array_length(data->'evidence')<>3 then
        raise exception 'Curriculum switch changed historical evidence';
    end if;
    perform public.curriculum_tracker('work-save',context || jsonb_build_object('study_id',study,'item_key','BA-5-01-02',
        'completed',false));
    data:=public.curriculum_tracker('record',winter_context);
    if jsonb_array_length(data->'evidence')<>2
       or not exists(select 1 from jsonb_array_elements(data->'work') w
           where w->>'item_key'='BA-5-01-02' and w->>'result'='A' and not (w->>'completed')::boolean)
       or exists(select 1 from jsonb_array_elements(data->'standards') s where s->>'key'=standard and (s->>'demonstrated')::boolean)
       or not exists(select 1 from jsonb_array_elements(data->'standards') s where s->>'key'=direct_standard and (s->>'demonstrated')::boolean) then
        raise exception 'Lesson reversal affected unrelated evidence or retained its own evidence';
    end if;

    perform set_config('request.jwt.claim.sub',stranger,true);
    begin
        perform public.curriculum_tracker('family',context);
        raise exception 'Unrelated family accessed progress';
    exception when insufficient_privilege then null; end;
    begin
        perform public.curriculum_tracker('report-download',context || jsonb_build_object('id',report));
        raise exception 'Unrelated family accessed the PDF';
    exception when insufficient_privilege then null; end;
    perform set_config('request.jwt.claim.sub',family,true);
    data:=public.curriculum_tracker('family',context);
    if data::text like '%private-work%' or data::text like '%Staff-only%' or data::text like '%Verified first work sample%'
       or position('96 / 100' in data::text)=0 then raise exception 'Family snapshot is incomplete or exposes internal records'; end if;
    if public.curriculum_tracker('report-download',context || jsonb_build_object('id',report))->>'pdf'<>file
       or public.curriculum_tracker('report-download',context || jsonb_build_object('id',interim))->>'pdf'<>file then
        raise exception 'Issued PDF changed after live records changed';
    end if;
end;
$$;
rollback;

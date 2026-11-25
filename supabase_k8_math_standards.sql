begin;

create table public.k8_math_levels (
    grade text primary key check (grade in ('K','1','2','3','4','5','6','7','8')),
    first_page smallint not null,
    last_page smallint not null,
    practice_url text not null
);
create table public.k8_math_standards (
    code text primary key check (code ~ '^[K1-8]\.[A-Z]+\.[0-9]+$'),
    grade text not null references public.k8_math_levels(grade),
    domain text not null,
    topic text not null,
    source_page smallint not null
);
create table public.k8_math_assignment_standards (
    assignment_id uuid not null references public.gradebook_assignments(id) on delete cascade,
    code text not null references public.k8_math_standards(code),
    primary key (assignment_id,code)
);
alter table public.k8_math_levels enable row level security;
alter table public.k8_math_standards enable row level security;
alter table public.k8_math_assignment_standards enable row level security;
revoke all on public.k8_math_levels,public.k8_math_standards,public.k8_math_assignment_standards
    from public,anon,authenticated;

-- Arkansas DESE 2023 code index, checked against Zion's grade-level reference.
insert into public.k8_math_levels(grade,first_page,last_page,practice_url) values
    ('K', 7, 8, 'https://www.ixl.com/standards/arkansas/math/kindergarten'),
    ('1', 9, 11, 'https://www.ixl.com/standards/arkansas/math/grade-1'),
    ('2', 12, 14, 'https://www.ixl.com/standards/arkansas/math/grade-2'),
    ('3', 15, 17, 'https://www.ixl.com/standards/arkansas/math/grade-3'),
    ('4', 18, 20, 'https://www.ixl.com/standards/arkansas/math/grade-4'),
    ('5', 21, 23, 'https://www.ixl.com/standards/arkansas/math/grade-5'),
    ('6', 24, 26, 'https://www.ixl.com/standards/arkansas/math/grade-6'),
    ('7', 28, 30, 'https://www.ixl.com/standards/arkansas/math/grade-7'),
    ('8', 32, 34, 'https://www.ixl.com/standards/arkansas/math/grade-8');

insert into public.k8_math_standards(code,grade,domain,topic,source_page)
select code, grade, domain, topic, source_page
from (values
    ('K', 'Number and place value', 'Counting and Number Foundations', 7, 'K.NPV.1 K.NPV.2 K.NPV.3 K.NPV.4'),
    ('K', 'Number and place value', 'Place Value', 7, 'K.NPV.5 K.NPV.6'),
    ('K', 'Number and place value', 'Comparison', 7, 'K.NPV.7 K.NPV.8'),
    ('K', 'Computation and algebraic reasoning', 'Operations and Properties', 7, 'K.CAR.1 K.CAR.2 K.CAR.3 K.CAR.4'),
    ('K', 'Computation and algebraic reasoning', 'Problem Solving', 7, 'K.CAR.5'),
    ('K', 'Geometry and measurement', 'Shapes', 8, 'K.GM.1 K.GM.2 K.GM.3 K.GM.4 K.GM.5'),
    ('K', 'Geometry and measurement', 'Measurement Concepts', 8, 'K.GM.6'),
    ('K', 'Geometry and measurement', 'Time and Money', 8, 'K.GM.7 K.GM.8'),
    ('K', 'Data analysis', 'Charts, Graphs, and Tables', 8, 'K.DA.1'),
    ('1', 'Number and place value', 'Counting', 9, '1.NPV.1 1.NPV.2'),
    ('1', 'Number and place value', 'Place Value', 9, '1.NPV.3 1.NPV.4 1.NPV.5 1.NPV.6'),
    ('1', 'Number and place value', 'Comparison', 9, '1.NPV.7'),
    ('1', 'Number and place value', 'Fraction Foundations', 9, '1.NPV.8'),
    ('1', 'Computation and algebraic reasoning', 'Operations and Properties', 9, '1.CAR.1 1.CAR.2 1.CAR.3 1.CAR.4'),
    ('1', 'Computation and algebraic reasoning', 'Operations and Properties', 10, '1.CAR.5'),
    ('1', 'Computation and algebraic reasoning', 'Problem Solving', 10, '1.CAR.6 1.CAR.7'),
    ('1', 'Computation and algebraic reasoning', 'Algebraic Concepts', 10, '1.CAR.8 1.CAR.9'),
    ('1', 'Geometry and measurement', 'Shapes', 10, '1.GM.1 1.GM.2'),
    ('1', 'Geometry and measurement', 'Length and Width', 10, '1.GM.3 1.GM.4'),
    ('1', 'Geometry and measurement', 'Time and Money', 10, '1.GM.5 1.GM.6'),
    ('1', 'Geometry and measurement', 'Time and Money', 11, '1.GM.7'),
    ('1', 'Data analysis', 'Charts, Graphs, and Tables', 11, '1.DA.1 1.DA.2'),
    ('2', 'Number and place value', 'Counting', 12, '2.NPV.1'),
    ('2', 'Number and place value', 'Place Value', 12, '2.NPV.2 2.NPV.3 2.NPV.4'),
    ('2', 'Number and place value', 'Comparison', 12, '2.NPV.5'),
    ('2', 'Number and place value', 'Fraction Foundations', 12, '2.NPV.6 2.NPV.7'),
    ('2', 'Computation and algebraic reasoning', 'Operations and Properties', 12, '2.CAR.1 2.CAR.2 2.CAR.3 2.CAR.4 2.CAR.5'),
    ('2', 'Computation and algebraic reasoning', 'Operations and Properties', 13, '2.CAR.6'),
    ('2', 'Computation and algebraic reasoning', 'Problem Solving', 13, '2.CAR.7'),
    ('2', 'Computation and algebraic reasoning', 'Algebraic Concepts', 13, '2.CAR.8'),
    ('2', 'Geometry and measurement', 'Shapes', 13, '2.GM.1 2.GM.2'),
    ('2', 'Geometry and measurement', 'Length and Width', 13, '2.GM.3 2.GM.4 2.GM.5 2.GM.6'),
    ('2', 'Geometry and measurement', 'Perimeter, Area, and Volume', 13, '2.GM.7 2.GM.8'),
    ('2', 'Geometry and measurement', 'Time and Money', 14, '2.GM.9 2.GM.10 2.GM.11 2.GM.12'),
    ('2', 'Data analysis', 'Charts, Graphs, and Tables', 14, '2.DA.1 2.DA.2'),
    ('3', 'Number and place value', 'Place Value', 15, '3.NPV.1 3.NPV.2 3.NPV.3'),
    ('3', 'Number and place value', 'Comparison', 15, '3.NPV.4 3.NPV.5'),
    ('3', 'Number and place value', 'Fraction Foundations', 15, '3.NPV.6 3.NPV.7 3.NPV.8 3.NPV.9 3.NPV.10'),
    ('3', 'Number and place value', 'Equivalent Fractions', 15, '3.NPV.11'),
    ('3', 'Computation and algebraic reasoning', 'Operations and Properties', 16, '3.CAR.1 3.CAR.2 3.CAR.3 3.CAR.4 3.CAR.5'),
    ('3', 'Computation and algebraic reasoning', 'Problem Solving', 16, '3.CAR.6 3.CAR.7'),
    ('3', 'Computation and algebraic reasoning', 'Algebraic Concepts', 16, '3.CAR.8 3.CAR.9'),
    ('3', 'Geometry and measurement', 'Shapes', 16, '3.GM.1 3.GM.2 3.GM.3'),
    ('3', 'Geometry and measurement', 'Length and Width', 17, '3.GM.4'),
    ('3', 'Geometry and measurement', 'Area and Volume', 17, '3.GM.5 3.GM.6 3.GM.7 3.GM.8 3.GM.9'),
    ('3', 'Geometry and measurement', 'Time', 17, '3.GM.10 3.GM.11'),
    ('3', 'Data analysis', 'Charts, Graphs, and Tables', 17, '3.DA.1 3.DA.2'),
    ('4', 'Number and place value', 'Place Value', 18, '4.NPV.1 4.NPV.2 4.NPV.3'),
    ('4', 'Number and place value', 'Comparison', 18, '4.NPV.4 4.NPV.5 4.NPV.6'),
    ('4', 'Number and place value', 'Fraction Foundations', 18, '4.NPV.7'),
    ('4', 'Number and place value', 'Equivalent Fractions', 18, '4.NPV.8 4.NPV.9 4.NPV.10'),
    ('4', 'Computation and algebraic reasoning', 'Operations and Properties', 19, '4.CAR.1 4.CAR.2 4.CAR.3 4.CAR.4 4.CAR.5 4.CAR.6'),
    ('4', 'Computation and algebraic reasoning', 'Problem Solving', 19, '4.CAR.7 4.CAR.8 4.CAR.9 4.CAR.10'),
    ('4', 'Computation and algebraic reasoning', 'Algebraic Concepts', 19, '4.CAR.11'),
    ('4', 'Geometry and measurement', 'Shapes', 19, '4.GM.1'),
    ('4', 'Geometry and measurement', 'Shapes', 20, '4.GM.2 4.GM.3 4.GM.4 4.GM.5 4.GM.6'),
    ('4', 'Geometry and measurement', 'Perimeter, Area, and Volume', 20, '4.GM.7'),
    ('4', 'Geometry and measurement', 'Time, Money, and Conversions', 20, '4.GM.8 4.GM.9 4.GM.10 4.GM.11'),
    ('4', 'Data analysis', 'Charts, Graphs, and Tables', 20, '4.DA.1 4.DA.2'),
    ('5', 'Number and place value', 'Place Value', 21, '5.NPV.1 5.NPV.2 5.NPV.3 5.NPV.4'),
    ('5', 'Number and place value', 'Comparison', 21, '5.NPV.5'),
    ('5', 'Number and place value', 'Fraction Foundations', 21, '5.NPV.6'),
    ('5', 'Computation and algebraic reasoning', 'Operations and Properties', 21, '5.CAR.1 5.CAR.2 5.CAR.3 5.CAR.4 5.CAR.5 5.CAR.6'),
    ('5', 'Computation and algebraic reasoning', 'Operations and Properties', 22, '5.CAR.7 5.CAR.8'),
    ('5', 'Computation and algebraic reasoning', 'Problem Solving', 22, '5.CAR.9 5.CAR.10 5.CAR.11'),
    ('5', 'Computation and algebraic reasoning', 'Algebraic Concepts', 22, '5.CAR.12 5.CAR.13 5.CAR.14'),
    ('5', 'Geometry and measurement', 'Shapes', 22, '5.GM.1'),
    ('5', 'Geometry and measurement', 'Area and Volume', 22, '5.GM.2 5.GM.3 5.GM.4 5.GM.5'),
    ('5', 'Geometry and measurement', 'Conversions', 23, '5.GM.6'),
    ('5', 'Geometry and measurement', 'Coordinate Plane System', 23, '5.GM.7 5.GM.8'),
    ('5', 'Data analysis', 'Charts, Graphs, and Tables', 23, '5.DA.1 5.DA.2'),
    ('6', 'Number concepts and computation', 'Rational Numbers', 24, '6.NCC.1 6.NCC.2 6.NCC.3 6.NCC.4 6.NCC.5'),
    ('6', 'Number concepts and computation', 'Rational Number Operations', 24, '6.NCC.6 6.NCC.7 6.NCC.8 6.NCC.9 6.NCC.10'),
    ('6', 'Number concepts and computation', 'Common Factors and Multiples', 24, '6.NCC.11 6.NCC.12 6.NCC.13'),
    ('6', 'Proportional relationships', 'Ratio and Rates', 25, '6.PR.1 6.PR.2 6.PR.3 6.PR.4 6.PR.5'),
    ('6', 'Algebra', 'Expressions', 25, '6.ALG.1 6.ALG.2 6.ALG.3 6.ALG.4 6.ALG.5'),
    ('6', 'Algebra', 'Equations and Inequalities', 25, '6.ALG.6 6.ALG.7 6.ALG.8'),
    ('6', 'Geometry and measurement', 'Area, Volume, and Surface Area', 25, '6.GM.1 6.GM.2 6.GM.3'),
    ('6', 'Geometry and measurement', 'Coordinate Plane System', 26, '6.GM.4 6.GM.5 6.GM.6'),
    ('6', 'Geometry and measurement', 'Conversions', 26, '6.GM.7'),
    ('6', 'Statistics and probability', 'Statistical and Nonstatistical', 26, '6.SP.1'),
    ('6', 'Statistics and probability', 'Measures of Center', 26, '6.SP.2 6.SP.3 6.SP.4'),
    ('6', 'Statistics and probability', 'Measures of Variation', 26, '6.SP.5 6.SP.6'),
    ('6', 'Statistics and probability', 'Numerical Data', 26, '6.SP.7 6.SP.8 6.SP.9'),
    ('7', 'Number concepts and computation', 'Rational Numbers', 28, '7.NCC.1 7.NCC.2 7.NCC.3 7.NCC.4 7.NCC.5'),
    ('7', 'Number concepts and computation', 'Rational Number Operations', 28, '7.NCC.6 7.NCC.7 7.NCC.8 7.NCC.9'),
    ('7', 'Proportional relationships', 'Ratio and Rates', 28, '7.PR.1 7.PR.2 7.PR.3'),
    ('7', 'Proportional relationships', 'Constant of Proportionality', 28, '7.PR.4 7.PR.5 7.PR.6'),
    ('7', 'Proportional relationships', 'Constant of Proportionality', 29, '7.PR.7'),
    ('7', 'Algebra', 'Expressions', 29, '7.ALG.1'),
    ('7', 'Algebra', 'Equations and Inequalities', 29, '7.ALG.2 7.ALG.3'),
    ('7', 'Algebra', 'Relationships between Quantities', 29, '7.ALG.4 7.ALG.5'),
    ('7', 'Geometry and measurement', 'Area, Volume, and Surface Area', 29, '7.GM.1 7.GM.2 7.GM.3'),
    ('7', 'Geometry and measurement', 'Cross Sections', 29, '7.GM.4'),
    ('7', 'Geometry and measurement', 'Triangles and Angles', 30, '7.GM.5'),
    ('7', 'Geometry and measurement', 'Scale', 30, '7.GM.6'),
    ('7', 'Statistics and probability', 'Numerical Data', 30, '7.SP.1 7.SP.2 7.SP.3 7.SP.4'),
    ('7', 'Statistics and probability', 'Sampling and Population', 30, '7.SP.5 7.SP.6'),
    ('7', 'Statistics and probability', 'Probability', 30, '7.SP.7 7.SP.8 7.SP.9 7.SP.10'),
    ('8', 'Number concepts and computation', 'Rational and Irrational Numbers', 32, '8.NCC.1 8.NCC.2 8.NCC.3 8.NCC.4 8.NCC.5 8.NCC.6'),
    ('8', 'Number concepts and computation', 'Rational Number Operations', 32, '8.NCC.7 8.NCC.8'),
    ('8', 'Functions', 'Proportional and Linear Relationships', 32, '8.FN.1 8.FN.2'),
    ('8', 'Functions', 'Functions', 32, '8.FN.3 8.FN.4 8.FN.5'),
    ('8', 'Functions', 'Functions', 33, '8.FN.6 8.FN.7 8.FN.8 8.FN.9'),
    ('8', 'Algebra', 'Equations and Inequalities', 33, '8.ALG.1 8.ALG.2'),
    ('8', 'Algebra', 'Systems of Equations', 33, '8.ALG.3'),
    ('8', 'Geometry and measurement', 'Area, Volume, and Surface Area', 33, '8.GM.1'),
    ('8', 'Geometry and measurement', 'Cross Sections', 33, '8.GM.2'),
    ('8', 'Geometry and measurement', 'Pythagorean Theorem', 33, '8.GM.3 8.GM.4 8.GM.5'),
    ('8', 'Geometry and measurement', 'Transformations and Congruence on a Coordinate Plane', 34, '8.GM.6 8.GM.7 8.GM.8 8.GM.9 8.GM.10 8.GM.11'),
    ('8', 'Statistics and probability', 'Bivariate Data', 34, '8.SP.1 8.SP.2 8.SP.3'),
    ('8', 'Statistics and probability', 'Probability', 34, '8.SP.4 8.SP.5 8.SP.6')
) as clusters(grade,domain,topic,source_page,codes)
cross join lateral unnest(string_to_array(codes,' ')) as standards(code);

create function public.k8_math_codes(p_codes jsonb)
returns text[] language plpgsql stable security definer set search_path=''
as $$
declare
    codes text[];
begin
    if p_codes is null then return '{}'::text[]; end if;
    if jsonb_typeof(p_codes) <> 'array' then
        raise exception 'Select standards from the K–8 math catalog.' using errcode='22023';
    end if;
    if jsonb_array_length(p_codes) > 100 or exists (
        select 1 from jsonb_array_elements_text(p_codes) as item(value)
        where not exists (select 1 from public.k8_math_standards s where s.code=item.value)
    ) then
        raise exception 'Select up to 100 valid standards from the K–8 math catalog.' using errcode='22023';
    end if;
    select coalesce(array_agg(distinct value order by value),'{}') into codes
    from jsonb_array_elements_text(p_codes) as item(value);
    return codes;
end;
$$;

create function public.k8_math_catalog()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
    if coalesce(public.current_portal_role(),'') not in ('admin','teacher') then
        raise exception 'Teacher or administrator access is required.' using errcode='42501';
    end if;
    return jsonb_build_object(
        'edition',2023,
        'source_url','https://dese.ade.arkansas.gov/Files/AR_2023_K-8%2C_Alg%2C_Geo_Math_Standards_LS_6.21.23_LS.pdf',
        'levels',(select jsonb_agg(to_jsonb(l) order by l.first_page) from public.k8_math_levels l),
        'standards',(select jsonb_agg(to_jsonb(s) order by s.source_page, s.code) from public.k8_math_standards s)
    );
end;
$$;

create function public.k8_math_assignment(target_assignment uuid, p_codes jsonb default null)
returns text[] language plpgsql security definer set search_path=''
as $$
declare
    target_course uuid;
    selected text[];
begin
    select a.course_id into target_course from public.gradebook_assignments a where a.id=target_assignment for update;
    if not found or not coalesce(public.gradebook_can_manage(target_course),false) then
        raise exception 'This assignment is unavailable.' using errcode='42501';
    end if;
    if p_codes is not null then
        selected := public.k8_math_codes(p_codes);
        delete from public.k8_math_assignment_standards where assignment_id=target_assignment;
        insert into public.k8_math_assignment_standards(assignment_id,code)
            select target_assignment,unnest(selected);
    end if;
    return (select coalesce(array_agg(code order by code),'{}')
        from public.k8_math_assignment_standards where assignment_id=target_assignment);
end;
$$;

revoke all on function public.k8_math_codes(jsonb),public.k8_math_catalog(),public.k8_math_assignment(uuid,jsonb)
    from public,anon,authenticated;
grant execute on function public.k8_math_catalog(),public.k8_math_assignment(uuid,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;

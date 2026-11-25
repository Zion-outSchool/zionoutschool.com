begin;

create or replace function public.portal_delete_student(target_student uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
    if public.current_portal_role() is distinct from 'admin' then
        raise exception 'Administrator access is required to delete a student.' using errcode = '42501';
    end if;

    perform 1 from public.students where id = target_student for update;
    if not found then
        raise exception 'This student record was already removed. Reload Student Records.' using errcode = '22023';
    end if;

    -- Serialize against grade edits, finalization and imports for affected courses.
    perform 1 from public.gradebook_courses c
    where exists (select 1 from public.gradebook_enrollments e where e.course_id = c.id and e.student_id = target_student)
    order by c.id for update of c;

    if to_regclass('public.gradebook_google_courses') is not null then
        update public.gradebook_google_courses google
        set student_matches = google.student_matches - array(
            select m.key
            from jsonb_each_text(google.student_matches) m
            join public.gradebook_enrollments e on e.id::text = m.value and e.course_id = google.course_id
            where e.student_id = target_student
        )
        where exists (select 1 from public.gradebook_enrollments e
            where e.course_id = google.course_id and e.student_id = target_student);
    end if;

    delete from public.gradebook_history h using public.gradebook_enrollments e
        where h.enrollment_id = e.id and e.student_id = target_student;
    delete from public.gradebook_final_courses where student_id = target_student;
    delete from public.gradebook_marks m using public.gradebook_enrollments e
        where m.enrollment_id = e.id and e.student_id = target_student;
    delete from public.gradebook_enrollments where student_id = target_student;

    delete from public.registration_review_emails n using public.registration_change_requests r
        where n.request_id = r.id and r.student_id = target_student;
    delete from public.registration_change_requests where student_id = target_student;
    update public.registration_records set student_id = null where student_id = target_student;

    -- Planner rows, messages and student-news recipients use their existing cascading foreign keys.
    delete from public.grade_reports where student_id = target_student;
    delete from public.students where id = target_student;
end;
$$;

revoke all on function public.portal_delete_student(uuid) from public, anon, authenticated;
grant execute on function public.portal_delete_student(uuid) to authenticated;

commit;

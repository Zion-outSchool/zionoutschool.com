begin;

create or replace function public.portal_delete_course(target_course uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
    if public.current_portal_role() is distinct from 'admin' then
        raise exception 'Administrator access is required to delete a class.' using errcode = '42501';
    end if;

    -- Serialize against grade edits, finalization, and imports for this course.
    perform 1 from public.gradebook_courses where id = target_course for update;
    if not found then
        raise exception 'This class was already removed. Reload the gradebook.' using errcode = '22023';
    end if;

    delete from public.gradebook_history where course_id = target_course;
    delete from public.gradebook_final_courses where course_id = target_course;
    delete from public.gradebook_marks where course_id = target_course;
    delete from public.gradebook_assignments where course_id = target_course;
    delete from public.communication_posts where course_id = target_course;
    delete from public.gradebook_enrollments where course_id = target_course;
    delete from public.gradebook_courses where id = target_course;
end;
$$;

revoke all on function public.portal_delete_course(uuid) from public, anon, authenticated;
grant execute on function public.portal_delete_course(uuid) to authenticated;

commit;

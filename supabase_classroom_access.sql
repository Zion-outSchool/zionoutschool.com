begin;

-- Apply after the gradebook and communications schemas.
create or replace function public.portal_can_edit_graduation(target_student uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
    select coalesce(public.current_portal_role() = 'staff'
        or public.communication_staff_can_access(target_student), false);
$$;
revoke all on function public.portal_can_edit_graduation(uuid) from public, anon;
grant execute on function public.portal_can_edit_graduation(uuid) to authenticated;

alter policy "Portal users can read allowed students" on public.students
using (
    public.current_portal_role() = 'staff'
    or public.communication_staff_can_access(id)
    or (public.current_portal_role() = 'family' and family_id = auth.uid())
);

alter policy "Users can read their own portal profile" on public.portal_users
using (id = auth.uid() or public.current_portal_role() in ('admin', 'staff'));

drop policy if exists gradebook_enrollment_manage on public.gradebook_enrollments;
drop policy if exists gradebook_enrollment_roster_read on public.gradebook_enrollments;
create policy gradebook_enrollment_roster_read on public.gradebook_enrollments
for select to authenticated using (public.gradebook_can_manage(course_id));
drop policy if exists gradebook_enrollment_admin_manage on public.gradebook_enrollments;
create policy gradebook_enrollment_admin_manage on public.gradebook_enrollments
for all to authenticated
using (public.current_portal_role() = 'admin')
with check (public.current_portal_role() = 'admin');

alter policy gradebook_finals_read on public.gradebook_final_courses
using (
    public.current_portal_role() = 'staff'
    or public.communication_staff_can_access(student_id)
    or public.communication_family_can_access(student_id, auth.uid())
);

alter policy "Staff can insert graduation plan entries" on public.graduation_plan_entries
with check (public.portal_can_edit_graduation(student_id));
alter policy "Staff can update graduation plan entries" on public.graduation_plan_entries
using (public.portal_can_edit_graduation(student_id))
with check (public.portal_can_edit_graduation(student_id));

alter policy "Staff can insert graduation milestones" on public.graduation_milestones
with check (public.portal_can_edit_graduation(student_id));
alter policy "Staff can update graduation milestones" on public.graduation_milestones
using (public.portal_can_edit_graduation(student_id))
with check (public.portal_can_edit_graduation(student_id));

commit;

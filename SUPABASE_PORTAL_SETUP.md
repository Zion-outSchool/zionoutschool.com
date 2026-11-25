# Supabase Family Portal Setup

This site uses Supabase Auth for the Family Portal.

- Project URL: `https://zwoivkqmnriwtokpbmdo.supabase.co`
- Frontend key type: publishable key
- Login method: email and password
- Account model: one Auth user per person or family
- Roles: `family`, `admin`, `teacher`, `staff`

Do not put the Supabase `service_role` key in this repository or in browser code.

## Updating an Existing Portal

Apply these files in order after the core portal and planner tables exist.

1. [Family visibility and private report PDFs](supabase_family_visibility_repair.sql)
2. [Portal accounts and invitations](supabase_portal_accounts.sql)
3. [Graduation final grades](supabase_graduation_final_grade.sql)
4. [Teacher gradebook](supabase_gradebook.sql)
5. [Registration records](supabase_registration_records.sql)
6. [School communications](supabase_communications.sql)
7. [Classroom access](supabase_classroom_access.sql)
8. [Administrator account repair tools](supabase_portal_account_management.sql)
9. [Registration review workflow](supabase_registration_review.sql)
10. [Student News and weekly newsletters](supabase_newsletter.sql)

After changing the registration records schema, apply the registration review script again so the read function includes approved corrections. Deploy the updated `communication-email` function after applying the review migration. The existing email job sends review links to active administrators with confirmed emails.

After the database update, follow the [invitation setup](#deploying-in-app-invitations) and the [registration sync setup](apps-script/registration/README.md). Use fictional records to verify account activation, grade finalization, registration delivery, and family access before releasing the website.

## Suggested First Data Model

Run this in Supabase SQL Editor when you are ready to publish grade reports from Supabase.

```sql
create table if not exists public.portal_users (
    id uuid primary key references auth.users(id) on delete cascade,
    display_name text not null,
    family_name text,
    role text not null default 'family',
    active boolean not null default true,
    constraint portal_users_role_check check (role in ('family', 'admin', 'teacher', 'staff')),
    created_at timestamptz not null default now()
);

create table if not exists public.students (
    id uuid primary key default gen_random_uuid(),
    family_id uuid references public.portal_users(id) on delete set null,
    first_name text not null,
    preferred_name text,
    last_name text not null,
    grade_level text,
    created_at timestamptz not null default now()
);

create table if not exists public.grade_reports (
    id uuid primary key default gen_random_uuid(),
    student_id uuid not null references public.students(id) on delete cascade,
    title text not null,
    school_year text,
    term text,
    report_type text not null default 'grade_report',
    status text not null default 'draft',
    gpa numeric(4, 2),
    credits_earned numeric(5, 2),
    file_url text,
    storage_bucket text default 'grade-reports',
    storage_path text,
    published_at timestamptz,
    updated_at timestamptz not null default now(),
    constraint grade_reports_type_check check (report_type in ('grade_report', 'transcript')),
    constraint grade_reports_status_check check (status in ('draft', 'published', 'archived')),
    constraint grade_reports_file_check check (file_url is not null or storage_path is not null)
);

create table if not exists public.graduation_plan_entries (
    id uuid primary key default gen_random_uuid(),
    student_id uuid not null references public.students(id) on delete cascade,
    requirement_key text not null,
    grade_level text not null,
    course_name text,
    credits numeric(4, 2),
    final_grade text,
    status text not null default 'not_started',
    notes text,
    updated_by uuid references auth.users(id),
    updated_at timestamptz not null default now(),
    constraint graduation_plan_entries_grade_check check (grade_level in ('8', '9', '10', '11', '12')),
    constraint graduation_plan_entries_status_check check (status in ('not_started', 'planned', 'in_progress', 'completed', 'waived')),
    constraint graduation_plan_entries_unique unique (student_id, requirement_key, grade_level)
);

create table if not exists public.graduation_milestones (
    id uuid primary key default gen_random_uuid(),
    student_id uuid not null references public.students(id) on delete cascade,
    milestone_key text not null,
    status text not null default 'not_started',
    completed_on date,
    notes text,
    updated_by uuid references auth.users(id),
    updated_at timestamptz not null default now(),
    constraint graduation_milestones_status_check check (status in ('not_started', 'in_progress', 'completed', 'waived')),
    constraint graduation_milestones_unique unique (student_id, milestone_key)
);

alter table public.portal_users enable row level security;
alter table public.students enable row level security;
alter table public.grade_reports enable row level security;
alter table public.graduation_plan_entries enable row level security;
alter table public.graduation_milestones enable row level security;

create or replace function public.current_portal_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
    select role
    from public.portal_users
    where id = auth.uid()
    and active = true
$$;

create policy "Users can read their own portal profile"
on public.portal_users
for select
to authenticated
using (
    id = auth.uid()
    or public.current_portal_role() in ('admin', 'teacher', 'staff')
);

create policy "Portal users can read allowed students"
on public.students
for select
to authenticated
using (
    public.current_portal_role() in ('admin', 'teacher', 'staff')
    or (public.current_portal_role() = 'family' and family_id = auth.uid())
);

create policy "Staff can create student files"
on public.students
for insert
to authenticated
with check (
    public.current_portal_role() = 'admin'
);

create policy "Staff can update student files"
on public.students
for update
to authenticated
using (
    public.current_portal_role() = 'admin'
)
with check (
    public.current_portal_role() = 'admin'
);

create policy "Portal users can read allowed published reports"
on public.grade_reports
for select
to authenticated
using (
    status = 'published'
    and exists (select 1 from public.students s where s.id = grade_reports.student_id)
);

create policy "Portal users can read allowed graduation plan entries"
on public.graduation_plan_entries
for select
to authenticated
using (
    exists (select 1 from public.students s where s.id = graduation_plan_entries.student_id)
);

create policy "Staff can insert graduation plan entries"
on public.graduation_plan_entries
for insert
to authenticated
with check (
    public.current_portal_role() in ('admin', 'teacher', 'staff')
);

create policy "Staff can update graduation plan entries"
on public.graduation_plan_entries
for update
to authenticated
using (
    public.current_portal_role() in ('admin', 'teacher', 'staff')
)
with check (
    public.current_portal_role() in ('admin', 'teacher', 'staff')
);

create policy "Portal users can read allowed graduation milestones"
on public.graduation_milestones
for select
to authenticated
using (
    exists (select 1 from public.students s where s.id = graduation_milestones.student_id)
);

create policy "Staff can insert graduation milestones"
on public.graduation_milestones
for insert
to authenticated
with check (
    public.current_portal_role() in ('admin', 'teacher', 'staff')
);

create policy "Staff can update graduation milestones"
on public.graduation_milestones
for update
to authenticated
using (
    public.current_portal_role() in ('admin', 'teacher', 'staff')
)
with check (
    public.current_portal_role() in ('admin', 'teacher', 'staff')
);
```

## Private PDF Storage

For grade report PDFs and working transcripts, use a private Supabase Storage bucket named `grade-reports`.

Store each file path on `grade_reports.storage_path`. The website creates a short-lived signed URL after the family logs in.

Run [supabase_family_visibility_repair.sql](supabase_family_visibility_repair.sql) after the core portal tables and planner tables exist. It creates or updates the private bucket and ensures the database applies the same active-family and published-report rules to PDF downloads.

After the gradebook, graduation planner, family visibility, and communications scripts, apply [supabase_classroom_access.sql](supabase_classroom_access.sql). Apply it again if you rerun an earlier script that defines these policies. Administrators manage rosters. Teachers can use student records and graduation tools for students in their assigned classes.

## Creating Portal Logins

Once the in-app workflow is deployed, sign in as an administrator and open **Portal Administration**. Create student records, select a family or teacher role, and enter the recipient's email. For a family, select all of their children before sending the invitation. An existing family can use the same email when a sibling joins. **Manage classrooms** opens the gradebook, where administrators can assign a teacher and enroll students in each course.

Classroom rosters support K–12. Use a graduation requirement for an eligible course when it should appear on the high school transcript. A student may appear on multiple rosters with different teachers.

### Deploying in-app invitations

1. Run [supabase_portal_accounts.sql](supabase_portal_accounts.sql) after the portal tables exist.
2. Deploy [portal-invite](supabase/functions/portal-invite/index.ts) as a Supabase Edge Function. The repository disables legacy gateway JWT verification for this function. The handler validates the caller's Supabase Auth token and requires an active admin profile before sending an invite. It uses the project URL and service role key supplied by the Edge Function runtime. Keep the service role key on the server.
3. Add `https://zionoutschool.com/portal-activate.html` to the [Auth redirect allow list](https://supabase.com/docs/guides/auth/redirect-urls). Keep the standard confirmation link in the invite email template. For a separate test site, set `PORTAL_SITE_URL` on that project's Edge Function and allow its activation path.
4. Confirm [custom SMTP or an Auth email hook](https://supabase.com/docs/guides/auth/auth-smtp) is set up to send to families outside the Supabase project team.

### Creating an administrator or using the dashboard

In Supabase Dashboard:

1. Go to Authentication > Users.
2. Create or invite one user per family, admin, teacher, or staff member.
3. Copy that user's Auth UID.
4. Insert one row into `portal_users` using the Auth UID as `id`.
5. For families, set `role` to `family` and add student rows with `family_id` set to the same Auth UID.
6. For admins, teachers, and staff, set the appropriate `role`.
7. Add published grade report rows linked to the student IDs.

## Graduation Planner

The staff planner page is `graduation-planner.html`.

Admin, teacher, and staff logins can edit `graduation_plan_entries` and `graduation_milestones`.
Family logins can view their student's saved graduation progress from `grade-reports.html`.

The planner structure is based on `Arkansas_Graduation_Planning_Worksheet.xlsx`.

## School Communications

The Communications page opens from the signed-in Family Portal and from Student Records. An administrator can contact any linked family. A teacher can contact families for current classroom rosters. A family can reply to a conversation in the portal or use the reply address on an email. Each conversation is filed by student. Email-only conversations are visible to authorized school users in the student file.

Administrators can publish news, announcements, and PDFs up to 10 MB to active portal accounts. An update can also be emailed individually to each active family with a confirmed address. PDF emails contain a portal link. Families download the PDF after signing in.

Teachers can publish news and announcements for their assigned classes. The audience preview counts linked family accounts and confirmed email addresses. Families see class updates while they have a student enrolled in the class. Administrators can also publish to any class.

### Set up communications in a test environment

1. Apply [supabase_communications.sql](supabase_communications.sql) after the family access, portal account, and gradebook SQL. The migration creates the communication tables and the private `portal-documents` bucket.
2. Deploy [communication-email](supabase/functions/communication-email/index.ts) with the per-function configuration in [supabase/config.toml](supabase/config.toml). Provide the Edge Function secrets listed below. These are separate from Supabase Auth's SMTP configuration.
3. Use a Google Workspace mailbox or an alias that receives replies. In a separate Apps Script project owned by the account that receives replies, install [PortalReplies.gs](apps-script/communications/PortalReplies.gs) and its [manifest](apps-script/communications/appsscript.json). Set these Script Properties, then run `installPortalReplySync` once to authorize the importer and install its one-minute trigger.

   | Script property | Value |
   | --- | --- |
   | `COMMUNICATION_REPLY_ADDRESS` | The dedicated mailbox address used in the Edge Function configuration |
   | `COMMUNICATION_MAILBOX_OWNER` | The account's primary Gmail address when the reply address is an alias |
   | `COMMUNICATION_REPLY_TAG_PREFIX` | Optional tag prefix, such as `zion-portal-`, matching the Edge Function setting |
   | `COMMUNICATION_REPLY_URL` | The deployed Edge Function URL ending in `/communication-email/reply` |
   | `COMMUNICATION_INBOUND_KEY` | The same inbound secret used by the Edge Function |

   The script watches Gmail for new messages and retrieves a body only when the recipient matches the portal's tagged conversation address. Replies are labeled individually after processing. Check `Zion-Portal-Review` for replies that could not be filed and run `retryPortalReplyReview` to retry up to 40 at a time. The portal imports text replies. Original emails and attachments remain in the mailbox.
4. In Supabase, enable the `http` extension and schedule a once-per-minute POST to `/functions/v1/communication-email/deliver` using Supabase Cron. Create Vault entries named `portal_communication_delivery_key` and `portal_communication_delivery_url`, then use this SQL for the job. [Supabase HTTP extension](https://supabase.com/docs/guides/database/extensions/http)

   ```sql
   do $job$
   declare response_status integer;
   begin
       perform set_config('http.curlopt_timeout_msec', '140000', true);
       select status into response_status from extensions.http((
           'POST',
           (select decrypted_secret from vault.decrypted_secrets where name = 'portal_communication_delivery_url'),
           array[extensions.http_header('Authorization', 'Bearer ' ||
               (select decrypted_secret from vault.decrypted_secrets where name = 'portal_communication_delivery_key'))],
           'application/json', '{}'
       )::extensions.http_request);
       if response_status is distinct from 200 then
           raise exception 'Portal email worker returned HTTP %', response_status;
       end if;
   end;
   $job$;
   ```

5. Before enabling school-wide sends, verify with fictional records that a teacher can send to an assigned student's test family, a reply to the email appears in the same conversation as a portal reply, and a different family cannot open the conversation. Verify bulletin delivery and PDF access separately.

| Edge Function setting | Value |
| --- | --- |
| `COMMUNICATION_CLOUDFLARE_ACCOUNT` | Cloudflare account ID |
| `COMMUNICATION_CLOUDFLARE_TOKEN` | A token scoped to Email Sending for that account |
| `COMMUNICATION_FROM` | A sender address on a Cloudflare-enabled domain |
| `COMMUNICATION_REPLY_ADDRESS` | The Google Workspace reply address |
| `COMMUNICATION_REPLY_TAG_PREFIX` | Optional prefix between the plus sign and the conversation token |
| `COMMUNICATION_PORTAL_URL` | The HTTPS URL of `portal-communications.html` |
| `COMMUNICATION_DELIVERY_KEY` | A random scheduler secret of at least 32 characters |
| `COMMUNICATION_INBOUND_KEY` | A separate random inbox secret of at least 32 characters |

An email provider response can be accepted, failed, or uncertain. The delivery worker retries rate-limited requests. If the provider may have accepted a message but the result is unknown, review delivery before sending it again.

### Student News and weekly newsletters

Apply [supabase_newsletter.sql](supabase_newsletter.sql) after the communications migration and before deploying the updated `communication-email` function. Deploy the website changes with the function. Use the existing scheduled `/deliver` request. Each run checks for due issues before draining the existing email queue.

Teachers and administrators open **Communications → Submit an Update**. Student News appears under **Communications → Student News** for the students selected in the submission. Families use their existing sign-in to select one of their linked students. Teachers can select students they teach. Checking **Include in the school-wide newsletter** sends the same text, links, and photos to the school-wide issue. The issue omits the selected student list. Teachers can edit or withdraw a newsletter submission until the Thursday cutoff. After the cutoff they can remove the targeted update from Student News.

Newsletter collection and delivery start disabled. To enable it, set `first_issue_on` to the first Friday you want to send an issue. Pick a Friday with an upcoming submission deadline. The weekly deadline is **Thursday at 5 p.m. Eastern** and delivery queues from **Friday at 9 a.m. Eastern**, including during daylight saving time. Empty issues are skipped. Published issues appear under **Communications → Weekly Newsletters** and are queued individually for active families with confirmed email addresses.

```sql
-- Replace the example with your chosen first Friday.
update public.newsletter_settings set first_issue_on = date '2027-01-15' where singleton;
```

Set `first_issue_on` to `null` to pause creation of new issues. Existing queued emails continue through the delivery queue. Newsletter photos in email use seven-day links. Archived newsletters remain available through the portal, where the browser requests fresh links after sign-in.

In a test environment, save one student-only update and one newsletter entry with a link and photo. Verify that an unrelated family cannot see the student-only update or its photo. Verify that the issue appears once and sends once per confirmed family after the worker runs, and that an emailed issue link returns the family to the correct issue after sign-in.

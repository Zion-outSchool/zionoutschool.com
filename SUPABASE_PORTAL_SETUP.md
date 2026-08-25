# Supabase Family Portal Setup

This site uses Supabase Auth for the Family Portal.

- Project URL: `https://zwoivkqmnriwtokpbmdo.supabase.co`
- Frontend key type: publishable key
- Login method: email and password
- Account model: one Auth user per person or family
- Roles: `family`, `admin`, `teacher`, `staff`

Do not put the Supabase `service_role` key in this repository or in browser code.

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
    family_id uuid not null references public.portal_users(id) on delete cascade,
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

alter table public.portal_users enable row level security;
alter table public.students enable row level security;
alter table public.grade_reports enable row level security;

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
    or public.current_portal_role() in ('admin', 'staff')
);

create policy "Portal users can read allowed students"
on public.students
for select
to authenticated
using (
    family_id = auth.uid()
    or public.current_portal_role() in ('admin', 'teacher', 'staff')
);

create policy "Portal users can read allowed published reports"
on public.grade_reports
for select
to authenticated
using (
    status = 'published'
    and (
        public.current_portal_role() in ('admin', 'teacher', 'staff')
        or exists (
            select 1
            from public.students
            where students.id = grade_reports.student_id
            and students.family_id = auth.uid()
        )
    )
);
```

## Private PDF Storage

For grade report PDFs and working transcripts, use a private Supabase Storage bucket named `grade-reports`.

Store each file path on `grade_reports.storage_path`. The website creates a short-lived signed URL after the family logs in.

You can create the bucket in Storage, or run:

```sql
insert into storage.buckets (id, name, public)
values ('grade-reports', 'grade-reports', false)
on conflict (id) do update set public = false;

create policy "Portal users can read allowed grade report files"
on storage.objects
for select
to authenticated
using (
    bucket_id = 'grade-reports'
    and exists (
        select 1
        from public.grade_reports
        join public.students on students.id = grade_reports.student_id
        where grade_reports.storage_path = storage.objects.name
        and grade_reports.status = 'published'
        and (
            public.current_portal_role() in ('admin', 'teacher', 'staff')
            or students.family_id = auth.uid()
        )
    )
);
```

## Creating Portal Logins

In Supabase Dashboard:

1. Go to Authentication > Users.
2. Create or invite one user per family, admin, teacher, or staff member.
3. Copy that user's Auth UID.
4. Insert one row into `portal_users` using the Auth UID as `id`.
5. For families, set `role` to `family` and add student rows with `family_id` set to the same Auth UID.
6. For admins, teachers, and staff, set the appropriate `role`.
7. Add published grade report rows linked to the student IDs.

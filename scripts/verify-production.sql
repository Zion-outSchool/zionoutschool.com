-- Read-only release audit. Expected to return only feature status, never student records or secrets.
with checks(feature, live) as (
    values
      ('Workroom database and queue',
        to_regclass('public.workroom_jobs') is not null and exists (
            select 1 from information_schema.columns
            where table_schema='public' and table_name='workroom_jobs' and column_name='available_at'
        )),
      ('Workroom minute worker', exists (
            select 1 from cron.job where jobname='zion-ai-workroom' and active
        ) and (select count(*)=2 from vault.secrets
                where name in ('zion_workroom_worker_url','zion_workroom_worker_secret'))),
      ('Administrator student and class deletion',
        to_regprocedure('public.portal_delete_student(uuid)') is not null
        and to_regprocedure('public.portal_delete_course(uuid)') is not null),
      ('Family current grades and grade alerts',
        to_regprocedure('public.gradebook_family_courses(uuid)') is not null
        and to_regclass('public.gradebook_alert_events') is not null),
      ('K–8 Learning Record and math standards',
        to_regprocedure('public.middle_school(text,jsonb)') is not null
        and to_regprocedure('public.ms_high_school_courses(uuid)') is not null
        and to_regclass('public.k8_math_standards') is not null),
      ('Curriculum tracker and yearly proficiency settings',
        to_regprocedure('public.curriculum_tracker(text,jsonb)') is not null
        and to_regclass('public.ct_year_settings') is not null
        and to_regclass('public.ct_marks') is not null
        and to_regclass('public.ct_reports') is not null),
      ('Class dates and finalization rule', exists (
            select 1 from pg_trigger where tgname='gradebook_check_finalization_date' and tgenabled <> 'D'
        ) and (select count(*)=2 from information_schema.columns where table_schema='public'
            and table_name='gradebook_courses' and column_name in ('starts_on','ends_on'))),
      ('Newsletter PDF attachments',
        to_regprocedure('public.news_can_read_pdf(text)') is not null
        and exists (select 1 from storage.buckets where id='portal-news-pdfs' and not public))
)
select feature, case when live then 'live' else 'missing or pending' end as status
from checks order by feature;

-- Projects Tracker: IFRS 16 post-implementation review finished (23 Nov 2026)
-- Paste into Supabase > SQL Editor > New query and press Run. Safe to run more than once.
-- Source: IFRS Foundation project page "Post-implementation Review of IFRS 16 Leases"
-- https://www.ifrs.org/content/ifrs/home/projects/work-plan/post-implementation-review-of-ifrs-16-leases.html

-- 1. The project's description now says what the review found and what comes next
update public.std_projects
set description = 'Stage: Research project, added to the work plan Nov 2026 · The IFRS 16 post-implementation review is complete: IFRS 16 is working as intended, with areas for targeted improvement. To explore: lower lessee costs for remeasuring the lease liability and discount rates; how IFRS 16 and IFRS 9 apply to rent concessions. No start or target dates published yet.',
    url = 'https://www.ifrs.org/content/ifrs/home/projects/work-plan/post-implementation-review-of-ifrs-16-leases.html',
    updated_at = now()
where id = 'iasb-targeted-improvements-to-ifrs-16-leases-66f1';

-- 2. The date on the calendar: the day the review's Feedback Statement came out
insert into public.std_events (project_id, type, title, start_date, end_date, url, notes, source, created_by)
select 'iasb-targeted-improvements-to-ifrs-16-leases-66f1', 'other', 'PIR finished: Project Summary and Feedback Statement published',
       '2026-11-23', null,
       'https://www.ifrs.org/content/ifrs/home/projects/work-plan/post-implementation-review-of-ifrs-16-leases.html',
       'IASB concluded IFRS 16 is working as intended and identified areas for targeted improvements.', 'manual', 'import: IFRS Foundation page'
where exists (select 1 from public.std_projects where id = 'iasb-targeted-improvements-to-ifrs-16-leases-66f1')
on conflict do nothing;

-- check: expected 1 project row and 1 date
select (select count(*) from public.std_projects where id = 'iasb-targeted-improvements-to-ifrs-16-leases-66f1') as project,
       (select count(*) from public.std_events where project_id = 'iasb-targeted-improvements-to-ifrs-16-leases-66f1') as dates;

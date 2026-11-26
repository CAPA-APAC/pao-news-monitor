-- PAO News Monitor - update 23: Standards tab (standard-setter tracker)
-- Paste this whole file into Supabase > SQL Editor > New query, then press Run. Safe to run more than once.
--
-- The Standards tab follows what the standard setters (IAASB, IESBA, IASB, ISSB, IPSASB ...) are doing:
--   std_projects  one row per standard / project, filed under a PAO (a standard setter)
--   std_events    the dates on it: work plan, exposure draft + call for comments (a period), board meetings,
--                 meetings after the comments, the date the standard is issued, the implementation date ...
--                 A standard's progress line is built from these, so every new date adds a stage by itself.
--   std_scanned   which emails the daily collection has already read for dates (so each is read once)
--
-- Rows are added by hand on the Standards tab (people who may "Add items") or by the daily collection, which
-- reads emails from the standard setters and adds what it finds (marked "From email" so staff can check them).
-- Everyone with access can read; only people with "Add items" can change. std_scanned is private to the collection.

create table if not exists public.std_projects (
  id          text primary key,
  pao_id      text not null references public.paos(id) on delete cascade,
  title       text not null,
  description text,
  url         text,
  status      text not null default 'active' check (status in ('active', 'done', 'withdrawn')),
  source      text not null default 'manual' check (source in ('manual', 'email')),
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists std_projects_pao_idx on public.std_projects (pao_id);

create table if not exists public.std_events (
  id             bigserial primary key,
  project_id     text not null references public.std_projects(id) on delete cascade,
  type           text not null check (type in ('work_plan', 'exposure_draft', 'call_for_comments', 'meeting',
                                               'feedback_meeting', 'issued', 'implementation', 'other')),
  title          text,
  start_date     date not null,
  end_date       date,                    -- only for a period (exposure draft, call for comments); empty = one day
  url            text,
  notes          text,
  source         text not null default 'manual' check (source in ('manual', 'email')),
  source_item_id text,                    -- the email (items.id) it was read from
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint std_events_dates check (end_date is null or end_date >= start_date)
);
create index if not exists std_events_start_idx on public.std_events (start_date);
create index if not exists std_events_project_idx on public.std_events (project_id);
-- the same kind of date on the same days for one standard is stored once (lets the collection re-read an email safely)
create unique index if not exists std_events_once on public.std_events (project_id, type, start_date, coalesce(end_date, start_date));

create table if not exists public.std_scanned (
  item_id    text primary key,
  scanned_at timestamptz not null default now(),
  events     integer not null default 0
);

alter table public.std_projects enable row level security;
alter table public.std_events   enable row level security;
alter table public.std_scanned  enable row level security;
revoke all on public.std_projects, public.std_events, public.std_scanned from anon;
revoke all on public.std_scanned from authenticated;   -- the collection uses the service key, which skips these checks
grant select, insert, update, delete on public.std_projects, public.std_events to authenticated;
grant usage, select on sequence public.std_events_id_seq to authenticated;

drop policy if exists "team reads standards" on public.std_projects;
drop policy if exists "team edits standards" on public.std_projects;
create policy "team reads standards" on public.std_projects for select to authenticated using (public.has_access());
create policy "team edits standards" on public.std_projects for all to authenticated
  using (public.has_perm('add_items')) with check (public.has_perm('add_items'));

drop policy if exists "team reads standard dates" on public.std_events;
drop policy if exists "team edits standard dates" on public.std_events;
create policy "team reads standard dates" on public.std_events for select to authenticated using (public.has_access());
create policy "team edits standard dates" on public.std_events for all to authenticated
  using (public.has_perm('add_items')) with check (public.has_perm('add_items'));

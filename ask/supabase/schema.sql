-- ============================================================
-- Whisper — Supabase schema
-- Run this once in your project: Supabase dashboard → SQL Editor
-- → New query → paste everything → Run.
--
-- Who can do what (enforced by Row Level Security):
--   Visitors  : send a question, read answered questions, read the profile.
--   Owner     : read every question, answer / archive / delete, edit profile.
-- ============================================================

-- ---------- tables ----------
create table if not exists public.questions (
  id          uuid primary key default gen_random_uuid(),
  text        text not null check (char_length(btrim(text)) between 3 and 300),
  status      text not null default 'open' check (status in ('open', 'answered', 'archived')),
  answer      text check (answer is null or char_length(answer) <= 600),
  created_at  timestamptz not null default now(),
  answered_at timestamptz
);
create index if not exists questions_created_at_idx on public.questions (created_at desc);
create index if not exists questions_status_idx on public.questions (status);

create table if not exists public.owners (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table if not exists public.profile (
  id     int primary key default 1 check (id = 1),
  name   text not null default 'Yahya Al Mawali' check (char_length(name) between 1 and 40),
  handle text not null default '@Yahya' check (char_length(handle) between 1 and 31),
  bio    text not null default 'اسألني أي شيء. أجيب عن الأسئلة الجميلة علنًا، والباقي يبقى بيننا.' check (char_length(bio) <= 160)
);
insert into public.profile (id) values (1) on conflict (id) do nothing;

-- ---------- helpers ----------
create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.owners where user_id = auth.uid());
$$;

-- counts for the public stats strip (visitors cannot read open questions themselves)
create or replace function public.public_stats()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'received', count(*),
    'answered', count(*) filter (where status = 'answered')
  ) from public.questions;
$$;

revoke all on function public.is_owner() from public;
revoke all on function public.public_stats() from public;
grant execute on function public.is_owner() to anon, authenticated;
grant execute on function public.public_stats() to anon, authenticated;

-- ---------- row level security ----------
alter table public.questions enable row level security;
alter table public.owners    enable row level security;   -- no policies: unreadable through the API
alter table public.profile   enable row level security;

drop policy if exists "anyone can ask"        on public.questions;
drop policy if exists "read answered or owner" on public.questions;
drop policy if exists "owner updates"          on public.questions;
drop policy if exists "owner deletes"          on public.questions;
drop policy if exists "anyone reads profile"   on public.profile;
drop policy if exists "owner edits profile"    on public.profile;

create policy "anyone can ask" on public.questions
  for insert to anon, authenticated
  with check (status = 'open' and answer is null and answered_at is null);

create policy "read answered or owner" on public.questions
  for select to anon, authenticated
  using (status = 'answered' or public.is_owner());

create policy "owner updates" on public.questions
  for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

create policy "owner deletes" on public.questions
  for delete to authenticated
  using (public.is_owner());

create policy "anyone reads profile" on public.profile
  for select to anon, authenticated using (true);

create policy "owner edits profile" on public.profile
  for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- table privileges: Supabase grants everything by default, so start from nothing
-- and give back only what each role needs (RLS above still filters the rows).
revoke all on public.questions from anon, authenticated;
revoke all on public.profile   from anon, authenticated;
revoke all on public.owners    from anon, authenticated;

grant insert (text) on public.questions to anon, authenticated;   -- visitors fill in the text only
grant select        on public.questions to anon, authenticated;
grant update (status, answer, answered_at) on public.questions to authenticated;
grant delete        on public.questions to authenticated;

grant select on public.profile to anon, authenticated;
grant update (name, handle, bio) on public.profile to authenticated;

-- ============================================================
-- LAST STEP — make yourself the owner.
-- 1. Authentication → Users → Add user → Create new user
--    (your email + a password, tick "Auto Confirm User").
-- 2. Put that same email below and run just this statement.
-- ============================================================
insert into public.owners (user_id)
select id from auth.users where email = 'YOUR_EMAIL_HERE'
on conflict do nothing;

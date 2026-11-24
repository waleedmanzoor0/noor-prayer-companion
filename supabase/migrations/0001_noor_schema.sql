-- Noor initial schema. Apply in Supabase SQL Editor.
-- This starter uses Supabase Auth email OTP and per-user timetable rows.

create extension if not exists pgcrypto;

create table if not exists public.mosques (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  city text not null default 'Nottingham',
  timetable_source text,
  created_at timestamptz not null default now()
);

create table if not exists public.prayer_times (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mosque_id uuid references public.mosques(id) on delete set null,
  prayer_date date not null,
  fajr time not null,
  sunrise time,
  dhuhr time not null,
  asr time not null,
  maghrib time not null,
  isha time not null,
  source text not null default 'User-imported local mosque timetable',
  created_at timestamptz not null default now(),
  unique(user_id, prayer_date)
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  location text not null default 'Nottingham, UK',
  timezone text not null default 'Europe/London',
  asr_school text not null default 'Hanafi',
  notifications_enabled boolean not null default true,
  prayer_notification_preferences jsonb not null default
    '{"Fajr":{"enabled":true,"mode":"both"},"Dhuhr":{"enabled":true,"mode":"both"},"Asr":{"enabled":true,"mode":"both"},"Maghrib":{"enabled":true,"mode":"both"},"Isha":{"enabled":true,"mode":"both"}}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  prayer_name text not null,
  prayer_date date not null,
  notification_type text not null,
  delivery_status text not null default 'queued',
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, prayer_name, prayer_date, notification_type)
);

alter table public.mosques enable row level security;
alter table public.prayer_times enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.user_preferences enable row level security;
alter table public.notification_logs enable row level security;

-- Mosque directory can be read by all app visitors; writes are service/admin-only.
drop policy if exists "Mosques are readable" on public.mosques;
create policy "Mosques are readable" on public.mosques for select using (true);

drop policy if exists "Users read own prayer times" on public.prayer_times;
create policy "Users read own prayer times" on public.prayer_times for select
  to authenticated using (auth.uid() = user_id);
drop policy if exists "Users insert own prayer times" on public.prayer_times;
create policy "Users insert own prayer times" on public.prayer_times for insert
  to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users update own prayer times" on public.prayer_times;
create policy "Users update own prayer times" on public.prayer_times for update
  to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users delete own prayer times" on public.prayer_times;
create policy "Users delete own prayer times" on public.prayer_times for delete
  to authenticated using (auth.uid() = user_id);

drop policy if exists "Users manage own subscriptions" on public.push_subscriptions;
drop policy if exists "Users read own subscriptions" on public.push_subscriptions;
create policy "Users read own subscriptions" on public.push_subscriptions for select
  to authenticated using (auth.uid() = user_id);
drop policy if exists "Users insert own subscriptions" on public.push_subscriptions;
create policy "Users insert own subscriptions" on public.push_subscriptions for insert
  to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users update own subscriptions" on public.push_subscriptions;
create policy "Users update own subscriptions" on public.push_subscriptions for update
  to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users delete own subscriptions" on public.push_subscriptions;
create policy "Users delete own subscriptions" on public.push_subscriptions for delete
  to authenticated using (auth.uid() = user_id);

drop policy if exists "Users manage own preferences" on public.user_preferences;
drop policy if exists "Users read own preferences" on public.user_preferences;
create policy "Users read own preferences" on public.user_preferences for select
  to authenticated using (auth.uid() = user_id);
create policy "Users insert own preferences" on public.user_preferences for insert
  to authenticated with check (auth.uid() = user_id);
create policy "Users update own preferences" on public.user_preferences for update
  to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users read own notification logs" on public.notification_logs;
create policy "Users read own notification logs" on public.notification_logs for select
  to authenticated using (auth.uid() = user_id);

-- Unique constraint for CSV upsert.
create index if not exists prayer_times_date_idx on public.prayer_times(prayer_date);
create index if not exists subscriptions_user_idx on public.push_subscriptions(user_id);

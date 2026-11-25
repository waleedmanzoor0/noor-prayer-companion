-- Save the user's postcode and madhhab independently from the selected mosque.
alter table public.user_preferences
  add column if not exists postcode text,
  add column if not exists madhhab text not null default 'Hanafi';

alter table public.user_preferences
  drop constraint if exists user_preferences_madhhab_check;
alter table public.user_preferences
  add constraint user_preferences_madhhab_check
  check (madhhab in ('Hanafi','Maliki','Shafi''i','Hanbali'));

-- Masjidi directory identity and capability metadata.
alter table public.mosques
  add column if not exists masjidi_id text,
  add column if not exists masjidi_supported boolean not null default false,
  add column if not exists masjidi_db_supported boolean not null default false,
  add column if not exists masjidi_last_synced_at timestamptz;

create unique index if not exists mosques_masjidi_id_unique
  on public.mosques(masjidi_id)
  where masjidi_id is not null;

create table if not exists public.masjidi_feed_cache (
  masjidi_id text not null,
  calendar_year integer not null,
  calendar_month integer not null check (calendar_month between 1 and 12),
  last_requested_at timestamptz not null,
  last_fetched_at timestamptz,
  payload jsonb,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (masjidi_id, calendar_year, calendar_month)
);

alter table public.masjidi_feed_cache enable row level security;
revoke all on table public.masjidi_feed_cache from public, anon, authenticated;
grant all privileges on table public.masjidi_feed_cache to service_role;

drop policy if exists "Service role manages Masjidi feed cache" on public.masjidi_feed_cache;
create policy "Service role manages Masjidi feed cache"
on public.masjidi_feed_cache
for all
to service_role
using (true)
with check (true);

comment on column public.user_preferences.postcode is 'User-entered UK postcode used to discover nearby mosques';
comment on column public.user_preferences.madhhab is 'User-selected madhhab: Hanafi, Maliki, Shafii, or Hanbali';
comment on column public.mosques.masjidi_id is 'Masjidi API masjid_id for directory and timetable lookups';
comment on table public.masjidi_feed_cache is 'Private shared monthly timetable cache to minimise repeated Masjidi API requests';

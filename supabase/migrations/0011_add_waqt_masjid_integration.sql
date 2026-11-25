-- Waqt UK integration: one mosque slug per cached API payload.
-- The API is public/free and asks consumers to fetch each mosque no more than hourly.
alter table public.mosques
  add column if not exists waqt_slug text,
  add column if not exists waqt_url text,
  add column if not exists waqt_last_requested_at timestamptz,
  add column if not exists waqt_last_fetched_at timestamptz,
  add column if not exists waqt_revision bigint,
  add column if not exists waqt_payload jsonb;

create unique index if not exists mosques_waqt_slug_unique
  on public.mosques(waqt_slug)
  where waqt_slug is not null;

alter table public.prayer_times
  add column if not exists maghrib_jamaat time,
  add column if not exists calculated_begins text[] not null default '{}';

comment on column public.mosques.waqt_slug is 'Waqt UK masjid slug used for https://waqt.uk/api/v1/<slug>.json';
comment on column public.mosques.waqt_payload is 'Cached public Waqt API response. Refresh no more than once per mosque per hour.';
comment on column public.prayer_times.calculated_begins is 'Prayer names whose Waqt start times were calculated rather than printed on the mosque timetable.';

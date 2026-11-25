-- Shared per-masjid Waqt feed cache. This enforces Waqt's one-request-per-hour fair-use rule
-- across all Noor users, including when a masjid is not yet registered in public.mosques.

create table if not exists public.waqt_feed_cache (
  slug text primary key,
  last_requested_at timestamptz not null,
  last_fetched_at timestamptz,
  payload jsonb,
  last_error text,
  updated_at timestamptz not null default now()
);

alter table public.waqt_feed_cache enable row level security;
revoke all on table public.waqt_feed_cache from public, anon, authenticated;
grant all privileges on table public.waqt_feed_cache to service_role;

comment on table public.waqt_feed_cache is
  'Private server-side Waqt API response cache, keyed by mosque slug; enforces at most one request per mosque per hour.';

drop policy if exists "Service role manages Waqt feed cache" on public.waqt_feed_cache;
create policy "Service role manages Waqt feed cache"
on public.waqt_feed_cache
for all
to service_role
using (true)
with check (true);

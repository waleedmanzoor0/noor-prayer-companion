-- Incremental hardening for Noor's existing schema.
-- The initial schema was applied through the Supabase SQL Editor.

begin;

grant usage on schema public to anon, authenticated;

revoke all on table
  public.mosques,
  public.prayer_times,
  public.push_subscriptions,
  public.user_preferences,
  public.notification_logs
from public, anon, authenticated;

-- The public directory is read-only to app visitors.
grant select on table public.mosques to anon, authenticated;

-- Signed-in users can manage only their own timetable rows (RLS below).
grant select, insert, update on table public.prayer_times to authenticated;

drop policy if exists "Users read own prayer times" on public.prayer_times;
create policy "Users read own prayer times" on public.prayer_times
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users insert own prayer times" on public.prayer_times;
create policy "Users insert own prayer times" on public.prayer_times
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Users update own prayer times" on public.prayer_times;
create policy "Users update own prayer times" on public.prayer_times
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete own prayer times" on public.prayer_times;
create policy "Users delete own prayer times" on public.prayer_times
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users read own subscriptions" on public.push_subscriptions;
create policy "Users read own subscriptions" on public.push_subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users insert own subscriptions" on public.push_subscriptions;
create policy "Users insert own subscriptions" on public.push_subscriptions
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Users update own subscriptions" on public.push_subscriptions;
create policy "Users update own subscriptions" on public.push_subscriptions
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete own subscriptions" on public.push_subscriptions;
create policy "Users delete own subscriptions" on public.push_subscriptions
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users read own preferences" on public.user_preferences;
create policy "Users read own preferences" on public.user_preferences
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users insert own preferences" on public.user_preferences;
create policy "Users insert own preferences" on public.user_preferences
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Users update own preferences" on public.user_preferences;
create policy "Users update own preferences" on public.user_preferences
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users read own notification logs" on public.notification_logs;
create policy "Users read own notification logs" on public.notification_logs
  for select to authenticated using ((select auth.uid()) = user_id);

-- Internal event-trigger helper: do not expose execution to app roles.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- Cover the mosque foreign key lookup.
create index if not exists prayer_times_mosque_id_idx
  on public.prayer_times(mosque_id);

commit;

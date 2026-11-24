-- The server-side Edge Functions use the Supabase service_role.
-- Restore its full table privileges while leaving anon/authenticated access
-- controlled by explicit grants and per-user RLS policies.

grant all privileges on table
  public.mosques,
  public.prayer_times,
  public.push_subscriptions,
  public.user_preferences,
  public.notification_logs
to service_role;

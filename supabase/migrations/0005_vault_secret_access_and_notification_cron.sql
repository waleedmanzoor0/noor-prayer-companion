-- The project-specific VAPID and cron secrets must be stored first in
-- Supabase Vault under these exact names:
--   noor_vapid_public_key
--   noor_vapid_private_key
--   noor_cron_secret
--   noor_project_url
--
-- The values are not committed to this repository.

create or replace function public.noor_get_vault_secret(secret_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ds.decrypted_secret
  from vault.decrypted_secrets as ds
  where ds.name = secret_name
  limit 1
$$;

revoke all on function public.noor_get_vault_secret(text)
  from public, anon, authenticated;
grant execute on function public.noor_get_vault_secret(text)
  to service_role;

-- Replace an older copy of this job, if one exists.
select cron.unschedule(jobid)
from cron.job
where jobname = 'noor-prayer-notification-dispatch';

-- Invoke the dispatcher once each minute. The custom header is checked by
-- the Edge Function against the value stored in Vault.
select cron.schedule(
  'noor-prayer-notification-dispatch',
  '* * * * *',
  $job$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'noor_project_url'
      ) || '/functions/v1/dispatch-prayer-notifications',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'noor_cron_secret'
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    );
  $job$
);

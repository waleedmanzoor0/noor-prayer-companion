# Noor — Prayer Companion

A React + TypeScript progressive web app for Nottingham prayer times, timetable imports, and prayer reminders.

**Live app:** https://waleedmanzoor.co.uk/noor-prayer-companion/

## Current deployment

- Frontend: GitHub Pages, deployed automatically from `main` by `.github/workflows/deploy.yml`.
- Supabase project: `Noor` (EU West / Ireland).
- Client uses the Supabase project URL and a publishable key. Publishable keys are designed for browser use; never place a Supabase secret/service-role key in frontend code.
- Vite base path and PWA assets are configured for `/noor-prayer-companion/`.
- The Pages build supplies the public VAPID key as `VITE_VAPID_PUBLIC_KEY`.

## Supabase database

The initial schema is in `supabase/migrations/0001_noor_schema.sql`. It creates:

- `mosques`
- `prayer_times`
- `push_subscriptions`
- `user_preferences`
- `notification_logs`

The incremental access and security hardening is in `supabase/migrations/0002_api_access_and_security_hardening.sql`. Row Level Security is enabled; mosque entries are readable, authenticated users can manage their own prayer timetable rows, and device subscriptions/preferences/notification logs are not directly exposed to app clients.

`0003_restore_service_role_table_access.sql` restores the explicit table privileges required by trusted server-side Edge Functions. It does not grant those privileges to `anon` or ordinary `authenticated` users.

## Frontend configuration

The GitHub Pages workflow supplies:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_VAPID_PUBLIC_KEY`

For local development, copy `.env.example` to `.env.local` and fill in the values. Keep private secrets out of source control.

## Authentication configuration

In Supabase Dashboard → Authentication → URL Configuration:

- Site URL: `https://waleedmanzoor.co.uk/noor-prayer-companion/`
- Allowed Redirect URL: `https://waleedmanzoor.co.uk/noor-prayer-companion/`

The live project's Site URL and redirect allow-list have been configured.

Noor uses eight-digit email OTP sign-in. In Supabase Dashboard → Authentication → Email Templates → Magic Link, set the subject to `Your Noor sign-in code` and replace the template body with an email containing `{{ .Token }}` (not `{{ .ConfirmationURL }}`). The app sends the code with `signInWithOtp()` and verifies it with `verifyOtp({ email, token, type: "email" })`.

## Prayer timetable

Noor uses the selected mosque's published timetable rather than estimating times. The Fazilat Masjid timetable for November 2026 is imported for 1–30 November.

- Prayer start times power the next-prayer countdown and scheduled notifications.
- Fajr, Dhuhr, Asr and Isha Jamaat times are stored and displayed separately.
- Sunrise is shown separately; the supplied timetable does not list a separate Maghrib Jamaat time.
- Phase 1 includes a month calendar with selectable dates. Future months will show available data after their official timetable is imported.

To import a mosque timetable, sign in and open Settings → Mosque Timetable Management. CSV columns are:

```csv
date,fajr,sunrise,dhuhr,asr,maghrib,isha,fajr_jamaat,dhuhr_jamaat,asr_jamaat,isha_jamaat,source
2026-12-01,HH:MM,HH:MM,HH:MM,HH:MM,HH:MM,HH:MM,HH:MM,HH:MM,HH:MM,HH:MM,Official mosque timetable
```

Use YYYY-MM-DD dates and 24-hour HH:MM values. Jamaat columns are optional; do not enter estimated values.
## Waqt UK mosque timetables

Noor can connect to Waqt UK without an API key. Users open Waqt's directory, choose a mosque, then paste that mosque's Waqt page URL or slug into Settings (or the first-time setup flow).

- Waqt publishes a JSON file for one mosque at `https://waqt.uk/api/v1/<slug>.json`.
- The file contains today's and tomorrow's times, the mosque page URL, a revision, London timezone, prayer starts, and optional Jamaat times.
- Waqt does not provide a downloadable API for every mosque. Noor therefore uses Waqt's own nearby finder/directory for discovery and requires the user to choose the specific mosque page.
- The secured `waqt-timetable` Edge Function fetches the feed and caches it per mosque. A private `waqt_feed_cache` table enforces no more than one request per mosque per hour across Noor users.
- Noor converts Waqt's prayer-specific clock notation into UK 24-hour times, preserves separate Jamaat fields, and marks entries listed in `calculatedBegins` as **Calculated start**.
- Waqt's special Maghrib/iftar convention is applied when there is no `jMaghrib`.
- Noor displays **Times from Waqt** with a link to Waqt wherever Waqt times appear.
- Waqt supplies today and tomorrow only; it is not a monthly timetable API. The calendar shows only dates available in Noor's database. Existing manually imported Fazilat Masjid rows remain intact unless a Waqt page for that mosque is explicitly connected.

Useful links:
- Waqt UK: https://waqt.uk/
- Nottingham directory: https://waqt.uk/nottingham/
- Developer documentation: https://waqt.uk/developers/

Related migrations:
- `0011_add_waqt_masjid_integration.sql`
- `0012_create_waqt_feed_cache.sql`


## Edge Functions and push delivery

The following functions are deployed:

- `register-push` — registers a signed-in user's browser push subscription.
- `test-notification` — sends a test push to the signed-in user's registered devices.
- `dispatch-prayer-notifications` — checks the current Europe/London minute and sends prayer notifications.

They use Supabase's injected publishable/secret key environment dictionaries, with legacy-key fallbacks.

The existing Noor project stores these values encrypted in Supabase Vault:

- `noor_vapid_public_key`
- `noor_vapid_private_key`
- `noor_cron_secret`
- `noor_project_url`

The public VAPID key is included in the frontend build. The private VAPID key and cron secret are never placed in GitHub or browser code. The Edge Functions retrieve them through a Vault-reading RPC that is executable only by the `service_role`.

The scheduled job `noor-prayer-notification-dispatch` is active and invokes the dispatch function every minute through `pg_cron` and `pg_net`. The dispatcher endpoint performs its own `x-cron-secret` check.

Related migrations:

- `0004_enable_notification_extensions.sql`
- `0005_vault_secret_access_and_notification_cron.sql`
- `0006_allow_users_to_manage_own_preferences.sql`
- `0007_add_jamaat_time_columns.sql`
- `0008_add_preferred_mosque_to_user_preferences.sql`
- `0009_share_selected_mosque_timetable_for_reading.sql`

The scheduled dispatcher has been smoke-tested and returned HTTP 200. Actual prayer notifications still require a verified timetable row and at least one subscribed device.

## iPhone installation

1. Open the HTTPS live app in Safari on iPhone.
2. Tap Share → Add to Home Screen.
3. Launch Noor from the Home Screen.
4. Sign in, enable notifications, and send a test notification.

Web Push on iOS requires iOS/iPadOS 16.4 or later and a Home Screen web app. Delivery depends on iOS permission, settings, connectivity, and push service availability. A web push notification cannot guarantee custom Adhan audio playing in the background.

## Local development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

## Known limitations

- CSV parsing is simple and does not support quoted commas.
- The month calendar can browse all dates currently imported for the selected mosque; it does not yet automatically retrieve future months from the mosque.
- Prayer reminder preferences and some display preferences are currently stored locally rather than synchronised across devices.
- Background Adhan audio is not implemented.
- A production release should add stronger timetable administration, subscription cleanup, delivery observability, backup/restore, and end-to-end testing.

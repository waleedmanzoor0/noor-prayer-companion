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
## Nearby mosque discovery

Signed-in users can choose **Find mosques near me** during setup or from Settings. Noor asks the device for location permission only when the user taps the button, then sends the coordinates to the authenticated `nearby-mosques` Edge Function. That function queries OpenStreetMap's Overpass API and returns named mosque listings within a user-selected 3, 6 or 10 km radius, sorted by distance.

The app does not save the device coordinates in the Noor profile. The coordinates are used in the search request and are forwarded to OpenStreetMap's public map-data service. OpenStreetMap attribution is displayed with the results.

A nearby map listing is **not** treated as a verified prayer timetable. Noor checks whether a selected mosque has actual timetable rows in the database. If it does, the rows are linked/copied to the signed-in user's account. If it does not, Noor clearly indicates that a verified timetable is not yet available; it does not calculate or invent times from map data.

The functions are:
- `nearby-mosques` — authenticated, read-only search over OpenStreetMap plus timetable-availability matching.
- `register-mosque` — authenticated registration of a selected public mosque listing in Noor's directory.

Related migration: `0010_add_openstreetmap_mosque_metadata.sql`.

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

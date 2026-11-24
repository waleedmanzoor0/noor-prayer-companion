# Noor — Prayer Companion

A React + TypeScript progressive web app for Nottingham prayer times, timetable imports, and prayer reminders.

**Live app:** https://waleedmanzoor.co.uk/noor-prayer-companion/

## Current deployment

- Frontend: GitHub Pages, deployed automatically from `main` by `.github/workflows/deploy.yml`.
- Supabase project: `Noor` (EU West / Ireland).
- Client uses the Supabase project URL and a publishable key. Publishable keys are designed for browser use; never place a Supabase secret/service-role key in frontend code.
- Vite base path and PWA assets are configured for `/noor-prayer-companion/`.

## Supabase database

The initial schema is in `supabase/migrations/0001_noor_schema.sql`. It creates:

- `mosques`
- `prayer_times`
- `push_subscriptions`
- `user_preferences`
- `notification_logs`

The incremental access and security hardening is in `supabase/migrations/0002_api_access_and_security_hardening.sql`. Row Level Security is enabled; mosque entries are readable, authenticated users can manage their own prayer timetable rows, and device subscriptions/preferences/notification logs are not directly exposed to app clients.

## Frontend configuration

The GitHub Pages workflow supplies:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

For local development, copy `.env.example` to `.env.local` and fill in the values. Keep secrets out of source control.

## Authentication configuration

In Supabase Dashboard → Authentication → URL Configuration:

- Set the Site URL to `https://waleedmanzoor.co.uk/noor-prayer-companion/`.
- Add that same URL to the allowed Redirect URLs list.

Noor sends email magic links back to the app subdirectory.

## Prayer timetable

No official Nottingham mosque timetable is bundled. Noor intentionally shows no prayer times until a verified timetable is imported.

1. Sign in using the email magic link.
2. Open Settings → Import mosque timetable.
3. Import rows using:

```csv
date,fajr,sunrise,dhuhr,asr,maghrib,isha,source
2026-11-24,HH:MM,HH:MM,HH:MM,HH:MM,HH:MM,HH:MM,Official mosque timetable
```

Replace every `HH:MM` with actual verified 24-hour local UK times. The current interface loads today's timetable; monthly timetable browsing is still limited.

## Edge Functions

The following functions are deployed:

- `register-push` — registers a signed-in user's browser push subscription.
- `test-notification` — sends a test push to the signed-in user's registered devices.
- `dispatch-prayer-notifications` — checks the current Europe/London minute and sends prayer notifications.

They use Supabase's injected publishable/secret key environment dictionaries, with legacy-key fallbacks.

### Remaining push configuration

Add these secrets in Supabase Dashboard → Edge Functions → Secrets:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT` (for example `mailto:admin@example.com`)
- `CRON_SECRET` (a long random value)

Also set `VITE_VAPID_PUBLIC_KEY` in the GitHub Pages build workflow to the matching VAPID public key. The private key and cron secret must never be committed to GitHub or placed in a `VITE_` variable.

The dispatcher must be invoked once per minute with an `x-cron-secret` header matching `CRON_SECRET`. Configure this through Supabase Cron + pg_net, keeping the cron secret in Supabase Vault. Do not put server secret keys in browser code.

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
- The current interface loads today's timetable only.
- Prayer reminder preferences and some display preferences are currently stored locally rather than synchronised across devices.
- Background Adhan audio is not implemented.
- A production release should add stronger timetable administration, subscription cleanup, delivery observability, backup/restore, and end-to-end testing.

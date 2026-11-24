# Noor — Prayer Companion

A browser-built React + TypeScript PWA starter for a personal Nottingham prayer-times app.

## Included

- Responsive prayer dashboard and countdown
- Nottingham / Europe-London defaults
- Hanafi preference display
- Manual CSV timetable import
- Supabase email magic-link sign-in
- Supabase database migration with Row Level Security
- PWA manifest and service worker
- Web Push subscription registration
- Test notification Edge Function
- Scheduled notification Edge Function

## Important before use

This repository does **not** contain an official Nottingham mosque timetable. Noor intentionally displays no prayer times until you import a verified timetable. The CSV example shown in the app is illustrative and must not be used as real prayer data.

Push delivery requires a deployed HTTPS origin, an installed iPhone Home Screen PWA, notification permission, VAPID secrets, Supabase Edge Functions, and a scheduled invocation. iOS web push notifications do not guarantee custom Adhan audio playback in the background.

## 1. Create Supabase project

1. Create a project at https://supabase.com/dashboard.
2. Open SQL Editor.
3. Run `supabase/migrations/0001_noor_schema.sql`.
4. In Authentication settings, enable Email OTP / magic links and add your deployed site URL to allowed redirect URLs.

## 2. Configure app environment

Copy `.env.example` to `.env.local` and fill in:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (or Supabase publishable key)
- `VITE_VAPID_PUBLIC_KEY`

Only the public/publishable Supabase key belongs in frontend environment variables. Never put the Supabase service-role key or VAPID private key in `VITE_` variables or browser code.

## 3. Run locally in Codespaces

In the Codespaces terminal:

```bash
npm install
npm run dev
```

Open the forwarded port 5173 in the browser.

## 4. Deploy frontend

Connect this GitHub repository to Vercel. Add the three `VITE_` environment variables in Vercel Project Settings → Environment Variables, then deploy.

After changing environment variables, redeploy.

## 5. Deploy Supabase Edge Functions

Install/use Supabase CLI in Codespaces, then authenticate and link the project:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase functions deploy register-push
npx supabase functions deploy test-notification
npx supabase functions deploy dispatch-prayer-notifications
```

Set Edge Function secrets in Supabase Dashboard → Edge Functions → Secrets:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT` (for example `mailto:you@example.com`)
- `CRON_SECRET` (a long random secret)

Supabase automatically provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. If your project dashboard requires explicit configuration, add them there as documented by Supabase.

Generate VAPID keys in a trusted environment using:

```bash
npx web-push generate-vapid-keys
```

Keep the private key secret.

## 6. Schedule the dispatcher

The `dispatch-prayer-notifications` function is designed to run once per minute. Configure Supabase Cron to invoke it with an `x-cron-secret` header containing the same `CRON_SECRET`.

A typical Supabase Cron + pg_net setup uses a Vault secret for the project function URL and cron secret. Follow current Supabase documentation for the exact Vault/pg_net setup for your project. Do not put the service-role key or cron secret in client code.

The dispatcher compares the current Europe/London minute with the imported timetable and sends one push per prayer/user/day. Test carefully before relying on it.

## 7. Import the mosque timetable

1. Sign in to Noor using your email magic link.
2. Open Settings → Import mosque timetable.
3. Paste verified rows using this CSV format:

```csv
date,fajr,sunrise,dhuhr,asr,maghrib,isha,source
2026-11-24,HH:MM,HH:MM,HH:MM,HH:MM,HH:MM,HH:MM,Official mosque timetable
```

Replace every `HH:MM` with actual times from your chosen mosque. Times are 24-hour local UK times.

## 8. iPhone installation

1. Deploy to HTTPS.
2. Open the deployed URL in Safari on iPhone.
3. Share → Add to Home Screen.
4. Open Noor from the Home Screen.
5. Sign in, then tap Enable notifications.
6. Accept the iOS permission prompt.
7. Send a test notification.

Web Push on iOS requires iOS/iPadOS 16.4 or later and a Home Screen web app. Notification delivery depends on iOS settings, connectivity, and push service availability.

## Known limitations in this starter

- CSV import currently supports simple comma-separated values (no quoted commas).
- The interface currently loads today's timetable only.
- The app's countdown uses the device's local display timezone; set the iPhone timezone to UK time for the most intuitive display. The backend dispatcher uses Europe/London.
- The backend sends a standard push reminder. It does not play a custom Adhan audio file in the background.
- A production release should add stronger timetable administration, subscription cleanup, richer delivery observability, backup/restore, and thorough end-to-end testing.

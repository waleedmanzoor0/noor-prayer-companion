-- Store congregation (Jamaat) times separately from the prayer start times.
-- Push notification scheduling continues to use fajr/dhuhr/asr/maghrib/isha.

alter table public.prayer_times
  add column if not exists fajr_jamaat time,
  add column if not exists dhuhr_jamaat time,
  add column if not exists asr_jamaat time,
  add column if not exists isha_jamaat time;

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://waleedmanzoor.co.uk",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function readKeyDictionary(name: string): Record<string, string> {
  const raw = Deno.env.get(name);
  if (!raw) return {};
  try { return JSON.parse(raw) as Record<string, string>; } catch { return {}; }
}
function publishableKey() {
  const keys = readKeyDictionary("SUPABASE_PUBLISHABLE_KEYS");
  const value = keys.default || Deno.env.get("SUPABASE_ANON_KEY");
  if (!value) throw new Error("Supabase publishable key is unavailable.");
  return value;
}
function secretKey() {
  const keys = readKeyDictionary("SUPABASE_SECRET_KEYS");
  const value = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || keys.default;
  if (!value) throw new Error("Supabase server key is unavailable.");
  return value;
}
async function requireUser(req: Request) {
  const authorization = req.headers.get("Authorization");
  if (!authorization) throw new Error("Please sign in to load mosque prayer times.");
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, publishableKey(), {
    global: { headers: { Authorization: authorization } },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) throw new Error("Your Noor session has expired. Please sign in again.");
  return user;
}
function londonDateParts() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (key: string) => parts.find(part => part.type === key)?.value || "";
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")) };
}
function time24(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const suffix = (match[3] || "").toLowerCase();
  if (hour > 23 || minute > 59) return null;
  if (suffix === "am") hour = hour % 12;
  if (suffix === "pm") hour = (hour % 12) + 12;
  return String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
}
function apiDate(value: any): string | null {
  const raw = typeof value === "string" ? value : value?.date;
  if (typeof raw !== "string") return null;
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || null;
}
function normalizeDay(day: any, userId: string, mosqueId: string) {
  const date = apiDate(day?.date);
  const fajr = time24(day?.fajr_start_time);
  const sunrise = time24(day?.shuruq);
  const dhuhr = time24(day?.zuhr_start_time);
  const asr = time24(day?.asr_start_time);
  const maghrib = time24(day?.magrib_start_time);
  const isha = time24(day?.isha_start_time);
  if (!date || !fajr || !dhuhr || !asr || !maghrib || !isha) return null;

  return {
    user_id: userId,
    mosque_id: mosqueId,
    prayer_date: date,
    fajr,
    sunrise,
    dhuhr,
    asr,
    maghrib,
    isha,
    fajr_jamaat: time24(day?.fajr_iqama_time || day?.fajr_iqama),
    dhuhr_jamaat: time24(day?.zuhr_iqama_time || day?.zuhr_iqama),
    asr_jamaat: time24(day?.asr_iqama_time || day?.asr_iqama),
    maghrib_jamaat: time24(day?.magrib_iqama_time || day?.maghrib_iqama),
    isha_jamaat: time24(day?.isha_iqama_time || day?.isha_iqama),
    calculated_begins: [],
    source: "Times from Masjidi",
  };
}
function jsonError(message: string, status: number) {
  return Response.json({ error: message }, {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError("Use POST.", 405);

  try {
    const user = await requireUser(req);
    const body = await req.json();
    const mosqueId = String(body.mosqueId || "");
    const masjidiId = String(body.masjidiId || "");
    const year = Number(body.year);
    const month = Number(body.month);
    if (!/^[0-9]+$/.test(masjidiId) || !/^[0-9a-f-]{36}$/i.test(mosqueId)) {
      return jsonError("Choose a mosque from Noor's nearby mosque results.", 400);
    }
    if (!Number.isInteger(year) || year < 2020 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
      return jsonError("Choose a valid timetable month.", 400);
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, secretKey());
    const { data: mosque, error: mosqueError } = await admin.from("mosques")
      .select("id,name,masjidi_id,masjidi_supported")
      .eq("id", mosqueId)
      .eq("masjidi_id", masjidiId)
      .maybeSingle();
    if (mosqueError) throw mosqueError;
    if (!mosque) return jsonError("This mosque is no longer available in Noor's directory. Search again.", 404);

    const cacheKey = { masjidi_id: masjidiId, calendar_year: year, calendar_month: month };
    const { data: cache, error: cacheError } = await admin.from("masjidi_feed_cache")
      .select("last_requested_at,last_fetched_at,payload,last_error")
      .match(cacheKey)
      .maybeSingle();
    if (cacheError) throw cacheError;

    const now = new Date();
    const nowIso = now.toISOString();
    const lastRequested = cache?.last_requested_at ? new Date(cache.last_requested_at).getTime() : 0;
    const sinceLastRequest = now.getTime() - lastRequested;
    const cacheFresh = Boolean(cache?.payload && cache?.last_fetched_at &&
      now.getTime() - new Date(cache.last_fetched_at).getTime() < 60 * 60 * 1000 &&
      now.getTime() >= new Date(cache.last_fetched_at).getTime());

    let payload: any;
    let cached = false;
    if (cacheFresh) {
      payload = cache.payload;
      cached = true;
    } else {
      if (lastRequested && sinceLastRequest >= 0 && sinceLastRequest < 60 * 1000 && !cacheFresh) {
        return jsonError("This mosque timetable is already being refreshed. Please try again in a minute.", 429);
      }
      const { data: apiKey, error: keyError } = await admin.rpc("noor_get_vault_secret", {
        secret_name: "masjidi_api_key",
      });
      if (keyError || !apiKey) throw new Error("Masjidi API credentials are not configured in Noor.");

      const { error: claimError } = cache
        ? await admin.from("masjidi_feed_cache").update({
            last_requested_at: nowIso, last_error: null, updated_at: nowIso,
          }).match(cacheKey)
        : await admin.from("masjidi_feed_cache").insert({
            ...cacheKey, last_requested_at: nowIso, updated_at: nowIso,
          });
      if (claimError) throw claimError;

      const url = "https://api.masjidiapp.cc/v2/masjids/" +
        encodeURIComponent(masjidiId) + "/salahandiqamatimes/month/" + year + "/" + month;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);
      try {
        const response = await fetch(url, {
          headers: { "Accept": "application/json", "apikey": String(apiKey) },
          signal: controller.signal,
        });
        if (!response.ok) {
          if (response.status === 404) throw new Error("This mosque does not have a published Masjidi monthly timetable.");
          if (response.status === 429) throw new Error("Masjidi is busy. Please try again later.");
          throw new Error("Masjidi returned HTTP " + response.status + ".");
        }
        payload = await response.json();
        if (!Array.isArray(payload)) throw new Error("Masjidi returned an unexpected timetable format.");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not retrieve the Masjidi timetable.";
        await admin.from("masjidi_feed_cache").update({ last_error: message, updated_at: new Date().toISOString() }).match(cacheKey);
        throw new Error(message);
      } finally {
        clearTimeout(timeout);
      }

      const fetchedAt = new Date().toISOString();
      const { error: cacheUpdateError } = await admin.from("masjidi_feed_cache").update({
        payload,
        last_fetched_at: fetchedAt,
        last_error: null,
        updated_at: fetchedAt,
      }).match(cacheKey);
      if (cacheUpdateError) throw cacheUpdateError;
    }

    const daysInMonth = new Date(year, month, 0).getDate();
    const rows = (Array.isArray(payload) ? payload : [])
      .map((day: any) => normalizeDay(day, user.id, mosqueId))
      .filter((row: any) => row && row.prayer_date >= String(year) + "-" + String(month).padStart(2, "0") + "-01" &&
        row.prayer_date <= String(year) + "-" + String(month).padStart(2, "0") + "-" + String(daysInMonth).padStart(2, "0"));

    if (!rows.length) {
      const message = "Masjidi does not currently provide complete prayer start times for " + mosque.name + " in this month.";
      await admin.from("mosques").update({
        masjidi_supported: false,
        timetable_source: "No complete verified timetable available",
      }).eq("id", mosqueId);
      return jsonError(message, 404);
    }

    const { error: upsertError } = await admin.from("prayer_times")
      .upsert(rows, { onConflict: "user_id,prayer_date" });
    if (upsertError) throw upsertError;

    const jamaatDays = rows.filter((row: any) =>
      row.fajr_jamaat || row.dhuhr_jamaat || row.asr_jamaat || row.maghrib_jamaat || row.isha_jamaat
    ).length;

    await admin.from("mosques").update({
      masjidi_supported: true,
      timetable_source: "Times from Masjidi",
      masjidi_last_synced_at: nowIso,
    }).eq("id", mosqueId);

    return Response.json({
      ok: true,
      mosque: mosque.name,
      masjidiId,
      year,
      month,
      cached,
      daysImported: rows.length,
      jamaatDays,
      rows: rows.map((row: any) => ({ prayer_date: row.prayer_date })),
      source: "Times from Masjidi",
    }, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load the mosque timetable.";
    console.error("[masjidi-timetable]", message);
    return jsonError(message, 502);
  }
});

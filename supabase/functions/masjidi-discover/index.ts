import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://waleedmanzoor.co.uk",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const API_BASE = "https://api.masjidiapp.cc/v2";

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
  if (!authorization) throw new Error("Please sign in to search nearby mosques.");
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, publishableKey(), {
    global: { headers: { Authorization: authorization } },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) throw new Error("Your Noor session has expired. Please sign in again.");
  return user;
}
function nonEmpty(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}
function bool(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}
function hasFiveStartTimes(item: Record<string, any>) {
  return [
    item.fajr_start_time,
    item.zuhr_start_time,
    item.asr_start_time,
    item.magrib_start_time,
    item.isha_start_time,
  ].every(nonEmpty);
}
function hasAnyIqamah(item: Record<string, any>) {
  return [
    item.fajr_iqama_time, item.fajr_iqama,
    item.zuhr_iqama_time, item.zuhr_iqama,
    item.asr_iqama_time, item.asr_iqama,
    item.magrib_iqama_time, item.maghrib_iqama,
    item.isha_iqama_time, item.isha_iqama,
  ].some(nonEmpty);
}
function cleanText(value: unknown, max = 180) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
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
    const body = await req.json();
    const postcode = cleanText(body.postcode, 16).toUpperCase().replace(/\s+/g, " ").trim();
    const radiusMiles = Math.min(15, Math.max(1, Number(body.radiusMiles) || 5));
    if (!/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(postcode.replace(/\s/g, ""))) {
      return jsonError("Enter a valid UK postcode, for example NG2 7PR.", 400);
    }

    const postcodeResponse = await fetch(
      "https://api.postcodes.io/postcodes/" + encodeURIComponent(postcode.replace(/\s/g, "")),
      { headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(12000) },
    );
    if (!postcodeResponse.ok) return jsonError("That postcode could not be found. Check it and try again.", 400);
    const postcodeJson = await postcodeResponse.json();
    const coords = postcodeJson?.result;
    if (postcodeJson?.status !== 200 || !Number.isFinite(coords?.latitude) || !Number.isFinite(coords?.longitude)) {
      return jsonError("That postcode could not be found. Check it and try again.", 400);
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, secretKey());
    const { data: apiKey, error: keyError } = await admin.rpc("noor_get_vault_secret", {
      secret_name: "masjidi_api_key",
    });
    if (keyError || !apiKey) throw new Error("Masjidi API credentials are not configured in Noor.");

    const url = new URL(API_BASE + "/masjids");
    url.searchParams.set("lat", String(coords.latitude));
    url.searchParams.set("long", String(coords.longitude));
    url.searchParams.set("dist", String(radiusMiles));

    const apiResponse = await fetch(url, {
      headers: { "Accept": "application/json", "apikey": String(apiKey) },
      signal: AbortSignal.timeout(20000),
    });
    if (!apiResponse.ok) {
      throw new Error(apiResponse.status === 429
        ? "Masjidi is receiving too many requests. Please try again shortly."
        : "Masjidi could not return nearby mosques right now.");
    }
    const raw = await apiResponse.json();
    if (!Array.isArray(raw)) throw new Error("Masjidi returned an unexpected mosque directory response.");

    const results = [];
    for (const item of raw.slice(0, 80)) {
      const masjidiId = cleanText(item.masjid_id || item.id, 50);
      const name = cleanText(item.title || item.name, 200);
      if (!masjidiId || !name) continue;
      if (item.display !== undefined && !bool(item.display)) continue;

      const prayerTimesAvailable = hasFiveStartTimes(item) || bool(item.db_supported);
      const jamaatTimesAvailable = hasAnyIqamah(item);
      // Keep unsupported directory-only entries out of Noor's selectable mosque list and database.
      if (!prayerTimesAvailable) continue;
      const values = {
        name,
        address: cleanText(item.address, 250) || null,
        city: cleanText(item.city, 120) || cleanText(item.state, 120) || "United Kingdom",
        timetable_source: prayerTimesAvailable ? "Times from Masjidi" : "No verified prayer timetable yet",
        latitude: Number.isFinite(Number(item.latitude)) ? Number(item.latitude) : null,
        longitude: Number.isFinite(Number(item.longitude)) ? Number(item.longitude) : null,
        masjidi_id: masjidiId,
        masjidi_supported: prayerTimesAvailable,
        masjidi_db_supported: bool(item.db_supported),
      };

      let mosque;
      const { data: existing, error: lookupError } = await admin.from("mosques")
        .select("id,waqt_slug,waqt_url")
        .eq("masjidi_id", masjidiId)
        .maybeSingle();
      if (lookupError) throw lookupError;

      if (existing) {
        const { data, error } = await admin.from("mosques").update(values)
          .eq("id", existing.id)
          .select("id,name,address,city,timetable_source,masjidi_id,masjidi_supported,masjidi_db_supported,latitude,longitude")
          .single();
        if (error) throw error;
        mosque = data;
      } else {
        const { data, error } = await admin.from("mosques").insert(values)
          .select("id,name,address,city,timetable_source,masjidi_id,masjidi_supported,masjidi_db_supported,latitude,longitude")
          .single();
        if (error) throw error;
        mosque = data;
      }

      results.push({
        mosqueId: mosque.id,
        masjidiId,
        name: mosque.name,
        address: mosque.address,
        city: mosque.city,
        postcode: cleanText(item.zip, 16) || null,
        distanceMiles: Number.isFinite(Number(item.distance)) ? Number(Number(item.distance).toFixed(1)) : null,
        phone: cleanText(item.phone_number, 60) || null,
        website: cleanText(item.web_url, 250) || null,
        denomination: cleanText(item.denomination, 80) || null,
        prayerTimesAvailable,
        jamaatTimesAvailable,
        lastUpdated: cleanText(item.last_updated, 40) || null,
        dbSupported: bool(item.db_supported),
      });
    }

    results.sort((a, b) => (a.distanceMiles ?? 999) - (b.distanceMiles ?? 999));
    return Response.json({
      ok: true,
      postcode: cleanText(coords.postcode, 16) || postcode,
      locality: cleanText(coords.admin_district || coords.parish || coords.region, 100),
      radiusMiles,
      count: results.length,
      mosques: results,
      source: "Masjidi",
    }, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nearby mosque search failed.";
    console.error("[masjidi-discover]", message);
    return jsonError(message, 502);
  }
});

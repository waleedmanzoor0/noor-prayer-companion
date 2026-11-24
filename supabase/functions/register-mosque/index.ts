import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function readKeyDictionary(name: string): Record<string, string> {
  const raw = Deno.env.get(name);
  if (!raw) return {};
  try { return JSON.parse(raw) as Record<string, string>; }
  catch { return {}; }
}
function getPublishableKey(): string {
  const keys = readKeyDictionary("SUPABASE_PUBLISHABLE_KEYS");
  const key = keys.default || Deno.env.get("SUPABASE_ANON_KEY");
  if (!key) throw new Error("Supabase publishable key is unavailable.");
  return key;
}
function getSecretKey(): string {
  const keys = readKeyDictionary("SUPABASE_SECRET_KEYS");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || keys.default;
  if (!key) throw new Error("Supabase server key is unavailable.");
  return key;
}
async function requireUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) throw new Error("Please sign in to search for nearby mosques.");
  const url = Deno.env.get("SUPABASE_URL")!;
  const userClient = createClient(url, getPublishableKey(), {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) throw new Error("Your session has expired. Please sign in again.");
  return user;
}
function londonDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}
function coreName(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/).filter(Boolean)
    .filter(word => !["the", "masjid", "mosque", "mosque", "islamic", "centre", "center"].includes(word))
    .sort().join(" ");
}
function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const rad = (value: number) => value * Math.PI / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const value = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}
function locationOf(element: any) {
  if (typeof element.lat === "number" && typeof element.lon === "number") return { lat: element.lat, lon: element.lon };
  if (typeof element.center?.lat === "number" && typeof element.center?.lon === "number") {
    return { lat: element.center.lat, lon: element.center.lon };
  }
  return null;
}
function addressOf(tags: Record<string, string>) {
  const firstLine = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  return [
    firstLine,
    tags["addr:suburb"] || tags["addr:neighbourhood"],
    tags["addr:city"] || tags["addr:town"] || tags["addr:village"],
    tags["addr:postcode"],
  ].filter(Boolean).join(", ") || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Use POST." }, { status: 405, headers: corsHeaders });
  try {
    await requireUser(req);
    const body = await req.json();
    const osmKey = String(body.osmKey || "");
    const name = String(body.name || "").trim().slice(0, 200);
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    if (!/^(node|way|relation)\/\d+$/.test(osmKey) || !name ||
        !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return Response.json({ error: "Invalid mosque directory entry." }, { status: 400, headers: corsHeaders });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, getSecretKey());
    const { data: existing, error: lookupError } = await admin.from("mosques")
      .select("id,name,address,city,timetable_source,latitude,longitude,osm_key")
      .eq("osm_key", osmKey).maybeSingle();
    if (lookupError) throw lookupError;

    let mosque = existing;
    if (!mosque) {
      const nameCore = coreName(name);
      const { data: candidates, error: candidatesError } = await admin.from("mosques")
        .select("id,name,address,city,timetable_source,latitude,longitude,osm_key").limit(1000);
      if (candidatesError) throw candidatesError;
      const matchingCandidates = (candidates || []).filter((item: any) =>
        !item.osm_key && nameCore && coreName(item.name || "") === nameCore
      );
      // Reuse an existing Noor timetable only when the exact normalized name is unique.
      const matched = matchingCandidates.length === 1 ? matchingCandidates[0] : null;
      if (matched) {
        const { data, error } = await admin.from("mosques").update({
          latitude, longitude, osm_key: osmKey, osm_source: "© OpenStreetMap contributors",
          address: matched.address || body.address || null,
          city: matched.city || String(body.city || "Unknown"),
        }).eq("id", matched.id)
          .select("id,name,address,city,timetable_source,latitude,longitude,osm_key").single();
        if (error) throw error;
        mosque = data;
      } else {
        const { data, error } = await admin.from("mosques").upsert({
          name,
          address: body.address ? String(body.address).slice(0, 500) : null,
          city: String(body.city || "Unknown").slice(0, 120),
          timetable_source: "No verified prayer timetable has been added yet",
          latitude, longitude, osm_key: osmKey,
          osm_source: "© OpenStreetMap contributors",
        }, { onConflict: "osm_key" })
          .select("id,name,address,city,timetable_source,latitude,longitude,osm_key").single();
        if (error) throw error;
        mosque = data;
      }
    }

    const today = londonDate();
    const { data: rows, error: timetableError } = await admin.from("prayer_times")
      .select("prayer_date").eq("mosque_id", mosque.id).gte("prayer_date", today);
    if (timetableError) throw timetableError;

    return Response.json({
      ok: true,
      mosque,
      timetableAvailable: Boolean(rows?.length),
      availableDays: rows?.length || 0,
    }, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save this mosque.";
    return Response.json({ error: message }, { status: 400, headers: corsHeaders });
  }
});

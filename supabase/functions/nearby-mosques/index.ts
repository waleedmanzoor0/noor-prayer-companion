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
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    const radiusMeters = Math.min(10000, Math.max(1000, Number(body.radiusMeters) || 6000));
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return Response.json({ error: "A valid location is required." }, { status: 400, headers: corsHeaders });
    }

    // Ask only for named mosque/worship features; the app only displays named entries.
    // Keep the query small because public Overpass instances are shared community services.
    const query = `[out:json][timeout:8];
(
  nwr(around:${radiusMeters},${latitude},${longitude})["amenity"="place_of_worship"]["religion"="muslim"]["name"];
  nwr(around:${radiusMeters},${latitude},${longitude})["amenity"="mosque"]["name"];
  nwr(around:${radiusMeters},${latitude},${longitude})["building"="mosque"]["name"];
  nwr(around:${radiusMeters},${latitude},${longitude})["place_of_worship"="mosque"]["name"];
);
out center tags 80;`;

    async function requestOverpass(endpoint: string): Promise<any> {
      const controller = new AbortController();
      controllers.push(controller);
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            "Accept": "application/json",
            "User-Agent": "NoorPrayerCompanion/1.0",
            "Referer": "https://waleedmanzoor.co.uk/noor-prayer-companion/",
          },
          body: "data=" + encodeURIComponent(query),
          signal: controller.signal,
        });
        if (!response.ok) {
          const detail = (await response.text().catch(() => "")).slice(0, 180);
          throw new Error("HTTP " + response.status + (detail ? ": " + detail : ""));
        }
        const data = await response.json();
        if (data?.remark) throw new Error(String(data.remark).slice(0, 180));
        if (!Array.isArray(data?.elements)) throw new Error("The map provider returned an unreadable response.");
        return data;
      } finally {
        clearTimeout(timeout);
      }
    }

    // These are two independently operated, global OpenStreetMap Overpass instances.
    // Race them so one slow public endpoint doesn't hold up the user.
    const controllers: AbortController[] = [];
    const endpoints = [
      "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
      "https://overpass.private.coffee/api/interpreter",
    ];
    let osmData: any;
    try {
      osmData = await Promise.any(endpoints.map(requestOverpass));
    } catch (error) {
      const failures = error instanceof AggregateError ? error.errors : [error];
      console.error("[nearby-mosques] all map providers failed:", failures.map((item: unknown) =>
        item instanceof Error ? item.message : String(item)
      ));
      throw new Error("The OpenStreetMap directory is temporarily busy. Please try again shortly.");
    } finally {
      // Cancel the slower request once a usable answer has arrived.
      for (const controller of controllers) controller.abort();
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, getSecretKey());
    const [{ data: registered, error: mosqueError }, { data: timetable, error: timetableError }] = await Promise.all([
      admin.from("mosques").select("id,name,address,city,latitude,longitude,osm_key").limit(1000),
      admin.from("prayer_times").select("mosque_id,prayer_date")
        .gte("prayer_date", londonDate())
        .limit(5000),
    ]);
    if (mosqueError) throw mosqueError;
    if (timetableError) throw timetableError;

    const availableDays = new Map<string, Set<string>>();
    for (const row of timetable || []) {
      if (!row.mosque_id) continue;
      if (!availableDays.has(row.mosque_id)) availableDays.set(row.mosque_id, new Set());
      availableDays.get(row.mosque_id)!.add(row.prayer_date);
    }

    const results = new Map<string, any>();
    for (const element of osmData.elements || []) {
      const tags = element.tags || {};
      const location = locationOf(element);
      if (!location) continue;
      const name = String(tags.name || tags["name:en"] || tags.official_name || "").trim();
      if (!name) continue;
      const osmKey = String(element.type) + "/" + String(element.id);
      const distance = distanceKm(latitude, longitude, location.lat, location.lon);
      const addr = addressOf(tags);
      const locality = tags["addr:city"] || tags["addr:town"] || tags["addr:village"] ||
        tags["addr:suburb"] || tags["is_in:city"] || "Nearby area";
      let match = (registered || []).find((item: any) => item.osm_key === osmKey);
      if (!match) {
        const core = coreName(name);
        if (core && distance <= 3) {
          const candidates = (registered || []).filter((item: any) =>
            coreName(item.name || "") === core
          );
          // Only auto-match an unlinked listing when the name is unique in Noor's directory.
          // Ambiguous names stay separate so a user doesn't inherit another mosque's timetable.
          if (candidates.length === 1) match = candidates[0];
        }
      }
      const days = match ? [...(availableDays.get(match.id) || new Set<string>())].sort() : [];
      results.set(osmKey, {
        osmKey,
        name,
        address: addr || (match?.address ?? null),
        city: String(locality),
        latitude: location.lat,
        longitude: location.lon,
        distanceKm: Number(distance.toFixed(2)),
        website: tags.website || tags["contact:website"] || null,
        phone: tags.phone || tags["contact:phone"] || null,
        mosqueId: match?.id || null,
        timetableAvailable: days.length > 0,
        availableDays: days.length,
      });
    }

    const mosques = [...results.values()].sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 60);
    return Response.json({
      ok: true,
      radiusMeters,
      count: mosques.length,
      mosques,
      attribution: "© OpenStreetMap contributors",
    }, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nearby mosque search failed.";
    console.error("[nearby-mosques] search failed:", message);
    const status = message.includes("A valid location") ? 400 : 502;
    return Response.json({ error: message }, { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

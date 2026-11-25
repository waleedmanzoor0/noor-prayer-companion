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
  if (!authHeader) throw new Error("Please sign in to connect a Waqt mosque.");
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, getPublishableKey(), {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) throw new Error("Your Noor session has expired. Please sign in again.");
  return user;
}
function londonDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function isValidDay(day: any): boolean {
  if (!day || !Array.isArray(day.date) || day.date.length !== 3) return false;
  const [year, month, date] = day.date.map(Number);
  return Number.isInteger(year) && year >= 2000 && month >= 1 && month <= 12 &&
    Number.isInteger(date) && date >= 1 && date <= 31;
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

  let slug = "";
  try {
    await requireUser(req);
    const body = await req.json();
    const rawSlug = String(body.slug || "").trim();
    slug = rawSlug
      .replace(/^https?:\/\/(?:www\.)?waqt\.uk\//i, "")
      .replace(/\?.*$/, "")
      .replace(/#.*$/, "")
      .replace(/^\/+|\/+$/g, "");
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(slug)) {
      return jsonError("Enter a Waqt mosque page address such as https://waqt.uk/shahjalal/ or its mosque slug.", 400);
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, getSecretKey());
    const now = new Date();
    const nowIso = now.toISOString();
    const today = londonDate();

    const { data: cache, error: cacheError } = await admin.from("waqt_feed_cache")
      .select("slug,last_requested_at,last_fetched_at,payload,last_error")
      .eq("slug", slug)
      .maybeSingle();
    if (cacheError) throw cacheError;

    const lastRequestedMs = cache?.last_requested_at
      ? new Date(cache.last_requested_at).getTime()
      : 0;
    const sinceLastRequest = now.getTime() - lastRequestedMs;
    const withinHour = Boolean(lastRequestedMs && sinceLastRequest >= 0 && sinceLastRequest < 60 * 60 * 1000);

    // The cache is shared across all Noor users. Never request a mosque's Waqt
    // file more than once per hour, even if the previous fetch failed.
    if (withinHour) {
      if (!cache?.payload) {
        const waitMinutes = Math.max(1, Math.ceil((60 * 60 * 1000 - sinceLastRequest) / 60000));
        return jsonError(
          cache?.last_error
            ? "Waqt was unavailable on the previous attempt. To respect its hourly limit, try again in about " + waitMinutes + " minute(s)."
            : "This mosque's Waqt feed was just checked. Try again in about " + waitMinutes + " minute(s).",
          429,
        );
      }

      const { data: existing, error: mosqueError } = await admin.from("mosques")
        .select("id,name,address,city,timetable_source,waqt_slug,waqt_url")
        .eq("waqt_slug", slug)
        .maybeSingle();
      if (mosqueError) throw mosqueError;

      return Response.json({
        ok: true,
        cached: true,
        currentForUkDate: cache.payload.date === today,
        mosque: existing || {
          id: null,
          name: cache.payload.masjid?.name || slug,
          address: null,
          city: "United Kingdom",
          timetable_source: "Times from Waqt",
          waqt_slug: slug,
          waqt_url: cache.payload.masjid?.url || "https://waqt.uk/" + slug + "/",
        },
        payload: cache.payload,
        attribution: cache.payload.attribution || { text: "Times from Waqt", url: "https://waqt.uk/" },
        cacheAgeSeconds: cache.last_fetched_at
          ? Math.max(0, Math.floor((now.getTime() - new Date(cache.last_fetched_at).getTime()) / 1000))
          : null,
      }, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (cache) {
      const { error } = await admin.from("waqt_feed_cache")
        .update({ last_requested_at: nowIso, last_error: null, updated_at: nowIso })
        .eq("slug", slug);
      if (error) throw error;
    } else {
      const { error } = await admin.from("waqt_feed_cache").insert({
        slug,
        last_requested_at: nowIso,
        updated_at: nowIso,
      });
      if (error) throw error;
    }

    const feedUrl = "https://waqt.uk/api/v1/" + encodeURIComponent(slug) + ".json";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let payload: any;
    try {
      const response = await fetch(feedUrl, {
        method: "GET",
        headers: { "Accept": "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("Waqt could not find that mosque slug. Check the mosque page address and try again.");
        }
        throw new Error("Waqt returned HTTP " + response.status + ". Please try again later.");
      }
      payload = await response.json();
    } catch (error) {
      const detail = error instanceof Error && error.message.startsWith("Waqt ")
        ? error.message
        : "Noor could not reach Waqt right now. Please try again shortly.";
      await admin.from("waqt_feed_cache")
        .update({ last_error: detail, updated_at: new Date().toISOString() })
        .eq("slug", slug);
      throw new Error(detail);
    } finally {
      clearTimeout(timeout);
    }

    const hasValidDay = (payload?.today && isValidDay(payload.today)) ||
      (payload?.tomorrow && isValidDay(payload.tomorrow));
    if (payload?.version !== 1 ||
        payload?.masjid?.slug?.toLowerCase() !== slug.toLowerCase() ||
        payload?.timezone !== "Europe/London" ||
        !hasValidDay) {
      const detail = "Waqt returned an unsupported or incomplete timetable for this mosque.";
      await admin.from("waqt_feed_cache").update({ last_error: detail, updated_at: nowIso }).eq("slug", slug);
      throw new Error(detail);
    }
    if (payload.date !== today) {
      const detail = "Waqt's feed date does not match today's UK date yet. Noor will respect Waqt's hourly limit; please try again later.";
      await admin.from("waqt_feed_cache").update({ last_error: detail, updated_at: nowIso }).eq("slug", slug);
      throw new Error(detail);
    }

    const masjidName = String(payload.masjid.name || "").trim();
    if (!masjidName) throw new Error("Waqt did not include a mosque name in its feed.");

    const fetchedAt = new Date().toISOString();
    const { error: cacheUpdateError } = await admin.from("waqt_feed_cache")
      .update({
        payload,
        last_fetched_at: fetchedAt,
        last_error: null,
        updated_at: fetchedAt,
      })
      .eq("slug", slug);
    if (cacheUpdateError) throw cacheUpdateError;

    const { data: existing, error: lookupError } = await admin.from("mosques")
      .select("id,name,address,city,timetable_source,waqt_slug,waqt_url")
      .eq("waqt_slug", slug)
      .maybeSingle();
    if (lookupError) throw lookupError;

    const values = {
      name: masjidName,
      city: existing?.city || String(body.city || "United Kingdom").slice(0, 120),
      timetable_source: "Times from Waqt",
      waqt_slug: slug,
      waqt_url: String(payload.masjid.url || ("https://waqt.uk/" + slug + "/")),
      waqt_last_requested_at: nowIso,
      waqt_last_fetched_at: fetchedAt,
      waqt_revision: Number(payload.revision) || null,
      waqt_payload: payload,
    };

    let mosque;
    if (existing) {
      const { data, error } = await admin.from("mosques").update(values)
        .eq("id", existing.id)
        .select("id,name,address,city,timetable_source,waqt_slug,waqt_url")
        .single();
      if (error) throw error;
      mosque = data;
    } else {
      const { data, error } = await admin.from("mosques").insert(values)
        .select("id,name,address,city,timetable_source,waqt_slug,waqt_url")
        .single();
      if (error) throw error;
      mosque = data;
    }

    return Response.json({
      ok: true,
      cached: false,
      currentForUkDate: true,
      mosque,
      payload,
      attribution: payload.attribution || { text: "Times from Waqt", url: "https://waqt.uk/" },
    }, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load Waqt timetable.";
    console.error("[waqt-timetable]", message);
    const status = message.includes("slug") || message.includes("incomplete") ? 400
      : message.includes("hourly") || message.includes("minute") ? 429
      : 502;
    return jsonError(message, status);
  }
});

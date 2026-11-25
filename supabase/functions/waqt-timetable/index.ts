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
  return Number.isInteger(year) && month >= 1 && month <= 12 &&
    Number.isInteger(date) && date >= 1 && date <= 31;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return Response.json({ error: "Use POST." }, { status: 405, headers: corsHeaders });
  }

  try {
    await requireUser(req);
    const body = await req.json();
    const rawSlug = String(body.slug || "").trim();
    const slug = rawSlug
      .replace(/^https?:\/\/(?:www\.)?waqt\.uk\//i, "")
      .replace(/\?.*$/, "")
      .replace(/#.*$/, "")
      .replace(/^\/+|\/+$/g, "")
      .replace(/\/$/, "");

    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(slug) || slug.includes("/")) {
      return Response.json({
        error: "Enter a Waqt mosque page URL such as https://waqt.uk/shahjalal/ or its mosque slug.",
      }, { status: 400, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(supabaseUrl, getSecretKey());
    const now = new Date();
    const nowIso = now.toISOString();
    const today = londonDate();

    const { data: existing, error: lookupError } = await admin.from("mosques")
      .select("id,name,address,city,timetable_source,waqt_slug,waqt_url,waqt_last_requested_at,waqt_last_fetched_at,waqt_revision,waqt_payload")
      .eq("waqt_slug", slug)
      .maybeSingle();
    if (lookupError) throw lookupError;

    const cachedPayload = existing?.waqt_payload as any | null;
    const cacheDateIsCurrent = cachedPayload?.date === today;
    const lastFetchedMs = existing?.waqt_last_fetched_at
      ? new Date(existing.waqt_last_fetched_at).getTime()
      : 0;
    const cacheAgeMs = now.getTime() - lastFetchedMs;

    // Waqt asks integrators to request each mosque no more than once per hour.
    // Reuse the shared database cache for every Noor user during that window.
    if (existing && cachedPayload && cacheDateIsCurrent && cacheAgeMs >= 0 && cacheAgeMs < 60 * 60 * 1000) {
      return Response.json({
        ok: true,
        cached: true,
        mosque: {
          id: existing.id,
          name: existing.name,
          address: existing.address,
          city: existing.city,
          waqt_slug: slug,
          waqt_url: existing.waqt_url || "https://waqt.uk/" + slug + "/",
        },
        payload: cachedPayload,
        attribution: { text: "Times from Waqt", url: "https://waqt.uk/" },
        cacheAgeSeconds: Math.floor(cacheAgeMs / 1000),
      }, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // If another request has just started, do not immediately hit Waqt again.
    const lastRequestedMs = existing?.waqt_last_requested_at
      ? new Date(existing.waqt_last_requested_at).getTime()
      : 0;
    if (existing && lastRequestedMs && now.getTime() - lastRequestedMs < 60 * 1000 &&
        (!cachedPayload || !cacheDateIsCurrent)) {
      throw new Error("This mosque's Waqt feed is being refreshed. Please try again in a minute.");
    }

    if (existing) {
      const { error: markError } = await admin.from("mosques")
        .update({ waqt_last_requested_at: nowIso })
        .eq("id", existing.id);
      if (markError) throw markError;
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
      if (error instanceof Error && error.message.startsWith("Waqt ")) throw error;
      throw new Error("Noor could not reach Waqt right now. Please try again shortly.");
    } finally {
      clearTimeout(timeout);
    }

    if (payload?.version !== 1 || payload?.masjid?.slug?.toLowerCase() !== slug.toLowerCase() ||
        payload?.timezone !== "Europe/London" || !payload?.today || !isValidDay(payload.today)) {
      throw new Error("Waqt returned an unsupported or incomplete timetable for this mosque.");
    }
    if (payload.date !== today) {
      throw new Error("Waqt's feed date does not match today's UK date yet. Please try again shortly.");
    }
    if (payload.tomorrow && !isValidDay(payload.tomorrow)) {
      throw new Error("Waqt returned an invalid tomorrow timetable.");
    }

    const masjidName = String(payload.masjid.name || "").trim();
    if (!masjidName) throw new Error("Waqt did not include a mosque name in its feed.");

    const values = {
      name: masjidName,
      city: existing?.city || String(body.city || "United Kingdom").slice(0, 120),
      timetable_source: "Times from Waqt",
      waqt_slug: slug,
      waqt_url: String(payload.masjid.url || ("https://waqt.uk/" + slug + "/")),
      waqt_last_requested_at: nowIso,
      waqt_last_fetched_at: nowIso,
      waqt_revision: Number(payload.revision) || null,
      waqt_payload: payload,
    };

    let mosque = existing;
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
      mosque,
      payload,
      attribution: payload.attribution || { text: "Times from Waqt", url: "https://waqt.uk/" },
    }, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load Waqt timetable.";
    console.error("[waqt-timetable]", message);
    return Response.json({ error: message }, {
      status: message.includes("slug") || message.includes("incomplete") ? 400 : 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

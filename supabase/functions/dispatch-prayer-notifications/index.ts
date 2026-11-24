import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const prayerColumns = [
  ["Fajr", "fajr"], ["Dhuhr", "dhuhr"], ["Asr", "asr"],
  ["Maghrib", "maghrib"], ["Isha", "isha"]
] as const;

function londonParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value || "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: get("hour"), minute: get("minute") };
}

function readKeyDictionary(name: string): Record<string, string> {
  const raw = Deno.env.get(name);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function getPublishableKey(): string {
  const keys = readKeyDictionary("SUPABASE_PUBLISHABLE_KEYS");
  const key = keys.default || Deno.env.get("SUPABASE_ANON_KEY");
  if (!key) throw new Error("Supabase publishable key is unavailable in this function environment.");
  return key;
}

function getSecretKey(): string {
  const keys = readKeyDictionary("SUPABASE_SECRET_KEYS");
  // Prefer the injected legacy JWT key because supabase-js sends it as a Bearer token.
  // The current new secret-key API is supported as a fallback; use @supabase/server
  // before removing the legacy key to avoid sending a non-JWT key as Authorization.
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || keys.default;
  if (!key) throw new Error("Supabase server secret key is unavailable in this function environment.");
  return key;
}

Deno.serve(async (req) => {
  try {
    const expected = Deno.env.get("CRON_SECRET");
    if (!expected || req.headers.get("x-cron-secret") !== expected) {
      return new Response("Unauthorized", { status: 401 });
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const service = getSecretKey();
    const admin = createClient(url, service);
    webpush.setVapidDetails(
      Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com",
      Deno.env.get("VAPID_PUBLIC_KEY")!,
      Deno.env.get("VAPID_PRIVATE_KEY")!
    );

    const now = new Date();
    const { date, hour, minute } = londonParts(now);
    const hhmm = `${hour}:${minute}:00`;
    const { data: rows, error: rowError } = await admin
      .from("prayer_times").select("*").eq("prayer_date", date);
    if (rowError) throw rowError;

    let sent = 0;
    for (const row of rows || []) {
      const { data: subscriptions } = await admin
        .from("push_subscriptions").select("user_id, subscription").eq("user_id", row.user_id);
      const { data: prefRow } = await admin.from("user_preferences")
        .select("notifications_enabled, prayer_notification_preferences")
        .eq("user_id", row.user_id).maybeSingle();
      if (prefRow?.notifications_enabled === false) continue;

      for (const [name, column] of prayerColumns) {
        const prayerTime = String(row[column]).slice(0, 8);
        if (prayerTime !== hhmm) continue;
        const setting = prefRow?.prayer_notification_preferences?.[name];
        if (setting?.enabled === false) continue;

        const { data: existing } = await admin.from("notification_logs").select("id")
          .eq("user_id", row.user_id).eq("prayer_name", name)
          .eq("prayer_date", date).eq("notification_type", "push").maybeSingle();
        if (existing) continue;

        const payload = JSON.stringify({
          title: `It is time for ${name}`,
          body: `It is time for ${name} prayer. May your prayer be accepted.`,
          tag: `noor-${date}-${name.toLowerCase()}`,
          url: "https://waleedmanzoor.co.uk/noor-prayer-companion/"
        });

        let hadSuccess = false;
        for (const sub of subscriptions || []) {
          try {
            await webpush.sendNotification(sub.subscription, payload);
            hadSuccess = true;
            sent++;
          } catch (err) {
            const status = (err as { statusCode?: number }).statusCode;
            if (status === 404 || status === 410) {
              await admin.from("push_subscriptions").delete().eq("user_id", row.user_id)
                .eq("subscription->>endpoint", sub.subscription.endpoint);
            }
          }
        }
        await admin.from("notification_logs").insert({
          user_id: row.user_id, prayer_name: name, prayer_date: date,
          notification_type: "push", delivery_status: hadSuccess ? "sent" : "failed",
          sent_at: hadSuccess ? now.toISOString() : null
        });
      }
    }
    return Response.json({ ok: true, date, time: hhmm, sent });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
});

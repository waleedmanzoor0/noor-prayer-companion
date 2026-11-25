import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization.");
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = getPublishableKey();
    const service = getSecretKey();
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new Error("Sign in first.");

    const admin = createClient(url, service);
    const { data: preference, error: preferenceError } = await admin.from("user_preferences")
      .select("notifications_enabled")
      .eq("user_id", user.id)
      .maybeSingle();
    if (preferenceError) throw preferenceError;
    if (preference?.notifications_enabled === false) {
      throw new Error("Prayer notifications are paused in Noor Settings. Turn them back on before sending a test.");
    }

    const { data: subs, error } = await admin.from("push_subscriptions").select("subscription").eq("user_id", user.id);
    if (error) throw error;
    if (!subs?.length) throw new Error("No registered device found. Enable notifications on your iPhone first.");

    const { data: vapidPublic, error: vapidPublicError } = await admin.rpc(
      "noor_get_vault_secret",
      { secret_name: "noor_vapid_public_key" }
    );
    const { data: vapidPrivate, error: vapidPrivateError } = await admin.rpc(
      "noor_get_vault_secret",
      { secret_name: "noor_vapid_private_key" }
    );
    if (vapidPublicError || vapidPrivateError || !vapidPublic || !vapidPrivate) {
      throw new Error("Noor push credentials are not available in Supabase Vault.");
    }

    webpush.setVapidDetails(
      Deno.env.get("VAPID_SUBJECT") || "https://waleedmanzoor.co.uk/",
      String(vapidPublic),
      String(vapidPrivate)
    );

    const payload = JSON.stringify({
      title: "Noor — Test notification",
      body: "Your Noor notification connection is working.",
      tag: "noor-test",
      url: "https://waleedmanzoor.co.uk/noor-prayer-companion/"
    });
    const results = await Promise.allSettled(subs.map((s) => webpush.sendNotification(s.subscription, payload)));
    const failures = results.filter((r) => r.status === "rejected").length;
    return new Response(JSON.stringify({ ok: true, devices: subs.length, failures }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

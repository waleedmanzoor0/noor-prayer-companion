import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  const key = keys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new Error("Supabase server secret key is unavailable in this function environment.");
  return key;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization.");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = getPublishableKey();
    const admin = createClient(supabaseUrl, getSecretKey());
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) throw new Error("You must sign in before registering push notifications.");

    const body = await req.json();
    const subscription = body.subscription;
    if (!subscription?.endpoint || !subscription?.keys) throw new Error("Invalid push subscription.");
    const { error } = await admin.from("push_subscriptions").upsert({
      user_id: user.id,
      endpoint: subscription.endpoint,
      subscription,
      updated_at: new Date().toISOString()
    }, { onConflict: "endpoint" });
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

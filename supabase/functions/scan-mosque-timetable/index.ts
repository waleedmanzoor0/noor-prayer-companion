import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = ["https://waleedmanzoor.co.uk", "http://localhost:5173", "http://127.0.0.1:5173"];
function cors(origin: string | null) {
  const value = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    "Access-Control-Allow-Origin": value,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
function keyDictionary(name: string): Record<string, string> {
  try { return JSON.parse(Deno.env.get(name) || "{}"); } catch { return {}; }
}
function publicKey() {
  const keys = keyDictionary("SUPABASE_PUBLISHABLE_KEYS");
  const key = keys.default || Deno.env.get("SUPABASE_ANON_KEY");
  if (!key) throw new Error("Supabase publishable key is unavailable.");
  return key;
}
function serviceKey() {
  const keys = keyDictionary("SUPABASE_SECRET_KEYS");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || keys.default;
  if (!key) throw new Error("Supabase server key is unavailable.");
  return key;
}
function errorResponse(message: string, status: number, headers: Record<string, string>) {
  return Response.json({ error: message }, { status, headers });
}
Deno.serve(async (req) => {
  const headers = cors(req.headers.get("Origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return errorResponse("Use POST.", 405, headers);
  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization) return errorResponse("Sign in to scan a mosque timetable.", 401, headers);
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, publicKey(), {
      global: { headers: { Authorization: authorization } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return errorResponse("Your Noor session has expired. Please sign in again.", 401, headers);

    const body = await req.json();
    const fileName = String(body.fileName || "timetable").slice(0, 160);
    const mimeType = String(body.mimeType || "");
    const fileBase64 = String(body.fileBase64 || "");
    const supported = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!supported.includes(mimeType)) return errorResponse("Upload a JPG, PNG, WebP image or PDF.", 400, headers);
    if (!fileBase64 || fileBase64.length > 17_000_000 || !/^[A-Za-z0-9+/=]+$/.test(fileBase64)) {
      return errorResponse("The file is empty or too large. Maximum upload size is 12 MB.", 413, headers);
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey());
    let apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      const { data, error } = await admin.rpc("noor_get_vault_secret", { secret_name: "gemini_api_key" });
      if (!error && data) apiKey = String(data);
    }
    if (!apiKey) {
      return errorResponse("Gemini API key was not found in Supabase Vault. Add it as gemini_api_key.", 503, headers);
    }

    const prompt = `You are a careful OCR assistant for mosque prayer timetables. Extract only information visibly printed in this document: ${fileName}.
Return a JSON object with exactly this shape:
{"days":[{"prayer_date":"YYYY-MM-DD","fajr":"HH:MM or null","sunrise":"HH:MM or null","dhuhr":"HH:MM or null","asr":"HH:MM or null","maghrib":"HH:MM or null","isha":"HH:MM or null","fajr_jamaat":"HH:MM or null","dhuhr_jamaat":"HH:MM or null","asr_jamaat":"HH:MM or null","maghrib_jamaat":"HH:MM or null","isha_jamaat":"HH:MM or null"}]}
Rules:
- Use 24-hour HH:MM. Convert clearly marked AM/PM correctly.
- Distinguish prayer start/beginning times from Jamaat/Iqamah/congregation times. Do not put one type in the other.
- Use null for missing, illegible, ambiguous or absent times. Never infer, calculate or guess.
- Include each date that can be confidently read. Resolve month/year from the document heading only when clear.
- If a date is ambiguous, omit that row rather than inventing a date.
- Do not treat sunrise as Fajr or Maghrib as Isha.
- Return JSON only, no markdown or explanatory text.`;

    const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent";
    const requestBody = JSON.stringify({
      contents: [{ role: "user", parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: fileBase64 } },
      ] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            days: { type: "ARRAY", items: { type: "OBJECT", properties: {
              prayer_date: { type: "STRING" },
              fajr: { type: "STRING", nullable: true }, sunrise: { type: "STRING", nullable: true },
              dhuhr: { type: "STRING", nullable: true }, asr: { type: "STRING", nullable: true },
              maghrib: { type: "STRING", nullable: true }, isha: { type: "STRING", nullable: true },
              fajr_jamaat: { type: "STRING", nullable: true }, dhuhr_jamaat: { type: "STRING", nullable: true },
              asr_jamaat: { type: "STRING", nullable: true }, maghrib_jamaat: { type: "STRING", nullable: true },
              isha_jamaat: { type: "STRING", nullable: true },
            }, required: ["prayer_date","fajr","sunrise","dhuhr","asr","maghrib","isha","fajr_jamaat","dhuhr_jamaat","asr_jamaat","maghrib_jamaat","isha_jamaat"] } },
          }, required: ["days"],
        },
      },
    });

    // Google recommends bounded exponential backoff for transient 429/5xx errors.
    let response: Response | null = null;
    let result: any = {};
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": String(apiKey) },
          body: requestBody,
        });
      } catch (networkError) {
        if (attempt === 2) throw networkError;
        await new Promise(resolve => setTimeout(resolve, 700 * (2 ** attempt) + Math.random() * 500));
        continue;
      }
      result = await response.json().catch(() => ({}));
      if (response.ok) break;
      const transient = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!transient || attempt === 2) break;
      await new Promise(resolve => setTimeout(resolve, 700 * (2 ** attempt) + Math.random() * 500));
    }
    if (!response?.ok) {
      const status = response?.status || 502;
      const reason = result?.error?.message || "Gemini could not read this document.";
      if (status === 503) {
        return errorResponse("Gemini is temporarily at capacity. Noor retried automatically; please wait a minute and try again.", 503, headers);
      }
      return errorResponse(reason, status === 429 ? 429 : status >= 500 ? 502 : status, headers);
    }
    const raw = result?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("");
    if (!raw) return errorResponse("Gemini returned no readable timetable. Try a clearer scan.", 422, headers);
    let parsed: { days?: unknown[] };
    try { parsed = JSON.parse(raw); } catch { return errorResponse("The timetable could not be read as structured data. Try a clearer image.", 422, headers); }

    const time = (value: unknown): string | null => {
      if (typeof value !== "string") return null;
      const match = value.trim().match(/^(\\d{1,2}):(\\d{2})(?:\\s*(am|pm))?$/i);
      if (!match) return null;
      let hour = Number(match[1]); const minute = Number(match[2]);
      if (hour > 23 || minute > 59) return null;
      const suffix = (match[3] || "").toLowerCase();
      if (suffix === "am") hour %= 12;
      if (suffix === "pm") hour = (hour % 12) + 12;
      return String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
    };
    const days = (Array.isArray(parsed.days) ? parsed.days : []).flatMap((item: any) => {
      if (!item || typeof item.prayer_date !== "string" || !/^\\d{4}-\\d{2}-\\d{2}$/.test(item.prayer_date)) return [];
      const date = new Date(item.prayer_date + "T12:00:00Z");
      if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== item.prayer_date) return [];
      return [{
        prayer_date: item.prayer_date, fajr: time(item.fajr), sunrise: time(item.sunrise),
        dhuhr: time(item.dhuhr), asr: time(item.asr), maghrib: time(item.maghrib), isha: time(item.isha),
        fajr_jamaat: time(item.fajr_jamaat), dhuhr_jamaat: time(item.dhuhr_jamaat),
        asr_jamaat: time(item.asr_jamaat), maghrib_jamaat: time(item.maghrib_jamaat),
        isha_jamaat: time(item.isha_jamaat),
      }];
    });
    return Response.json({ days }, { headers });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Timetable scan failed.", 500, headers);
  }
});

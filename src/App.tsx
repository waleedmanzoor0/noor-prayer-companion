import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle, Bell, BellRing, Building2, CalendarDays,
  CheckCircle2, ChevronLeft, ChevronRight, Clock3, ExternalLink, LogIn, LogOut,
  MapPin, Moon, RefreshCw, Settings, ShieldCheck, Smartphone, Sun, Upload, X
} from "lucide-react";
import { supabase, hasSupabaseConfig } from "./lib/supabase";
import { countdown, formatClock, hijriDate, localDateKey, prayerDateTime } from "./lib/date";
import { parseCsv, toPrayers } from "./lib/prayers";
import type { PrayerRow, PrayerName } from "./lib/types";
import { waqtDayToPrayerRow, type WaqtPayload } from "./lib/waqt";
import "./styles.css";

const prayerNames: PrayerName[] = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];
const defaultPrefs = {
  Fajr: { enabled: true, mode: "both" },
  Dhuhr: { enabled: true, mode: "both" },
  Asr: { enabled: true, mode: "both" },
  Maghrib: { enabled: true, mode: "both" },
  Isha: { enabled: true, mode: "both" },
};
type Prefs = typeof defaultPrefs;
type Mosque = {
  id: string;
  name: string;
  address: string | null;
  city: string;
  timetable_source: string | null;
  waqt_slug?: string | null;
  waqt_url?: string | null;
};
type Tab = "home" | "timetable" | "settings";

function dateKey(year: number, month: number, day: number) {
  return year + "-" + String(month + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
}
function formatDateLabel(value: string, options: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" }) {
  const [y, m, d] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "Europe/London" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}
function monthLabel(value: Date) {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(value);
}
function getCalendarCells(value: Date) {
  const year = value.getFullYear();
  const month = value.getMonth();
  const offset = new Date(year, month, 1).getDay();
  const count = new Date(year, month + 1, 0).getDate();
  return [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: count }, (_, index) => dateKey(year, month, index + 1)),
  ];
}

export default function App() {
  const [now, setNow] = useState(new Date());
  const [tab, setTab] = useState<Tab>("home");
  const [dark, setDark] = useState(() => localStorage.getItem("noor-theme") !== "light");
  const [busy, setBusy] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [message, setMessage] = useState("");
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [mosques, setMosques] = useState<Mosque[]>([]);
  const [selectedMosqueId, setSelectedMosqueId] = useState("");
  const [waqtSlug, setWaqtSlug] = useState("");
  const [connectingWaqt, setConnectingWaqt] = useState(false);
  const [monthRows, setMonthRows] = useState<PrayerRow[]>([]);
  const [monthCursor, setMonthCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(() => localDateKey());
  const [prefs, setPrefs] = useState<Prefs>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("noor-prefs") || "{}") as Partial<Prefs>;
      return {
        Fajr: { ...defaultPrefs.Fajr, ...(stored.Fajr || {}) },
        Dhuhr: { ...defaultPrefs.Dhuhr, ...(stored.Dhuhr || {}) },
        Asr: { ...defaultPrefs.Asr, ...(stored.Asr || {}) },
        Maghrib: { ...defaultPrefs.Maghrib, ...(stored.Maghrib || {}) },
        Isha: { ...defaultPrefs.Isha, ...(stored.Isha || {}) },
      };
    } catch { return defaultPrefs; }
  });
  const [asrSchool, setAsrSchool] = useState("Hanafi");
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [setupStep, setSetupStep] = useState(0);
  const [pushState, setPushState] = useState("Checking…");
  const [showImportTools, setShowImportTools] = useState(false);
  const [csvText, setCsvText] = useState("");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem("noor-theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    localStorage.setItem("noor-prefs", JSON.stringify(prefs));
  }, [prefs]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSessionEmail(data.session?.user.email ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionEmail(session?.user.email ?? null);
      if (session) {
        setOtpSent(false);
        setOtp("");
      } else {
        setPrefsLoaded(false);
        setSetupRequired(false);
        setSelectedMosqueId("");
        setMonthRows([]);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!client || !sessionEmail) return;
    let active = true;
    const loadSetup = async () => {
      setBusy(true);
      try {
        const [{ data: mosqueData, error: mosqueError }, { data: { user }, error: userError }] = await Promise.all([
          client.from("mosques").select("id,name,address,city,timetable_source,waqt_slug,waqt_url").order("name"),
          client.auth.getUser(),
        ]);
        if (mosqueError) throw mosqueError;
        if (userError || !user) throw userError || new Error("Please sign in again.");
        const available = (mosqueData || []) as Mosque[];
        if (active) setMosques(available);

        const { data, error } = await client.from("user_preferences")
          .select("preferred_mosque_id,location,timezone,asr_school,notifications_enabled,prayer_notification_preferences")
          .eq("user_id", user.id).maybeSingle();
        if (error) throw error;

        if (data) {
          const stored = (data.prayer_notification_preferences || {}) as Partial<Prefs>;
          if (active) {
            setSelectedMosqueId(data.preferred_mosque_id || "");
            setWaqtSlug(available.find(item => item.id === data.preferred_mosque_id)?.waqt_slug || "");
            setAsrSchool(data.asr_school || "Hanafi");
            setNotificationsEnabled(data.notifications_enabled !== false);
            setPrefs({
              Fajr: { ...defaultPrefs.Fajr, ...(stored.Fajr || {}) },
              Dhuhr: { ...defaultPrefs.Dhuhr, ...(stored.Dhuhr || {}) },
              Asr: { ...defaultPrefs.Asr, ...(stored.Asr || {}) },
              Maghrib: { ...defaultPrefs.Maghrib, ...(stored.Maghrib || {}) },
              Isha: { ...defaultPrefs.Isha, ...(stored.Isha || {}) },
            });
            setSetupRequired(!data.preferred_mosque_id);
          }
        } else if (active) {
          setSetupRequired(true);
          if (available[0]) setSelectedMosqueId(available[0].id);
        }
        if (active) setPrefsLoaded(true);
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "Could not load your Noor settings.");
      } finally {
        if (active) setBusy(false);
      }
    };
    void loadSetup();
    return () => { active = false; };
  }, [sessionEmail]);

  async function loadTimetable() {
    if (!supabase || !sessionEmail) {
      setMonthRows([]);
      return;
    }
    setLoadingRows(true);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw userError || new Error("Please sign in again.");
      let query = supabase.from("prayer_times").select("*")
        .eq("user_id", user.id)
        .order("prayer_date", { ascending: true }).limit(1200);
      if (selectedMosqueId) query = query.eq("mosque_id", selectedMosqueId);
      const { data, error } = await query;
      if (error) throw error;
      const uniqueDays = new Map<string, PrayerRow>();
      for (const item of (data || []) as PrayerRow[]) {
        if (!uniqueDays.has(item.prayer_date)) uniqueDays.set(item.prayer_date, item);
      }
      setMonthRows([...uniqueDays.values()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load the mosque timetable.");
    } finally {
      setLoadingRows(false);
    }
  }

  useEffect(() => {
    if (sessionEmail && prefsLoaded) void loadTimetable();
  }, [sessionEmail, selectedMosqueId, prefsLoaded]);

  useEffect(() => {
    const client = supabase;
    if (!client || !sessionEmail || !prefsLoaded || setupRequired || !selectedMosqueId) return;
    let active = true;
    const save = async () => {
      const { data: { user } } = await client.auth.getUser();
      if (!user) return;
      const { error } = await client.from("user_preferences").upsert({
        user_id: user.id,
        preferred_mosque_id: selectedMosqueId,
        location: "Nottingham, UK",
        timezone: "Europe/London",
        asr_school: asrSchool,
        notifications_enabled: notificationsEnabled,
        prayer_notification_preferences: prefs,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (error && active) setMessage(error.message);
    };
    void save();
    return () => { active = false; };
  }, [prefs, asrSchool, notificationsEnabled, selectedMosqueId, prefsLoaded, setupRequired, sessionEmail]);

  useEffect(() => {
    if (!sessionEmail) {
      setPushState("Not signed in");
      return;
    }
    if (!("Notification" in window)) {
      setPushState("Not supported in this browser");
      return;
    }
    if (Notification.permission === "denied") {
      setPushState("Blocked in device settings");
      return;
    }
    if (Notification.permission !== "granted") {
      setPushState("Not enabled on this device");
      return;
    }
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription())
        .then(subscription => setPushState(subscription ? "Enabled on this device" : "Permission granted — not subscribed"))
        .catch(() => setPushState("Permission granted — status unavailable"));
    }
  }, [sessionEmail]);

  const todayKey = localDateKey(now);
  const todayRow = monthRows.find(item => item.prayer_date === todayKey) || null;
  const selectedRow = monthRows.find(item => item.prayer_date === selectedDate) || null;
  const mosque = mosques.find(item => item.id === selectedMosqueId) || null;
  const prayerList = todayRow ? toPrayers(todayRow) : [];
  const next = useMemo(() => {
    for (const day of [...monthRows].sort((a, b) => a.prayer_date.localeCompare(b.prayer_date))) {
      if (day.prayer_date < todayKey) continue;
      for (const prayer of toPrayers(day)) {
        const at = prayerDateTime(day.prayer_date, prayer.time);
        if (at.getTime() > now.getTime()) return { ...prayer, at, date: day.prayer_date };
      }
    }
    return null;
  }, [monthRows, now, todayKey]);
  const remaining = next ? countdown(next.at, now) : null;
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London"
  }).format(now);
  const monthRowsOnly = monthRows.filter(item => item.prayer_date.startsWith(dateKey(monthCursor.getFullYear(), monthCursor.getMonth(), 1).slice(0, 7)));
  const calendarCells = getCalendarCells(monthCursor);
  const selectedLabel = formatDateLabel(selectedDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  async function signIn() {
    const client = supabase;
    const normalizedEmail = email.trim().toLowerCase();
    if (!client || !normalizedEmail) return;
    setBusy(true);
    setMessage("");
    try {
      const { error } = await client.auth.signInWithOtp({ email: normalizedEmail, options: { shouldCreateUser: true } });
      if (error) throw error;
      setEmail(normalizedEmail);
      setOtp("");
      setOtpSent(true);
      setMessage("A verification code has been sent to " + normalizedEmail + ".");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not send your verification code.");
    } finally { setBusy(false); }
  }

  async function verifyEmailCode() {
    const client = supabase;
    const normalizedEmail = email.trim().toLowerCase();
    const token = otp.replace(/\s/g, "");
    if (!client || !normalizedEmail) return;
    if (!/^\d{8}$/.test(token)) {
      setMessage("Enter the eight-digit code from your email.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const { error } = await client.auth.verifyOtp({ email: normalizedEmail, token, type: "email" });
      if (error) throw error;
      setOtp("");
      setOtpSent(false);
      setMessage("You're signed in to Noor. Welcome back!");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That code could not be verified. Check it and try again.");
    } finally { setBusy(false); }
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setMessage("Signed out.");
  }

  async function enablePush() {
    if (!supabase || !sessionEmail) {
      setMessage("Sign in to Noor before enabling notifications.");
      return;
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setMessage("Push notifications are not supported here. On iPhone, add Noor to your Home Screen and open it there.");
      return;
    }
    const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
    if (!publicKey) {
      setMessage("Push notifications are not configured for this deployment.");
      return;
    }
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notification permission was not granted.");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const { error } = await supabase.functions.invoke("register-push", { body: { subscription: subscription.toJSON() } });
      if (error) throw error;
      setPushState("Enabled on this device");
      setMessage("This device is subscribed to Noor notifications.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not enable notifications.");
    } finally { setBusy(false); }
  }

  async function testNotification() {
    if (!supabase || !sessionEmail) return;
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("test-notification");
      if (error) throw error;
      setMessage("Test notification sent. Check this device.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not send a test notification.");
    } finally { setBusy(false); }
  }

  async function connectWaqtMosque() {
    const client = supabase;
    const supplied = waqtSlug.trim();
    if (!client || !sessionEmail) {
      setMessage("Sign in to Noor before connecting a Waqt mosque.");
      return;
    }
    if (!supplied) {
      setMessage("Enter a Waqt mosque page address or slug first.");
      return;
    }

    setConnectingWaqt(true);
    setBusy(true);
    setMessage("");
    try {
      const { data, error } = await client.functions.invoke("waqt-timetable", {
        body: { slug: supplied },
      });
      if (error) {
        if ("context" in error && error.context instanceof Response) {
          const details = await error.context.clone().json().catch(() => null) as { error?: string } | null;
          throw new Error(details?.error || error.message);
        }
        throw error;
      }
      if (data?.error) throw new Error(String(data.error));

      const payload = data?.payload as WaqtPayload | undefined;
      const mosqueData = data?.mosque as Mosque | undefined;
      if (!payload || !mosqueData?.id) {
        throw new Error("Waqt did not return a complete mosque record.");
      }
      if (data?.currentForUkDate === false) {
        throw new Error("Waqt is still serving its previous cached day. To respect its hourly limit, please try again later.");
      }
      if (!payload.today && !payload.tomorrow) {
        throw new Error("Waqt has not published prayer times for today or tomorrow yet.");
      }

      const { data: { user }, error: userError } = await client.auth.getUser();
      if (userError || !user) throw userError || new Error("Please sign in again.");

      const sourceRows = [payload.today, payload.tomorrow]
        .map(day => waqtDayToPrayerRow(day))
        .filter((row): row is NonNullable<typeof row> => Boolean(row));
      if (!sourceRows.length) {
        throw new Error("Waqt has not published complete prayer start times for today or tomorrow.");
      }

      const rows = sourceRows.map(row => ({
        ...row,
        user_id: user.id,
        mosque_id: mosqueData.id,
      }));
      const { error: importError } = await client.from("prayer_times")
        .upsert(rows, { onConflict: "user_id,prayer_date" });
      if (importError) throw importError;

      const { error: preferenceError } = await client.from("user_preferences").upsert({
        user_id: user.id,
        preferred_mosque_id: mosqueData.id,
        location: mosqueData.city || "United Kingdom",
        timezone: "Europe/London",
        asr_school: asrSchool,
        notifications_enabled: notificationsEnabled,
        prayer_notification_preferences: prefs,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (preferenceError) throw preferenceError;

      setMosques(previous => previous.some(item => item.id === mosqueData.id)
        ? previous.map(item => item.id === mosqueData.id ? { ...item, ...mosqueData } : item)
        : [...previous, mosqueData]);
      setSelectedMosqueId(mosqueData.id);
      setWaqtSlug(payload.masjid.slug);
      setMonthRows(previous => {
        const byDate = new Map(previous.map(item => [item.prayer_date, item]));
        rows.forEach(row => byDate.set(row.prayer_date, row as PrayerRow));
        return [...byDate.values()].sort((a, b) => a.prayer_date.localeCompare(b.prayer_date));
      });

      const importedDates = sourceRows.map(row => row.prayer_date).join(" and ");
      setMessage("Connected to " + payload.masjid.name + ". Waqt times imported for " + importedDates + ".");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not connect this Waqt mosque.");
    } finally {
      setConnectingWaqt(false);
      setBusy(false);
    }
  }

  async function saveMosqueChoiceAndCopy(mosqueId: string) {
    const client = supabase;
    if (!client || !sessionEmail) throw new Error("Sign in before choosing a mosque.");
    const { data: { user }, error: userError } = await client.auth.getUser();
    if (userError || !user) throw userError || new Error("Please sign in again.");
    const { error: preferenceError } = await client.from("user_preferences").upsert({
      user_id: user.id,
      preferred_mosque_id: mosqueId,
      location: "Near me, UK",
      timezone: "Europe/London",
      asr_school: asrSchool,
      notifications_enabled: notificationsEnabled,
      prayer_notification_preferences: prefs,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (preferenceError) throw preferenceError;

    const { data: sharedRows, error: rowsError } = await client.from("prayer_times")
      .select("*").eq("mosque_id", mosqueId).order("prayer_date", { ascending: true });
    if (rowsError) throw rowsError;
    if (sharedRows?.length) {
      const copies = sharedRows.map((item: PrayerRow & { created_at?: string }) => {
        const { id: _id, created_at: _createdAt, ...rest } = item;
        return { ...rest, user_id: user.id };
      });
      const { error: copyError } = await client.from("prayer_times")
        .upsert(copies, { onConflict: "user_id,prayer_date" });
      if (copyError) throw copyError;
    }
    setSelectedMosqueId(mosqueId);
    await loadTimetable();
    return sharedRows?.length || 0;
  }

  async function changePreferredMosque(mosqueId: string) {
    if (!mosqueId) {
      setSelectedMosqueId("");
      return;
    }
    setBusy(true);
    try {
      const chosen = mosques.find(item => item.id === mosqueId);
      if (chosen?.waqt_slug) {
        setWaqtSlug(chosen.waqt_slug);
        const { data, error } = await supabase!.functions.invoke("waqt-timetable", { body: { slug: chosen.waqt_slug } });
        if (error) throw error;
        if (data?.error) throw new Error(String(data.error));
        const payload = data?.payload as WaqtPayload;
        const { data: { user } } = await supabase!.auth.getUser();
        if (!user) throw new Error("Please sign in again.");
        const rows = [payload.today, payload.tomorrow].map(waqtDayToPrayerRow)
          .filter((row): row is NonNullable<typeof row> => Boolean(row))
          .map(row => ({ ...row, user_id: user.id, mosque_id: mosqueId }));
        if (rows.length) {
          const { error: upsertError } = await supabase!.from("prayer_times").upsert(rows, { onConflict: "user_id,prayer_date" });
          if (upsertError) throw upsertError;
        }
        setSelectedMosqueId(mosqueId);
        setMonthRows(previous => {
          const byDate = new Map(previous.map(item => [item.prayer_date, item]));
          rows.forEach(row => byDate.set(row.prayer_date, row as PrayerRow));
          return [...byDate.values()].sort((a, b) => a.prayer_date.localeCompare(b.prayer_date));
        });
        setMessage("Your Waqt mosque timetable has been refreshed.");
      } else {
        const days = await saveMosqueChoiceAndCopy(mosqueId);
        setMessage(days ? "Your preferred mosque and timetable have been updated." : "Mosque selected. No verified timetable is available yet.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update your preferred mosque.");
    } finally {
      setBusy(false);
    }
  }

  async function savePreferences() {
    if (!supabase || !sessionEmail) throw new Error("Sign in before saving your preferences.");
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) throw userError || new Error("Please sign in again.");
    const { error } = await supabase.from("user_preferences").upsert({
      user_id: user.id,
      preferred_mosque_id: selectedMosqueId || null,
      location: "Nottingham, UK",
      timezone: "Europe/London",
      asr_school: asrSchool,
      notifications_enabled: notificationsEnabled,
      prayer_notification_preferences: prefs,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) throw error;
    return user.id;
  }

  async function finishSetup() {
    if (!supabase || !selectedMosqueId) {
      setMessage("Please choose your mosque before continuing.");
      return;
    }
    setBusy(true);
    try {
      const userId = await savePreferences();
      const { data: sharedRows, error: rowsError } = await supabase.from("prayer_times")
        .select("*").eq("mosque_id", selectedMosqueId).order("prayer_date", { ascending: true });
      if (rowsError) throw rowsError;

      if (sharedRows?.length) {
        const dates = [...new Set(sharedRows.map((item: PrayerRow) => item.prayer_date))];
        const { data: existing, error: ownError } = await supabase.from("prayer_times")
          .select("prayer_date").eq("user_id", userId).in("prayer_date", dates);
        if (ownError) throw ownError;
        const ownedDates = new Set((existing || []).map((item: { prayer_date: string }) => item.prayer_date));
        const copies = sharedRows.filter((item: PrayerRow) => !ownedDates.has(item.prayer_date)).map((item: PrayerRow) => {
          const { id: _id, created_at: _createdAt, ...rest } = item as PrayerRow & { created_at?: string };
          return { ...rest, user_id: userId };
        });
        if (copies.length) {
          const { error: copyError } = await supabase.from("prayer_times").upsert(copies, { onConflict: "user_id,prayer_date" });
          if (copyError) throw copyError;
        }
      }
      setSetupRequired(false);
      setSetupStep(0);
      setMessage("Noor is ready. Your mosque timetable and preferences are saved.");
      await loadTimetable();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not finish Noor setup.");
    } finally { setBusy(false); }
  }

  async function importCsv() {
    if (!supabase || !sessionEmail) {
      setMessage("Sign in first to import a timetable.");
      return;
    }
    try {
      const parsed = parseCsv(csvText);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Please sign in before importing a timetable.");
      setBusy(true);
      const rows = parsed.map(item => ({ ...item, user_id: user.id, mosque_id: selectedMosqueId || null }));
      const { error } = await supabase.from("prayer_times").upsert(rows, { onConflict: "user_id,prayer_date" });
      if (error) throw error;
      setMessage("Imported " + parsed.length + " timetable day(s).");
      setCsvText("");
      setShowImportTools(false);
      await loadTimetable();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not import the timetable.");
    } finally { setBusy(false); }
  }

  function changeMonth(offset: number) {
    const nextMonth = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + offset, 1);
    setMonthCursor(nextMonth);
    setSelectedDate(dateKey(nextMonth.getFullYear(), nextMonth.getMonth(), 1));
  }

  const signedOutCard = (
    <div className="setting-card">
      <div className="setting-title"><LogIn/><div><strong>Account</strong><span>{sessionEmail || "Sign in to sync your mosque timetable"}</span></div></div>
      {!hasSupabaseConfig ? <div className="notice warning"><AlertCircle size={16}/> Noor's database connection is not configured.</div> :
        sessionEmail ? <div className="account-row"><div className="account-avatar">{sessionEmail.slice(0, 1).toUpperCase()}</div><div className="account-email">{sessionEmail}</div><button className="secondary-btn" onClick={signOut}><LogOut size={15}/> Sign out</button></div> :
        <>
          <label className="field-label" htmlFor="noor-login-email">Email address</label>
          <input id="noor-login-email" className="field" type="email" autoComplete="email" inputMode="email" value={email}
            onChange={event => setEmail(event.target.value)} placeholder="you@example.com" disabled={otpSent || busy}/>
          {!otpSent ? <button className="primary-btn full" onClick={signIn} disabled={busy || !email.trim()}>
            <LogIn size={16}/>{busy ? "Sending code…" : "Send verification code"}
          </button> : <>
            <p className="small-note">Enter the eight-digit code sent to <strong>{email}</strong>.</p>
            <label className="field-label" htmlFor="noor-login-code">Verification code</label>
            <input id="noor-login-code" className="field otp-field" type="text" inputMode="numeric" pattern="[0-9]*"
              autoComplete="one-time-code" maxLength={8} value={otp}
              onChange={event => setOtp(event.target.value.replace(/\D/g, "").slice(0, 8))}
              placeholder="00000000" aria-label="Eight-digit email verification code" disabled={busy}/>
            <button className="primary-btn full" onClick={verifyEmailCode} disabled={busy || otp.length !== 8}>
              <ShieldCheck size={16}/>{busy ? "Verifying…" : "Verify code & sign in"}
            </button>
            <button className="secondary-btn full" onClick={signIn} disabled={busy}><RefreshCw size={15}/> Send a new code</button>
            <button className="text-btn full" onClick={() => { setOtpSent(false); setOtp(""); setMessage(""); }} disabled={busy}>Use a different email</button>
          </>}
        </>}
    </div>
  );

  return (
    <div className={dark ? "app dark" : "app light"}>
      <div className="shell">
        <header className="topbar">
          <button className="brand brand-button" onClick={() => setTab("home")} aria-label="Go to Noor home">
            <div className="brand-mark">ن</div>
            <div className="brand-copy"><div className="brand-name">noor<span>.</span></div><div className="brand-sub">PRAYER COMPANION</div></div>
          </button>
          <div className="top-actions">
            <button className="icon-btn" aria-label="Toggle appearance" onClick={() => setDark(!dark)}>{dark ? <Sun size={18}/> : <Moon size={18}/>}</button>
            <button className="icon-btn" aria-label="Settings" onClick={() => setTab("settings")}><Settings size={18}/></button>
          </div>
        </header>

        {setupRequired && sessionEmail && prefsLoaded ? (
          <main className="setup-screen">
            <div className="setup-brand">ن</div>
            <div className="eyebrow">WELCOME TO NOOR</div>
            <h1>Let's make it yours.</h1>
            <p className="muted">A few quick choices will prepare your daily prayer companion.</p>
            <div className="setup-progress">
              {[0, 1, 2].map(step => <span key={step} className={step <= setupStep ? "active" : ""}/>)}
            </div>
            <div className="setup-card">
              <div className="setup-step-label">STEP {setupStep + 1} OF 3</div>
              {setupStep === 0 && <>
                <div className="setup-icon"><Building2 size={23}/></div>
                <h2>Choose your mosque</h2>
                <p className="muted">Noor will use its timetable for your daily prayer times and reminders.</p>
                <label className="field-label" htmlFor="setup-mosque">Your mosque</label>
                <select id="setup-mosque" className="field" value={selectedMosqueId} onChange={event => setSelectedMosqueId(event.target.value)}>
                  <option value="">Choose a mosque</option>
                  {mosques.map(item => <option key={item.id} value={item.id}>{item.name} · {item.city}</option>)}
                </select>
                {mosque && <div className="mosque-choice"><MapPin size={16}/><div><strong>{mosque.name}</strong><span>{mosque.address}</span></div><CheckCircle2 size={18}/></div>}
                <div className="waqt-connect-box">
                  <div className="waqt-connect-heading"><CalendarDays size={17}/><strong>Use a Waqt UK mosque timetable</strong></div>
                  <a className="secondary-btn full external-link" href="https://waqt.uk/" target="_blank" rel="noreferrer">
                    <MapPin size={15}/> Find your nearest mosque on Waqt UK <ExternalLink size={13}/>
                  </a>
                  <a className="waqt-directory-link" href="https://waqt.uk/nottingham/" target="_blank" rel="noreferrer">
                    Browse Nottingham mosque directory <ExternalLink size={11}/>
                  </a>
                  <label className="field-label" htmlFor="setup-waqt-slug">Waqt mosque page or slug</label>
                  <input id="setup-waqt-slug" className="field" value={waqtSlug} onChange={event => setWaqtSlug(event.target.value)}
                    placeholder="https://waqt.uk/shahjalal/ or shahjalal" autoCapitalize="none" autoCorrect="off"/>
                  <p className="small-note">Open Waqt, choose your mosque, then paste its page address here. Noor fetches today's and tomorrow's published times.</p>
                  <button className="primary-btn full" onClick={connectWaqtMosque} disabled={connectingWaqt || busy || !waqtSlug.trim()}>
                    <RefreshCw size={15}/>{connectingWaqt ? "Connecting to Waqt…" : "Connect Waqt timetable"}
                  </button>
                  <p className="waqt-attribution-note">Times from Waqt · cached at most once an hour.</p>
                </div>
              </>}
              {setupStep === 1 && <>
                <div className="setup-icon"><Moon size={23}/></div>
                <h2>Prayer preferences</h2>
                <p className="muted">Your selected mosque timetable provides the times. Choose the Asr school used for your practice.</p>
                <div className="preference-choice">
                  <button className={asrSchool === "Hanafi" ? "selected" : ""} onClick={() => setAsrSchool("Hanafi")}><strong>Hanafi</strong><span>Later Asr calculation</span></button>
                  <button className={asrSchool === "Standard" ? "selected" : ""} onClick={() => setAsrSchool("Standard")}><strong>Standard</strong><span>Earlier Asr calculation</span></button>
                </div>
                <p className="small-note">Fazilat Masjid's timetable timings remain authoritative when selected. This choice is saved as your preference.</p>
              </>}
              {setupStep === 2 && <>
                <div className="setup-icon"><BellRing size={23}/></div>
                <h2>Stay in the moment</h2>
                <p className="muted">Allow notifications so Noor can remind you when each prayer begins.</p>
                <div className="notification-explainer"><Smartphone size={20}/><div><strong>Prayer reminders on this device</strong><span>You can change these settings at any time.</span></div></div>
                <button className="secondary-btn full" onClick={enablePush} disabled={busy}><Bell size={16}/> {pushState.startsWith("Enabled") ? "Notifications enabled" : "Enable notifications"}</button>
                <button className="text-btn full" onClick={() => setNotificationsEnabled(false)}>I'll do this later</button>
              </>}
              <div className="setup-actions">
                {setupStep > 0 && <button className="secondary-btn" onClick={() => setSetupStep(step => step - 1)} disabled={busy}>Back</button>}
                {setupStep < 2 ? <button className="primary-btn" onClick={() => {
                  if (setupStep === 0 && !selectedMosqueId) { setMessage("Choose your mosque to continue."); return; }
                  setSetupStep(step => step + 1);
                }}>Continue <ChevronRight size={16}/></button> :
                  <button className="primary-btn" onClick={finishSetup} disabled={busy || !selectedMosqueId}>{busy ? "Setting up Noor…" : "Finish setup"} <CheckCircle2 size={16}/></button>}
              </div>
            </div>
            <p className="setup-footnote">You can update your mosque and preferences in Settings whenever you need.</p>
          </main>
        ) : (
          <main>
            {tab === "home" && <>
              <section className="welcome welcome-compact">
                <div className="eyebrow"><MapPin size={13}/> {mosque?.city || "YOUR PRAYER COMPANION"}</div>
                <h1>Assalamu Alaikum<span className="gold">.</span></h1>
                <p className="muted">{dateLabel} <span className="dot">·</span> {hijriDate(now)}</p>
                {mosque && <button className="mosque-pill" onClick={() => setTab("settings")}><Building2 size={13}/>{mosque.name}<ChevronRight size={13}/></button>}
              </section>

              <section className="hero-card hero-card-premium">
                <div className="hero-pattern"></div>
                <div className="hero-top"><span className="eyebrow pale">NEXT PRAYER</span><span className="live-dot">● LIVE</span></div>
                {next && remaining ? <>
                  <div className="next-name">{next.name}</div>
                  <div className="arabic">{next.arabic}</div>
                  <div className="next-time">{formatClock(next.time)}</div>
                  <div className="countdown-label">TIME REMAINING</div>
                  <div className="countdown">
                    {remaining.days > 0 && <TimeUnit value={remaining.days} label="DAYS"/>}
                    <TimeUnit value={remaining.hours} label="HOURS"/>
                    <TimeUnit value={remaining.minutes} label="MINUTES"/>
                    <TimeUnit value={remaining.seconds} label="SECONDS"/>
                  </div>
                  {next.calculated && <div className="next-jamaat">Start time calculated by Waqt</div>}
                  {next.jamaat && <div className="next-jamaat">Jamaat {formatClock(next.jamaat)}</div>}
                  {next.date !== todayKey && <div className="next-jamaat">{formatDateLabel(next.date, { weekday: "long", day: "numeric", month: "short" })}</div>}
                </> : <div className="empty-next"><Clock3 size={24}/><strong>{monthRows.length ? "No upcoming prayer time found" : "Your timetable is waiting"}</strong><span>{monthRows.length ? "Check your next month's timetable or refresh the schedule." : "Choose a mosque with an available timetable to get started."}</span></div>}
                <div className="hero-footer"><span><ShieldCheck size={14}/> {asrSchool} Asr</span><span>Europe/London</span></div>
              </section>

              <section className="section-head section-head-premium">
                <div><div className="eyebrow">TODAY'S SCHEDULE</div><h2>Prayer times</h2></div>
                <button className="text-btn" onClick={() => { setSelectedDate(todayKey); setMonthCursor(new Date(now.getFullYear(), now.getMonth(), 1)); setTab("timetable"); }}><CalendarDays size={14}/> Full timetable</button>
              </section>

              {!todayRow ? <div className="empty-card">
                <div className="empty-icon"><CalendarDays size={23}/></div>
                <h3>No timetable for today</h3>
                <p>{mosque ? "No verified prayer timetable is available for " + mosque.name + " yet. You can choose another nearby mosque or add its official timetable when you receive it." : "Noor doesn't estimate prayer times. Find a nearby mosque with a published timetable to get started."}</p>
                <button className="secondary-btn" onClick={() => setTab("settings")}><MapPin size={15}/> Find another mosque</button>
                <button className="primary-btn" onClick={() => setTab("timetable")}>View timetable <ChevronRight size={16}/></button>
              </div> : <div className="prayer-list">
                {prayerList.map((prayer, index) => <div className={"prayer-row " + (next?.name === prayer.name && next.date === todayKey ? "is-next" : "")} key={prayer.name}>
                  <div className="prayer-symbol">{["✦","☀","◈","☾","✧"][index]}</div>
                  <div className="prayer-info"><strong>{prayer.name}</strong><span>{prayer.arabic}</span></div>
                  <div className="prayer-time-wrap">
                    <div className="prayer-time">{formatClock(prayer.time)}</div>
                    {prayer.calculated && <div className="prayer-calculated">Calculated start</div>}
                    {prayer.jamaat && <div className="prayer-jamaat">Jamaat {formatClock(prayer.jamaat)}</div>}
                  </div>
                  <div className="prayer-status">{prefs[prayer.name].enabled ? <Bell size={15}/> : <Bell size={15} className="dim"/>}</div>
                </div>)}
                {todayRow.sunrise && <div className="sunrise-row"><Sun size={14}/> Sunrise <span>{formatClock(todayRow.sunrise)}</span></div>}
                <div className="source-note">{mosque?.name || "Local mosque"} · {todayRow.source || "Mosque timetable"}
                  {mosque?.waqt_slug && <> · <a className="waqt-inline-link" href="https://waqt.uk/" target="_blank" rel="noreferrer">Times from Waqt</a></>}
                </div>
              </div>}

              <section className="home-shortcuts">
                <button className="shortcut-card" onClick={() => setTab("timetable")}><CalendarDays/><span><strong>Monthly timetable</strong><small>Browse dates and Jamaat times</small></span><ChevronRight size={16}/></button>
                <button className="shortcut-card" onClick={() => setTab("settings")}><Bell/><span><strong>Prayer reminders</strong><small>{notificationsEnabled ? "Manage your alerts" : "Reminders are paused"}</small></span><ChevronRight size={16}/></button>
              </section>
            </>}

            {tab === "timetable" && <section className="page-section timetable-page">
              <div className="eyebrow">YOUR MOSQUE SCHEDULE</div>
              <h1>Timetable</h1>
              <p className="muted">{mosque?.name || "Choose a mosque"} · {mosque?.city || "Nottingham"}</p>
              <div className="month-toolbar">
                <button className="icon-btn" aria-label="Previous month" onClick={() => changeMonth(-1)}><ChevronLeft size={18}/></button>
                <div><strong>{monthLabel(monthCursor)}</strong><span>{monthRowsOnly.length} timetable days available</span></div>
                <button className="icon-btn" aria-label="Next month" onClick={() => changeMonth(1)}><ChevronRight size={18}/></button>
              </div>
              <div className="calendar-card">
                <div className="calendar-weekdays">{["S","M","T","W","T","F","S"].map((day, index) => <span key={day + index}>{day}</span>)}</div>
                <div className="calendar-grid">
                  {calendarCells.map((day, index) => {
                    if (!day) return <span className="calendar-empty" key={"empty-" + index}/>;
                    const hasTimes = monthRows.some(item => item.prayer_date === day);
                    const isToday = day === todayKey;
                    const isSelected = day === selectedDate;
                    return <button key={day} className={"calendar-day" + (isToday ? " today" : "") + (isSelected ? " selected" : "") + (hasTimes ? " has-times" : "")}
                      onClick={() => setSelectedDate(day)} aria-label={formatDateLabel(day, { weekday: "long", day: "numeric", month: "long" })}>
                      <span>{Number(day.slice(-2))}</span>{hasTimes && <i/>}
                    </button>;
                  })}
                </div>
                <div className="calendar-legend"><span><i className="legend-dot"/> Mosque timetable available</span><span><i className="legend-today"/> Today</span></div>
              </div>
              <div className="selected-date-heading">
                <div><div className="eyebrow">SELECTED DAY</div><h2>{selectedLabel}</h2></div>
                <button className="text-btn" onClick={() => setSelectedDate(todayKey)}>Today</button>
              </div>
              {selectedRow ? <div className="prayer-list selected-day-list">
                {toPrayers(selectedRow).map(prayer => <div className="prayer-row" key={prayer.name}>
                  <div className="prayer-info"><strong>{prayer.name}</strong><span>{prayer.arabic}</span></div>
                  <div className="prayer-time-wrap"><div className="prayer-time">{formatClock(prayer.time)}</div>{prayer.calculated && <div className="prayer-calculated">Calculated start</div>}{prayer.jamaat && <div className="prayer-jamaat">Jamaat {formatClock(prayer.jamaat)}</div>}</div>
                </div>)}
                {selectedRow.sunrise && <div className="sunrise-row"><Sun size={14}/> Sunrise <span>{formatClock(selectedRow.sunrise)}</span></div>}
                <div className="source-note">{selectedRow.source || "Mosque timetable"}
                  {mosque?.waqt_slug && <> · <a className="waqt-inline-link" href="https://waqt.uk/" target="_blank" rel="noreferrer">Times from Waqt</a></>}
                </div>
              </div> : <div className="empty-card compact-empty"><CalendarDays size={21}/><h3>No timings published for this date</h3><p>Choose a highlighted date to see the mosque's prayer and Jamaat times.</p></div>}
              {loadingRows && <div className="status-line"><span className="status-dot"/> Updating timetable…</div>}
            </section>}

            {tab === "settings" && <section className="page-section settings-page">
              <div className="eyebrow">PERSONALISE NOOR</div><h1>Settings</h1>
              <p className="muted">Everything you need to make Noor feel right for you.</p>

              <div className="settings-group-label">YOUR PLACE</div>
              <div className="setting-card">
                <div className="setting-title"><Building2/><div><strong>Mosque & location</strong><span>Your timetable source and local time</span></div></div>
                <label className="field-label" htmlFor="settings-mosque">Preferred mosque</label>
                <select id="settings-mosque" className="field" value={selectedMosqueId} onChange={event => void changePreferredMosque(event.target.value)} disabled={busy}>
                  <option value="">Choose a mosque</option>{mosques.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                {mosque && <div className="mosque-address"><MapPin size={15}/><span>{mosque.address || mosque.city}</span></div>}
                <div className="waqt-connect-box">
                  <div className="waqt-connect-heading"><CalendarDays size={17}/><strong>Waqt UK timetable</strong></div>
                  {mosque?.waqt_slug && <div className="waqt-connected-label"><CheckCircle2 size={14}/> Connected: {mosque.name}</div>}
                  <a className="secondary-btn full external-link" href="https://waqt.uk/" target="_blank" rel="noreferrer">
                    <MapPin size={15}/> Find your nearest mosque on Waqt UK <ExternalLink size={13}/>
                  </a>
                  <a className="waqt-directory-link" href="https://waqt.uk/nottingham/" target="_blank" rel="noreferrer">
                    Browse Nottingham mosque directory <ExternalLink size={11}/>
                  </a>
                  <label className="field-label" htmlFor="settings-waqt-slug">Waqt mosque page or slug</label>
                  <input id="settings-waqt-slug" className="field" value={waqtSlug} onChange={event => setWaqtSlug(event.target.value)}
                    placeholder={mosque?.waqt_slug || "https://waqt.uk/masjid-name/"} autoCapitalize="none" autoCorrect="off"/>
                  <p className="small-note">Paste a mosque page from Waqt. Noor securely retrieves and caches its published timetable for today and tomorrow.</p>
                  <button className="primary-btn full" onClick={connectWaqtMosque} disabled={connectingWaqt || busy || !waqtSlug.trim()}>
                    <RefreshCw size={15}/>{connectingWaqt ? "Refreshing timetable…" : "Connect / refresh Waqt timetable"}
                  </button>
                  {mosque?.waqt_slug && <a className="waqt-directory-link" href={mosque.waqt_url || "https://waqt.uk/" + mosque.waqt_slug + "/"} target="_blank" rel="noreferrer">
                    View selected mosque on Waqt <ExternalLink size={11}/>
                  </a>}
                  <p className="waqt-attribution-note">Times from Waqt · no API key required · cached at most once an hour.</p>
                </div>
                <div className="setting-line"><span>Time zone</span><strong>Europe/London</strong></div>
                <div className="setting-line"><span>Asr preference</span>
                  <select className="inline-select" value={asrSchool} onChange={event => setAsrSchool(event.target.value)}>
                    <option>Hanafi</option><option>Standard</option>
                  </select>
                </div>
              </div>

              <div className="settings-group-label">PRAYER REMINDERS</div>
              <div className="setting-card">
                <div className="setting-title"><Bell/><div><strong>Notifications</strong><span>Choose which prayers can notify you</span></div></div>
                <div className="toggle-line global-toggle"><div><strong>All prayer notifications</strong><span>Master switch for your reminders</span></div>
                  <input type="checkbox" checked={notificationsEnabled} onChange={event => setNotificationsEnabled(event.target.checked)}/>
                </div>
                {prayerNames.map(name => <div className="toggle-line" key={name}>
                  <div><strong>{name}</strong><span>Prayer-start reminder</span></div>
                  <input type="checkbox" checked={prefs[name].enabled} disabled={!notificationsEnabled}
                    onChange={event => setPrefs(old => ({ ...old, [name]: { ...old[name], enabled: event.target.checked } }))}/>
                </div>)}
                <div className="status-line"><span className={"status-dot " + (pushState.startsWith("Enabled") ? "green" : "")}/>{pushState}</div>
                <button className="primary-btn full" onClick={enablePush} disabled={busy || pushState.startsWith("Enabled")}><BellRing size={16}/>{pushState.startsWith("Enabled") ? "This device is enabled" : "Enable on this device"}</button>
                <button className="secondary-btn full" onClick={testNotification} disabled={busy || !sessionEmail}>Send test notification</button>
              </div>

              <div className="settings-group-label">APP PREFERENCES</div>
              <div className="setting-card">
                <div className="setting-title"><Sun/><div><strong>Appearance</strong><span>Choose a comfortable display</span></div></div>
                <div className="appearance-options">
                  <button className={!dark ? "selected" : ""} onClick={() => setDark(false)}><Sun size={16}/> Light</button>
                  <button className={dark ? "selected" : ""} onClick={() => setDark(true)}><Moon size={16}/> Dark</button>
                </div>
              </div>

              <div className="settings-group-label">ACCOUNT</div>
              {signedOutCard}

              <div className="settings-group-label">MOSQUE TIMETABLE MANAGEMENT</div>
              <div className="setting-card import-card">
                <button className="disclosure-button" onClick={() => setShowImportTools(value => !value)}>
                  <span><Upload size={18}/><span><strong>Manage timetable data</strong><small>Import an official monthly CSV timetable</small></span></span>
                  <ChevronRight className={showImportTools ? "rotated" : ""} size={18}/>
                </button>
                {showImportTools && <div className="import-tools">
                  <p className="small-note">CSV columns: date, fajr, sunrise, dhuhr, asr, maghrib, isha, fajr_jamaat, dhuhr_jamaat, asr_jamaat, isha_jamaat, source. Use YYYY-MM-DD dates and 24-hour HH:MM times.</p>
                  <textarea className="csv-area" value={csvText} onChange={event => setCsvText(event.target.value)}
                    placeholder={"date,fajr,sunrise,dhuhr,asr,maghrib,isha,fajr_jamaat,dhuhr_jamaat,asr_jamaat,isha_jamaat,source\n2026-12-01,05:50,08:00,11:55,14:00,15:45,17:50,06:45,13:30,14:30,19:00,Official mosque timetable"}/>
                  <button className="primary-btn full" onClick={importCsv} disabled={busy || !csvText.trim() || !supabase}><Upload size={16}/> Import timetable</button>
                </div>}
              </div>
            </section>}
          </main>
        )}

        {message && <div className="toast" role="status"><AlertCircle size={16}/><span>{message}</span><button onClick={() => setMessage("")}><X size={15}/></button></div>}

        {!(setupRequired && sessionEmail && prefsLoaded) && <nav className="bottom-nav">
          <button className={tab === "home" ? "selected" : ""} onClick={() => setTab("home")}><Moon/><span>Home</span></button>
          <button className={tab === "timetable" ? "selected" : ""} onClick={() => setTab("timetable")}><CalendarDays/><span>Timetable</span></button>
          <button className={tab === "settings" ? "selected" : ""} onClick={() => setTab("settings")}><Settings/><span>Settings</span></button>
        </nav>}
        <footer className="footer-note">Made with intention <span>✦</span> Noor Prayer Companion</footer>
      </div>
    </div>
  );
}

function TimeUnit({ value, label }: { value: number; label: string }) {
  return <div className="time-unit"><strong>{String(value).padStart(2, "0")}</strong><span>{label}</span></div>;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
}

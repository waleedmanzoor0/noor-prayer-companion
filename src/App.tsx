import { useEffect, useMemo, useRef, useState } from "react";
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
  masjidi_id?: string | null;
  masjidi_supported?: boolean;
  masjidi_db_supported?: boolean;
  latitude?: number | null;
  longitude?: number | null;
};
type NearbyMasjid = {
  mosqueId: string; masjidiId: string; name: string;
  address: string | null; city: string; postcode: string | null;
  distanceMiles: number | null; phone: string | null; website: string | null;
  denomination: string | null; prayerTimesAvailable: boolean;
  jamaatTimesAvailable: boolean; lastUpdated: string | null; dbSupported: boolean;
};
type Madhhab = "Hanafi" | "Maliki" | "Shafi'i" | "Hanbali";
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
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [mosques, setMosques] = useState<Mosque[]>([]);
  const [selectedMosqueId, setSelectedMosqueId] = useState("");
  const [waqtSlug, setWaqtSlug] = useState("");
  const [connectingWaqt, setConnectingWaqt] = useState(false);
  const autoWaqtRefreshAttempt = useRef("");
  const [postcode, setPostcode] = useState("");
  const [madhhab, setMadhhab] = useState<Madhhab>("Hanafi");
  const [mosqueRadius, setMosqueRadius] = useState(5);
  const [nearbyMosques, setNearbyMosques] = useState<NearbyMasjid[]>([]);
  const [nearbyResultsOpen, setNearbyResultsOpen] = useState(false);
  const [searchingMosques, setSearchingMosques] = useState(false);
  const [masjidiSyncing, setMasjidiSyncing] = useState(false);
  const autoMasjidiRefreshAttempt = useRef("");
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
  const [savingNotificationSetting, setSavingNotificationSetting] = useState(false);
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
    const client = supabase;
    if (!client) {
      setMessage("Noor could not connect to its database. Please refresh the page.");
      setAuthReady(true);
      return;
    }

    let mounted = true;
    let guestSignInStarted = false;
    const startGuestSession = () => {
      if (guestSignInStarted) return;
      guestSignInStarted = true;
      // Start outside the Supabase auth callback to avoid locking auth state
      // while signInAnonymously emits its SIGNED_IN event.
      window.setTimeout(() => {
        void client.auth.signInAnonymously().then(({ data, error }) => {
          if (!mounted) return;
          if (error) throw error;
          if (!data.user) throw new Error("Supabase did not return a guest user.");
          setSessionEmail(data.user.email ?? "Guest");
          setAuthReady(true);
        }).catch(error => {
          if (!mounted) return;
          setMessage(error instanceof Error ? error.message : "Could not start a guest session. Please refresh Noor.");
          setAuthReady(true);
        });
      }, 0);
    };

    const { data: listener } = client.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (session) {
        setSessionEmail(session.user.email ?? "Guest");
        setOtpSent(false);
        setOtp("");
        setAuthReady(true);
      } else if (event === "INITIAL_SESSION") {
        startGuestSession();
      } else if (event === "SIGNED_OUT") {
        setSessionEmail(null);
        setPrefsLoaded(false);
        setSetupRequired(false);
        setSelectedMosqueId("");
        setMonthRows([]);
        startGuestSession();
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!client || !sessionEmail) return;
    let active = true;
    const loadSetup = async () => {
      setBusy(true);
      try {
        const [{ data: mosqueData, error: mosqueError }, { data: { user }, error: userError }] = await Promise.all([
          client.from("mosques").select("id,name,address,city,timetable_source,waqt_slug,waqt_url,masjidi_id,masjidi_supported,masjidi_db_supported,latitude,longitude").order("name"),
          client.auth.getUser(),
        ]);
        if (mosqueError) throw mosqueError;
        if (userError || !user) throw userError || new Error("Please sign in again.");
        const available = (mosqueData || []) as Mosque[];
        if (active) setMosques(available);

        const { data, error } = await client.from("user_preferences")
          .select("preferred_mosque_id,location,timezone,asr_school,madhhab,postcode,notifications_enabled,prayer_notification_preferences")
          .eq("user_id", user.id).maybeSingle();
        if (error) throw error;

        if (data) {
          const stored = (data.prayer_notification_preferences || {}) as Partial<Prefs>;
          if (active) {
            setSelectedMosqueId(data.preferred_mosque_id || "");
            setWaqtSlug(available.find(item => item.id === data.preferred_mosque_id)?.waqt_slug || "");
            setPostcode(data.postcode || "");
            const savedMadhhab = ["Hanafi", "Maliki", "Shafi'i", "Hanbali"].includes(String(data.madhhab))
              ? data.madhhab as Madhhab
              : "Hanafi";
            setMadhhab(savedMadhhab);
            setAsrSchool(savedMadhhab === "Hanafi" ? "Hanafi" : "Standard");
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
          setPostcode("");
          setSelectedMosqueId("");
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
        location: postcode.trim().toUpperCase() || "United Kingdom",
        postcode: postcode.trim().toUpperCase() || null,
        timezone: "Europe/London",
        madhhab,
        asr_school: madhhab === "Hanafi" ? "Hanafi" : "Standard",
        notifications_enabled: notificationsEnabled,
        prayer_notification_preferences: prefs,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (error && active) setMessage(error.message);
    };
    void save();
    return () => { active = false; };
  }, [prefs, madhhab, postcode, notificationsEnabled, selectedMosqueId, prefsLoaded, setupRequired, sessionEmail]);

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
  const currentPrayer = useMemo(() => {
    let latest: (ReturnType<typeof toPrayers>[number] & { at: Date; date: string }) | null = null;
    for (const day of monthRows) {
      if (day.prayer_date > todayKey) continue;
      for (const prayer of toPrayers(day)) {
        const at = prayerDateTime(day.prayer_date, prayer.time);
        if (at.getTime() <= now.getTime() && (!latest || at.getTime() > latest.at.getTime())) {
          latest = { ...prayer, at, date: day.prayer_date };
        }
      }
    }
    return latest;
  }, [monthRows, now, todayKey]);
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London"
  }).format(now);
  const monthRowsOnly = monthRows.filter(item => item.prayer_date.startsWith(dateKey(monthCursor.getFullYear(), monthCursor.getMonth(), 1).slice(0, 7)));
  const calendarCells = getCalendarCells(monthCursor);
  const selectedLabel = formatDateLabel(selectedDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const selectedMasjidiMosque = mosques.find(item => item.id === selectedMosqueId && item.masjidi_id);

  useEffect(() => {
    if (!sessionEmail || !prefsLoaded || setupRequired || !selectedMasjidiMosque?.masjidi_id) return;
    const key = selectedMasjidiMosque.id + ":" + monthCursor.getFullYear() + "-" + String(monthCursor.getMonth() + 1);
    if (autoMasjidiRefreshAttempt.current === key) return;
    autoMasjidiRefreshAttempt.current = key;
    void syncMasjidiMonth(
      selectedMasjidiMosque.id,
      selectedMasjidiMosque.masjidi_id,
      monthCursor.getFullYear(),
      monthCursor.getMonth() + 1,
      true,
    ).catch(error => setMessage(error instanceof Error ? error.message : "Could not refresh the mosque timetable."));
  }, [sessionEmail, prefsLoaded, setupRequired, selectedMasjidiMosque?.id, selectedMasjidiMosque?.masjidi_id, monthCursor]);

  // Refresh a selected Waqt mosque once when Noor opens on a new UK day.
  // The server-side shared cache still enforces Waqt's hourly request limit.
  useEffect(() => {
    if (!sessionEmail || !prefsLoaded || setupRequired || !selectedMosqueId) return;
    const selected = mosques.find(item => item.id === selectedMosqueId);
    if (!selected?.waqt_slug || selected.masjidi_id) return;
    const refreshKey = selected.id + ":" + todayKey;
    if (autoWaqtRefreshAttempt.current === refreshKey) return;
    autoWaqtRefreshAttempt.current = refreshKey;
    setWaqtSlug(selected.waqt_slug);
    void connectWaqtMosque(selected.waqt_slug, true);
  }, [sessionEmail, prefsLoaded, setupRequired, selectedMosqueId, mosques, todayKey]);

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

  async function updateGlobalNotifications(enabled: boolean) {
    const previous = notificationsEnabled;
    setNotificationsEnabled(enabled);

    if (!supabase || !sessionEmail || !prefsLoaded || setupRequired) return;

    setSavingNotificationSetting(true);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw userError || new Error("Please sign in again.");

      const { error } = await supabase.from("user_preferences").upsert({
        user_id: user.id,
        preferred_mosque_id: selectedMosqueId || null,
        location: "Nottingham, UK",
        timezone: "Europe/London",
        asr_school: asrSchool,
        notifications_enabled: enabled,
        prayer_notification_preferences: prefs,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (error) throw error;

      setMessage(enabled
        ? "Prayer notifications are switched on."
        : "All Noor prayer notifications are paused. You can turn them back on at any time.");
    } catch (error) {
      setNotificationsEnabled(previous);
      setMessage(error instanceof Error
        ? "Could not save your notification setting: " + error.message
        : "Could not save your notification setting.");
    } finally {
      setSavingNotificationSetting(false);
    }
  }

  async function testNotification() {
    if (!supabase || !sessionEmail) return;
    if (!notificationsEnabled) {
      setMessage("Prayer notifications are paused. Turn them back on before sending a test.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("test-notification");
      if (error) throw error;
      setMessage("Test notification sent. Check this device.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not send a test notification.");
    } finally { setBusy(false); }
  }

  async function connectWaqtMosque(rawSlug = waqtSlug, silent = false) {
    const client = supabase;
    const supplied = rawSlug.trim();
    if (!client || !sessionEmail) {
      setMessage("Sign in to Noor before connecting a Waqt mosque.");
      return;
    }
    if (!supplied) {
      setMessage("Enter a Waqt mosque page address or slug first.");
      return;
    }

    if (!silent) {
      setConnectingWaqt(true);
      setBusy(true);
      setMessage("");
    }
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

      if (data?.currentForUkDate === false) {
        throw new Error("Waqt is still serving its previous cached day. To respect its hourly limit, please try again later.");
      }
      const payload = data?.payload as WaqtPayload | undefined;
      const mosqueData = data?.mosque as Mosque | undefined;
      if (!payload || !mosqueData?.id) {
        throw new Error("Waqt did not return a complete mosque record.");
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
      const importedDateKeys = sourceRows.map(row => row.prayer_date);
      const { data: savedRows, error: savedRowsError } = await client.from("prayer_times")
        .select("*")
        .eq("user_id", user.id)
        .eq("mosque_id", mosqueData.id)
        .in("prayer_date", importedDateKeys);
      if (savedRowsError) throw savedRowsError;

      setSelectedMosqueId(mosqueData.id);
      setWaqtSlug(payload.masjid.slug);
      if (savedRows?.length) {
        setMonthRows(previous => {
          const byDate = new Map(previous.map(item => [item.prayer_date, item]));
          (savedRows as PrayerRow[]).forEach(row => byDate.set(row.prayer_date, row));
          return [...byDate.values()].sort((a, b) => a.prayer_date.localeCompare(b.prayer_date));
        });
      }

      const importedDates = sourceRows.map(row => row.prayer_date).join(" and ");
      if (!silent) {
        setMessage("Connected to " + payload.masjid.name + ". Waqt times imported for " + importedDates + ".");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not connect this Waqt mosque.");
    } finally {
      if (!silent) {
        setConnectingWaqt(false);
        setBusy(false);
      }
    }
  }

  async function discoverNearbyMosques() {
    if (!supabase || !sessionEmail) {
      setMessage("Sign in to Noor before searching for nearby mosques.");
      return;
    }
    const value = postcode.trim().toUpperCase();
    if (!value) {
      setMessage("Enter your UK postcode to find nearby mosques.");
      return;
    }
    setSearchingMosques(true);
    setNearbyMosques([]);
    setNearbyResultsOpen(true);
    setMessage("");
    try {
      const { data, error } = await supabase.functions.invoke("masjidi-discover", {
        body: { postcode: value, radiusMiles: mosqueRadius },
      });
      if (error) {
        if ("context" in error && error.context instanceof Response) {
          const detail = await error.context.clone().json().catch(() => null) as { error?: string } | null;
          throw new Error(detail?.error || error.message);
        }
        throw error;
      }
      if (data?.error) throw new Error(String(data.error));
      const results = ((data?.mosques || []) as NearbyMasjid[])
        .filter(item => item.prayerTimesAvailable);
      setPostcode(data?.postcode || value);
      setNearbyMosques(results);
      setNearbyResultsOpen(results.length > 0);
      setMessage(results.length
        ? "Found " + results.length + " mosques with prayer times."
        : "No mosques with published prayer times were found within " + mosqueRadius + " miles. Try a wider search radius.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not search for nearby mosques.");
    } finally {
      setSearchingMosques(false);
    }
  }

  async function syncMasjidiMonth(
    mosqueId: string,
    masjidiId: string,
    year: number,
    month: number,
    silent = false,
  ) {
    if (!supabase || !sessionEmail) throw new Error("Sign in to Noor before syncing mosque prayer times.");
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) throw userError || new Error("Please sign in again.");

    if (!silent) setMasjidiSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("masjidi-timetable", {
        body: { mosqueId, masjidiId, year, month },
      });
      if (error) {
        if ("context" in error && error.context instanceof Response) {
          const detail = await error.context.clone().json().catch(() => null) as { error?: string } | null;
          throw new Error(detail?.error || error.message);
        }
        throw error;
      }
      if (data?.error) throw new Error(String(data.error));
      if (!data?.daysImported) throw new Error("Masjidi has not published a complete timetable for this month.");

      const firstDay = year + "-" + String(month).padStart(2, "0") + "-01";
      const lastDay = year + "-" + String(month).padStart(2, "0") + "-" + String(new Date(year, month, 0).getDate()).padStart(2, "0");
      const { data: rows, error: rowsError } = await supabase.from("prayer_times")
        .select("*")
        .eq("user_id", user.id)
        .eq("mosque_id", mosqueId)
        .gte("prayer_date", firstDay)
        .lte("prayer_date", lastDay)
        .order("prayer_date");
      if (rowsError) throw rowsError;
      if (rows?.length) {
        setMonthRows(previous => {
          const byDate = new Map(previous.map(item => [item.prayer_date, item]));
          (rows as PrayerRow[]).forEach(row => byDate.set(row.prayer_date, row));
          return [...byDate.values()].sort((a, b) => a.prayer_date.localeCompare(b.prayer_date));
        });
      }
      if (!silent) {
        setMessage(
          "Updated " + data.daysImported + " prayer days from Masjidi." +
          (data.jamaatDays ? " Jamaat times are available for " + data.jamaatDays + " day(s)." : " Jamaat times have not been published for this mosque.")
        );
      }
      return data;
    } finally {
      if (!silent) setMasjidiSyncing(false);
    }
  }

  async function selectNearbyMasjid(item: NearbyMasjid, persistSelection = false) {
    if (!item.prayerTimesAvailable) {
      setMessage("This mosque is listed in Masjidi, but it does not currently publish complete prayer start times.");
      return;
    }
    setBusy(true);
    try {
      const nowParts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London", year: "numeric", month: "2-digit",
      }).formatToParts(new Date());
      const year = Number(nowParts.find(part => part.type === "year")?.value);
      const month = Number(nowParts.find(part => part.type === "month")?.value);

      await syncMasjidiMonth(item.mosqueId, item.masjidiId, year, month, false);
      autoMasjidiRefreshAttempt.current = item.mosqueId + ":" + year + "-" + String(month);
      if (persistSelection) {
        const { data: { user }, error: userError } = await supabase!.auth.getUser();
        if (userError || !user) throw userError || new Error("Please sign in again.");
        const { error } = await supabase!.from("user_preferences").upsert({
          user_id: user.id,
          preferred_mosque_id: item.mosqueId,
          postcode: postcode.trim().toUpperCase() || null,
          location: postcode.trim().toUpperCase() || "United Kingdom",
          timezone: "Europe/London",
          madhhab,
          asr_school: madhhab === "Hanafi" ? "Hanafi" : "Standard",
          notifications_enabled: notificationsEnabled,
          prayer_notification_preferences: prefs,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
        if (error) throw error;
      }

      setSelectedMosqueId(item.mosqueId);
      setNearbyResultsOpen(false);
      setMonthCursor(new Date(year, month - 1, 1));
      setSelectedDate(localDateKey());
      setMosques(previous => previous.some(m => m.id === item.mosqueId)
        ? previous.map(m => m.id === item.mosqueId ? {
            ...m, name: item.name, address: item.address, city: item.city,
            masjidi_id: item.masjidiId, masjidi_supported: true,
            masjidi_db_supported: item.dbSupported, timetable_source: "Times from Masjidi",
          } : m)
        : [...previous, {
            id: item.mosqueId, name: item.name, address: item.address, city: item.city,
            masjidi_id: item.masjidiId, masjidi_supported: true,
            masjidi_db_supported: item.dbSupported, timetable_source: "Times from Masjidi",
          }]);
      if (persistSelection) {
        setPrefsLoaded(true);
        setSetupRequired(false);
        setSetupStep(0);
        setTab("home");
      }
      setMessage(item.name + " selected. Your prayer times are ready.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not select this mosque.");
    } finally {
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
      location: postcode.trim().toUpperCase() || "United Kingdom",
      postcode: postcode.trim().toUpperCase() || null,
      timezone: "Europe/London",
      madhhab,
      asr_school: madhhab === "Hanafi" ? "Hanafi" : "Standard",
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
    const chosen = mosques.find(item => item.id === mosqueId);
    if (chosen?.masjidi_id) {
      setBusy(true);
      try {
        const result = await syncMasjidiMonth(
          mosqueId, chosen.masjidi_id,
          monthCursor.getFullYear(), monthCursor.getMonth() + 1, false,
        );
        autoMasjidiRefreshAttempt.current = mosqueId + ":" + monthCursor.getFullYear() + "-" + String(monthCursor.getMonth() + 1);
        const { data: { user } } = await supabase!.auth.getUser();
        if (!user) throw new Error("Please sign in again.");
        const { error } = await supabase!.from("user_preferences").upsert({
          user_id: user.id,
          preferred_mosque_id: mosqueId,
          postcode: postcode.trim().toUpperCase() || null,
          location: postcode.trim().toUpperCase() || "United Kingdom",
          timezone: "Europe/London",
          madhhab,
          asr_school: madhhab === "Hanafi" ? "Hanafi" : "Standard",
          notifications_enabled: notificationsEnabled,
          prayer_notification_preferences: prefs,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
        if (error) throw error;
        setSelectedMosqueId(mosqueId);
        setMessage("Preferred mosque updated. " + (result?.daysImported || 0) + " timetable days loaded.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not update your preferred mosque.");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (chosen?.waqt_slug) {
      setWaqtSlug(chosen.waqt_slug);
      await connectWaqtMosque(chosen.waqt_slug);
      return;
    }
    setBusy(true);
    try {
      const days = await saveMosqueChoiceAndCopy(mosqueId);
      setMessage(days ? "Your preferred mosque and timetable have been updated." : "Mosque selected. No verified timetable is available yet.");
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
      location: postcode.trim().toUpperCase() || "United Kingdom",
      postcode: postcode.trim().toUpperCase() || null,
      timezone: "Europe/London",
      madhhab,
      asr_school: madhhab === "Hanafi" ? "Hanafi" : "Standard",
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
        sessionEmail ? <div className="account-row"><div className="account-avatar">{sessionEmail === "Guest" ? "G" : sessionEmail.slice(0, 1).toUpperCase()}</div><div className="account-email">{sessionEmail === "Guest" ? "Guest session · saved on this device" : sessionEmail}</div></div> :
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

        {!authReady ? (
          <main className="setup-screen welcome-loading">
            <div className="setup-brand">ن</div>
            <div className="eyebrow">NOOR PRAYER COMPANION</div>
            <h1>Preparing Noor.</h1>
            <p className="muted">Your prayer companion is getting ready.</p>
            <span className="nearby-spinner"/>
          </main>
        ) : !sessionEmail ? (
          <main className="setup-screen welcome-loading">
            <div className="setup-brand">ن</div>
            <div className="eyebrow">NOOR PRAYER COMPANION</div>
            <h1>Preparing Noor.</h1>
            <span className="nearby-spinner"/>
          </main>
        ) : !prefsLoaded ? (
          <main className="setup-screen welcome-loading">
            <div className="setup-brand">ن</div>
            <div className="eyebrow">PERSONALISING YOUR PRAYER COMPANION</div>
            <h1>One moment.</h1>
            <p className="muted">Loading your saved mosque and preferences.</p>
            <span className="nearby-spinner"/>
          </main>
        ) : setupRequired ? (
          <main className="setup-screen">
            <div className="setup-brand">ن</div>
            <div className="eyebrow">WELCOME TO NOOR</div>
            <h1>Find your local mosque<span className="gold">.</span></h1>
            <p className="muted">Enter your postcode, choose a nearby mosque and your prayer times will appear on Home. No sign-up needed.</p>
            <div className="setup-progress"><span className="active"/></div>
            <div className="setup-card">
              <div className="setup-step-label">CHOOSE YOUR LOCAL MOSQUE</div>
              {setupStep === 0 && <>
                <div className="setup-icon"><MapPin size={23}/></div>
                <h2>Find your local mosque</h2>
                <p className="muted">Enter your postcode and Noor will find nearby mosques with published prayer times.</p>
                <label className="field-label" htmlFor="setup-postcode">Your UK postcode</label>
                <div className="postcode-search-row">
                  <input id="setup-postcode" className="field" value={postcode}
                    onChange={event => { setPostcode(event.target.value.toUpperCase()); setNearbyResultsOpen(false); }}
                    placeholder="e.g. NG2 7PR" autoCapitalize="characters" autoCorrect="off" autoComplete="postal-code"/>
                  <select className="field postcode-radius" value={mosqueRadius} onChange={event => setMosqueRadius(Number(event.target.value))} aria-label="Search radius">
                    <option value={3}>3 mi</option><option value={5}>5 mi</option><option value={10}>10 mi</option>
                  </select>
                </div>
                <button className="primary-btn full" onClick={discoverNearbyMosques} disabled={searchingMosques || masjidiSyncing || busy || !postcode.trim()}>
                  <MapPin size={16}/>{searchingMosques ? "Finding nearby mosques…" : "Find nearby mosques"}
                </button>
                {mosque && <div className="mosque-choice"><MapPin size={16}/><div><strong>{mosque.name}</strong><span>{mosque.address || mosque.city}</span></div><CheckCircle2 size={18}/></div>}
                {nearbyResultsOpen && <NearbyMasjidResults items={nearbyMosques} selectedId={selectedMosqueId} disabled={busy || masjidiSyncing} onSelect={item => void selectNearbyMasjid(item, true)}/>}
                <p className="small-note privacy-note">Your postcode is used to find nearby mosques and saved to your Noor profile. Noor does not request GPS location.</p>
              </>}
              <p className="small-note">Choose a mosque with published prayer times. Noor will then open your Home screen automatically.</p>
            </div>
            <p className="setup-footnote">You can change your mosque and notification preferences later in Settings.</p>
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
                <div className="hero-top"><span className="eyebrow pale">PRAYER STATUS</span><span className="live-dot">● LIVE</span></div>
                <div className="current-prayer-strip">
                  <span className="current-prayer-label">CURRENT PRAYER</span>
                  {currentPrayer
                    ? <><strong>{currentPrayer.name}</strong><span>Started at {formatClock(currentPrayer.time)}</span></>
                    : <><strong>Not available</strong><span>Today's current prayer time isn't in your timetable yet.</span></>}
                </div>
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
                <div className="hero-footer">
                  <span><ShieldCheck size={14}/> {madhhab} preference</span>
                  {mosque?.masjidi_id
                    ? <span className="masjidi-attribution">Times from Masjidi</span>
                    : mosque?.waqt_slug
                      ? <a className="waqt-inline-link" href="https://waqt.uk/" target="_blank" rel="noreferrer">Times from Waqt <ExternalLink size={10}/></a>
                      : <span>Europe/London</span>}
                </div>
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
                  {mosque?.masjidi_id && <> · <span className="masjidi-attribution">Times from Masjidi</span></>}
                  {mosque?.waqt_slug && <> · <a className="waqt-inline-link" href="https://waqt.uk/" target="_blank" rel="noreferrer">Times from Waqt</a></>}
                </div>
              </div>}

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
                <label className="field-label" htmlFor="settings-saved-mosque">Currently selected mosque</label>
                <select id="settings-saved-mosque" className="field" value={selectedMosqueId}
                  onChange={event => void changePreferredMosque(event.target.value)} disabled={busy}>
                  <option value="">Choose a saved mosque</option>
                  {mosques.map(item => <option key={item.id} value={item.id}>{item.name} · {item.city}</option>)}
                </select>
                <label className="field-label" htmlFor="settings-postcode">Your UK postcode</label>
                <div className="postcode-search-row">
                  <input id="settings-postcode" className="field" value={postcode}
                    onChange={event => setPostcode(event.target.value.toUpperCase())}
                    placeholder="e.g. NG2 7PR" autoCapitalize="characters" autoCorrect="off" autoComplete="postal-code"/>
                  <select className="field postcode-radius" value={mosqueRadius} onChange={event => setMosqueRadius(Number(event.target.value))} aria-label="Search radius">
                    <option value={3}>3 mi</option><option value={5}>5 mi</option><option value={10}>10 mi</option>
                  </select>
                </div>
                <button className="secondary-btn full" onClick={discoverNearbyMosques} disabled={searchingMosques || busy || !postcode.trim()}>
                  <MapPin size={16}/>{searchingMosques ? "Finding nearby mosques…" : "Find nearby mosques"}
                </button>
                {nearbyResultsOpen && <NearbyMasjidResults items={nearbyMosques} selectedId={selectedMosqueId} disabled={busy || masjidiSyncing} onSelect={item => void selectNearbyMasjid(item, true)}/>}
                {mosque && <div className="mosque-address"><MapPin size={15}/><span>Selected: {mosque.name} · {mosque.address || mosque.city}</span></div>}
                <div className="setting-line"><span>Madhhab</span>
                  <select className="inline-select" value={madhhab} onChange={event => setMadhhab(event.target.value as Madhhab)}>
                    <option>Hanafi</option><option>Maliki</option><option>Shafi'i</option><option>Hanbali</option>
                  </select>
                </div>
                <div className="setting-line"><span>Time zone</span><strong>Europe/London</strong></div>
                <p className="small-note">Mosque-published prayer times are used as supplied. Your madhhab preference is saved separately.</p>
              </div>

              <div className="settings-group-label">PRAYER REMINDERS</div>
              <div className="setting-card">
                <div className="setting-title"><Bell/><div><strong>Notifications</strong><span>Choose which prayers can notify you</span></div></div>
                <div className={"notification-master-card" + (notificationsEnabled ? " notifications-on" : " notifications-paused")}>
                  <div className="notification-master-copy">
                    <span className="notification-master-state">{notificationsEnabled ? "ON" : "PAUSED"}</span>
                    <strong>{notificationsEnabled ? "Prayer notifications are on" : "All prayer notifications are paused"}</strong>
                    <span>{notificationsEnabled
                      ? "Turn this switch off to stop every scheduled Noor prayer alert."
                      : "No scheduled prayer alerts will be sent. Turn this back on whenever you want."}</span>
                  </div>
                  <label className="notification-switch">
                    <input type="checkbox" role="switch" aria-label="Enable all Noor prayer notifications"
                      checked={notificationsEnabled}
                      disabled={savingNotificationSetting}
                      onChange={event => void updateGlobalNotifications(event.target.checked)}/>
                    <span className="notification-switch-track" aria-hidden="true"><span/></span>
                  </label>
                </div>
                {prayerNames.map(name => <div className="toggle-line" key={name}>
                  <div><strong>{name}</strong><span>Prayer-start reminder</span></div>
                  <input type="checkbox" checked={prefs[name].enabled} disabled={!notificationsEnabled}
                    onChange={event => setPrefs(old => ({ ...old, [name]: { ...old[name], enabled: event.target.checked } }))}/>
                </div>)}
                <div className="status-line"><span className={"status-dot " + (pushState.startsWith("Enabled") ? "green" : "")}/>{pushState}</div>
                <button className="primary-btn full" onClick={enablePush}
                  disabled={busy || !notificationsEnabled || pushState.startsWith("Enabled")}>
                  <BellRing size={16}/>{!notificationsEnabled ? "Turn on prayer notifications first" : pushState.startsWith("Enabled") ? "This device is enabled" : "Enable on this device"}
                </button>
                <button className="secondary-btn full" onClick={testNotification} disabled={busy || !sessionEmail || !notificationsEnabled}>
                  Send test notification
                </button>
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
                    placeholder={"date,fajr,sunrise,dhuhr,asr,maghrib,isha,fajr_jamaat,dhuhr_jamaat,asr_jamaat,maghrib_jamaat,isha_jamaat,source\n2026-12-01,05:50,08:00,11:55,14:00,15:45,17:50,06:45,13:30,14:30,19:00,Official mosque timetable"}/>
                  <button className="primary-btn full" onClick={importCsv} disabled={busy || !csvText.trim() || !supabase}><Upload size={16}/> Import timetable</button>
                </div>}
              </div>
            </section>}
          </main>
        )}

        {message && <div className="toast" role="status"><AlertCircle size={16}/><span>{message}</span><button onClick={() => setMessage("")}><X size={15}/></button></div>}

        {sessionEmail && prefsLoaded && !setupRequired && <nav className="bottom-nav">
          <button className={tab === "home" ? "selected" : ""} onClick={() => setTab("home")}><Moon/><span>Home</span></button>
          <button className={tab === "timetable" ? "selected" : ""} onClick={() => setTab("timetable")}><CalendarDays/><span>Timetable</span></button>
          <button className={tab === "settings" ? "selected" : ""} onClick={() => setTab("settings")}><Settings/><span>Settings</span></button>
        </nav>}
        <footer className="footer-note">Made with intention <span>✦</span> Noor Prayer Companion</footer>
      </div>
    </div>
  );
}

function NearbyMasjidResults({ items, selectedId, disabled, onSelect }: {
  items: NearbyMasjid[];
  selectedId: string;
  disabled: boolean;
  onSelect: (item: NearbyMasjid) => void;
}) {
  const selectableItems = items.filter(item => item.prayerTimesAvailable);
  if (!selectableItems.length) return null;
  return (
    <div className="nearby-results">
      <div className="nearby-results-heading">
        <strong>Nearby mosques</strong>
        <span>{selectableItems.length} available</span>
      </div>
      {selectableItems.map(item => (
        <div className={"nearby-mosque-card" + (item.mosqueId === selectedId ? " selected" : "")} key={item.masjidiId}>
          <div className="nearby-mosque-icon"><Building2 size={17}/></div>
          <div className="nearby-mosque-details">
            <strong>{item.name}</strong>
            <small>{[item.address, item.city, item.postcode].filter(Boolean).join(", ")}</small>
            <small>{item.distanceMiles === null ? "Distance unavailable" : item.distanceMiles.toFixed(1) + " miles away"}</small>
            <div className="nearby-mosque-badges">
              <span className="timetable-status available">Prayer times available</span>
              <span className={item.jamaatTimesAvailable ? "timetable-status available" : "timetable-status missing"}>
                {item.jamaatTimesAvailable ? "Jamaat data available" : "No Jamaat times published"}
              </span>
            </div>
            {item.phone && <small>{item.phone}</small>}
          </div>
          <button className="nearby-select-btn" disabled={disabled}
            onClick={() => onSelect(item)} aria-label={"Select " + item.name}>
            {item.mosqueId === selectedId ? <CheckCircle2 size={18}/> : <ChevronRight size={18}/>}
          </button>
        </div>
      ))}
      <p className="nearby-results-footnote">Mosque directory and prayer data provided by Masjidi.</p>
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

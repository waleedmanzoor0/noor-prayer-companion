import { useEffect, useMemo, useState } from "react";
import {
  Bell, BellRing, CalendarDays, ChevronRight, Clock3, Compass, Moon,
  Settings, Sun, Upload, MapPin, ShieldCheck, LogIn, LogOut, RefreshCw,
  CheckCircle2, AlertCircle, Smartphone, BookOpen, Menu, X
} from "lucide-react";
import { supabase, hasSupabaseConfig } from "./lib/supabase";
import { countdown, formatClock, hijriDate, localDateKey } from "./lib/date";
import { nextPrayer, parseCsv, toPrayers } from "./lib/prayers";
import type { PrayerRow, PrayerName } from "./lib/types";
import "./styles.css";

const prayers: PrayerName[] = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];
const defaultPrefs = {
  Fajr: { enabled: true, mode: "both" },
  Dhuhr: { enabled: true, mode: "both" },
  Asr: { enabled: true, mode: "both" },
  Maghrib: { enabled: true, mode: "both" },
  Isha: { enabled: true, mode: "both" },
};

type Prefs = typeof defaultPrefs;

export default function App() {
  const [row, setRow] = useState<PrayerRow | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(() => {
    try { return { ...defaultPrefs, ...JSON.parse(localStorage.getItem("noor-prefs") || "{}") }; }
    catch { return defaultPrefs; }
  });
  const [now, setNow] = useState(new Date());
  const [tab, setTab] = useState<"home" | "timetable" | "settings">("home");
  const [dark, setDark] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [pushState, setPushState] = useState("Not enabled");
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [mosqueName, setMosqueName] = useState("Your Nottingham mosque");
  const [csvText, setCsvText] = useState("");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem("noor-prefs", JSON.stringify(prefs));
  }, [prefs]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSessionEmail(data.session?.user.email ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionEmail(session?.user.email ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function loadTimetable() {
    if (!supabase || !sessionEmail) {
      setRow(null);
      return;
    }
    setBusy(true);
    setMessage("");
    const date = localDateKey();
    const { data, error } = await supabase
      .from("prayer_times")
      .select("*")
      .eq("prayer_date", date)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) setMessage(error.message);
    else setRow(data as PrayerRow | null);
    setBusy(false);
  }

  useEffect(() => {
    if (sessionEmail) {
      void loadTimetable();
    } else {
      setRow(null);
    }
  }, [sessionEmail]);

  useEffect(() => {
    if (!supabase || !sessionEmail) {
      setPrefsLoaded(false);
      return;
    }

    let active = true;
    const loadPreferences = async () => {
      try {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) throw new Error("Please sign in to load your preferences.");

        const { data, error } = await supabase
          .from("user_preferences")
          .select("prayer_notification_preferences")
          .eq("user_id", user.id)
          .maybeSingle();
        if (error) throw error;

        if (data?.prayer_notification_preferences) {
          const stored = data.prayer_notification_preferences as Partial<Prefs>;
          if (active) {
            setPrefs({
              Fajr: { ...defaultPrefs.Fajr, ...(stored.Fajr || {}) },
              Dhuhr: { ...defaultPrefs.Dhuhr, ...(stored.Dhuhr || {}) },
              Asr: { ...defaultPrefs.Asr, ...(stored.Asr || {}) },
              Maghrib: { ...defaultPrefs.Maghrib, ...(stored.Maghrib || {}) },
              Isha: { ...defaultPrefs.Isha, ...(stored.Isha || {}) },
            });
          }
        } else {
          const { error: insertError } = await supabase
            .from("user_preferences")
            .upsert({
              user_id: user.id,
              location: "Nottingham, UK",
              timezone: "Europe/London",
              asr_school: "Hanafi",
              notifications_enabled: true,
              prayer_notification_preferences: prefs,
            }, { onConflict: "user_id" });
          if (insertError) throw insertError;
        }

        if (active) setPrefsLoaded(true);
      } catch (error) {
        if (active) {
          setMessage(error instanceof Error ? error.message : "Could not load your prayer preferences.");
          setPrefsLoaded(true);
        }
      }
    };

    void loadPreferences();
    return () => { active = false; };
  }, [sessionEmail]);

  useEffect(() => {
    if (!supabase || !sessionEmail || !prefsLoaded) return;

    let active = true;
    const savePreferences = async () => {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) return;
      const { error } = await supabase.from("user_preferences").upsert({
        user_id: user.id,
        location: "Nottingham, UK",
        timezone: "Europe/London",
        asr_school: "Hanafi",
        notifications_enabled: true,
        prayer_notification_preferences: prefs,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (error && active) setMessage(error.message);
    };

    void savePreferences();
    return () => { active = false; };
  }, [prefs, prefsLoaded, sessionEmail]);

  const next = useMemo(() => nextPrayer(row, now), [row, now]);
  const remaining = next ? countdown(next.at, now) : null;
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London"
  }).format(now);

  async function signIn() {
    if (!supabase || !email) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: new URL(import.meta.env.BASE_URL, window.location.origin).toString() } });
    setMessage(error ? error.message : "Check your email for your secure sign-in link.");
    setBusy(false);
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setMessage("Signed out.");
  }

  async function importCsv() {
    if (!supabase || !sessionEmail) {
      setMessage("Sign in first to import your mosque timetable.");
      return;
    }
    try {
      const parsed = parseCsv(csvText);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Please sign in before importing a timetable.");
      setBusy(true);
      const rows = parsed.map((item) => ({ ...item, user_id: user.id }));
      const { error } = await supabase.from("prayer_times").upsert(rows, { onConflict: "user_id,prayer_date" });
      if (error) throw error;
      setMessage(`Imported ${parsed.length} timetable row(s).`);
      setCsvText("");
      await loadTimetable();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not import timetable.");
    } finally {
      setBusy(false);
    }
  }

  async function enablePush() {
    if (!supabase) {
      setMessage("Connect Supabase before enabling push notifications.");
      return;
    }
    if (!sessionEmail) {
      setMessage("Sign in to Noor before enabling notifications.");
      return;
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setMessage("Push notifications are not supported in this browser. On iPhone, install Noor to your Home Screen and open it there.");
      return;
    }
    const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
    if (!publicKey) {
      setMessage("Add VITE_VAPID_PUBLIC_KEY to your deployment environment first.");
      return;
    }
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notification permission was not granted.");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
      const { error } = await supabase.functions.invoke("register-push", { body: { subscription: subscription.toJSON() } });
      if (error) throw error;
      setPushState("Enabled");
      setMessage("This device is subscribed to Noor notifications.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not enable notifications.");
    } finally {
      setBusy(false);
    }
  }

  async function testNotification() {
    if (!supabase) return;
    if (!sessionEmail) {
      setMessage("Sign in to Noor before sending a test notification.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.functions.invoke("test-notification");
    setMessage(error ? error.message : "Test notification request sent. Check your iPhone.");
    setBusy(false);
  }

  const prayerList = row ? toPrayers(row) : [];
  const activeName = next?.name;

  return (
    <div className={dark ? "app dark" : "app light"}>
      <div className="shell">
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark">ن</div>
            <div><div className="brand-name">noor<span>.</span></div><div className="brand-sub">PRAYER COMPANION</div></div>
          </div>
          <div className="top-actions">
            <button className="icon-btn" aria-label="Toggle appearance" onClick={() => setDark(!dark)}>{dark ? <Sun size={18}/> : <Moon size={18}/>}</button>
            <button className="icon-btn" aria-label="Settings" onClick={() => setTab("settings")}><Settings size={18}/></button>
          </div>
        </header>

        <main>
          {tab === "home" && <>
            <section className="welcome">
              <div className="eyebrow"><MapPin size={13}/> NOTTINGHAM, UNITED KINGDOM</div>
              <h1>Assalamu Alaikum<span className="gold">.</span></h1>
              <p className="muted">{dateLabel} <span className="dot">·</span> {hijriDate(now)}</p>
            </section>

            <section className="hero-card">
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
              </> : <div className="empty-next"><Clock3 size={24}/><strong>{row ? "Today's prayers are complete" : "Your timetable is waiting"}</strong><span>{row ? "Tomorrow's timetable will appear when added." : "Add your local mosque timetable to get started."}</span></div>}
              <div className="hero-footer"><span><ShieldCheck size={14}/> Hanafi Asr</span><span>Europe/London</span></div>
            </section>

            <section className="section-head">
              <div><div className="eyebrow">YOUR DAILY SCHEDULE</div><h2>Prayer times</h2></div>
              <button className="text-btn" onClick={loadTimetable} disabled={busy}><RefreshCw size={14}/> Refresh</button>
            </section>

            {!row ? <div className="empty-card">
              <div className="empty-icon"><CalendarDays size={23}/></div>
              <h3>No mosque timetable added yet</h3>
              <p>For accuracy, Noor does not invent prayer times. Import your chosen Nottingham mosque's official timetable in Settings.</p>
              <button className="primary-btn" onClick={() => setTab("settings")}><Upload size={16}/> Add timetable</button>
            </div> : <div className="prayer-list">
              {prayerList.map((p, i) => <div className={`prayer-row ${activeName === p.name ? "is-next" : ""}`} key={p.name}>
                <div className="prayer-symbol">{["✦","☀","◈","☾","✧"][i]}</div>
                <div className="prayer-info"><strong>{p.name}</strong><span>{p.arabic}</span></div>
                <div className="prayer-time">{formatClock(p.time)}</div>
                <div className="prayer-status">{prefs[p.name].enabled ? <Bell size={15}/> : <BellRing size={15} className="dim"/>}</div>
              </div>)}
              {row.sunrise && <div className="sunrise-row"><Sun size={14}/> Sunrise <span>{formatClock(row.sunrise)}</span></div>}
              <div className="source-note">Timetable source: {row.source || "Not specified"}</div>
            </div>}

            <section className="quick-grid">
              <button className="quick-card" onClick={() => setTab("timetable")}><CalendarDays/><span>Monthly timetable</span><ChevronRight size={16}/></button>
              <button className="quick-card" onClick={() => setTab("settings")}><Bell/><span>Prayer reminders</span><ChevronRight size={16}/></button>
            </section>
          </>}

          {tab === "timetable" && <section className="page-section">
            <div className="eyebrow">YOUR SCHEDULE</div><h1>Timetable</h1>
            <p className="muted">Your mosque timetable is stored in Supabase. Import monthly rows from Settings.</p>
            {row ? <div className="prayer-list">{prayerList.map(p => <div className="prayer-row" key={p.name}><div className="prayer-info"><strong>{p.name}</strong><span>{p.arabic}</span></div><div className="prayer-time">{formatClock(p.time)}</div></div>)}</div> : <div className="empty-card"><CalendarDays/><p>No timetable available for today.</p></div>}
          </section>}

          {tab === "settings" && <section className="page-section">
            <div className="eyebrow">PERSONALISE NOOR</div><h1>Settings</h1>
            <div className="setting-card">
              <div className="setting-title"><MapPin/><div><strong>Location & calculation</strong><span>Prayer timetable preferences</span></div></div>
              <div className="setting-line"><span>Location</span><strong>Nottingham, UK</strong></div>
              <div className="setting-line"><span>Time zone</span><strong>Europe/London</strong></div>
              <div className="setting-line"><span>Asr school</span><strong>Hanafi</strong></div>
              <div className="setting-line"><span>Timetable source</span><strong>Local mosque</strong></div>
              <label className="field-label">Mosque name (for your records)</label>
              <input className="field" value={mosqueName} onChange={e => setMosqueName(e.target.value)} placeholder="Enter your mosque name"/>
            </div>

            <div className="setting-card">
              <div className="setting-title"><Bell/><div><strong>Prayer notifications</strong><span>Choose reminders for each prayer</span></div></div>
              {prayers.map(name => <div className="toggle-line" key={name}>
                <div><strong>{name}</strong><span>Adhan and simple reminder</span></div>
                <input type="checkbox" checked={prefs[name].enabled} onChange={e => setPrefs(old => ({ ...old, [name]: { ...old[name], enabled: e.target.checked } }))}/>
              </div>)}
              <p className="small-note">Both reminder types are enabled as your default preference. Actual delivery requires the Supabase notification functions to be configured.</p>
              <button className="primary-btn full" onClick={enablePush} disabled={busy}><BellRing size={16}/>{busy ? "Please wait…" : "Enable notifications on this device"}</button>
              <div className="status-line"><span className={`status-dot ${pushState === "Enabled" ? "green" : ""}`}></span> Push status: {pushState}</div>
              <button className="secondary-btn full" onClick={testNotification} disabled={busy || !supabase}>Send test notification</button>
            </div>

            <div className="setting-card">
              <div className="setting-title"><Upload/><div><strong>Import mosque timetable</strong><span>CSV file with official daily timings</span></div></div>
              <p className="small-note">CSV columns required: date, fajr, dhuhr, asr, maghrib, isha. Optional: sunrise, source. Use YYYY-MM-DD dates and 24-hour HH:MM times.</p>
              <textarea className="csv-area" value={csvText} onChange={e => setCsvText(e.target.value)} placeholder={"date,fajr,sunrise,dhuhr,asr,maghrib,isha,source\n2026-11-24,05:30,07:45,12:05,14:20,16:10,17:45,My mosque"} />
              <button className="primary-btn full" onClick={importCsv} disabled={busy || !csvText.trim() || !supabase}><Upload size={16}/> Import timetable to Supabase</button>
              <p className="small-note">The sample row above is illustrative only. Replace it with your mosque's verified times.</p>
            </div>

            <div className="setting-card">
              <div className="setting-title"><LogIn/><div><strong>Account & connection</strong><span>{sessionEmail || "Sign in to manage your timetable"}</span></div></div>
              {!hasSupabaseConfig ? <div className="notice warning"><AlertCircle size={16}/> Supabase is not connected. Add your project URL and publishable key to deployment environment variables.</div> :
                sessionEmail ? <button className="secondary-btn full" onClick={signOut}><LogOut size={16}/> Sign out</button> :
                <><input className="field" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Your email address"/><button className="primary-btn full" onClick={signIn} disabled={busy || !email}><LogIn size={16}/> Send sign-in link</button></>}
            </div>
          </section>}

          {message && <div className="toast" role="status"><AlertCircle size={16}/><span>{message}</span><button onClick={() => setMessage("")}><X size={15}/></button></div>}
        </main>

        <nav className="bottom-nav">
          <button className={tab === "home" ? "selected" : ""} onClick={() => setTab("home")}><Moon/><span>Home</span></button>
          <button className={tab === "timetable" ? "selected" : ""} onClick={() => setTab("timetable")}><CalendarDays/><span>Timetable</span></button>
          <button className={tab === "settings" ? "selected" : ""} onClick={() => setTab("settings")}><Settings/><span>Settings</span></button>
        </nav>
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

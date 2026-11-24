export function localDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(date);
}

export function formatClock(value: string) {
  if (!value) return "—";
  const [hourText, minuteText] = value.slice(0, 5).split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true }).format(d);
}

export function prayerDateTime(dateKey: string, time: string) {
  // Parse the date/time in the browser's local timezone only for display/countdown.
  // For production scheduling, the server must interpret this using Europe/London.
  const [y, m, d] = dateKey.split("-").map(Number);
  const [hh, mm] = time.slice(0, 5).split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

export function hijriDate(date = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-GB-u-ca-islamic", {
      day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London"
    }).format(date);
  } catch {
    return "Hijri date unavailable";
  }
}

export function countdown(target: Date, now = new Date()) {
  const seconds = Math.max(0, Math.floor((target.getTime() - now.getTime()) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return { days, hours, minutes, seconds: secs };
}

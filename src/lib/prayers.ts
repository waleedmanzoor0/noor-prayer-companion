import type { PrayerRow, Prayer } from "./types";
import { PRAYER_KEYS } from "./types";
import { localDateKey, prayerDateTime } from "./date";

export function toPrayers(row: PrayerRow): Prayer[] {
  return PRAYER_KEYS.map(({ name, key, jamaatKey, arabic }) => ({
    name,
    time: String(row[key] ?? ""),
    jamaat: jamaatKey ? String(row[jamaatKey] ?? "") || null : null,
    arabic
  }));
}

export function nextPrayer(row: PrayerRow | null, now = new Date()) {
  if (!row) return null;
  const today = localDateKey(now);
  const prayers = toPrayers(row);
  for (const prayer of prayers) {
    const at = prayerDateTime(today, prayer.time);
    if (at.getTime() > now.getTime()) return { ...prayer, at };
  }
  return null;
}

export function parseCsv(text: string): Omit<PrayerRow, "id" | "mosque_id">[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("CSV must include a header and at least one timetable row.");
  const headers = lines[0].split(",").map(x => x.trim().toLowerCase());
  const required = ["date", "fajr", "dhuhr", "asr", "maghrib", "isha"];
  for (const field of required) if (!headers.includes(field)) throw new Error(`Missing CSV column: ${field}`);
  const index = (name: string) => headers.indexOf(name);
  return lines.slice(1).map((line, i) => {
    const cells = line.split(",").map(x => x.trim());
    const get = (name: string) => cells[index(name)] || "";
    const date = get("date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Row ${i + 2}: date must be YYYY-MM-DD.`);
    for (const name of ["fajr", "dhuhr", "asr", "maghrib", "isha"]) {
      if (!/^\d{1,2}:\d{2}$/.test(get(name))) throw new Error(`Row ${i + 2}: ${name} must be HH:MM.`);
    }
    for (const name of ["fajr_jamaat", "dhuhr_jamaat", "asr_jamaat", "isha_jamaat"]) {
      if (get(name) && !/^\d{1,2}:\d{2}$/.test(get(name))) {
        throw new Error(`Row ${i + 2}: ${name} must be HH:MM when supplied.`);
      }
    }
    return {
      prayer_date: date,
      fajr: get("fajr"),
      sunrise: get("sunrise") || null,
      dhuhr: get("dhuhr"),
      asr: get("asr"),
      maghrib: get("maghrib"),
      isha: get("isha"),
      fajr_jamaat: get("fajr_jamaat") || null,
      dhuhr_jamaat: get("dhuhr_jamaat") || null,
      asr_jamaat: get("asr_jamaat") || null,
      isha_jamaat: get("isha_jamaat") || null,
      source: get("source") || "User-imported local mosque timetable"
    };
  });
}

import type { PrayerRow } from "./types";

export type WaqtDay = {
  date: [number, number, number];
  day?: string;
  fajr?: string;
  sunrise?: string;
  zuhr?: string;
  asr?: string;
  isha?: string;
  jFajr?: string;
  jZuhr?: string;
  jAsr?: string;
  maghrib?: string;
  jMaghrib?: string;
  jIsha?: string;
  iftar?: string;
  calculatedBegins?: string[];
};

export type WaqtPayload = {
  version: number;
  generator?: string;
  attribution?: { text?: string; url?: string };
  timezone: string;
  date: string;
  revision?: number;
  masjid: { slug: string; name: string; url: string };
  today: WaqtDay | null;
  tomorrow: WaqtDay | null;
};

type PrayerColumns = Omit<PrayerRow, "id" | "user_id" | "mosque_id">;

function toIsoDate(parts: [number, number, number]) {
  const [year, month, day] = parts;
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

/**
 * Waqt prints most times without AM/PM. Its developer notes define the
 * prayer-specific convention: Isha values 12 or below 3 are after midnight.
 */
export function waqtClock(value: string | undefined, prayer: "fajr" | "sunrise" | "zuhr" | "asr" | "maghrib" | "isha"): string | null {
  if (!value?.trim()) return null;
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] || "0");
  const suffix = (match[3] || "").toLowerCase();
  if (hour > 23 || minute > 59) return null;

  if (suffix === "am") {
    hour = hour % 12;
  } else if (suffix === "pm") {
    hour = (hour % 12) + 12;
  } else if (hour < 13) {
    if (prayer === "fajr" || prayer === "sunrise") {
      if (hour === 12) hour = 0;
    } else if (prayer === "zuhr" || prayer === "asr" || prayer === "maghrib") {
      if (hour < 12) hour += 12;
    } else if (prayer === "isha") {
      if (hour === 12) hour = 0;
      else if (hour >= 3) hour += 12;
    }
  }

  return String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
}

export function waqtDayToPrayerRow(day: WaqtDay | null): PrayerColumns | null {
  if (!day || !Array.isArray(day.date)) return null;

  const fajr = waqtClock(day.fajr, "fajr");
  const sunrise = waqtClock(day.sunrise, "sunrise");
  const dhuhr = waqtClock(day.zuhr, "zuhr");
  const asr = waqtClock(day.asr, "asr");
  let maghrib = waqtClock(day.maghrib, "maghrib");
  let maghribJamaat = waqtClock(day.jMaghrib, "maghrib");
  const isha = waqtClock(day.isha, "isha");

  // Waqt's Maghrib convention:
  // - jMaghrib present: maghrib is start and jMaghrib is congregation.
  // - otherwise Maghrib is also Jamaat; during Ramadan, an earlier iftar is
  //   the start and the listed maghrib time becomes Jamaat.
  if (maghrib && !day.jMaghrib) {
    const iftar = waqtClock(day.iftar, "maghrib");
    if (iftar && iftar < maghrib) {
      maghribJamaat = maghrib;
      maghrib = iftar;
    } else {
      maghribJamaat = maghrib;
    }
  }

  if (!fajr || !dhuhr || !asr || !maghrib || !isha) return null;

  const calculated = (day.calculatedBegins || [])
    .map(value => String(value).toLowerCase())
    .filter(value => ["fajr", "zuhr", "asr", "maghrib", "isha"].includes(value));

  return {
    prayer_date: toIsoDate(day.date),
    fajr,
    sunrise,
    dhuhr,
    asr,
    maghrib,
    isha,
    fajr_jamaat: waqtClock(day.jFajr, "fajr"),
    dhuhr_jamaat: waqtClock(day.jZuhr, "zuhr"),
    asr_jamaat: waqtClock(day.jAsr, "asr"),
    maghrib_jamaat: maghribJamaat,
    isha_jamaat: waqtClock(day.jIsha, "isha"),
    calculated_begins: calculated,
    source: "Times from Waqt",
  };
}

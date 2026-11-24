export type PrayerName = "Fajr" | "Dhuhr" | "Asr" | "Maghrib" | "Isha";
export type PrayerRow = {
  id: string;
  mosque_id: string | null;
  prayer_date: string;
  fajr: string;
  sunrise: string | null;
  dhuhr: string;
  asr: string;
  maghrib: string;
  isha: string;
  fajr_jamaat?: string | null;
  dhuhr_jamaat?: string | null;
  asr_jamaat?: string | null;
  isha_jamaat?: string | null;
  source: string | null;
};

export type Prayer = { name: PrayerName; time: string; jamaat: string | null; arabic: string };
export const PRAYER_KEYS: {
  name: PrayerName;
  key: keyof PrayerRow;
  jamaatKey: keyof PrayerRow | null;
  arabic: string;
}[] = [
  { name: "Fajr", key: "fajr", jamaatKey: "fajr_jamaat", arabic: "الفجر" },
  { name: "Dhuhr", key: "dhuhr", jamaatKey: "dhuhr_jamaat", arabic: "الظهر" },
  { name: "Asr", key: "asr", jamaatKey: "asr_jamaat", arabic: "العصر" },
  { name: "Maghrib", key: "maghrib", jamaatKey: null, arabic: "المغرب" },
  { name: "Isha", key: "isha", jamaatKey: "isha_jamaat", arabic: "العشاء" },
];

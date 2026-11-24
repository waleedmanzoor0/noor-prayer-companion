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
  source: string | null;
};

export type Prayer = { name: PrayerName; time: string; arabic: string };
export const PRAYER_KEYS: { name: PrayerName; key: keyof PrayerRow; arabic: string }[] = [
  { name: "Fajr", key: "fajr", arabic: "الفجر" },
  { name: "Dhuhr", key: "dhuhr", arabic: "الظهر" },
  { name: "Asr", key: "asr", arabic: "العصر" },
  { name: "Maghrib", key: "maghrib", arabic: "المغرب" },
  { name: "Isha", key: "isha", arabic: "العشاء" },
];

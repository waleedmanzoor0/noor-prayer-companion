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
  maghrib_jamaat?: string | null;
  calculated_begins?: string[] | null;
  source: string | null;
};

export type Prayer = { name: PrayerName; time: string; jamaat: string | null; arabic: string; calculated: boolean };
export const PRAYER_KEYS: {
  name: PrayerName;
  key: keyof PrayerRow;
  jamaatKey: keyof PrayerRow | null;
  calculatedKey: string;
  arabic: string;
}[] = [
  { name: "Fajr", key: "fajr", jamaatKey: "fajr_jamaat", calculatedKey: "fajr", arabic: "الفجر" },
  { name: "Dhuhr", key: "dhuhr", jamaatKey: "dhuhr_jamaat", calculatedKey: "zuhr", arabic: "الظهر" },
  { name: "Asr", key: "asr", jamaatKey: "asr_jamaat", calculatedKey: "asr", arabic: "العصر" },
  { name: "Maghrib", key: "maghrib", jamaatKey: "maghrib_jamaat", calculatedKey: "maghrib", arabic: "المغرب" },
  { name: "Isha", key: "isha", jamaatKey: "isha_jamaat", calculatedKey: "isha", arabic: "العشاء" },
];

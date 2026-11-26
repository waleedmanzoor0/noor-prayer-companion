import { useRef, useState } from "react";
import { AlertCircle, Check, CheckCircle2, FileImage, FileText, Loader2, ScanLine, Sparkles, Upload, X } from "lucide-react";
import { supabase } from "./lib/supabase";

export type ScannedTimetableDay = {
  prayer_date: string;
  fajr: string | null;
  sunrise: string | null;
  dhuhr: string | null;
  asr: string | null;
  maghrib: string | null;
  isha: string | null;
  fajr_jamaat: string | null;
  dhuhr_jamaat: string | null;
  asr_jamaat: string | null;
  maghrib_jamaat: string | null;
  isha_jamaat: string | null;
  source: string;
};

type Props = {
  mosqueName: string;
  onImport: (rows: ScannedTimetableDay[]) => Promise<void>;
};

const columns: { key: keyof ScannedTimetableDay; label: string }[] = [
  { key: "fajr", label: "Fajr" },
  { key: "sunrise", label: "Sunrise" },
  { key: "dhuhr", label: "Dhuhr" },
  { key: "asr", label: "Asr" },
  { key: "maghrib", label: "Maghrib" },
  { key: "isha", label: "Isha" },
  { key: "fajr_jamaat", label: "Fajr Jamaat" },
  { key: "dhuhr_jamaat", label: "Dhuhr Jamaat" },
  { key: "asr_jamaat", label: "Asr Jamaat" },
  { key: "maghrib_jamaat", label: "Maghrib Jamaat" },
  { key: "isha_jamaat", label: "Isha Jamaat" },
];

function validTime(value: string | null) {
  return !value || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export default function TimetableScanner({ mosqueName, onImport }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ScannedTimetableDay[]>([]);
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function scan() {
    if (!file || !supabase) return;
    setScanning(true);
    setError("");
    setNotice("");
    setRows([]);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      const base64 = btoa(binary);
      const { data, error: invokeError } = await supabase.functions.invoke("scan-mosque-timetable", {
        body: { fileName: file.name, mimeType: file.type || "application/octet-stream", fileBase64: base64 },
      });
      if (invokeError) {
        let message = invokeError.message;
        if ("context" in invokeError && invokeError.context instanceof Response) {
          const details = await invokeError.context.clone().json().catch(() => null) as { error?: string } | null;
          message = details?.error || message;
        }
        throw new Error(message);
      }
      const extracted = Array.isArray(data?.days) ? data.days as ScannedTimetableDay[] : [];
      if (!extracted.length) throw new Error("No dated prayer entries were found. Try a clearer image or PDF.");
      setRows(extracted.map(day => ({ ...day, source: "AI-scanned mosque timetable — reviewed by user" })));
      setNotice("Review every extracted time below. Correct any mistakes before importing.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not scan this timetable.");
    } finally {
      setScanning(false);
    }
  }

  function updateCell(index: number, key: keyof ScannedTimetableDay, value: string) {
    setRows(current => current.map((row, i) => i === index ? { ...row, [key]: value.trim() || null } : row));
  }

  async function importRows() {
    if (!rows.length) return;
    const invalid = rows.find(row => !/^\d{4}-\d{2}-\d{2}$/.test(row.prayer_date) ||
      columns.some(column => !validTime(row[column.key] as string | null)));
    if (invalid) {
      setError("Check the date and time formats. Use YYYY-MM-DD and 24-hour HH:MM.");
      return;
    }
    if (rows.some(row => !row.fajr || !row.dhuhr || !row.asr || !row.maghrib || !row.isha)) {
      setError("At least one essential prayer start time is missing. Fill it in or remove that date before importing.");
      return;
    }
    setImporting(true);
    setError("");
    try {
      await onImport(rows);
      setRows([]);
      setFile(null);
      setNotice("Timetable imported successfully.");
      if (inputRef.current) inputRef.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not import the scanned timetable.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="scanner-panel" aria-label="Smart mosque timetable scanner">
      <div className="scanner-intro">
        <div className="scanner-icon"><ScanLine size={20}/></div>
        <div><strong>Smart timetable scanner</strong><span>Let Gemini read a mosque timetable for you.</span></div>
        <span className="scanner-ai-tag"><Sparkles size={11}/> AI</span>
      </div>
      <div className="scanner-dropzone">
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf"
          onChange={event => { setFile(event.target.files?.[0] || null); setRows([]); setError(""); setNotice(""); }}
          aria-label="Choose timetable image or PDF"/>
        <div className="scanner-file-icon">{file?.type === "application/pdf" ? <FileText/> : <FileImage/>}</div>
        <strong>{file ? file.name : "Upload a timetable"}</strong>
        <span>{file ? (file.size / 1024 / 1024).toFixed(1) + " MB · " + (file.type === "application/pdf" ? "PDF document" : "Image") : "PDF, JPG, PNG or WebP · up to 12 MB"}</span>
        <button className="secondary-btn" type="button" onClick={() => inputRef.current?.click()}><Upload size={15}/> Choose file</button>
      </div>
      <p className="scanner-privacy">Your file is processed securely by Noor's server-side Gemini integration. API keys are never exposed in the browser.</p>
      {file && <button className="primary-btn full scanner-action" type="button" onClick={scan} disabled={scanning || importing}>
        {scanning ? <><Loader2 className="spin" size={16}/> Reading timetable…</> : <><Sparkles size={16}/> Scan with Gemini</>}
      </button>}
      {error && <div className="scanner-message error"><AlertCircle size={15}/>{error}</div>}
      {notice && <div className="scanner-message success"><CheckCircle2 size={15}/>{notice}</div>}
      {rows.length > 0 && <div className="scanner-review">
        <div className="scanner-review-head"><div><strong>Review extracted timetable</strong><span>{rows.length} date(s) · {mosqueName || "Selected mosque"}</span></div><button type="button" className="scanner-clear" onClick={() => setRows([])} aria-label="Clear scan"><X size={17}/></button></div>
        <p className="scanner-hint">Tap any time to correct it. Blank Jamaat fields stay blank.</p>
        <div className="scanner-table-wrap"><table className="scanner-table">
          <thead><tr><th>Date</th>{columns.map(column => <th key={column.key}>{column.label}</th>)}</tr></thead>
          <tbody>{rows.map((row, index) => <tr key={row.prayer_date}>
            <td><input aria-label="Prayer date" type="date" value={row.prayer_date} onChange={event => setRows(current => current.map((item, i) => i === index ? { ...item, prayer_date: event.target.value } : item))}/></td>
            {columns.map(column => <td key={column.key}><input aria-label={column.label + " " + row.prayer_date} type="time" value={(row[column.key] as string | null) || ""} onChange={event => updateCell(index, column.key, event.target.value)}/></td>)}
          </tr>)}</tbody>
        </table></div>
        <div className="scanner-review-footer"><span><Check size={13}/> Review before saving</span><button className="primary-btn" type="button" onClick={importRows} disabled={importing || scanning}>{importing ? "Importing…" : "Import " + rows.length + " day(s)"}</button></div>
      </div>}
    </section>
  );
}

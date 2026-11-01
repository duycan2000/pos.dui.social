// Time-clock maths shared by the app and the tests: hours, night hours, lateness, pay.
import type { TimeEntry, WorkShift } from './types';

const MIN = 60000;

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}

/** Timestamp of HH:MM on a business day. Times before the cut-off fall on the next calendar morning. */
export function atDayTime(day: string, hhmm: string, tz: number, cutoff: string): number {
  const [y, m, d] = day.split('-').map(Number);
  let ms = Date.UTC(y, m - 1, d) + minutesOf(hhmm) * MIN - tz * MIN;
  if (minutesOf(hhmm) < minutesOf(cutoff)) ms += 86400000;
  return ms;
}

/** Planned start/end of a scheduled shift. */
export function shiftWindow(s: WorkShift, tz: number, cutoff: string) {
  const start = atDayTime(s.day, s.start, tz, cutoff);
  let end = atDayTime(s.day, s.end, tz, cutoff);
  if (end <= start) end += 86400000;
  return { start, end };
}

export function shiftMinutes(s: WorkShift, tz: number, cutoff: string) {
  const w = shiftWindow(s, tz, cutoff);
  return Math.round((w.end - w.start) / MIN);
}

/** Paid minutes: clock-out (or now, while still working) minus clock-in minus break. */
export function workedMinutes(e: Pick<TimeEntry, 'clock_in' | 'clock_out' | 'break_min'>, now = Date.now()) {
  const end = e.clock_out ?? now;
  return Math.max(0, Math.round((end - e.clock_in) / MIN) - (e.break_min || 0));
}

/** Minutes inside the night window 22:00–06:00 local time (Vietnamese labour code definition). */
export function nightMinutes(e: Pick<TimeEntry, 'clock_in' | 'clock_out' | 'break_min'>, tz: number, now = Date.now()) {
  const a = e.clock_in;
  const b = e.clock_out ?? now;
  if (b <= a) return 0;
  let total = 0;
  // Each night window starts at 22:00 local on some calendar day.
  const localDay0 = Math.floor((a + tz * MIN) / 86400000) - 1;
  for (let d = localDay0; d * 86400000 - tz * MIN < b + 86400000; d++) {
    const ws = d * 86400000 + 22 * 60 * MIN - tz * MIN;
    const we = ws + 8 * 60 * MIN;
    const s = Math.max(a, ws);
    const t = Math.min(b, we);
    if (t > s) total += (t - s) / MIN;
  }
  return Math.min(Math.round(total), workedMinutes(e, now));
}

/** Minutes late versus the scheduled start for that staff member and business day (0 when on time or not scheduled). */
export function lateMinutes(e: TimeEntry, schedule: WorkShift[], tz: number, cutoff: string, graceMin = 10) {
  const mine = schedule.filter((s) => s.staff_id === e.staff_id && s.day === e.business_day);
  if (!mine.length) return 0;
  // The planned shift whose start is closest to the clock-in.
  const starts = mine.map((s) => shiftWindow(s, tz, cutoff).start).sort((x, y) => Math.abs(x - e.clock_in) - Math.abs(y - e.clock_in));
  const late = Math.round((e.clock_in - starts[0]) / MIN);
  return late > graceMin ? late : 0;
}

export type EntryFlag = 'open' | 'forgot' | 'long' | 'late' | 'edited';

export function entryFlags(e: TimeEntry, schedule: WorkShift[], tz: number, cutoff: string, graceMin = 10, now = Date.now()): EntryFlag[] {
  const f: EntryFlag[] = [];
  if (!e.clock_out) f.push(now - e.clock_in > 14 * 3600000 ? 'forgot' : 'open');
  else if (workedMinutes(e, now) > 12 * 60) f.push('long');
  if (lateMinutes(e, schedule, tz, cutoff, graceMin)) f.push('late');
  if (e.edited_by || e.source === 'admin') f.push('edited');
  return f;
}

/** Pay in VND rounded to 1.000: hours × rate, plus the night premium on night hours. */
export function payFor(minutes: number, nightMin: number, rate: number, nightPremiumPct = 0) {
  const raw = (minutes / 60) * rate + (nightMin / 60) * rate * (nightPremiumPct / 100);
  return Math.round(raw / 1000) * 1000;
}

export interface StaffTotals {
  staff_id: string;
  entries: number;
  minutes: number;
  night_minutes: number;
  scheduled_minutes: number;
  late: number;
  open: number;
  pay: number;
}

export function summarize(entries: TimeEntry[], schedule: WorkShift[], rates: Record<string, number>, o: { tz: number; cutoff: string; nightPct?: number; grace?: number; now?: number }): Map<string, StaffTotals> {
  const now = o.now ?? Date.now();
  const out = new Map<string, StaffTotals>();
  const get = (id: string) => {
    let t = out.get(id);
    if (!t) { t = { staff_id: id, entries: 0, minutes: 0, night_minutes: 0, scheduled_minutes: 0, late: 0, open: 0, pay: 0 }; out.set(id, t); }
    return t;
  };
  for (const e of entries) {
    const t = get(e.staff_id);
    t.entries++;
    // An entry nobody closed counts as 0 until a manager fixes it, so a forgotten clock-out never inflates pay.
    const forgot = !e.clock_out && now - e.clock_in > 14 * 3600000;
    if (!e.clock_out) t.open++;
    if (forgot) continue;
    t.minutes += workedMinutes(e, now);
    t.night_minutes += nightMinutes(e, o.tz, now);
    if (lateMinutes(e, schedule, o.tz, o.cutoff, o.grace ?? 10)) t.late++;
  }
  for (const s of schedule) get(s.staff_id).scheduled_minutes += shiftMinutes(s, o.tz, o.cutoff);
  for (const t of out.values()) t.pay = payFor(t.minutes, t.night_minutes, rates[t.staff_id] || 0, o.nightPct || 0);
  return out;
}

/** "7g 45p" */
export function fmtMinutes(m: number) {
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return h ? (r ? `${h}g ${r}p` : `${h}g`) : `${r}p`;
}

/** Monday of the week containing a business day. */
export function weekStart(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  const back = (dow + 6) % 7;
  const dt = new Date(Date.UTC(y, m - 1, d - back));
  return dt.toISOString().slice(0, 10);
}

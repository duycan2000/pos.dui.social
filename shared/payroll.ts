// Monthly pay ("bảng lương"): worked hours × hourly rate, night premium, tips, extra pay, advances and deductions.
// Shared by the Worker (which computes and freezes it in a payslip) and the tests.
import { summarize } from './timesheet';
import type { TimeEntry, WorkShift } from './types';

export type TipMode = 'none' | 'by_staff' | 'pool_hours';
export type AdjKind = 'allowance' | 'bonus' | 'advance' | 'deduction';

export interface PayrollRow {
  staff_id: string;
  name: string;
  rate: number;
  minutes: number;
  night_minutes: number;
  shifts: number;
  open_entries: number;
  base: number;
  night_pay: number;
  tips: number;
  allowance: number;
  bonus: number;
  advance: number;
  deduction: number;
  gross: number;
  net: number;
}

const r1000 = (v: number) => Math.round(v / 1000) * 1000;

/** First and last business day of a month "YYYY-MM". */
export function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

export function computePayroll(input: {
  staff: { id: string; name: string; hourly_rate?: number | null }[];
  entries: TimeEntry[];
  schedule?: WorkShift[];
  tipsByStaff: Record<string, number>;
  adjustments: { staff_id: string; kind: AdjKind; amount: number }[];
  /** Advances taken from the till (cash_movement 'advance'). */
  cashAdvances: Record<string, number>;
  tz: number;
  cutoff: string;
  nightPct: number;
  tipMode: TipMode;
  now?: number;
}): PayrollRow[] {
  const rates = Object.fromEntries(input.staff.map((s) => [s.id, s.hourly_rate || 0]));
  const sums = summarize(input.entries.filter((e) => e.clock_out), input.schedule ?? [], rates, { tz: input.tz, cutoff: input.cutoff, nightPct: input.nightPct, now: input.now });
  const open = new Map<string, number>();
  for (const e of input.entries) if (!e.clock_out) open.set(e.staff_id, (open.get(e.staff_id) ?? 0) + 1);
  const totalMinutes = [...sums.values()].reduce((a, t) => a + t.minutes, 0);
  const tipPool = Object.values(input.tipsByStaff).reduce((a, b) => a + b, 0);
  const rows: PayrollRow[] = [];
  for (const s of input.staff) {
    const t = sums.get(s.id);
    const adj = input.adjustments.filter((a) => a.staff_id === s.id);
    const sum = (k: AdjKind) => adj.filter((a) => a.kind === k).reduce((x, a) => x + a.amount, 0);
    const minutes = t?.minutes ?? 0;
    const nightMin = t?.night_minutes ?? 0;
    const rate = rates[s.id];
    const base = r1000((minutes / 60) * rate);
    const nightPay = r1000((nightMin / 60) * rate * (input.nightPct / 100));
    const tips = input.tipMode === 'by_staff' ? input.tipsByStaff[s.id] ?? 0
      : input.tipMode === 'pool_hours' && totalMinutes > 0 ? r1000((tipPool * minutes) / totalMinutes) : 0;
    const allowance = sum('allowance');
    const bonus = sum('bonus');
    const advance = sum('advance') + (input.cashAdvances[s.id] ?? 0);
    const deduction = sum('deduction');
    const gross = base + nightPay + tips + allowance + bonus;
    const row: PayrollRow = {
      staff_id: s.id, name: s.name, rate, minutes, night_minutes: nightMin, shifts: t?.entries ?? 0, open_entries: open.get(s.id) ?? 0,
      base, night_pay: nightPay, tips, allowance, bonus, advance, deduction, gross, net: gross - advance - deduction,
    };
    if (row.minutes || row.gross || row.advance || row.deduction || row.open_entries) rows.push(row);
  }
  return rows;
}

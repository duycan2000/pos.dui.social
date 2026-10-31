// Small helpers shared by app and Worker. No dependencies.

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ULID: 48-bit time + 80-bit randomness, sortable by creation time. */
export function ulid(now = Date.now()): string {
  let t = now;
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let rand = '';
  for (let i = 0; i < 16; i++) rand += CROCKFORD[bytes[i] % 32];
  return time + rand;
}

/** 240000 -> "240.000 ₫" */
export function vnd(amount: number, withSymbol = true): string {
  const sign = amount < 0 ? '−' : '';
  const s = Math.round(Math.abs(amount)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return sign + s + (withSymbol ? ' ₫' : '');
}

/** 120000 -> "120K", 1500000 -> "1,5tr" */
export function vndShort(amount: number): string {
  if (Math.abs(amount) >= 1_000_000) return (amount / 1_000_000).toFixed(1).replace('.', ',').replace(',0', '') + 'tr';
  if (Math.abs(amount) >= 1000 && amount % 1000 === 0) return amount / 1000 + 'K';
  return vnd(amount, false);
}

/** Parse "240.000", "240000", "240k" into an integer VND. */
export function parseVnd(input: string): number {
  const s = input.trim().toLowerCase();
  if (!s) return 0;
  if (/k$/.test(s)) return Math.round(parseFloat(s.slice(0, -1).replace(',', '.')) * 1000) || 0;
  return parseInt(s.replace(/[^\d-]/g, ''), 10) || 0;
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}

/** Local wall-clock Date (as UTC fields) for a timestamp at a fixed offset. */
export function localParts(ms: number, tzOffsetMin: number) {
  const d = new Date(ms + tzOffsetMin * 60000);
  return {
    y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(),
    h: d.getUTCHours(), mi: d.getUTCMinutes(), dow: d.getUTCDay(),
  };
}

function ymd(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Business day: a sale before the cut-off (e.g. 05:00) belongs to the previous calendar day.
 * Vietnam has no DST, so a fixed offset (420 min) is exact.
 */
export function businessDay(ms: number, tzOffsetMin: number, cutoff: string): string {
  const shifted = ms + tzOffsetMin * 60000 - minutesOf(cutoff) * 60000;
  const d = new Date(shifted);
  return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(from + 'T00:00:00Z');
  const b = Date.parse(to + 'T00:00:00Z');
  return Math.round((b - a) / 86400000) + 1;
}

export function hhmm(ms: number, tzOffsetMin: number): string {
  const p = localParts(ms, tzOffsetMin);
  return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
}

export function fmtDay(day: string): string {
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}

export function parseSettings<T = Record<string, unknown>>(json: string | null | undefined): T {
  try { return JSON.parse(json || '{}') as T; } catch { return {} as T; }
}

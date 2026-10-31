// Pricing rules used by both the app (live cart) and the Worker (re-check on sync).
import type { OrderAdjustment, OrderLine, Promotion, PromotionItem } from './types';
import { localParts, ulid } from './util';

function minutes(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Is a promotion running at this moment (local time of the outlet)? */
export function promoActiveAt(p: Promotion, ms: number, tzOffsetMin: number): boolean {
  if (!p.active) return false;
  const lp = localParts(ms, tzOffsetMin);
  const today = `${lp.y}-${String(lp.mo).padStart(2, '0')}-${String(lp.d).padStart(2, '0')}`;
  if (p.start_date && today < p.start_date) return false;
  if (p.end_date && today > p.end_date) return false;
  if (p.days_of_week) {
    const days = p.days_of_week.split(',').map((x) => parseInt(x, 10));
    if (!days.includes(lp.dow)) return false;
  }
  if (p.time_from && p.time_to) {
    const now = lp.h * 60 + lp.mi;
    const a = minutes(p.time_from);
    const b = minutes(p.time_to);
    const inside = a <= b ? now >= a && now < b : now >= a || now < b; // window may cross midnight
    if (!inside) return false;
  }
  return true;
}

/**
 * BOGO: eligible = active lines whose item is in the promotion and that carry no option with
 * excludes_promo (the Mocktail version). Units are sorted by unit price, high to low, and every
 * 2nd unit is free: 2 → 1 free, 3 → 1 free, 4 → 2 free. Pairs mix across the promo items,
 * so the cheaper drink of each pair is the free one.
 */
export function computeBogo(lines: OrderLine[], promo: Promotion, promoItemIds: Set<string>): OrderAdjustment[] {
  const units: { lineId: string; price: number }[] = [];
  for (const l of lines) {
    if (l.status !== 'active' || l.comp) continue;
    if (!promoItemIds.has(l.item_id)) continue;
    if (l.modifiers.some((m) => m.excludes_promo)) continue;
    for (let i = 0; i < l.qty; i++) units.push({ lineId: l.id, price: l.unit_price });
  }
  units.sort((a, b) => b.price - a.price);
  const perLine = new Map<string, number>();
  for (let i = 1; i < units.length; i += 2) {
    const u = units[i];
    perLine.set(u.lineId, (perLine.get(u.lineId) || 0) + u.price);
  }
  return [...perLine.entries()].map(([lineId, amount]) => ({
    id: ulid(),
    order_line_id: lineId,
    kind: 'promo' as const,
    promotion_id: promo.id,
    amount,
    reason: promo.name,
    staff_id: null,
    approved_by: null,
  }));
}

export interface Totals {
  subtotal: number;
  promo_total: number;
  discount_total: number;
  comp_total: number;
  total: number;
  adjustments: OrderAdjustment[];
}

/** Recompute line totals, promotions and order totals. Manual discounts (P2) are kept as given. */
export function computeTotals(
  lines: OrderLine[],
  promotions: Promotion[],
  promotionItems: PromotionItem[],
  ms: number,
  tzOffsetMin: number,
  manualDiscounts: OrderAdjustment[] = [],
): Totals {
  for (const l of lines) l.line_total = l.unit_price * l.qty;
  const active = lines.filter((l) => l.status === 'active');
  const subtotal = active.reduce((s, l) => s + l.line_total, 0);
  const adjustments: OrderAdjustment[] = [];
  for (const p of promotions) {
    if (p.type !== 'bogo' || !promoActiveAt(p, ms, tzOffsetMin)) continue;
    const ids = new Set(promotionItems.filter((x) => x.promotion_id === p.id).map((x) => x.item_id));
    adjustments.push(...computeBogo(lines, p, ids));
  }
  const promo_total = adjustments.reduce((s, a) => s + a.amount, 0);
  const discount_total = manualDiscounts.reduce((s, a) => s + a.amount, 0);
  adjustments.push(...manualDiscounts);
  // Ly mời: the guest pays nothing for the line; its value is reported as comp.
  const comp_total = active.filter((l) => l.comp).reduce((s, l) => s + l.line_total, 0);
  const total = Math.max(0, subtotal - promo_total - discount_total - comp_total);
  return { subtotal, promo_total, discount_total, comp_total, total, adjustments };
}

/** Expected cash in the shared drawer: float + cash sales + cash tips + cash in − cash out. */
export function expectedCash(openingFloat: number, cashPayments: number, cashIn: number, cashOut: number, cashTips = 0): number {
  return openingFloat + cashPayments + cashTips + cashIn - cashOut;
}

/** Find an order code like "A-012" inside a bank transfer note ("DUI A012", "dui a 012 thanh toan"…). */
export function parseOrderCode(text: string | null | undefined): string | null {
  if (!text) return null;
  const s = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = s.match(/DUI([A-Z])(\d{3,4})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

/** Quick-cash suggestions for S11: exact, then round notes above the amount due. */
export function cashSuggestions(due: number): number[] {
  const out = new Set<number>([due]);
  for (const step of [10000, 50000, 100000]) out.add(Math.ceil((due + 1) / step) * step);
  for (const note of [100000, 200000, 500000, 1000000]) if (note > due) out.add(note);
  return [...out].sort((a, b) => a - b).slice(0, 5);
}

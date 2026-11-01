// What goes on paper: customer bill, pre-bill for an open tab, and the bar ticket.
import type { Order, OrderLine, PosConfig } from '../../shared/types';
import { hhmm, localParts } from '../../shared/util';
import { type PLine, printDoc, printerSettings } from './printer';

// ---------- guest bill & receipt (English) ----------

const METHOD: Record<string, string> = { cash: 'Cash', vietqr: 'Bank transfer', card: 'Card' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 240000 → "240,000" */
const money = (n: number) => (n < 0 ? '-' : '') + Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** "01 Nov 2026, 22:14" in the outlet's time zone. */
function when(ms: number, tz: number) {
  const p = localParts(ms, tz);
  return `${String(p.d).padStart(2, '0')} ${MONTHS[p.mo - 1]} ${p.y}, ${hhmm(ms, tz)}`;
}

/** English item name from the menu, falling back to the name saved on the order line. */
function itemName(cfg: PosConfig, l: OrderLine) {
  return cfg.items.find((i) => i.id === l.item_id)?.name_en?.trim() || l.item_name;
}

/** Chosen options that differ from the defaults (in English), then the bar note. */
function detailEn(cfg: PosConfig, l: OrderLine) {
  const opts = l.modifiers
    .map((m) => cfg.modifierOptions.find((o) => o.id === m.id))
    .filter((o) => o && !o.is_default)
    .map((o) => o!.name_en?.trim() || o!.name_vi);
  return [...opts, l.note].filter(Boolean).join(' · ');
}

function billHeader(cfg: PosConfig, o: Order, band: string): PLine[] {
  const tz = cfg.outlet.tz_offset_min;
  const table = cfg.tables?.find((t) => t.id === o.table_id)?.name;
  const staff = cfg.staff.find((s) => s.id === o.staff_id)?.name;
  const where = table ? table.replace(/^Bàn\s*/i, 'Table ') : o.order_type === 'takeaway' ? 'Takeaway' : o.order_type === 'message' ? 'Delivery' : 'Dine-in';
  const out: PLine[] = [{ t: 'text', text: cfg.outlet.name.toUpperCase(), align: 'center', size: 'xl', bold: true, spacing: 3 }];
  if (cfg.outlet.receipt_header) out.push({ t: 'text', text: cfg.outlet.receipt_header, align: 'center', size: 'sm' });
  out.push({ t: 'space', h: 10 }, { t: 'band', text: band }, { t: 'space', h: 4 });
  out.push({ t: 'row', left: `Order #${o.short_code}`, right: where, size: 'sm', bold: true });
  out.push({ t: 'row', left: when(o.paid_at ?? Date.now(), tz), right: o.guests ? `${o.guests} guest${o.guests > 1 ? 's' : ''}` : '', size: 'sm' });
  const who = [o.customer_label ? `Guest: ${o.customer_label}` : '', staff ? `Server: ${staff}` : ''].filter(Boolean);
  if (who.length) out.push({ t: 'row', left: who[0], right: who[1] ?? '', size: 'sm' });
  out.push({ t: 'hr' });
  return out;
}

function billItems(cfg: PosConfig, o: Order): PLine[] {
  return o.lines.filter((x) => x.status === 'active').map((l): PLine => ({
    t: 'item',
    qty: String(l.qty),
    name: itemName(cfg, l),
    right: l.comp ? 'FREE' : money(l.unit_price * l.qty),
    detail: [detailEn(cfg, l), l.comp ? 'Complimentary' : ''].filter(Boolean).join(' · ') || undefined,
  }));
}

function billTotals(o: Order, label: string): PLine[] {
  const out: PLine[] = [{ t: 'hr' }];
  const extras = (o.promo_total || 0) + (o.discount_total || 0) + (o.comp_total || 0);
  if (extras) {
    out.push({ t: 'row', left: 'Subtotal', right: money(o.subtotal), size: 'sm' });
    if (o.promo_total) out.push({ t: 'row', left: 'Buy 1 Get 1', right: money(-o.promo_total), size: 'sm' });
    if (o.comp_total) out.push({ t: 'row', left: 'Complimentary', right: money(-(o.comp_total || 0)), size: 'sm' });
    if (o.discount_total) out.push({ t: 'row', left: 'Discount', right: money(-o.discount_total), size: 'sm' });
    out.push({ t: 'space', h: 4 });
  }
  out.push({ t: 'row', left: label, right: `${money(o.total)} VND`, size: 'lg', bold: true });
  return out;
}

function footer(cfg: PosConfig, extra?: string): PLine[] {
  const out: PLine[] = [{ t: 'hr' }];
  if (extra) out.push({ t: 'text', text: extra, align: 'center', size: 'sm', bold: true });
  out.push({ t: 'text', text: cfg.outlet.receipt_footer || 'Thank you — see you again soon!', align: 'center', size: 'sm' });
  return out;
}

/** Receipt after payment: what was paid, how, change and tip. */
export function receiptDoc(cfg: PosConfig, o: Order): PLine[] {
  const band = o.status === 'void' ? 'VOID' : o.status === 'awaiting_payment' ? 'AWAITING TRANSFER' : 'RECEIPT';
  const doc: PLine[] = [...billHeader(cfg, o, band), ...billItems(cfg, o), ...billTotals(o, 'TOTAL')];
  const pays = o.payments.filter((x) => x.status === 'confirmed');
  if (pays.length) {
    doc.push({ t: 'hr' });
    for (const p of pays) {
      doc.push({ t: 'row', left: METHOD[p.method] ?? p.method, right: money(p.method === 'cash' && p.tendered ? p.tendered : p.amount + (p.tip || 0)), size: 'sm' });
      if (p.method === 'cash' && p.change_given) doc.push({ t: 'row', left: 'Change', right: money(p.change_given), size: 'sm' });
      if (p.tip) doc.push({ t: 'row', left: 'Tip', right: money(p.tip), size: 'sm' });
    }
  }
  if (o.status === 'void' && o.void_reason) doc.push({ t: 'text', text: `Voided: ${o.void_reason}`, align: 'center', size: 'sm' });
  doc.push(...footer(cfg, o.status === 'paid' ? 'PAID' : undefined));
  return doc;
}

/** Guest bill before payment (also for a table that asks for the bill). Not a receipt. */
export async function preBillDoc(cfg: PosConfig, o: Order): Promise<PLine[]> {
  return [...billHeader(cfg, o, 'BILL'), ...billItems(cfg, o), ...billTotals(o, 'TOTAL'), ...footer(cfg, 'Not paid yet · please pay at the counter')];
}

// ---------- bar ticket (Vietnamese, for the bartenders) ----------

function optText(cfg: PosConfig, l: OrderLine) {
  const opts = l.modifiers.filter((m) => !cfg.modifierOptions.find((o) => o.id === m.id)?.is_default).map((m) => m.name);
  return [...opts, l.note].filter(Boolean).join(', ');
}

function title(cfg: PosConfig, o: Order) {
  return [cfg.tables?.find((t) => t.id === o.table_id)?.name, o.customer_label].filter(Boolean).join(' · ');
}

/** Bar ticket: only the lines being sent now, big and readable. */
export function ticketDoc(cfg: PosConfig, o: Order, newLines: OrderLine[]): PLine[] {
  const tz = cfg.outlet.tz_offset_min;
  const doc: PLine[] = [
    { t: 'text', text: `#${o.short_code}`, size: 'xl', bold: true },
    { t: 'row', left: title(cfg, o) || (o.order_type === 'takeaway' ? 'Mang đi' : 'Tại chỗ'), right: hhmm(Date.now(), tz), bold: true },
    { t: 'hr', dashed: false },
  ];
  for (const l of newLines) {
    doc.push({ t: 'text', text: `${l.qty} × ${l.item_name}${l.comp ? ' (mời)' : ''}`, size: 'lg', bold: true });
    const extra = optText(cfg, l);
    if (extra) doc.push({ t: 'text', text: '   → ' + extra, size: 'md' });
  }
  return doc;
}

/** Print helpers that never throw into the selling flow; they return an error message instead. */
export async function tryPrint(doc: PLine[], opts: { kick?: boolean; copies?: number } = {}): Promise<string | null> {
  if (printerSettings().mode === 'none') return 'Chưa cài máy in';
  try { await printDoc(doc, opts); return null; } catch (e) { return (e as Error).message || 'In thất bại'; }
}

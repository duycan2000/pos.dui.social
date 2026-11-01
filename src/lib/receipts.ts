// What goes on paper: customer bill, pre-bill for an open tab, and the bar ticket.
import type { Order, OrderLine, PosConfig } from '../../shared/types';
import { hhmm, fmtDay, vnd } from '../../shared/util';
import { type PLine, printDoc, printerSettings } from './printer';

const METHOD: Record<string, string> = { cash: 'Tiền mặt', vietqr: 'Chuyển khoản', card: 'Thẻ' };

function optText(cfg: PosConfig, l: OrderLine) {
  const opts = l.modifiers.filter((m) => !cfg.modifierOptions.find((o) => o.id === m.id)?.is_default).map((m) => m.name);
  return [...opts, l.note].filter(Boolean).join(', ');
}

function title(cfg: PosConfig, o: Order) {
  return [cfg.tables?.find((t) => t.id === o.table_id)?.name, o.customer_label].filter(Boolean).join(' · ');
}

function header(cfg: PosConfig, o: Order, title_: string): PLine[] {
  const tz = cfg.outlet.tz_offset_min;
  const out: PLine[] = [{ t: 'text', text: cfg.outlet.name.toUpperCase(), align: 'center', size: 'lg', bold: true }];
  if (cfg.outlet.receipt_header) out.push({ t: 'text', text: cfg.outlet.receipt_header, align: 'center', size: 'sm' });
  out.push({ t: 'space', h: 6 }, { t: 'text', text: title_, align: 'center', size: 'md', bold: true });
  const name = title(cfg, o);
  out.push({ t: 'row', left: `#${o.short_code}${name ? ' · ' + name : ''}`, right: hhmm(o.paid_at ?? Date.now(), tz), size: 'sm' });
  if (o.guests) out.push({ t: 'row', left: `${o.guests} khách`, right: `Vào ${hhmm(o.created_at, tz)}`, size: 'sm' });
  out.push({ t: 'row', left: fmtDay(o.business_day), right: cfg.staff.find((s) => s.id === o.staff_id)?.name ?? '', size: 'sm' });
  out.push({ t: 'hr' });
  return out;
}

function lines(cfg: PosConfig, o: Order): PLine[] {
  const out: PLine[] = [];
  for (const l of o.lines.filter((x) => x.status === 'active')) {
    out.push({ t: 'row', left: `${l.qty} × ${l.item_name}`, right: l.comp ? 'MỜI' : vnd(l.unit_price * l.qty, false), bold: true });
    const extra = optText(cfg, l);
    if (extra) out.push({ t: 'text', text: '   ' + extra, size: 'sm' });
  }
  return out;
}

function totals(o: Order): PLine[] {
  const out: PLine[] = [{ t: 'hr' }, { t: 'row', left: 'Tạm tính', right: vnd(o.subtotal, false) }];
  if (o.promo_total) out.push({ t: 'row', left: 'Mua 1 tặng 1', right: '-' + vnd(o.promo_total, false) });
  if (o.discount_total) out.push({ t: 'row', left: 'Giảm giá', right: '-' + vnd(o.discount_total, false) });
  if (o.comp_total) out.push({ t: 'row', left: 'Mời', right: '-' + vnd(o.comp_total, false) });
  out.push({ t: 'row', left: 'TỔNG', right: vnd(o.total), size: 'lg', bold: true });
  return out;
}

export function receiptDoc(cfg: PosConfig, o: Order): PLine[] {
  const doc: PLine[] = [...header(cfg, o, 'HOÁ ĐƠN'), ...lines(cfg, o), ...totals(o)];
  for (const p of o.payments.filter((x) => x.status === 'confirmed')) {
    doc.push({ t: 'row', left: METHOD[p.method], right: vnd(p.amount + (p.tip || 0), false), size: 'sm' });
    if (p.tendered && p.method === 'cash') doc.push({ t: 'row', left: 'Khách đưa / thối', right: `${vnd(p.tendered, false)} / ${vnd(p.change_given, false)}`, size: 'sm' });
    if (p.tip) doc.push({ t: 'row', left: 'Tip', right: vnd(p.tip, false), size: 'sm' });
  }
  doc.push({ t: 'hr' }, { t: 'text', text: cfg.outlet.receipt_footer || 'Cảm ơn quý khách!', align: 'center', size: 'sm' });
  return doc;
}

/** Bill for the guest before paying: items and total only (payment is taken at the counter). */
export async function preBillDoc(cfg: PosConfig, o: Order): Promise<PLine[]> {
  return [...header(cfg, o, 'PHIẾU TẠM TÍNH'), ...lines(cfg, o), ...totals(o), { t: 'hr' }, { t: 'text', text: 'Phiếu tạm tính — chưa thanh toán', align: 'center', size: 'sm' }];
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

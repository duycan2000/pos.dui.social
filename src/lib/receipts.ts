// What goes on paper: customer bill, pre-bill for an open tab, and the bar ticket.
import { bankShort } from '../../shared/banks';
import type { Order, OrderLine, OutletSettings, PosConfig } from '../../shared/types';
import QRCode from 'qrcode';
import { vietQrPayload } from '../../shared/vietqr';
import { hhmm, localParts, parseSettings } from '../../shared/util';
import { type PLine, printDoc, printerSettings } from './printer';

// ---------- guest bill & receipt ----------
// Layout follows the bills guests in Vietnam are used to (CukCuk/KiotViet style): outlet and address,
// title, number, date/time, table, guests, cashier, a bordered item table (# · Item · Qty · Price · % off ·
// Amount), totals, footer notes, then the bank QR and "TPB - ACCOUNT NAME - NUMBER". Labels in English
// (default) or Vietnamese — Cài đặt › Hoá đơn.

type Lang = 'en' | 'vi';
const L = {
  en: {
    prebill: 'GUEST BILL', receipt: 'RECEIPT', void: 'VOIDED', awaiting: 'AWAITING TRANSFER', no: 'No.:', date: 'Date:', table: 'Table:', takeaway: 'Takeaway',
    guests: 'Guests:', cashier: 'Cashier:', guest: 'Guest:', cols: ['#', 'Item', 'Qty', 'Price', '% Off', 'Amount'], subtotal: 'Subtotal', bogo: 'Buy 1 Get 1',
    comp: 'Complimentary', discount: 'Discount', total: 'Total', cash: 'Cash', vietqr: 'Bank transfer', card: 'Card', tendered: 'Cash received', change: 'Change',
    tip: 'Tip', due: 'Balance due', toPay: 'To pay (incl. tip)', scan: 'SCAN TO PAY', note: 'Transfer note:', keep: 'Please keep the transfer note unchanged',
    check: 'Please check your bill before paying', thanks: 'Thank you — see you again soon!', wifi: 'Wifi password:', voided: 'Voided:',
  },
  vi: {
    prebill: 'PHIẾU TẠM TÍNH', receipt: 'HOÁ ĐƠN THANH TOÁN', void: 'HOÁ ĐƠN ĐÃ HUỶ', awaiting: 'CHỜ CHUYỂN KHOẢN', no: 'Số:', date: 'Ngày:', table: 'Bàn:', takeaway: 'Mang đi',
    guests: 'SL khách:', cashier: 'Thu ngân:', guest: 'Khách:', cols: ['#', 'Tên món', 'SL', 'ĐG', '% KM', 'TT'], subtotal: 'Tiền hàng', bogo: 'Mua 1 tặng 1',
    comp: 'Mời', discount: 'Giảm giá', total: 'Tổng thanh toán', cash: 'Tiền mặt', vietqr: 'Chuyển khoản', card: 'Thẻ', tendered: 'Khách đưa', change: 'Trả lại',
    tip: 'Tip', due: 'Còn phải thu', toPay: 'Cần chuyển (gồm tip)', scan: 'QUÉT MÃ ĐỂ THANH TOÁN', note: 'Nội dung CK:', keep: 'Vui lòng giữ nguyên nội dung chuyển khoản',
    check: 'Vui lòng kiểm tra kỹ lại nội dung trước khi thanh toán!', thanks: 'Trân trọng cảm ơn!', wifi: 'Pass wifi:', voided: 'Đã huỷ:',
  },
};

interface BillOpts { lang: Lang; note: string; wifi: string; prebillQr: boolean }
function billOpts(cfg: PosConfig): BillOpts {
  const s = parseSettings<OutletSettings>(cfg.outlet.settings_json);
  return { lang: s.bill_lang === 'vi' ? 'vi' : 'en', note: s.bill_note ?? '', wifi: s.wifi_pass ?? '', prebillQr: !!s.prebill_qr };
}

const money = (n: number, lang: Lang) => (n < 0 ? '-' : '') + Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'vi' ? '.' : ',');
const amt = (n: number, lang: Lang) => money(n, lang) + (lang === 'vi' ? 'đ' : ' VND');

function dateRange(o: Order, tz: number) {
  const p = localParts(o.created_at, tz);
  const end = o.paid_at ?? Date.now();
  return `${String(p.d).padStart(2, '0')}/${String(p.mo).padStart(2, '0')}/${p.y} (${hhmm(o.created_at, tz)} - ${hhmm(end, tz)})`;
}

function itemName(cfg: PosConfig, l: OrderLine, lang: Lang) {
  const base = lang === 'en' ? cfg.items.find((i) => i.id === l.item_id)?.name_en?.trim() || l.item_name : l.item_name;
  const opts = l.modifiers
    .map((m) => cfg.modifierOptions.find((o) => o.id === m.id))
    .filter((o) => o && !o.is_default)
    .map((o) => (lang === 'en' ? o!.name_en?.trim() || o!.name_vi : o!.name_vi));
  const extra = [...opts, l.note].filter(Boolean).join(', ');
  return (lang === 'vi' ? base.toUpperCase() : base) + (extra ? ` (${extra})` : '');
}

function head(cfg: PosConfig, o: Order, title: string, lang: Lang): PLine[] {
  const t = L[lang];
  const tz = cfg.outlet.tz_offset_min;
  const table = cfg.tables?.find((x) => x.id === o.table_id)?.name;
  const staff = cfg.staff.find((s) => s.id === o.staff_id)?.name;
  const out: PLine[] = [{ t: 'text', text: cfg.outlet.name, align: 'center', size: 'lg', bold: true }];
  if (cfg.outlet.receipt_header) out.push({ t: 'text', text: cfg.outlet.receipt_header, align: 'center', size: 'sm' });
  out.push({ t: 'text', text: title, align: 'center', size: 'lg', bold: true });
  out.push({ t: 'text', text: `${t.no} ${o.short_code}`, align: 'center', size: 'sm', bold: true }, { t: 'space', h: 4 });
  out.push({ t: 'field', label: t.date, value: dateRange(o, tz) });
  out.push({ t: 'field', label: t.table, value: table ? (lang === 'en' ? table.replace(/^Bàn\s*/i, '') : table.replace(/^Bàn\s*/i, '')) : t.takeaway });
  if (o.guests) out.push({ t: 'field', label: t.guests, value: String(o.guests) });
  if (o.customer_label) out.push({ t: 'field', label: t.guest, value: o.customer_label });
  if (staff) out.push({ t: 'field', label: t.cashier, value: staff });
  out.push({ t: 'space', h: 4 });
  return out;
}

function items(cfg: PosConfig, o: Order, lang: Lang): PLine {
  const promoOf = (id: string) => o.adjustments.filter((a) => a.order_line_id === id && a.kind === 'promo').reduce((s, a) => s + a.amount, 0);
  const rows = o.lines.filter((l) => l.status === 'active').map((l, i) => {
    const gross = l.unit_price * l.qty;
    const off = l.comp ? 100 : gross ? Math.round((promoOf(l.id) / gross) * 100) : 0;
    return [String(i + 1), itemName(cfg, l, lang), String(l.qty), money(l.unit_price, lang), off ? String(off) : '', money(gross, lang)];
  });
  return {
    t: 'table', rows,
    cols: L[lang].cols.map((label, k) => ({ label, w: [0.055, 0.315, 0.075, 0.2, 0.105, 0.25][k], align: (['center', 'left', 'right', 'right', 'center', 'right'] as const)[k] })),
  };
}

function totals(o: Order, lang: Lang): PLine[] {
  const t = L[lang];
  const out: PLine[] = [{ t: 'row', left: t.subtotal, right: amt(o.subtotal, lang), size: 'sm', italic: true, bold: true }];
  if (o.promo_total) out.push({ t: 'row', left: t.bogo, right: '-' + amt(o.promo_total, lang), size: 'sm', italic: true });
  if (o.comp_total) out.push({ t: 'row', left: t.comp, right: '-' + amt(o.comp_total, lang), size: 'sm', italic: true });
  if (o.discount_total) out.push({ t: 'row', left: t.discount, right: '-' + amt(o.discount_total, lang), size: 'sm', italic: true });
  out.push({ t: 'space', h: 4 }, { t: 'row', left: t.total, right: amt(o.total, lang), size: 'lg', bold: true });
  return out;
}

function closing(cfg: PosConfig, opt: BillOpts, extra?: string): PLine[] {
  const t = L[opt.lang];
  const out: PLine[] = [{ t: 'space', h: 10 }];
  if (extra) out.push({ t: 'text', text: extra, align: 'center', size: 'sm', bold: true });
  const lines = (opt.note.trim() ? opt.note.split('\n') : [t.check]).map((x) => x.trim()).filter(Boolean);
  for (const x of lines) out.push({ t: 'text', text: x, align: 'center', size: 'sm', bold: true });
  out.push({ t: 'text', text: cfg.outlet.receipt_footer || t.thanks, align: 'center', size: 'sm', bold: true });
  if (opt.wifi.trim()) out.push({ t: 'text', text: `${t.wifi} ${opt.wifi.trim()}`, align: 'center', size: 'sm', bold: true });
  return out;
}

/** VietQR for the amount and order; "TPB - HOLDER - NUMBER" underneath. */
async function qrBlock(cfg: PosConfig, o: Order, amount: number, lang: Lang, withTitle: boolean): Promise<PLine[]> {
  const { vietqr_bank_bin: bin, vietqr_account: acc, vietqr_account_name: holder } = cfg.outlet;
  if (!bin || !acc) throw new Error('Chưa cài tài khoản VietQR (Quản trị › Cài đặt)');
  const t = L[lang];
  const purpose = 'DUI ' + o.short_code.replace('-', '');
  const canvas = document.createElement('canvas');
  await QRCode.toCanvas(canvas, vietQrPayload({ bankBin: bin, account: acc, amount, purpose }), { margin: 1, width: 300, errorCorrectionLevel: 'M' });
  const out: PLine[] = [{ t: 'space', h: 6 }];
  if (withTitle) out.push({ t: 'text', text: t.scan, align: 'center', size: 'md', bold: true });
  out.push({ t: 'image', canvas, width: 230 });
  out.push({ t: 'text', text: [bankShort(bin), holder, acc].filter(Boolean).join(' - '), align: 'center', size: 'sm', bold: true });
  out.push({ t: 'text', text: `${t.note} ${purpose} · ${amt(amount, lang)}`, align: 'center', size: 'sm' });
  return out;
}

/** Receipt after payment: what was paid, how, change and tip. */
export function receiptDoc(cfg: PosConfig, o: Order): PLine[] {
  const opt = billOpts(cfg);
  const t = L[opt.lang];
  const title = o.status === 'void' ? t.void : o.status === 'awaiting_payment' ? t.awaiting : t.receipt;
  const doc: PLine[] = [...head(cfg, o, title, opt.lang), items(cfg, o, opt.lang), ...totals(o, opt.lang), { t: 'hr', dashed: false }];
  const pays = o.payments.filter((x) => x.status === 'confirmed');
  let paid = 0;
  for (const p of pays) {
    paid += p.amount;
    doc.push({ t: 'row', left: t[p.method], right: amt(p.amount + (p.tip || 0), opt.lang), size: 'sm' });
    if (p.method === 'cash' && p.tendered) doc.push({ t: 'row', left: t.tendered, right: amt(p.tendered, opt.lang), size: 'sm' });
    if (p.method === 'cash' && p.change_given) doc.push({ t: 'row', left: t.change, right: amt(p.change_given, opt.lang), size: 'sm' });
    if (p.tip) doc.push({ t: 'row', left: t.tip, right: amt(p.tip, opt.lang), size: 'sm' });
  }
  doc.push({ t: 'row', left: t.due, right: amt(Math.max(0, o.status === 'paid' ? 0 : o.total - paid), opt.lang), size: 'sm', italic: true, bold: true });
  if (o.status === 'void' && o.void_reason) doc.push({ t: 'text', text: `${t.voided} ${o.void_reason}`, align: 'center', size: 'sm' });
  doc.push(...closing(cfg, opt));
  return doc;
}

/** Guest bill before payment (also for a table that asks for the bill). QR only if turned on in Settings. */
export async function preBillDoc(cfg: PosConfig, o: Order): Promise<PLine[]> {
  const opt = billOpts(cfg);
  const t = L[opt.lang];
  const doc: PLine[] = [...head(cfg, o, t.prebill, opt.lang), items(cfg, o, opt.lang), ...totals(o, opt.lang), { t: 'hr', dashed: false },
    { t: 'row', left: t.due, right: amt(o.total, opt.lang), size: 'sm', italic: true, bold: true }, ...closing(cfg, opt)];
  if (opt.prebillQr && cfg.outlet.vietqr_bank_bin && cfg.outlet.vietqr_account && o.total > 0) {
    try { doc.push(...(await qrBlock(cfg, o, o.total, opt.lang, false))); } catch { /* print without QR */ }
  }
  return doc;
}

/**
 * Bill with a VietQR code for a guest who pays by bank transfer. The QR carries the amount and the note
 * "DUI A012", so the transfer is matched to this order and confirmed automatically by the bank webhook.
 */
export async function qrBillDoc(cfg: PosConfig, o: Order, amount: number): Promise<PLine[]> {
  const opt = billOpts(cfg);
  const t = L[opt.lang];
  const tip = amount - o.total;
  return [
    ...head(cfg, o, t.prebill, opt.lang), items(cfg, o, opt.lang), ...totals(o, opt.lang), { t: 'hr', dashed: false },
    ...(tip > 0 ? [{ t: 'row', left: t.tip, right: amt(tip, opt.lang), size: 'sm' } as PLine] : []),
    { t: 'row', left: tip > 0 ? t.toPay : t.due, right: amt(amount, opt.lang), size: 'sm', italic: true, bold: true },
    ...closing(cfg, opt, t.keep),
    ...(await qrBlock(cfg, o, amount, opt.lang, true)),
  ];
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

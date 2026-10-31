// Finance: dashboard (cash flow and P&L kept separate), cash book, revenue reports for tax.
import { addDays, businessDay, daysBetween, parseSettings, ulid } from '../shared/util';
import { all, auditStmt, batch, body, type Ctx, type Env, first, json, need, now, requireRole, stmt } from './http';

async function outlet(env: Env) {
  return (await first<{ tz_offset_min: number; business_day_cutoff: string; settings_json: string }>(env, 'SELECT tz_offset_min,business_day_cutoff,settings_json FROM outlet LIMIT 1'))!;
}

function range(c: Ctx, todayDay: string) {
  const from = c.url.searchParams.get('from') || todayDay;
  const to = c.url.searchParams.get('to') || from;
  need(/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to, 400, 'Khoảng ngày không hợp lệ');
  return { from, to };
}

async function periodSummary(env: Env, from: string, to: string) {
  const [s, pays, ledger, cash] = await Promise.all([
    first<{ n: number; gross: number; promo: number; disc: number; net: number; cogs: number }>(env,
      "SELECT COUNT(*) n, COALESCE(SUM(subtotal),0) gross, COALESCE(SUM(promo_total),0) promo, COALESCE(SUM(discount_total),0) disc, COALESCE(SUM(total),0) net, COALESCE(SUM(cost_total),0) cogs FROM sale_order WHERE status='paid' AND business_day BETWEEN ? AND ?", from, to),
    all<{ method: string; s: number }>(env,
      "SELECT p.method, COALESCE(SUM(p.amount),0) s FROM payment p JOIN sale_order o ON o.id=p.order_id WHERE o.status='paid' AND p.status='confirmed' AND o.business_day BETWEEN ? AND ? GROUP BY p.method", from, to),
    all<{ direction: string; category: string; s: number }>(env,
      'SELECT direction, category, COALESCE(SUM(amount),0) s FROM ledger_entry WHERE voided=0 AND business_day BETWEEN ? AND ? GROUP BY direction, category', from, to),
    all<{ direction: string; reason: string; s: number }>(env,
      'SELECT direction, reason, COALESCE(SUM(amount),0) s FROM cash_movement WHERE business_day BETWEEN ? AND ? GROUP BY direction, reason', from, to),
  ]);
  const byMethod = { cash: 0, vietqr: 0, card: 0 } as Record<string, number>;
  for (const p of pays) byMethod[p.method] = p.s;
  const salesIn = byMethod.cash + byMethod.vietqr + byMethod.card;
  const ledgerIn = ledger.filter((l) => l.direction === 'in').reduce((a, l) => a + l.s, 0);
  const ledgerOut = ledger.filter((l) => l.direction === 'out').reduce((a, l) => a + l.s, 0);
  const cashIn = cash.filter((l) => l.direction === 'in').reduce((a, l) => a + l.s, 0);
  const cashOut = cash.filter((l) => l.direction === 'out').reduce((a, l) => a + l.s, 0);
  // P&L expenses exclude stock purchases: purchased stock is an asset until it is sold (then it is COGS).
  const opex = ledger.filter((l) => l.direction === 'out' && l.category !== 'purchase').reduce((a, l) => a + l.s, 0)
    + cash.filter((l) => l.direction === 'out' && l.reason !== 'purchase').reduce((a, l) => a + l.s, 0);
  const expenseByCategory: Record<string, number> = {};
  for (const l of ledger.filter((x) => x.direction === 'out')) expenseByCategory[l.category] = (expenseByCategory[l.category] || 0) + l.s;
  for (const l of cash.filter((x) => x.direction === 'out')) {
    const k = l.reason === 'purchase' ? 'purchase' : 'drawer_' + l.reason;
    expenseByCategory[k] = (expenseByCategory[k] || 0) + l.s;
  }
  const net = s!.net;
  return {
    orders: s!.n, gross: s!.gross, promo: s!.promo, discount: s!.disc, revenue: net,
    aov: s!.n ? Math.round(net / s!.n) : 0,
    by_method: byMethod,
    cash_flow: { in: salesIn + ledgerIn + cashIn, out: ledgerOut + cashOut, net: salesIn + ledgerIn + cashIn - ledgerOut - cashOut, sales_in: salesIn, other_in: ledgerIn + cashIn },
    pnl: { revenue: net, cogs: s!.cogs, gross_profit: net - s!.cogs, opex, net_profit: net - s!.cogs - opex, cogs_pct: net ? (s!.cogs / net) * 100 : 0 },
    expense_by_category: expenseByCategory,
  };
}

export async function dashboard(c: Ctx) {
  requireRole(c, 'owner', 'manager');
  const o = await outlet(c.env);
  const today = businessDay(now(), o.tz_offset_min, o.business_day_cutoff);
  const { from, to } = range(c, today);
  const len = daysBetween(from, to);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(len - 1));
  const tz = o.tz_offset_min * 60;
  const [cur, prev, byHour, top, byDay] = await Promise.all([
    periodSummary(c.env, from, to),
    periodSummary(c.env, prevFrom, prevTo),
    all<{ h: number; s: number; n: number }>(c.env,
      "SELECT CAST(((paid_at/1000 + ?) % 86400) / 3600 AS INTEGER) h, COALESCE(SUM(total),0) s, COUNT(*) n FROM sale_order WHERE status='paid' AND business_day BETWEEN ? AND ? GROUP BY h ORDER BY h", tz, from, to),
    all<{ name: string; qty: number; revenue: number; cost: number }>(c.env,
      "SELECT l.item_name name, SUM(l.qty) qty, SUM(l.line_total) revenue, SUM(l.line_cost) cost FROM order_line l JOIN sale_order o ON o.id=l.order_id WHERE o.status='paid' AND l.status='active' AND o.business_day BETWEEN ? AND ? GROUP BY l.item_name ORDER BY qty DESC LIMIT 15", from, to),
    all<{ day: string; s: number; n: number }>(c.env,
      "SELECT business_day day, COALESCE(SUM(total),0) s, COUNT(*) n FROM sale_order WHERE status='paid' AND business_day BETWEEN ? AND ? GROUP BY business_day ORDER BY business_day", from, to),
  ]);
  return json({ from, to, prev_from: prevFrom, prev_to: prevTo, current: cur, previous: prev, by_hour: byHour, top_items: top, by_day: byDay });
}

// ----- cash book -----

const LEDGER_CATEGORIES = ['purchase', 'salary', 'rent', 'utilities', 'marketing', 'bank_fee', 'repair', 'supplies', 'other_out', 'other_in', 'owner_capital'];

export async function listLedger(c: Ctx) {
  requireRole(c, 'owner', 'manager');
  const o = await outlet(c.env);
  const today = businessDay(now(), o.tz_offset_min, o.business_day_cutoff);
  const { from, to } = range(c, today);
  const [ledger, cash] = await Promise.all([
    all(c.env, 'SELECT l.*, s.name staff_name FROM ledger_entry l LEFT JOIN staff s ON s.id=l.staff_id WHERE l.business_day BETWEEN ? AND ? ORDER BY l.created_at DESC', from, to),
    all(c.env, 'SELECT m.*, s.name staff_name FROM cash_movement m LEFT JOIN staff s ON s.id=m.staff_id WHERE m.business_day BETWEEN ? AND ? ORDER BY m.created_at DESC', from, to),
  ]);
  return json({ from, to, ledger, drawer: cash, categories: LEDGER_CATEGORIES });
}

export async function addLedger(c: Ctx) {
  requireRole(c, 'owner', 'manager');
  const b = await body<{ business_day?: string; direction: 'in' | 'out'; category: string; amount: number; source: string; note?: string; photo_key?: string }>(c);
  need(['in', 'out'].includes(b.direction), 400, 'Chiều tiền không hợp lệ');
  need(LEDGER_CATEGORIES.includes(b.category), 400, 'Danh mục không hợp lệ');
  need(['bank', 'owner', 'supplier_debt'].includes(b.source), 400, 'Nguồn tiền không hợp lệ (tiền trong két ghi ở màn Thu/chi của ca)');
  const amount = Math.round(Number(b.amount));
  need(amount > 0, 400, 'Số tiền phải lớn hơn 0');
  const o = await outlet(c.env);
  const day = b.business_day || businessDay(now(), o.tz_offset_min, o.business_day_cutoff);
  const id = ulid();
  const t = now();
  await batch(c.env, [
    stmt(c.env, 'INSERT INTO ledger_entry (id,business_day,direction,category,amount,source,note,photo_key,staff_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      id, day, b.direction, b.category, amount, b.source, b.note || null, b.photo_key || null, c.staff!.id, t, t),
    auditStmt(c.env, { action: 'ledger_add', entity: 'ledger_entry', entity_id: id, actor_id: c.staff!.id, device_id: c.device!.id, after: { ...b, amount } }, ulid()),
  ]);
  return json({ id }, 201);
}

export async function voidLedger(c: Ctx) {
  requireRole(c, 'owner');
  const b = await body<{ reason: string }>(c);
  need(b.reason?.trim(), 400, 'Cần lý do');
  const e = await first<{ ref_type: string | null }>(c.env, 'SELECT ref_type FROM ledger_entry WHERE id=?', c.params.id);
  need(e, 404, 'Không tìm thấy');
  need(!e.ref_type, 409, 'Khoản này sinh từ phiếu nhập, không huỷ riêng được');
  await batch(c.env, [
    stmt(c.env, 'UPDATE ledger_entry SET voided=1, updated_at=? WHERE id=?', now(), c.params.id),
    auditStmt(c.env, { action: 'ledger_void', entity: 'ledger_entry', entity_id: c.params.id, actor_id: c.staff!.id, device_id: c.device!.id, reason: b.reason }, ulid()),
  ]);
  return json({ ok: true });
}

// ----- revenue reports (month / quarter / year) -----

function csvCell(v: unknown) {
  const s = v == null ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function revenueReport(c: Ctx) {
  requireRole(c, 'owner', 'manager');
  const o = await outlet(c.env);
  const today = businessDay(now(), o.tz_offset_min, o.business_day_cutoff);
  const { from, to } = range(c, today);
  const [days, pays, voids, voidList] = await Promise.all([
    all<{ day: string; n: number; gross: number; promo: number; disc: number; net: number }>(c.env,
      "SELECT business_day day, COUNT(*) n, SUM(subtotal) gross, SUM(promo_total) promo, SUM(discount_total) disc, SUM(total) net FROM sale_order WHERE status='paid' AND business_day BETWEEN ? AND ? GROUP BY business_day ORDER BY business_day", from, to),
    all<{ day: string; method: string; s: number }>(c.env,
      "SELECT o.business_day day, p.method, SUM(p.amount) s FROM payment p JOIN sale_order o ON o.id=p.order_id WHERE o.status='paid' AND p.status='confirmed' AND o.business_day BETWEEN ? AND ? GROUP BY o.business_day, p.method", from, to),
    all<{ day: string; n: number; v: number }>(c.env,
      "SELECT business_day day, COUNT(*) n, SUM(total) v FROM sale_order WHERE status='void' AND business_day BETWEEN ? AND ? GROUP BY business_day", from, to),
    all(c.env, "SELECT o.business_day, o.short_code, o.total, o.void_reason, o.voided_at, s.name voided_by_name, a.name approved_by_name FROM sale_order o LEFT JOIN staff s ON s.id=o.voided_by LEFT JOIN staff a ON a.id=o.approved_by WHERE o.status='void' AND o.business_day BETWEEN ? AND ? ORDER BY o.voided_at", from, to),
  ]);
  const rows = days.map((d) => {
    const m = (k: string) => pays.find((p) => p.day === d.day && p.method === k)?.s || 0;
    const v = voids.find((x) => x.day === d.day);
    return { day: d.day, orders: d.n, gross: d.gross, promo: d.promo, discount: d.disc, net: d.net, cash: m('cash'), vietqr: m('vietqr'), card: m('card'), voids: v?.n || 0, void_value: v?.v || 0 };
  });
  for (const v of voids) if (!rows.find((r) => r.day === v.day)) rows.push({ day: v.day, orders: 0, gross: 0, promo: 0, discount: 0, net: 0, cash: 0, vietqr: 0, card: 0, voids: v.n, void_value: v.v });
  rows.sort((a, b) => a.day.localeCompare(b.day));
  const totals = rows.reduce((t, r) => {
    for (const k of ['orders', 'gross', 'promo', 'discount', 'net', 'cash', 'vietqr', 'card', 'voids', 'void_value'] as const) t[k] += r[k];
    return t;
  }, { orders: 0, gross: 0, promo: 0, discount: 0, net: 0, cash: 0, vietqr: 0, card: 0, voids: 0, void_value: 0 });

  if (c.url.searchParams.get('format') === 'csv') {
    const head = ['Ngày', 'Số đơn', 'Doanh thu gộp', 'Khuyến mãi', 'Giảm giá', 'Doanh thu thuần', 'Tiền mặt', 'Chuyển khoản', 'Thẻ', 'Số đơn huỷ', 'Giá trị huỷ'];
    const lines = [head, ...rows.map((r) => [r.day, r.orders, r.gross, r.promo, r.discount, r.net, r.cash, r.vietqr, r.card, r.voids, r.void_value]),
      ['TỔNG', totals.orders, totals.gross, totals.promo, totals.discount, totals.net, totals.cash, totals.vietqr, totals.card, totals.voids, totals.void_value],
      [], ['Đơn huỷ', 'Mã đơn', 'Giá trị', 'Lý do', 'Người huỷ', 'Người duyệt'],
      ...voidList.map((v: any) => [v.business_day, v.short_code, v.total, v.void_reason, v.voided_by_name, v.approved_by_name])];
    const csv = '﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n');
    return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="doanh-thu_${from}_${to}.csv"` } });
  }
  return json({ from, to, rows, totals, voids: voidList });
}

/** Year-to-date revenue against the configured threshold (verify the threshold with the accountant). */
export async function ytd(c: Ctx) {
  requireRole(c, 'owner', 'manager');
  const o = await outlet(c.env);
  const today = businessDay(now(), o.tz_offset_min, o.business_day_cutoff);
  const year = today.slice(0, 4);
  const r = await first<{ s: number }>(c.env, "SELECT COALESCE(SUM(total),0) s FROM sale_order WHERE status='paid' AND business_day BETWEEN ? AND ?", `${year}-01-01`, `${year}-12-31`);
  const threshold = parseSettings<{ tax_threshold_year?: number }>(o.settings_json).tax_threshold_year || 0;
  const dayOfYear = daysBetween(`${year}-01-01`, today);
  const projected = dayOfYear ? Math.round((r!.s / dayOfYear) * 365) : 0;
  return json({ year, revenue: r!.s, threshold, pct: threshold ? (r!.s / threshold) * 100 : null, projected_year: projected, warn: threshold ? projected >= threshold * 0.9 : false });
}

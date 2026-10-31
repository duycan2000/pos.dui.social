// Offline sync: devices push records from their outbox and pull config + recent activity.
import type { CashMovement, DrawerSession, Order, StaffShift, SyncRecord, ZReport } from '../shared/types';
import { addDays, businessDay, ulid } from '../shared/util';
import { configSnapshot } from './auth';
import { all, auditStmt, batch, body, type Ctx, type Env, first, json, need, now, requireRole, stmt, upsertStmt } from './http';

const ORDER_COLS = ['id', 'outlet_id', 'device_id', 'short_code', 'business_day', 'staff_id', 'staff_shift_id', 'drawer_session_id', 'order_type', 'customer_label', 'status', 'subtotal', 'promo_total', 'discount_total', 'total', 'cost_total', 'stock_applied', 'sent_at', 'paid_at', 'void_reason', 'voided_by', 'approved_by', 'voided_at', 'created_at', 'updated_at'];
const DRAWER_COLS = ['id', 'outlet_id', 'business_day', 'status', 'opened_by', 'opened_at', 'opening_float', 'opening_count_json', 'device_id', 'note', 'created_at', 'updated_at'];
const SHIFT_COLS = ['id', 'staff_id', 'outlet_id', 'device_id', 'drawer_session_id', 'business_day', 'started_at', 'ended_at', 'created_at', 'updated_at'];
const CASH_COLS = ['id', 'drawer_session_id', 'business_day', 'direction', 'amount', 'reason', 'note', 'photo_key', 'purchase_id', 'staff_id', 'approved_by', 'device_id', 'created_at', 'updated_at'];

async function outletInfo(env: Env) {
  return (await first<{ id: string; tz_offset_min: number; business_day_cutoff: string }>(env, 'SELECT id,tz_offset_min,business_day_cutoff FROM outlet LIMIT 1'))!;
}

// ---------- pull ----------

export async function pull(c: Ctx) {
  const since = parseInt(c.url.searchParams.get('since') || '0', 10) || 0;
  const serverTime = now();
  const o = await outletInfo(c.env);
  const today = businessDay(serverTime, o.tz_offset_min, o.business_day_cutoff);
  const fromDay = addDays(today, -1);
  const [config, drawers, shifts, orders, cash] = await Promise.all([
    configSnapshot(c.env, c.device),
    all<DrawerSession>(c.env, "SELECT * FROM drawer_session WHERE status='open' OR business_day >= ? ORDER BY opened_at", fromDay),
    all<StaffShift>(c.env, 'SELECT * FROM staff_shift WHERE ended_at IS NULL OR business_day >= ?', fromDay),
    loadOrders(c.env, 'WHERE o.updated_at > ? AND o.business_day >= ?', since, fromDay),
    all<CashMovement>(c.env, 'SELECT * FROM cash_movement WHERE updated_at > ? AND business_day >= ?', since, fromDay),
  ]);
  return json({ serverTime, config, drawers, shifts, orders, cashMovements: cash });
}

export async function loadOrders(env: Env, where: string, ...args: unknown[]): Promise<Order[]> {
  const orders = await all<any>(env, `SELECT o.* FROM sale_order o ${where} ORDER BY o.created_at LIMIT 2000`, ...args);
  if (!orders.length) return [];
  const ids = orders.map((o) => o.id);
  const ph = ids.map(() => '?').join(',');
  const [lines, adjs, pays] = await Promise.all([
    all<any>(env, `SELECT * FROM order_line WHERE order_id IN (${ph}) ORDER BY sort`, ...ids),
    all<any>(env, `SELECT * FROM order_adjustment WHERE order_id IN (${ph})`, ...ids),
    all<any>(env, `SELECT * FROM payment WHERE order_id IN (${ph}) ORDER BY created_at`, ...ids),
  ]);
  return orders.map((o) => ({
    ...o,
    lines: lines.filter((l) => l.order_id === o.id).map((l) => ({ ...l, modifiers: JSON.parse(l.modifiers_json || '[]') })),
    adjustments: adjs.filter((a) => a.order_id === o.id),
    payments: pays.filter((p) => p.order_id === o.id),
  }));
}

// ---------- push ----------

export async function push(c: Ctx) {
  const b = await body<{ records: SyncRecord[] }>(c);
  need(Array.isArray(b.records), 400, 'Thiếu records');
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const r of b.records) {
    const id = (r.data as { id: string })?.id;
    try {
      switch (r.type) {
        case 'order': await pushOrder(c, r.data); break;
        case 'drawer_session': await pushDrawer(c, r.data); break;
        case 'staff_shift': await batch(c.env, [upsertStmt(c.env, 'staff_shift', { ...r.data, device_id: c.device!.id }, SHIFT_COLS)]); break;
        case 'cash_movement': await batch(c.env, [upsertStmt(c.env, 'cash_movement', { ...r.data, device_id: c.device!.id }, CASH_COLS)]); break;
        case 'audit_log': await batch(c.env, [stmt(c.env,
          'INSERT OR IGNORE INTO audit_log (id,outlet_id,device_id,at,actor_id,approver_id,action,entity,entity_id,before_json,after_json,reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
          r.data.id, c.device!.outlet_id, c.device!.id, r.data.at, r.data.actor_id, r.data.approver_id, r.data.action, r.data.entity, r.data.entity_id, r.data.before_json, r.data.after_json, r.data.reason)]); break;
        default: throw new Error('Loại bản ghi không hỗ trợ');
      }
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, error: (e as Error).message });
    }
  }
  return json({ results, serverTime: now() });
}

async function pushDrawer(c: Ctx, d: DrawerSession) {
  const existing = await first<DrawerSession>(c.env, 'SELECT * FROM drawer_session WHERE id=?', d.id);
  if (existing && existing.status === 'closed') return; // closing happens only on the server
  await batch(c.env, [upsertStmt(c.env, 'drawer_session', { ...d, status: 'open' }, DRAWER_COLS)]);
}

async function pushOrder(c: Ctx, o: Order) {
  const env = c.env;
  const existing = await first<{ status: string; stock_applied: number; short_code: string }>(env, 'SELECT status,stock_applied,short_code FROM sale_order WHERE id=?', o.id);
  // Paid orders are immutable: the only allowed changes are awaiting→paid, awaiting→void and paid→void.
  if (existing) {
    if (existing.status === 'void') return;
    if (existing.status === 'paid' && o.status !== 'void') return;
  }
  let shortCode = existing?.short_code ?? o.short_code;
  if (!existing) {
    const clash = await first(env, 'SELECT id FROM sale_order WHERE outlet_id=? AND business_day=? AND short_code=? AND id<>?', c.device!.outlet_id, o.business_day, shortCode, o.id);
    if (clash) shortCode = `${shortCode}-${o.id.slice(-3)}`;
  }
  const row = { ...o, outlet_id: c.device!.outlet_id, device_id: o.device_id || c.device!.id, short_code: shortCode, stock_applied: existing?.stock_applied ?? 0, cost_total: 0, updated_at: now() };
  const stmts: D1PreparedStatement[] = [];
  if (existing) {
    stmts.push(stmt(env, `UPDATE sale_order SET status=?, paid_at=?, void_reason=?, voided_by=?, approved_by=?, voided_at=?, customer_label=?, subtotal=?, promo_total=?, discount_total=?, total=?, updated_at=? WHERE id=?`,
      o.status, o.paid_at, o.void_reason, o.voided_by, o.approved_by, o.voided_at, o.customer_label, o.subtotal, o.promo_total, o.discount_total, o.total, row.updated_at, o.id));
  } else {
    stmts.push(upsertStmt(env, 'sale_order', row, ORDER_COLS));
  }
  // Lines/adjustments are replaced while the order is not yet paid on the server (or on first arrival).
  if (!existing || existing.status === 'awaiting_payment' || existing.status === 'open') {
    stmts.push(stmt(env, 'DELETE FROM order_line WHERE order_id=?', o.id));
    stmts.push(stmt(env, 'DELETE FROM order_adjustment WHERE order_id=?', o.id));
    o.lines.forEach((l, i) => stmts.push(stmt(env,
      'INSERT INTO order_line (id,order_id,item_id,item_name,unit_price,qty,modifiers_json,line_total,line_cost,note,status,removed_by,removed_reason,sort) VALUES (?,?,?,?,?,?,?,?,0,?,?,?,?,?)',
      l.id, o.id, l.item_id, l.item_name, l.unit_price, l.qty, JSON.stringify(l.modifiers || []), l.line_total, l.note, l.status, l.removed_by ?? null, l.removed_reason ?? null, l.sort ?? i)));
    for (const a of o.adjustments) stmts.push(stmt(env,
      'INSERT INTO order_adjustment (id,order_id,order_line_id,kind,promotion_id,amount,reason,staff_id,approved_by) VALUES (?,?,?,?,?,?,?,?,?)',
      a.id, o.id, a.order_line_id, a.kind, a.promotion_id, a.amount, a.reason, a.staff_id, a.approved_by));
  }
  for (const p of o.payments) stmts.push(stmt(env,
    'INSERT OR REPLACE INTO payment (id,order_id,drawer_session_id,method,amount,tendered,change_given,reference,status,confirmed_by,confirmed_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    p.id, o.id, p.drawer_session_id ?? o.drawer_session_id, p.method, p.amount, p.tendered, p.change_given ?? 0, p.reference, p.status, p.confirmed_by, p.confirmed_at, p.created_at));
  await batch(env, stmts);

  if (o.status === 'paid' && !row.stock_applied) await applyStock(env, o.id, -1, 'sale');
  if (o.status === 'void' && row.stock_applied) await applyStock(env, o.id, +1, 'void');
}

/**
 * Deduct (sign −1) or return (sign +1) ingredients for an order, following the item recipe plus
 * each chosen option's recipe lines. Option lines may be negative (Mocktail version removes the spirit).
 * Prepared ingredients (syrups, house spirits) are deducted as finished stock.
 */
export async function applyStock(env: Env, orderId: string, sign: 1 | -1, reason: 'sale' | 'void') {
  const order = await first<{ business_day: string }>(env, 'SELECT business_day FROM sale_order WHERE id=?', orderId);
  if (!order) return;
  const lines = await all<{ id: string; item_id: string; qty: number; modifiers_json: string; status: string }>(env,
    "SELECT id,item_id,qty,modifiers_json,status FROM order_line WHERE order_id=? AND status='active'", orderId);
  const usage = new Map<string, number>();
  const lineUse = new Map<string, Map<string, number>>();
  if (lines.length) {
    const optionIds = new Set<string>();
    for (const l of lines) for (const m of JSON.parse(l.modifiers_json || '[]')) optionIds.add(m.id);
    const ownerIds = [...new Set(lines.map((l) => l.item_id)), ...optionIds];
    const recipe = await all<{ owner_type: string; owner_id: string; ingredient_id: string; qty_base: number }>(env,
      `SELECT owner_type,owner_id,ingredient_id,qty_base FROM recipe_line WHERE owner_id IN (${ownerIds.map(() => '?').join(',')}) AND owner_type IN ('item','modifier_option')`, ...ownerIds);
    for (const l of lines) {
      const per = new Map<string, number>();
      const add = (ownerType: string, ownerId: string) => {
        for (const r of recipe) if (r.owner_type === ownerType && r.owner_id === ownerId) per.set(r.ingredient_id, (per.get(r.ingredient_id) || 0) + r.qty_base * l.qty);
      };
      add('item', l.item_id);
      for (const m of JSON.parse(l.modifiers_json || '[]')) add('modifier_option', m.id);
      lineUse.set(l.id, per);
      for (const [ing, q] of per) usage.set(ing, (usage.get(ing) || 0) + q);
    }
  }
  const ingIds = [...usage.keys()];
  const costs = ingIds.length
    ? await all<{ id: string; avg_cost_per_base: number }>(env, `SELECT id,avg_cost_per_base FROM ingredient WHERE id IN (${ingIds.map(() => '?').join(',')})`, ...ingIds)
    : [];
  const costOf = new Map(costs.map((x) => [x.id, x.avg_cost_per_base]));
  const t = now();
  const stmts: D1PreparedStatement[] = [];
  if (reason === 'void') {
    // Reverse exactly what was deducted at sale time.
    const prev = await all<{ ingredient_id: string; qty_delta: number; unit_cost: number }>(env,
      "SELECT ingredient_id,qty_delta,unit_cost FROM stock_movement WHERE ref_type='order' AND ref_id=? AND reason='sale'", orderId);
    for (const p of prev) {
      stmts.push(stmt(env, 'INSERT INTO stock_movement (id,ingredient_id,qty_delta,reason,ref_type,ref_id,unit_cost,business_day,at) VALUES (?,?,?,?,?,?,?,?,?)',
        ulid(), p.ingredient_id, -p.qty_delta, 'void', 'order', orderId, p.unit_cost, order.business_day, t));
      stmts.push(stmt(env, 'UPDATE ingredient SET stock_base = stock_base + ?, updated_at=? WHERE id=?', -p.qty_delta, t, p.ingredient_id));
    }
    stmts.push(stmt(env, 'UPDATE sale_order SET stock_applied=0 WHERE id=?', orderId));
  } else {
    let costTotal = 0;
    for (const [ing, q] of usage) {
      if (!q) continue;
      const uc = costOf.get(ing) || 0;
      costTotal += q * uc;
      stmts.push(stmt(env, 'INSERT INTO stock_movement (id,ingredient_id,qty_delta,reason,ref_type,ref_id,unit_cost,business_day,at) VALUES (?,?,?,?,?,?,?,?,?)',
        ulid(), ing, sign * q, 'sale', 'order', orderId, uc, order.business_day, t));
      stmts.push(stmt(env, 'UPDATE ingredient SET stock_base = stock_base + ?, updated_at=? WHERE id=?', sign * q, t, ing));
    }
    for (const [lineId, per] of lineUse) {
      let lc = 0;
      for (const [ing, q] of per) lc += q * (costOf.get(ing) || 0);
      stmts.push(stmt(env, 'UPDATE order_line SET line_cost=? WHERE id=?', Math.round(lc), lineId));
    }
    stmts.push(stmt(env, 'UPDATE sale_order SET stock_applied=1, cost_total=? WHERE id=?', Math.round(costTotal), orderId));
  }
  await batch(env, stmts);
}

// ---------- drawer close + Z-report ----------

export async function zReport(env: Env, drawerId: string): Promise<ZReport> {
  const d = await first<DrawerSession>(env, 'SELECT * FROM drawer_session WHERE id=?', drawerId);
  need(d, 404, 'Không tìm thấy phiên két');
  const [paid, voids, pays, pending, cash] = await Promise.all([
    first<{ n: number; gross: number; promo: number; disc: number; net: number }>(env,
      "SELECT COUNT(*) n, COALESCE(SUM(subtotal),0) gross, COALESCE(SUM(promo_total),0) promo, COALESCE(SUM(discount_total),0) disc, COALESCE(SUM(total),0) net FROM sale_order WHERE drawer_session_id=? AND status='paid'", drawerId),
    first<{ n: number; v: number }>(env, "SELECT COUNT(*) n, COALESCE(SUM(total),0) v FROM sale_order WHERE drawer_session_id=? AND status='void'", drawerId),
    all<{ method: string; amount: number; change: number }>(env,
      "SELECT p.method, COALESCE(SUM(p.amount),0) amount, COALESCE(SUM(p.change_given),0) change FROM payment p JOIN sale_order o ON o.id=p.order_id WHERE o.drawer_session_id=? AND o.status='paid' AND p.status='confirmed' GROUP BY p.method", drawerId),
    first<{ n: number }>(env, "SELECT COUNT(*) n FROM sale_order WHERE drawer_session_id=? AND status='awaiting_payment'", drawerId),
    all<{ direction: string; s: number }>(env, 'SELECT direction, COALESCE(SUM(amount),0) s FROM cash_movement WHERE drawer_session_id=? GROUP BY direction', drawerId),
  ]);
  const by = { cash: 0, vietqr: 0, card: 0 } as ZReport['by_method'];
  let changeGiven = 0;
  for (const p of pays) { by[p.method as keyof typeof by] = p.amount; if (p.method === 'cash') changeGiven = p.change; }
  const cashIn = cash.find((x) => x.direction === 'in')?.s || 0;
  const cashOut = cash.find((x) => x.direction === 'out')?.s || 0;
  const expected = d.opening_float + by.cash + cashIn - cashOut;
  return {
    drawer_session_id: d.id, business_day: d.business_day, opened_at: d.opened_at, closed_at: d.closed_at,
    gross_sales: paid!.gross, promo_total: paid!.promo, discount_total: paid!.disc, net_sales: paid!.net, orders: paid!.n,
    by_method: by, voids: voids!.n, void_value: voids!.v, cash_in: cashIn, cash_out: cashOut,
    opening_float: d.opening_float, cash_sales: by.cash, change_given: changeGiven,
    expected_cash: d.status === 'closed' && d.expected_total != null ? d.expected_total : expected,
    counted_cash: d.counted_total, difference: d.difference, pending_vietqr: pending!.n,
  };
}

export async function getZReport(c: Ctx) {
  return json(await zReport(c.env, c.params.id));
}

/** Close the shared drawer. Online only, so every device's cash sales are counted. */
export async function closeDrawer(c: Ctx) {
  requireRole(c, 'owner', 'manager');
  const b = await body<{ counted: Record<string, number>; note?: string }>(c);
  const d = await first<DrawerSession>(c.env, 'SELECT * FROM drawer_session WHERE id=?', c.params.id);
  need(d, 404, 'Không tìm thấy phiên két');
  need(d.status === 'open', 409, 'Két đã đóng');
  const counted = Object.entries(b.counted || {}).reduce((s, [denom, n]) => s + parseInt(denom, 10) * (n || 0), 0);
  const z = await zReport(c.env, d.id);
  const diff = counted - z.expected_cash;
  need(diff === 0 || (b.note && b.note.trim()), 400, 'Cần ghi chú khi có chênh lệch');
  const t = now();
  await batch(c.env, [
    stmt(c.env, "UPDATE drawer_session SET status='closed', closed_by=?, closed_at=?, counted_json=?, counted_total=?, expected_total=?, difference=?, note=?, updated_at=? WHERE id=?",
      c.staff!.id, t, JSON.stringify(b.counted || {}), counted, z.expected_cash, diff, b.note ?? null, t, d.id),
    stmt(c.env, 'UPDATE staff_shift SET ended_at=?, updated_at=? WHERE drawer_session_id=? AND ended_at IS NULL', t, t, d.id),
    auditStmt(c.env, { action: 'drawer_close', entity: 'drawer_session', entity_id: d.id, actor_id: c.staff!.id, device_id: c.device!.id, outlet_id: d.outlet_id, after: { counted, expected: z.expected_cash, diff }, reason: b.note ?? null }, ulid()),
  ]);
  return json(await zReport(c.env, d.id));
}

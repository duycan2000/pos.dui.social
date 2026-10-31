// End-to-end checks of the shared rules and the Worker API, run in Node: `npm test`.
import assert from 'node:assert/strict';
import { computeTotals, cashSuggestions } from '../shared/pricing';
import type { Order, OrderLine } from '../shared/types';
import { businessDay, ulid } from '../shared/util';
import { crc16, vietQrPayload } from '../shared/vietqr';
import worker from '../worker/index';
import { makeD1, makeR2 } from './fakes';

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log('  ✓', name);
}

// ---------- shared rules ----------
const promo = { id: 'P', name: 'BOGO', type: 'bogo', active: 1, start_date: null, end_date: null, days_of_week: null, time_from: null, time_to: null, rule_json: '{}' };
const line = (id: string, item: string, price: number, qty: number, mocktail = false): OrderLine => ({
  id, item_id: item, item_name: item, unit_price: price, qty, line_total: 0, note: null, status: 'active', sort: 0,
  modifiers: mocktail ? [{ id: 'm', group_id: 'g', name: 'Mocktail', price_delta: -20000, excludes_promo: 1 }] : [],
});
const pi = (ids: string[]) => ids.map((item_id) => ({ promotion_id: 'P', item_id }));

console.log('Shared rules');
await test('BOGO: 2 drinks → 1 free', () => {
  const t = computeTotals([line('a', 'S1', 120000, 2)], [promo], pi(['S1']), Date.now(), 420);
  assert.equal(t.promo_total, 120000); assert.equal(t.total, 120000);
});
await test('BOGO: 3 drinks → 1 free, 4 → 2 free', () => {
  assert.equal(computeTotals([line('a', 'S1', 120000, 3)], [promo], pi(['S1']), Date.now(), 420).promo_total, 120000);
  assert.equal(computeTotals([line('a', 'S1', 120000, 4)], [promo], pi(['S1']), Date.now(), 420).promo_total, 240000);
});
await test('BOGO: cross-pairing, cheaper one free', () => {
  const t = computeTotals([line('a', 'S1', 150000, 1), line('b', 'S2', 120000, 1)], [promo], pi(['S1', 'S2']), Date.now(), 420);
  assert.equal(t.promo_total, 120000);
  assert.equal(t.adjustments[0].order_line_id, 'b');
});
await test('BOGO: mocktail version excluded', () => {
  const t = computeTotals([line('a', 'S1', 120000, 1), line('b', 'S1', 100000, 1, true)], [promo], pi(['S1']), Date.now(), 420);
  assert.equal(t.promo_total, 0);
});
await test('BOGO: time window respected', () => {
  const hh = { ...promo, time_from: '19:00', time_to: '20:00' };
  const at = Date.parse('2026-10-31T12:30:00Z'); // 19:30 in Vietnam
  assert.equal(computeTotals([line('a', 'S1', 120000, 2)], [hh], pi(['S1']), at, 420).promo_total, 120000);
  assert.equal(computeTotals([line('a', 'S1', 120000, 2)], [hh], pi(['S1']), at + 3600000, 420).promo_total, 0);
});
await test('Business day cut-off 05:00', () => {
  assert.equal(businessDay(Date.parse('2026-10-31T21:30:00Z'), 420, '05:00'), '2026-10-31'); // 04:30 next morning
  assert.equal(businessDay(Date.parse('2026-10-31T23:00:00Z'), 420, '05:00'), '2026-11-01'); // 06:00
});
await test('VietQR CRC and payload', () => {
  assert.equal(crc16('123456789'), '29B1');
  const p = vietQrPayload({ bankBin: '970436', account: '0123456789', amount: 210000, purpose: 'DUI A-012' });
  assert.ok(p.includes('5406210000') && p.includes('QRIBFTTA'));
  assert.equal(p.slice(-4), crc16(p.slice(0, -4)));
});
await test('Cash suggestions', () => assert.deepEqual(cashSuggestions(210000).slice(0, 3), [210000, 220000, 250000]));

// ---------- API ----------
console.log('Worker API');
const env = { DB: makeD1(new URL('../migrations', import.meta.url).pathname), MEDIA: makeR2(), ASSETS: { fetch: async () => new Response('app') } } as any;
let deviceToken = '';
let staffSession = '';
async function call(method: string, path: string, data?: unknown, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...extra };
  if (deviceToken) headers.authorization = 'Bearer ' + deviceToken;
  if (staffSession) headers['x-staff-session'] = staffSession;
  const res = await worker.fetch(new Request('https://pos.test' + path, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) }), env);
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* csv */ }
  return { status: res.status, body };
}

let cfg: any;
let ownerId = '';
await test('Setup creates outlet, owner, starter menu and device A', async () => {
  assert.equal((await call('GET', '/api/setup/status')).body.needsSetup, true);
  const r = await call('POST', '/api/setup', { outletName: 'Dui Social', ownerName: 'Duy', ownerPin: '123456', deviceName: 'Máy A' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  deviceToken = r.body.deviceToken;
  assert.equal(r.body.device.order_prefix, 'A');
  assert.equal((await call('POST', '/api/setup', { outletName: 'x', ownerName: 'y', ownerPin: '123456' })).status, 409);
});
await test('Pull returns config with categories, modifier groups, BOGO promo', async () => {
  const r = await call('GET', '/api/sync/pull?since=0');
  cfg = r.body.config;
  assert.equal(cfg.categories.length, 4);
  assert.equal(cfg.modifierGroups.length, 4);
  assert.equal(cfg.promotions[0].type, 'bogo');
  ownerId = cfg.staff[0].id;
});
await test('Register second device needs a manager PIN', async () => {
  const save = deviceToken; deviceToken = '';
  assert.equal((await call('POST', '/api/devices/register', { pin: '999999', deviceName: 'Máy B' })).status, 403);
  const r = await call('POST', '/api/devices/register', { pin: '123456', deviceName: 'Máy B' });
  assert.equal(r.body.device.order_prefix, 'B');
  deviceToken = save;
});
await test('Admin routes reject without staff session; login works', async () => {
  assert.equal((await call('GET', '/api/admin/staff')).status, 401);
  assert.equal((await call('POST', '/api/auth/staff', { staffId: ownerId, pin: '000000' })).status, 403);
  const r = await call('POST', '/api/auth/staff', { staffId: ownerId, pin: '123456' });
  staffSession = r.body.session;
  assert.ok(staffSession);
});

let itemId = '';
let vodkaId = '';
let syrupId = '';
let gingerId = '';
let mocktailOptionId = '';
await test('Menu, ingredients, recipes and BOGO items', async () => {
  const sig = cfg.categories.find((x: any) => x.name_en === 'Signature');
  const it = await call('POST', '/api/admin/t/item', { category_id: sig.id, name_en: 'Ginger Mule', name_vi: 'Ginger Mule', price: 120000, show_on_web: 1 });
  assert.equal(it.status, 201, JSON.stringify(it.body));
  itemId = it.body.id;
  const groups = cfg.modifierGroups.map((g: any) => g.id);
  await call('PUT', `/api/admin/item/${itemId}/groups`, { groupIds: groups });
  vodkaId = (await call('POST', '/api/admin/t/ingredient', { name: 'Vodka', base_unit: 'ml', purchase_unit: 'chai', base_per_purchase: 700, min_stock_base: 1400 })).body.id;
  gingerId = (await call('POST', '/api/admin/t/ingredient', { name: 'Gừng', base_unit: 'g', purchase_unit: 'kg', base_per_purchase: 1000 })).body.id;
  syrupId = (await call('POST', '/api/admin/t/ingredient', { name: 'Syrup gừng', kind: 'prepared', base_unit: 'ml', purchase_unit: 'lít', base_per_purchase: 1000, recipe_yield_base: 1000 })).body.id;
  await call('PUT', `/api/inv/recipe/ingredient/${syrupId}`, { lines: [{ ingredient_id: gingerId, qty_base: 200 }] });
  await call('PUT', `/api/inv/recipe/item/${itemId}`, { lines: [{ ingredient_id: vodkaId, qty_base: 30 }, { ingredient_id: syrupId, qty_base: 20 }] });
  mocktailOptionId = cfg.modifierOptions.find((o: any) => o.name_en === 'Mocktail').id;
  await call('PUT', `/api/inv/recipe/modifier_option/${mocktailOptionId}`, { lines: [{ ingredient_id: vodkaId, qty_base: -30 }] });
  await call('PUT', `/api/admin/promotion/${cfg.promotions[0].id}/items`, { itemIds: [itemId] });
  const menu = await call('GET', '/api/public/menu');
  assert.equal(menu.body.items.length, 1);
});
await test('Only the owner can change prices (with history)', async () => {
  const r = await call('PUT', `/api/admin/t/item/${itemId}`, { price: 125000 });
  assert.equal(r.body.price, 125000);
  await call('PUT', `/api/admin/t/item/${itemId}`, { price: 120000 });
  const audit = await call('GET', '/api/admin/audit?action=price_change');
  assert.equal(audit.body.length, 2);
});
await test('Purchase: stock in base units + weighted-average cost', async () => {
  let r = await call('POST', '/api/inv/purchases', { supplier_name: 'NCC Rượu', payment_source: 'bank', lines: [{ ingredient_id: vodkaId, qty_purchase_units: 2, unit_price: 280000 }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  r = await call('POST', '/api/inv/purchases', { payment_source: 'owner', lines: [{ ingredient_id: vodkaId, qty_purchase_units: 1, unit_price: 350000 }, { ingredient_id: gingerId, qty_purchase_units: 1, unit_price: 40000 }] });
  const ings = (await call('GET', '/api/inv/ingredients')).body;
  const vodka = ings.find((i: any) => i.id === vodkaId);
  assert.equal(vodka.stock_base, 2100);
  assert.equal(Math.round(vodka.avg_cost_per_base * 1000) / 1000, Math.round(((560000 + 350000) / 2100) * 1000) / 1000);
});
await test('Batch production of a prepared syrup', async () => {
  const r = await call('POST', '/api/inv/batch', { ingredient_id: syrupId, qty_base: 1000 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const ings = (await call('GET', '/api/inv/ingredients')).body;
  assert.equal(ings.find((i: any) => i.id === gingerId).stock_base, 800);
  assert.equal(ings.find((i: any) => i.id === syrupId).stock_base, 1000);
});

const t0 = Date.now();
const day = businessDay(t0, 420, '05:00');
const drawerId = ulid();
await test('Push drawer session, shift and a paid BOGO order; stock is deducted', async () => {
  const drawer = { id: drawerId, outlet_id: 'x', business_day: day, status: 'open', opened_by: ownerId, opened_at: t0, opening_float: 500000, opening_count_json: null, closed_by: null, closed_at: null, counted_json: null, counted_total: null, expected_total: null, difference: null, note: null, device_id: null, created_at: t0, updated_at: t0 };
  const shift = { id: ulid(), staff_id: ownerId, outlet_id: 'x', device_id: 'x', drawer_session_id: drawerId, business_day: day, started_at: t0, ended_at: null, created_at: t0, updated_at: t0 };
  const lines = [line(ulid(), itemId, 120000, 2)];
  const totals = computeTotals(lines, cfg.promotions.map((p: any) => ({ ...p, active: 1 })), [{ promotion_id: cfg.promotions[0].id, item_id: itemId }], t0, 420);
  const order: Order = {
    id: ulid(), outlet_id: 'x', device_id: 'x', short_code: 'A-001', business_day: day, staff_id: ownerId, staff_shift_id: shift.id, drawer_session_id: drawerId,
    order_type: 'takeaway', customer_label: 'John', status: 'paid', subtotal: totals.subtotal, promo_total: totals.promo_total, discount_total: 0, total: totals.total,
    sent_at: t0, paid_at: t0, void_reason: null, voided_by: null, approved_by: null, voided_at: null, created_at: t0, updated_at: t0,
    lines, adjustments: totals.adjustments,
    payments: [{ id: ulid(), method: 'cash', amount: 120000, tendered: 200000, change_given: 80000, reference: null, status: 'confirmed', confirmed_by: ownerId, confirmed_at: t0, drawer_session_id: drawerId, created_at: t0 }],
  };
  const r = await call('POST', '/api/sync/push', { records: [{ type: 'drawer_session', data: drawer }, { type: 'staff_shift', data: shift }, { type: 'order', data: order }] });
  assert.ok(r.body.results.every((x: any) => x.ok), JSON.stringify(r.body));
  const ings = (await call('GET', '/api/inv/ingredients')).body;
  assert.equal(ings.find((i: any) => i.id === vodkaId).stock_base, 2100 - 60);
  assert.equal(ings.find((i: any) => i.id === syrupId).stock_base, 1000 - 40);
  // re-push is idempotent
  await call('POST', '/api/sync/push', { records: [{ type: 'order', data: order }] });
  assert.equal((await call('GET', '/api/inv/ingredients')).body.find((i: any) => i.id === vodkaId).stock_base, 2040);
  (globalThis as any).paidOrder = order;
});
await test('Mocktail version deducts no vodka; VietQR awaiting → paid', async () => {
  const lines = [{ ...line(ulid(), itemId, 100000, 1, true), modifiers: [{ id: mocktailOptionId, group_id: 'g', name: 'Mocktail', price_delta: -20000, excludes_promo: 1 }] }];
  lines[0].line_total = 100000;
  const base: Order = {
    id: ulid(), outlet_id: 'x', device_id: 'x', short_code: 'B-001', business_day: day, staff_id: ownerId, staff_shift_id: null, drawer_session_id: drawerId,
    order_type: 'takeaway', customer_label: null, status: 'awaiting_payment', subtotal: 100000, promo_total: 0, discount_total: 0, total: 100000,
    sent_at: t0, paid_at: null, void_reason: null, voided_by: null, approved_by: null, voided_at: null, created_at: t0, updated_at: t0, lines, adjustments: [],
    payments: [{ id: ulid(), method: 'vietqr', amount: 100000, tendered: null, change_given: 0, reference: 'DUI B001', status: 'pending', confirmed_by: null, confirmed_at: null, drawer_session_id: drawerId, created_at: t0 }],
  };
  await call('POST', '/api/sync/push', { records: [{ type: 'order', data: base }] });
  let z = (await call('GET', `/api/drawer/${drawerId}/zreport`)).body;
  assert.equal(z.pending_vietqr, 1);
  const paid = { ...base, status: 'paid' as const, paid_at: t0 + 1000, payments: [{ ...base.payments[0], status: 'confirmed' as const, confirmed_by: ownerId, confirmed_at: t0 + 1000 }] };
  await call('POST', '/api/sync/push', { records: [{ type: 'order', data: paid }] });
  const ings = (await call('GET', '/api/inv/ingredients')).body;
  assert.equal(ings.find((i: any) => i.id === vodkaId).stock_base, 2040);
  assert.equal(ings.find((i: any) => i.id === syrupId).stock_base, 940);
  z = (await call('GET', `/api/drawer/${drawerId}/zreport`)).body;
  assert.equal(z.by_method.vietqr, 100000);
});
await test('Void returns stock and is logged', async () => {
  const o = (globalThis as any).paidOrder as Order;
  const voided = { ...o, status: 'void' as const, void_reason: 'Sai món', voided_by: ownerId, approved_by: ownerId, voided_at: Date.now() };
  await call('POST', '/api/sync/push', { records: [{ type: 'order', data: voided }, { type: 'audit_log', data: { id: ulid(), at: Date.now(), actor_id: ownerId, approver_id: ownerId, action: 'void', entity: 'order', entity_id: o.id, before_json: null, after_json: null, reason: 'Sai món', outlet_id: null, device_id: null } }] });
  const ings = (await call('GET', '/api/inv/ingredients')).body;
  assert.equal(ings.find((i: any) => i.id === vodkaId).stock_base, 2100);
  // a paid→paid edit after void is ignored (immutability)
  await call('POST', '/api/sync/push', { records: [{ type: 'order', data: { ...o, total: 1 } }] });
  const r = await call('GET', '/api/sync/pull?since=0');
  assert.equal(r.body.orders.find((x: any) => x.id === o.id).status, 'void');
});
await test('Cash out from drawer and drawer close with Z-report', async () => {
  const cm = { id: ulid(), drawer_session_id: drawerId, business_day: day, direction: 'out', amount: 50000, reason: 'ice', note: null, photo_key: null, purchase_id: null, staff_id: ownerId, approved_by: null, device_id: null, created_at: t0, updated_at: t0 };
  await call('POST', '/api/sync/push', { records: [{ type: 'cash_movement', data: cm }] });
  const z = (await call('GET', `/api/drawer/${drawerId}/zreport`)).body;
  assert.equal(z.expected_cash, 500000 - 50000); // the only cash sale was voided
  assert.equal((await call('POST', `/api/drawer/${drawerId}/close`, { counted: { '200000': 2 } })).status, 400); // diff without note
  const closed = await call('POST', `/api/drawer/${drawerId}/close`, { counted: { '200000': 2 }, note: 'Thiếu 50K' });
  assert.equal(closed.body.difference, -50000);
  assert.equal(closed.body.counted_cash, 400000);
});
await test('Stocktake records variance in ml and money', async () => {
  const r = await call('POST', '/api/inv/stocktakes', { lines: [{ ingredient_id: vodkaId, counted_base: 2000 }] });
  assert.equal(r.body.lines[0].variance_base, -100);
  assert.ok(r.body.variance_value < 0);
});
await test('Costing, simulation, dashboard, ledger and reports', async () => {
  const cost = (await call('GET', '/api/inv/costing')).body;
  const row = cost.items.find((i: any) => i.id === itemId);
  assert.ok(row.cost > 0 && row.bogo && row.bogo_cost_pct > row.cost_pct);
  const sim = (await call('POST', '/api/inv/simulate', { ingredient_id: gingerId, pct: 10 })).body;
  assert.equal(sim.affected_count, 1); // through the syrup sub-recipe
  assert.equal((await call('POST', '/api/fin/ledger', { direction: 'out', category: 'rent', amount: 15000000, source: 'bank' })).status, 201);
  const dash = (await call('GET', `/api/fin/dashboard?from=${day}&to=${day}`)).body;
  assert.equal(dash.current.revenue, 100000);
  assert.ok(dash.current.pnl.opex >= 15000000);
  const rep = (await call('GET', `/api/reports/revenue?from=${day}&to=${day}`)).body;
  assert.equal(rep.totals.voids, 1);
  const csv = await call('GET', `/api/reports/revenue?from=${day}&to=${day}&format=csv`);
  assert.ok(String(csv.body).includes('Doanh thu thuần'));
  const y = (await call('GET', '/api/reports/ytd')).body;
  assert.equal(y.revenue, 100000);
});
await test('Staff role is kept out of the back office', async () => {
  const r = await call('POST', '/api/admin/staff', { name: 'Nam', role: 'staff', pin: '5555' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const save = staffSession;
  staffSession = (await call('POST', '/api/auth/staff', { staffId: r.body.id, pin: '5555' })).body.session;
  assert.equal((await call('GET', '/api/inv/costing')).status, 403);
  assert.equal((await call('PUT', `/api/admin/t/item/${itemId}`, { price: 1 })).status, 403);
  staffSession = save;
});
await test('Media upload to R2 and serve', async () => {
  const res = await worker.fetch(new Request('https://pos.test/api/media', { method: 'POST', headers: { authorization: 'Bearer ' + deviceToken, 'content-type': 'image/png' }, body: new Uint8Array([137, 80, 78, 71]) }), env);
  const { key } = await res.json() as any;
  const got = await worker.fetch(new Request('https://pos.test/media/' + key), env);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'image/png');
});

await test('PIN rules, light hash format and lockout after 5 wrong tries', async () => {
  assert.equal((await call('POST', '/api/admin/staff', { name: 'Linh', role: 'manager', pin: '1234' })).status, 400); // managers need 6 digits
  const nam = (await call('GET', '/api/admin/staff')).body.find((x: any) => x.name === 'Nam');
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/api/auth/staff', { staffId: nam.id, pin: '0000' })).status, 403);
  assert.equal((await call('POST', '/api/auth/staff', { staffId: nam.id, pin: '5555' })).status, 429); // locked even with the right PIN
  const { hashPin, verifyPin } = await import('../shared/crypto');
  const h = await hashPin('123456', 'salt');
  assert.ok(h.startsWith('2000$'));
  assert.ok(await verifyPin('123456', 'salt', h));
  assert.ok(!(await verifyPin('123457', 'salt', h)));
});

console.log(`\n${passed} checks passed`);

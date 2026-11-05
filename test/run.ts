// End-to-end checks of the shared rules and the Worker API, run in Node: `npm test`.
import assert from 'node:assert/strict';
import { computeTotals, cashSuggestions } from '../shared/pricing';
import type { Order, OrderLine } from '../shared/types';
import { businessDay, ulid } from '../shared/util';
import { lateMinutes, nightMinutes, payFor, summarize, weekStart, workedMinutes } from '../shared/timesheet';
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
  if (deviceToken && !extra.authorization) headers.authorization = 'Bearer ' + deviceToken;
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
  assert.equal((await call('POST', '/api/setup', { outletName: 'Dui Social', ownerName: 'Duy', ownerPin: '123456', deviceName: 'Máy A' })).status, 400); // login + password required
  assert.equal((await call('POST', '/api/setup', { outletName: 'Dui Social', ownerName: 'Duy', ownerPin: '123456', ownerLogin: 'duy@dui.social', ownerPassword: '12345678' })).status, 400); // digits only
  const r = await call('POST', '/api/setup', { outletName: 'Dui Social', ownerName: 'Duy', ownerPin: '123456', ownerLogin: 'Duy@Dui.Social', ownerPassword: 'quay-bar-2026', deviceName: 'Máy A' });
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
await test('New device: login + password (a PIN alone no longer works); legacy installs still use the manager PIN', async () => {
  const save = deviceToken; deviceToken = '';
  assert.equal((await call('GET', '/api/setup/status')).body.passwordLogin, true);
  assert.equal((await call('POST', '/api/devices/register', { pin: '123456', deviceName: 'Máy B' })).status, 400);
  assert.equal((await call('POST', '/api/devices/register', { login: 'duy@dui.social', password: 'wrong-pass', deviceName: 'Máy B' })).status, 403);
  const r = await call('POST', '/api/devices/register', { login: ' DUY@dui.social ', password: 'quay-bar-2026', deviceName: 'Máy B' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.device.order_prefix, 'B');
  // Passwords never reach the till.
  deviceToken = save;
  const cfgStaff = (await call('GET', '/api/sync/pull?since=0')).body.config.staff;
  assert.ok(cfgStaff.every((x: any) => !('pw_hash' in x) && !('login' in x)));
  // An install from before passwords: the manager PIN still registers devices until someone sets a password.
  env.DB.raw.prepare('UPDATE staff SET pw_hash=NULL, pw_salt=NULL').run();
  deviceToken = '';
  assert.equal((await call('GET', '/api/setup/status')).body.passwordLogin, false);
  assert.equal((await call('POST', '/api/devices/register', { pin: '123456', deviceName: 'Máy C' })).status, 200);
  deviceToken = save;
});
await test('Admin routes reject without staff session; login works', async () => {
  assert.equal((await call('GET', '/api/admin/staff')).status, 401);
  assert.equal((await call('POST', '/api/auth/staff', { staffId: ownerId, pin: '000000' })).status, 403);
  const r = await call('POST', '/api/auth/staff', { staffId: ownerId, pin: '123456' });
  staffSession = r.body.session;
  assert.ok(staffSession);
});
await test('Owner sets logins and passwords (staff too); revoke other devices', async () => {
  assert.equal((await call('PUT', `/api/admin/staff/${ownerId}`, { password: 'short' })).status, 400);
  assert.equal((await call('PUT', `/api/admin/staff/${ownerId}`, { login: 'duy', password: 'quay-bar-2027' })).status, 200);
  const me = (await call('GET', '/api/admin/staff')).body.find((x: any) => x.id === ownerId);
  assert.equal(me.login, 'duy');
  assert.equal(me.has_password, 1);
  const st = await call('POST', '/api/admin/staff', { name: 'Tí', role: 'staff', pin: '4321', login: 'ti.dui', password: 'abcdefgh1' });
  assert.equal(st.status, 200);
  const ti = (await call('GET', '/api/admin/staff')).body.find((x: any) => x.name === 'Tí');
  assert.equal(ti.login, 'ti.dui');
  assert.equal(ti.has_password, 1);
  { // a staff account signs a new device in
    const keep = deviceToken; deviceToken = '';
    assert.equal((await call('POST', '/api/devices/register', { login: 'ti.dui', password: 'abcdefgh1', deviceName: 'Máy Tí' })).status, 200);
    deviceToken = keep;
  }
  // remove the account: login cleared, PIN stays
  assert.equal((await call('PUT', `/api/admin/staff/${ti.id}`, { login: null })).status, 200);
  assert.equal((await call('GET', '/api/admin/staff')).body.find((x: any) => x.id === ti.id).has_password, 0);
  const mgr = await call('POST', '/api/admin/staff', { name: 'Mai', role: 'manager', pin: '135790', login: 'duy', password: 'abcdefgh1' });
  assert.equal(mgr.status, 409); // login already taken
  // Revoke: every other device is signed out.
  const before = (await call('GET', '/api/admin/devices')).body.filter((d: any) => d.active).length;
  assert.ok(before >= 3);
  const rv = await call('POST', '/api/admin/devices/revoke-others');
  assert.equal(rv.body.revoked, before - 1);
  const save = deviceToken; deviceToken = '';
  const nd = await call('POST', '/api/devices/register', { login: 'duy', password: 'quay-bar-2027', deviceName: 'Máy D' });
  assert.equal(nd.status, 200);
  deviceToken = save;
  // Not indexed by search engines.
  const robots = await worker.fetch(new Request('https://pos.test/robots.txt'), env);
  assert.match(await robots.text(), /Disallow: \//);
  const page = await worker.fetch(new Request('https://pos.test/'), env);
  assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
});

await test('Permissions: staff gets revenue only when the owner grants it', async () => {
  const st = await call('POST', '/api/admin/staff', { name: 'Kế toán', role: 'staff', pin: '246810' });
  assert.equal(st.status, 200);
  const keep = staffSession;
  const loginAs = async () => { const r = await call('POST', '/api/auth/staff', { staffId: st.body.id, pin: '246810' }); assert.equal(r.status, 200); staffSession = r.body.session; };
  await loginAs();
  assert.equal((await call('GET', '/api/fin/dashboard')).status, 403);
  staffSession = keep;
  assert.equal((await call('PUT', `/api/admin/staff/${st.body.id}`, { perms: ['revenue', 'nope'] })).status, 400);
  assert.equal((await call('PUT', `/api/admin/staff/${st.body.id}`, { perms: ['revenue', 'audit'] })).status, 200);
  staffSession = (await call('POST', '/api/auth/staff', { staffId: st.body.id, pin: '246810' })).body.session;
  assert.notEqual((await call('GET', '/api/fin/dashboard')).status, 403);
  assert.equal((await call('GET', '/api/admin/audit')).status, 200);
  assert.equal((await call('GET', '/api/fin/ledger')).status, 403); // not granted
  assert.equal((await call('PUT', `/api/admin/staff/${st.body.id}`, { perms: ['ledger'] })).status, 403); // owner-only
  staffSession = keep;
  // config carries perms for the till; a manager with a custom set loses the rest
  const cfg = (await call('GET', '/api/sync/pull')).body.config;
  assert.equal(JSON.parse(cfg.staff.find((x: any) => x.id === st.body.id).perms).join(), 'revenue,audit');
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

// ---------- tabs, comps, tips, bank webhooks ----------
const mkOrder = (over: Partial<Order>): Order => ({
  id: ulid(), outlet_id: 'x', device_id: 'x', short_code: 'A-100', business_day: day, staff_id: ownerId, staff_shift_id: null, drawer_session_id: null,
  order_type: 'dine_in', customer_label: 'Tab John', status: 'open', subtotal: 0, promo_total: 0, discount_total: 0, total: 0,
  sent_at: Date.now(), paid_at: null, void_reason: null, voided_by: null, approved_by: null, voided_at: null, created_at: Date.now(), updated_at: Date.now(),
  lines: [], adjustments: [], payments: [], ...over,
});
await test('Comp line: free for the guest, excluded from BOGO, value reported', () => {
  const comp = { ...line('c', 'S1', 120000, 1), comp: 1, comp_reason: 'Khách quen' };
  const t = computeTotals([line('a', 'S1', 120000, 1), comp], [promo], pi(['S1']), Date.now(), 420);
  assert.equal(t.promo_total, 0);
  assert.equal(t.comp_total, 120000);
  assert.equal(t.total, 120000);
});
const drawer2 = ulid();
await test('Open tab: rounds from two devices merge; totals recomputed; late lines after payment are refused', async () => {
  const t0 = Date.now();
  await call('POST', '/api/sync/push', { records: [{ type: 'drawer_session', data: { id: drawer2, outlet_id: 'x', business_day: day, status: 'open', opened_by: ownerId, opened_at: t0, opening_float: 0, opening_count_json: null, closed_by: null, closed_at: null, counted_json: null, counted_total: null, expected_total: null, difference: null, note: null, device_id: null, created_at: t0, updated_at: t0 } }] });
  const L1 = { ...line(ulid(), itemId, 120000, 1), sent_at: t0 };
  const L2 = { ...line(ulid(), itemId, 120000, 1), sent_at: t0 };
  const tab = mkOrder({ drawer_session_id: drawer2, lines: [L1], subtotal: 120000, total: 120000 });
  await call('POST', '/api/sync/push', { records: [{ type: 'order', data: tab }] });
  await call('POST', '/api/sync/push', { records: [{ type: 'order', data: { ...tab, lines: [L2] } }] }); // other device's copy
  let srv = (await call('GET', '/api/sync/pull?since=0')).body.orders.find((o: any) => o.id === tab.id);
  assert.equal(srv.lines.length, 2);
  assert.equal(srv.subtotal, 240000);
  assert.equal(srv.total, 120000); // BOGO on the merged rounds
  const z = (await call('GET', `/api/drawer/${drawer2}/zreport`)).body;
  assert.equal(z.open_tabs, 1);
  const paid = { ...tab, status: 'paid' as const, lines: [L1, L2], subtotal: 240000, promo_total: 120000, total: 120000, paid_at: Date.now(),
    payments: [{ id: ulid(), method: 'cash' as const, amount: 120000, tip: 20000, tendered: 200000, change_given: 60000, reference: null, status: 'confirmed' as const, confirmed_by: ownerId, confirmed_at: Date.now(), drawer_session_id: drawer2, created_at: Date.now() }] };
  await call('POST', '/api/sync/push', { records: [{ type: 'order', data: paid }] });
  const late = await call('POST', '/api/sync/push', { records: [{ type: 'order', data: { ...tab, lines: [L1, L2, { ...line(ulid(), itemId, 120000, 1) }] } }] });
  assert.equal(late.body.results[0].ok, false);
  srv = (await call('GET', '/api/sync/pull?since=0')).body.orders.find((o: any) => o.id === tab.id);
  assert.equal(srv.lines.length, 2);
  assert.equal(srv.tip_total, 20000);
});
await test('Cash tips are in the drawer but not in revenue', async () => {
  const z = (await call('GET', `/api/drawer/${drawer2}/zreport`)).body;
  assert.equal(z.tips.cash, 20000);
  assert.equal(z.by_method.cash, 120000);
  assert.equal(z.expected_cash, 140000);
  const rep = (await call('GET', `/api/reports/revenue?from=${day}&to=${day}`)).body;
  assert.equal(rep.totals.tips, 20000);
});
await test('Drawer cannot close with an open tab', async () => {
  await call('POST', '/api/sync/push', { records: [{ type: 'order', data: mkOrder({ short_code: 'A-101', drawer_session_id: drawer2, lines: [line(ulid(), itemId, 120000, 1)] }) }] });
  const r = await call('POST', `/api/drawer/${drawer2}/close`, { counted: {}, note: 'x' });
  assert.equal(r.status, 409);
});
await test('Bank webhook (SePay): key required, dedup, auto-confirms a waiting order, extra = tip', async () => {
  env.BANK_WEBHOOK_KEY = 'secret-key';
  const waiting = mkOrder({ short_code: 'B-002', status: 'awaiting_payment', drawer_session_id: drawer2, lines: [line(ulid(), itemId, 100000, 1)], subtotal: 100000, total: 100000,
    payments: [{ id: ulid(), method: 'vietqr', amount: 100000, tendered: null, change_given: 0, reference: 'DUI B002', status: 'pending', confirmed_by: null, confirmed_at: null, drawer_session_id: drawer2, created_at: Date.now() }] });
  await call('POST', '/api/sync/push', { records: [{ type: 'order', data: waiting }] });
  const payload = { id: 501, gateway: 'Vietcombank', transactionDate: '2026-10-31 20:00:00', accountNumber: '0123', code: null, content: 'dui b002 chuyen tien', transferType: 'in', description: '', transferAmount: 120000, accumulated: 0, referenceCode: 'FT1' };
  assert.equal((await call('POST', '/api/webhooks/bank', payload, { authorization: 'Apikey wrong' })).status, 401);
  const ok = await call('POST', '/api/webhooks/bank', payload, { authorization: 'Apikey secret-key' });
  assert.deepEqual(ok.body, { success: true });
  await call('POST', '/api/webhooks/bank', payload, { authorization: 'Apikey secret-key' }); // retry
  const srv = (await call('GET', '/api/sync/pull?since=0')).body.orders.find((o: any) => o.id === waiting.id);
  assert.equal(srv.status, 'paid');
  assert.equal(srv.payments.length, 1);
  assert.equal(srv.payments[0].tip, 20000);
  const cfg2 = (await call('GET', '/api/sync/pull?since=0')).body.config;
  assert.equal(cfg2.features.bankWebhook, true);
});
await test('Bank check while the QR is on screen (Casso format), then admin list', async () => {
  await call('POST', '/api/webhooks/bank?key=secret-key', { error: 0, data: [{ id: 9001, tid: 'R1', description: 'DUI A777', amount: 50000, when: '2026-10-31 20:01:00', bank_sub_acc_id: '0123', bankName: 'VPBank' }] });
  const c1 = (await call('GET', '/api/bank/check?code=A-777&amount=50000')).body;
  assert.equal(c1.found, true);
  assert.equal((await call('GET', '/api/bank/check?code=A-777&amount=50000')).body.found, false); // claimed once
  const list = (await call('GET', '/api/admin/bank-txns')).body;
  assert.ok(list.some((t: any) => t.id === 'casso:9001' && t.status === 'claimed'));
});


// ---------- tables (sơ đồ bàn) ----------
console.log('Tables & time clock');
const push = (records: any[]) => call('POST', '/api/sync/push', { records });
const drawer3 = ulid();
await test('Floor plan: 6 starter tables in the config; bulk add; busy table cannot be deleted', async () => {
  const cfg0 = (await call('GET', '/api/sync/pull?since=0')).body.config;
  assert.equal(cfg0.tables.length, 6);
  assert.deepEqual(cfg0.tables.map((t: any) => t.name).slice(0, 3), ['Bàn 1', 'Bàn 2', 'Bàn 3']);
  const r = await call('POST', '/api/admin/tables/bulk', { area: 'Sân', prefix: 'S', start: 1, count: 4, seats: 2 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const san = r.body.filter((t: any) => t.area === 'Sân');
  assert.equal(san.length, 4);
  assert.equal(new Set(san.map((t: any) => `${t.x},${t.y}`)).size, 4); // no two tables on the same cell
  assert.equal((await call('POST', '/api/admin/tables/area', { from: 'Sân', to: 'Sân trước' })).status, 200);
  const busy = mkOrder({ short_code: 'A-201', table_id: san[0].id, lines: [line(ulid(), itemId, 120000, 1)] });
  await push([{ type: 'order', data: busy }]);
  assert.equal((await call('DELETE', `/api/admin/t/dining_table/${san[0].id}`)).status, 409);
  assert.equal((await call('DELETE', `/api/admin/t/dining_table/${san[1].id}`)).status, 200);
  const cfg1 = (await call('GET', '/api/sync/pull?since=0')).body.config;
  assert.equal(cfg1.tables.length, 9);
  assert.ok(cfg1.tables.every((t: any) => t.area !== 'Sân'));
  await push([{ type: 'order', data: { ...busy, status: 'void', void_reason: 'test', voided_at: Date.now() } }]);
});
await test('Table order stays unpaid: rounds, pre-bill mark, move table; old open tables still pulled', async () => {
  const t0 = Date.now();
  await push([{ type: 'drawer_session', data: { id: drawer3, outlet_id: 'x', business_day: day, status: 'open', opened_by: ownerId, opened_at: t0, opening_float: 0, opening_count_json: null, closed_by: null, closed_at: null, counted_json: null, counted_total: null, expected_total: null, difference: null, note: null, device_id: null, created_at: t0, updated_at: t0 } }]);
  const L1 = { ...line(ulid(), itemId, 120000, 1), sent_at: t0 };
  const o = mkOrder({ short_code: 'A-301', table_id: 'TBL01', guests: 3, drawer_session_id: drawer3, lines: [L1], subtotal: 120000, total: 120000 });
  await push([{ type: 'order', data: o }]);
  await push([{ type: 'order', data: { ...o, prebill_at: t0 + 1000 } }]);
  let srv = (await call('GET', '/api/sync/pull?since=0')).body.orders.find((x: any) => x.id === o.id);
  assert.equal(srv.status, 'open');
  assert.equal(srv.table_id, 'TBL01');
  assert.equal(srv.guests, 3);
  assert.equal(srv.prebill_at, t0 + 1000);
  await push([{ type: 'order', data: { ...o, table_id: 'TBL02', prebill_at: null } }]);
  srv = (await call('GET', '/api/sync/pull?since=0')).body.orders.find((x: any) => x.id === o.id);
  assert.equal(srv.table_id, 'TBL02');
  assert.equal(srv.prebill_at, null);
  // An open table from three days ago is still sent to a new device.
  const old = mkOrder({ short_code: 'A-302', business_day: '2000-01-01', table_id: 'TBL03', lines: [line(ulid(), itemId, 120000, 1)] });
  await push([{ type: 'order', data: old }]);
  assert.ok((await call('GET', '/api/sync/pull?since=0')).body.orders.some((x: any) => x.id === old.id));
  await push([{ type: 'order', data: { ...old, status: 'void', void_reason: 'test', voided_at: Date.now() } }]);
});
await test('Merge tables: lines move to the target, BOGO recomputed, merged tab not counted as a void, late rounds refused', async () => {
  const t0 = Date.now();
  const A1 = { ...line(ulid(), itemId, 120000, 1), sent_at: t0 };
  const B1 = { ...line(ulid(), itemId, 120000, 1), sent_at: t0 };
  const a = mkOrder({ short_code: 'A-311', table_id: 'TBL04', guests: 2, drawer_session_id: drawer3, lines: [A1], subtotal: 120000, total: 120000 });
  const b = mkOrder({ short_code: 'A-312', table_id: 'TBL05', guests: 2, drawer_session_id: drawer3, lines: [B1], subtotal: 120000, total: 120000 });
  await push([{ type: 'order', data: a }, { type: 'order', data: b }]);
  // What mergeOrders() on the device sends: the target with both rounds, then the source closed as merged.
  await push([
    { type: 'order', data: { ...a, guests: 4, lines: [A1, { ...B1, sort: 1 }], subtotal: 240000, promo_total: 120000, total: 120000 } },
    { type: 'order', data: { ...b, status: 'void', merged_into: a.id, void_reason: 'Gộp vào Bàn 4', voided_at: t0, lines: [], subtotal: 0, total: 0 } },
  ]);
  const orders = (await call('GET', '/api/sync/pull?since=0')).body.orders;
  const sa = orders.find((x: any) => x.id === a.id);
  const sb = orders.find((x: any) => x.id === b.id);
  assert.equal(sa.lines.length, 2);
  assert.equal(sa.total, 120000); // 1+1 across the two tables' drinks
  assert.equal(sb.status, 'void');
  assert.equal(sb.merged_into, a.id);
  assert.equal(sb.lines.length, 0);
  const z = (await call('GET', `/api/drawer/${drawer3}/zreport`)).body;
  assert.equal(z.voids, 0);
  const late = await push([{ type: 'order', data: { ...b, lines: [B1, { ...line(ulid(), itemId, 120000, 1), sent_at: Date.now() }] } }]);
  assert.equal(late.body.results[0].ok, false);
  assert.match(late.body.results[0].error, /gộp/);
  // Pay the merged table: it leaves the floor.
  await push([{ type: 'order', data: { ...a, status: 'paid', paid_at: Date.now(), guests: 4, lines: [A1, { ...B1, sort: 1 }], subtotal: 240000, promo_total: 120000, total: 120000,
    payments: [{ id: ulid(), method: 'cash', amount: 120000, tip: 0, tendered: 120000, change_given: 0, reference: null, status: 'confirmed', confirmed_by: ownerId, confirmed_at: Date.now(), drawer_session_id: drawer3, created_at: Date.now() }] } }]);
  const after = (await call('GET', `/api/drawer/${drawer3}/zreport`)).body;
  assert.equal(after.net_sales, 120000);
  assert.equal(after.open_tabs, 1); // A-301 is still open on Bàn 2
});

// ---------- time clock ----------
await test('Timesheet maths: worked, night hours, lateness, pay', () => {
  const tz = 420;
  const at = (iso: string) => Date.parse(iso);
  const e: any = { staff_id: 'S', business_day: '2026-10-30', clock_in: at('2026-10-30T10:20:00Z'), clock_out: at('2026-10-30T18:30:00Z'), break_min: 30 }; // 17:20–01:30 local
  assert.equal(workedMinutes(e), 460);
  assert.equal(nightMinutes(e, tz), 210); // 22:00–01:30
  const plan = [{ id: 'p', staff_id: 'S', day: '2026-10-30', start: '17:00', end: '01:30', note: null }];
  assert.equal(lateMinutes(e, plan, tz, '05:00', 10), 20);
  assert.equal(lateMinutes({ ...e, clock_in: at('2026-10-30T10:05:00Z') }, plan, tz, '05:00', 10), 0);
  assert.equal(payFor(460, 210, 30000, 0), 230000);
  assert.equal(payFor(460, 210, 30000, 30), 262000); // + 30% on 3.5 night hours = 31.500 → 261.500 → 262.000
  const sum = summarize([e, { ...e, clock_out: null, clock_in: Date.now() - 20 * 3600000 }], plan, { S: 30000 }, { tz, cutoff: '05:00' });
  assert.equal(sum.get('S')!.minutes, 460); // the forgotten clock-out is not paid
  assert.equal(sum.get('S')!.open, 1);
  assert.equal(sum.get('S')!.scheduled_minutes, 510);
  assert.equal(weekStart('2026-11-01'), '2026-10-26'); // Sunday → Monday before
});
await test('Clock in/out from a device; manager fixes win over stale pushes; deletes stay deleted', async () => {
  const id = ulid();
  const tin = Date.now() - 3 * 3600000;
  const entry = { id, staff_id: ownerId, business_day: day, clock_in: tin, clock_out: null, break_min: 0, device_id: null, source: 'pos', note: null, created_at: tin, updated_at: tin };
  await push([{ type: 'time_entry', data: entry }]);
  let pulled = (await call('GET', '/api/sync/pull?since=0')).body;
  assert.ok(pulled.timeEntries.some((x: any) => x.id === id && !x.clock_out));
  const tout = Date.now();
  await push([{ type: 'time_entry', data: { ...entry, clock_out: tout, break_min: 15 } }]);
  let sheet = (await call('GET', `/api/time/sheet?from=${day}&to=${day}`)).body;
  let row = sheet.entries.find((x: any) => x.id === id);
  assert.equal(row.clock_out, tout);
  assert.equal(row.break_min, 15);
  // Manager correction needs a reason and is audited.
  assert.equal((await call('PUT', `/api/time/entries/${id}`, { clock_in: tin - 1800000, clock_out: tout })).status, 400);
  assert.equal((await call('PUT', `/api/time/entries/${id}`, { clock_in: tin - 1800000, clock_out: tout, break_min: 0, reason: 'Quên chấm vào' })).status, 200);
  await push([{ type: 'time_entry', data: { ...entry, clock_out: tout + 999 } }]); // stale copy from another device
  sheet = (await call('GET', `/api/time/sheet?from=${day}&to=${day}`)).body;
  row = sheet.entries.find((x: any) => x.id === id);
  assert.equal(row.clock_in, tin - 1800000);
  assert.equal(row.clock_out, tout);
  assert.ok(row.edited_by_name);
  const audit = (await call('GET', '/api/admin/audit?action=time_edit')).body;
  assert.ok(JSON.stringify(audit).includes('Quên chấm vào'));
  // Manual entry and validation.
  assert.equal((await call('POST', '/api/time/entries', { staff_id: ownerId, clock_in: tout, clock_out: tin, note: 'x' })).status, 400);
  const man = await call('POST', '/api/time/entries', { staff_id: ownerId, clock_in: tin - 86400000, clock_out: tin - 86400000 + 4 * 3600000, break_min: 0, note: 'Làm sự kiện' });
  assert.equal(man.status, 201);
  assert.equal(man.body.source, 'admin');
  // Delete is soft: a late device push does not bring it back.
  assert.equal((await call('POST', `/api/time/entries/${id}/delete`, { reason: 'Trùng' })).status, 200);
  await push([{ type: 'time_entry', data: { ...entry, clock_out: tout } }]);
  sheet = (await call('GET', `/api/time/sheet?from=${day}&to=${day}`)).body;
  assert.ok(!sheet.entries.some((x: any) => x.id === id));
  assert.ok(!(await call('GET', '/api/sync/pull?since=0')).body.timeEntries.some((x: any) => x.id === id));
});
await test('Pay rates: owner sets and sees them, a manager does not; staff are kept out', async () => {
  const st = (await call('GET', '/api/admin/staff')).body;
  const nam = st.find((x: any) => x.name === 'Nam');
  assert.equal((await call('PUT', `/api/admin/staff/${nam.id}`, { hourly_rate: 28000 })).status, 200);
  assert.equal((await call('PUT', `/api/admin/staff/${nam.id}`, { hourly_rate: -5 })).status, 400);
  const sheet = (await call('GET', `/api/time/sheet?from=${day}&to=${day}`)).body;
  assert.equal(sheet.owner, true);
  assert.equal(sheet.staff.find((x: any) => x.id === nam.id).hourly_rate, 28000);
  const mgr = await call('POST', '/api/admin/staff', { name: 'Hà', role: 'manager', pin: '246802' });
  const save = staffSession;
  staffSession = (await call('POST', '/api/auth/staff', { staffId: mgr.body.id, pin: '246802' })).body.session;
  const ms = (await call('GET', `/api/time/sheet?from=${day}&to=${day}`)).body;
  assert.equal(ms.owner, false);
  assert.equal(ms.staff.find((x: any) => x.id === nam.id).hourly_rate, undefined);
  assert.equal((await call('GET', '/api/admin/staff')).body.find((x: any) => x.id === nam.id).hourly_rate, undefined);
  staffSession = save;
  // The till never receives pay rates.
  const cfgStaff = (await call('GET', '/api/sync/pull?since=0')).body.config.staff;
  assert.ok(cfgStaff.every((x: any) => !('hourly_rate' in x)));
});
await test('Schedule: add, edit, copy last week (refuses to overwrite unless asked), shown to devices', async () => {
  const mon = weekStart(day);
  const prev = new Date(Date.parse(mon) - 7 * 86400000).toISOString().slice(0, 10);
  assert.equal((await call('POST', '/api/time/schedule', { staff_id: ownerId, day: prev, start: '25:00', end: '01:00' })).status, 400);
  const a = await call('POST', '/api/time/schedule', { staff_id: ownerId, day: prev, start: '17:00', end: '01:30', note: 'Bar' });
  assert.equal(a.status, 201);
  assert.equal((await call('PUT', `/api/time/schedule/${a.body.id}`, { staff_id: ownerId, day: prev, start: '18:00', end: '02:00' })).status, 200);
  await call('POST', '/api/time/schedule', { staff_id: ownerId, day: mon, start: '12:00', end: '16:00' });
  assert.equal((await call('POST', '/api/time/schedule/copy', { from: prev, to: mon })).status, 409);
  const c = await call('POST', '/api/time/schedule/copy', { from: prev, to: mon, replace: true });
  assert.equal(c.body.copied, 1);
  const sched = (await call('GET', '/api/sync/pull?since=0')).body.schedule;
  const mine = sched.filter((x: any) => x.day === mon);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].start, '18:00');
});

await test('Owner deletes staff: no history → removed; with history → archived but kept on old records', async () => {
  const fresh = (await call('POST', '/api/admin/staff', { name: 'Tạm', role: 'staff', pin: '7777' })).body;
  let r = await call('DELETE', `/api/admin/staff/${fresh.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.archived, false);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM staff WHERE id=?').get(fresh.id).n, 0);
  const nam = (await call('GET', '/api/admin/staff')).body.find((x: any) => x.name === 'Nam');
  // Clocked in → refused until clocked out.
  const te = { id: ulid(), staff_id: nam.id, business_day: day, clock_in: Date.now() - 3600000, clock_out: null, break_min: 0, device_id: null, source: 'pos', note: null, created_at: Date.now(), updated_at: Date.now() };
  await push([{ type: 'time_entry', data: te }]);
  assert.equal((await call('DELETE', `/api/admin/staff/${nam.id}`)).status, 409);
  await push([{ type: 'time_entry', data: { ...te, clock_out: Date.now() } }]);
  r = await call('DELETE', `/api/admin/staff/${nam.id}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.archived, true);
  assert.ok(!(await call('GET', '/api/admin/staff')).body.some((x: any) => x.id === nam.id));
  assert.ok(!(await call('GET', '/api/sync/pull?since=0')).body.config.staff.some((x: any) => x.id === nam.id));
  assert.equal((await call('POST', '/api/auth/staff', { staffId: nam.id, pin: '5555' })).status >= 400, true);
  const sheet = (await call('GET', `/api/time/sheet?from=${day}&to=${day}`)).body;
  assert.ok(sheet.staff.find((x: any) => x.id === nam.id)?.deleted_at); // name still resolvable on old entries
  // Cannot delete yourself.
  assert.equal((await call('DELETE', `/api/admin/staff/${ownerId}`)).status, 409);
  // Managers cannot delete.
  const mgr = (await call('GET', '/api/admin/staff')).body.find((x: any) => x.name === 'Hà');
  const save = staffSession;
  staffSession = (await call('POST', '/api/auth/staff', { staffId: mgr.id, pin: '246802' })).body.session;
  assert.equal((await call('DELETE', `/api/admin/staff/${ownerId}`)).status, 403);
  assert.equal((await call('POST', '/api/admin/t/dining_table', { area: 'Trong nhà', name: 'Bàn 99' })).status, 403); // only the owner adds tables
  assert.equal((await call('POST', '/api/admin/tables/bulk', { count: 2 })).status, 403);
  staffSession = save;
});
await test('Demo data: menu + last month 10–15 orders/day, then a clean wipe that keeps real data', async () => {
  const realBefore = (env.DB.raw.prepare("SELECT COUNT(*) n FROM sale_order WHERE id NOT LIKE 'DEMO%'").get() as any).n;
  const st = (await call('GET', '/api/admin/demo')).body;
  assert.equal(st.seeded, false);
  assert.ok(st.days.length >= 28);
  assert.equal((await call('POST', '/api/admin/demo/seed', { step: 'menu' })).status, 200);
  assert.equal((await call('POST', '/api/admin/demo/seed', { step: 'menu' })).status, 409);
  for (const d of st.days) {
    const r = await call('POST', '/api/admin/demo/seed', { step: 'day', day: d });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.orders >= 10 && r.body.orders <= 15, `${d}: ${r.body.orders}`);
  }
  const from = st.days[0], to = st.days[st.days.length - 1];
  const dash = (await call('GET', `/api/fin/dashboard?from=${from}&to=${to}`)).body;
  assert.ok(dash.current.orders > 250 && dash.current.revenue > 20_000_000, JSON.stringify(dash.current));
  assert.ok(dash.current.pnl.cogs > 0 && dash.current.tips > 0 && dash.current.comp > 0);
  const neg = (env.DB.raw.prepare("SELECT COUNT(*) n FROM ingredient WHERE id LIKE 'DEMO%' AND stock_base < 0").get() as any).n;
  assert.equal(neg, 0, 'demo stock went negative');
  const cost = (await call('GET', '/api/inv/costing')).body;
  assert.ok(cost.items.filter((i: any) => i.has_recipe).length >= 17);
  // S1a-HKD book, charts and the monthly verdict on the demo month.
  const s1 = (await call('GET', `/api/reports/s1a?from=${from}&to=${to}`)).body;
  assert.equal(s1.rows.length, dash.current.orders);
  assert.equal(s1.total, dash.current.revenue);
  const s1d = (await call('GET', `/api/reports/s1a?from=${from}&to=${to}&mode=day`)).body;
  assert.equal(s1d.total, s1.total);
  assert.ok(s1d.rows.length >= 28);
  const an = (await call('GET', `/api/fin/analytics?from=${from}&to=${to}`)).body;
  assert.ok(an.daily.length >= 28 && an.heat.length > 0 && an.items.length > 0 && an.months.length >= 1);
  const ins = await call('GET', `/api/fin/insights?period=month&date=${from}`);
  assert.equal(ins.status, 200, JSON.stringify(ins.body));
  assert.equal(ins.body.summary.revenue, dash.current.revenue);
  assert.match(ins.body.findings[0].title, /LÃI|LỖ/);
  assert.ok(ins.body.findings.some((x: any) => x.area === 'Huỷ đơn'));
  assert.ok(ins.body.findings.some((x: any) => x.area === 'Két tiền'));
  const wk = await call('GET', `/api/fin/insights?period=week&date=${from}`);
  assert.equal(wk.status, 200);
  const ts = (await call('GET', `/api/time/sheet?from=${from}&to=${to}`)).body;
  assert.ok(ts.entries.filter((e: any) => e.id.startsWith('DEMO')).length >= 50 && ts.schedule.length >= 50);
  assert.equal((await call('POST', '/api/admin/demo/clear')).status, 200);
  for (const t of ['sale_order', 'order_line', 'item', 'ingredient', 'staff', 'ledger_entry', 'drawer_session', 'stock_movement', 'recipe_line', 'time_entry', 'work_schedule']) {
    const left = (env.DB.raw.prepare(`SELECT COUNT(*) n FROM ${t} WHERE ${t === 'order_line' ? 'order_id' : 'id'} LIKE 'DEMO%'`).get() as any).n;
    assert.equal(left, 0, t);
  }
  assert.equal((env.DB.raw.prepare("SELECT COUNT(*) n FROM sale_order").get() as any).n, realBefore);
  assert.equal((await call('GET', '/api/admin/demo')).body.seeded, false);
});

console.log(`\n${passed} checks passed`);

// Demo data for trying the app: a bar menu with recipes, stock, suppliers, two demo staff, monthly costs,
// and 10–15 orders a day for every day of last month. Every demo row has an id starting with "DEMO",
// so "Xoá dữ liệu demo" removes exactly what was added and nothing else.
//
// Seeding runs in small steps (menu first, then one call per day) so each request stays inside the
// Workers Free limits (10 ms CPU, 50 D1 queries per request; a batch counts as one query).
import { hashPin } from '../shared/crypto';
import { computeTotals } from '../shared/pricing';
import type { ChosenOption, OrderLine, Promotion, PromotionItem } from '../shared/types';
import { addDays, businessDay } from '../shared/util';
import { all, batch, body, type Ctx, type Env, first, json, need, now, requireRole, stmt } from './http';

let seq = 0;
const did = (p: string) => `DEMO-${p}-${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Deterministic random per day, so a day always looks the same.
function rng(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}

// name, category (by name_en), price, bogo, recipe [ingredient key, qty base]
const ITEMS: [string, string, number, boolean, [string, number][], number][] = [
  ['Ginger Mule', 'Signature', 120000, true, [['vodka', 40], ['syrup', 20], ['chanh', 15], ['soda', 100], ['ly', 1], ['onghut', 1]], 10],
  ['Lychee Sour', 'Signature', 120000, true, [['vodka', 40], ['vai', 60], ['chanh', 20], ['duong', 10], ['ly', 1]], 9],
  ['Passion Smash', 'Signature', 120000, true, [['rum', 40], ['chanhday', 40], ['syrup', 15], ['ly', 1], ['onghut', 1]], 8],
  ['Pandan Old Fashioned', 'Signature', 120000, true, [['whiskey', 50], ['ladua', 5], ['duong', 8], ['ly', 1]], 6],
  ['Dui Negroni', 'Signature', 120000, true, [['gin', 30], ['campari', 30], ['ly', 1]], 6],
  ['Espresso Martini', 'Signature', 150000, false, [['vodka', 40], ['kahlua', 20], ['cafe', 18], ['ly', 1]], 5],
  ['Saigon Spritz', 'Signature', 140000, false, [['campari', 40], ['soda', 80], ['chanh', 10], ['ly', 1]], 3],
  ['Virgin Mojito', 'Mocktail', 80000, false, [['chanh', 25], ['duong', 15], ['soda', 150], ['ly', 1], ['onghut', 1]], 4],
  ['Peach Iced Tea', 'Mocktail', 70000, false, [['duong', 15], ['ly', 1], ['onghut', 1]], 3],
  ['Calamansi Soda', 'Mocktail', 75000, false, [['chanh', 30], ['soda', 150], ['ly', 1]], 3],
  ['Tequila Shot', 'Shots', 60000, false, [['tequila', 30], ['chanh', 5]], 5],
  ['Jäger Shot', 'Shots', 70000, false, [['jager', 30]], 4],
  ['Vodka Shot', 'Shots', 50000, false, [['vodka', 30]], 3],
  ['Bia Tiger', 'Other', 40000, false, [['tiger', 1]], 6],
  ['Bia Heineken', 'Other', 50000, false, [['heineken', 1]], 5],
  ['Nước suối', 'Other', 20000, false, [['nuoc', 1]], 2],
  ['Snack mix', 'Other', 60000, false, [['snack', 1]], 3],
];

// key, name, kind, base unit, purchase unit, base per purchase, yield %, price per purchase unit, purchase qty for the month, min stock (purchase units)
const INGS: [string, string, 'raw' | 'prepared', string, string, number, number, number, number, number][] = [
  ['vodka', 'Vodka (demo)', 'raw', 'ml', 'chai', 700, 100, 320000, 20, 3],
  ['gin', 'Gin (demo)', 'raw', 'ml', 'chai', 700, 100, 450000, 6, 2],
  ['rum', 'Rum (demo)', 'raw', 'ml', 'chai', 700, 100, 380000, 8, 2],
  ['whiskey', 'Whiskey (demo)', 'raw', 'ml', 'chai', 700, 100, 600000, 8, 2],
  ['tequila', 'Tequila (demo)', 'raw', 'ml', 'chai', 750, 100, 550000, 6, 1],
  ['campari', 'Campari (demo)', 'raw', 'ml', 'chai', 700, 100, 520000, 8, 1],
  ['kahlua', 'Kahlua (demo)', 'raw', 'ml', 'chai', 700, 100, 480000, 3, 1],
  ['jager', 'Jägermeister (demo)', 'raw', 'ml', 'chai', 700, 100, 600000, 5, 1],
  ['gung', 'Gừng (demo)', 'raw', 'g', 'kg', 1000, 100, 40000, 3, 1],
  ['duong', 'Đường (demo)', 'raw', 'g', 'kg', 1000, 100, 25000, 8, 2],
  ['chanh', 'Nước cốt chanh (demo)', 'raw', 'ml', 'kg', 1000, 40, 30000, 25, 3],
  ['chanhday', 'Chanh dây (demo)', 'raw', 'ml', 'kg', 1000, 35, 60000, 15, 2],
  ['vai', 'Vải hộp (demo)', 'raw', 'g', 'lon', 565, 100, 35000, 18, 3],
  ['ladua', 'Lá dứa (demo)', 'raw', 'g', 'bó', 100, 100, 10000, 10, 2],
  ['cafe', 'Cà phê espresso (demo)', 'raw', 'g', 'kg', 1000, 100, 400000, 2, 1],
  ['soda', 'Soda (demo)', 'raw', 'ml', 'lon', 330, 100, 10000, 160, 24],
  ['tiger', 'Bia Tiger lon (demo)', 'raw', 'cái', 'thùng', 24, 100, 380000, 8, 1],
  ['heineken', 'Bia Heineken lon (demo)', 'raw', 'cái', 'thùng', 24, 100, 450000, 7, 1],
  ['nuoc', 'Nước suối (demo)', 'raw', 'cái', 'thùng', 24, 100, 90000, 2, 1],
  ['snack', 'Snack gói (demo)', 'raw', 'cái', 'gói', 1, 100, 25000, 90, 10],
  ['ly', 'Ly nhựa (demo)', 'raw', 'cái', 'cây 50', 50, 100, 60000, 30, 4],
  ['onghut', 'Ống hút (demo)', 'raw', 'cái', 'bịch 100', 100, 100, 20000, 12, 2],
  ['syrup', 'Syrup gừng (demo)', 'prepared', 'ml', 'lít', 1000, 100, 0, 0, 1],
];

const NAMES = ['John', 'Anna', 'Minh', 'Lisa', 'Tom', 'Hà', 'Kenji', 'Sarah', 'Bàn 3', 'Bàn 5', 'Áo đỏ', 'Mike', 'Linh', 'Paul', 'Emma'];

function lastMonth(env: Env, tz: number, cutoff: string) {
  const today = businessDay(now(), tz, cutoff);
  const [y, m] = today.split('-').map(Number);
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  const first = `${py}-${String(pm).padStart(2, '0')}-01`;
  const days = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => addDays(first, i));
}

async function outlet(env: Env) {
  return (await first<{ id: string; tz_offset_min: number; business_day_cutoff: string }>(env, 'SELECT id,tz_offset_min,business_day_cutoff FROM outlet LIMIT 1'))!;
}

/** Local wall time (hour, minute) on a business day → epoch ms. Hours ≥ 24 roll into the next calendar day. */
function at(day: string, h: number, m: number, tz: number) {
  return Date.parse(day + 'T00:00:00Z') + (h * 60 + m) * 60000 - tz * 60000;
}

export async function status(c: Ctx) {
  requireRole(c, 'owner');
  const o = await outlet(c.env);
  const [items, orders] = await Promise.all([
    first<{ n: number }>(c.env, "SELECT COUNT(*) n FROM item WHERE id LIKE 'DEMO%'"),
    first<{ n: number; s: number }>(c.env, "SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM sale_order WHERE id LIKE 'DEMO%'"),
  ]);
  return json({ seeded: (items?.n ?? 0) > 0, items: items?.n ?? 0, orders: orders?.n ?? 0, revenue: orders?.s ?? 0, days: lastMonth(c.env, o.tz_offset_min, o.business_day_cutoff) });
}

export async function seed(c: Ctx) {
  requireRole(c, 'owner');
  const b = await body<{ step: 'menu' | 'day'; day?: string }>(c);
  const o = await outlet(c.env);
  if (b.step === 'menu') return seedMenu(c, o);
  need(b.day && /^\d{4}-\d{2}-\d{2}$/.test(b.day), 400, 'Thiếu ngày');
  return seedDay(c, o, b.day);
}

async function seedMenu(c: Ctx, o: { id: string; tz_offset_min: number; business_day_cutoff: string }) {
  const env = c.env;
  const exists = await first<{ n: number }>(env, "SELECT COUNT(*) n FROM item WHERE id LIKE 'DEMO%'");
  need(!exists?.n, 409, 'Đã có dữ liệu demo. Xoá trước khi tạo lại.');
  const [cats, groups, promo] = await Promise.all([
    all<{ id: string; name_en: string }>(env, 'SELECT id,name_en FROM category'),
    all<{ id: string }>(env, 'SELECT id FROM modifier_group ORDER BY sort'),
    first<{ id: string }>(env, "SELECT id FROM promotion WHERE type='bogo' ORDER BY created_at LIMIT 1"),
  ]);
  const t = now();
  const days = lastMonth(env, o.tz_offset_min, o.business_day_cutoff);
  const firstDay = days[0];
  const stmts: D1PreparedStatement[] = [];
  const catId = new Map(cats.map((x) => [x.name_en, x.id]));
  ['Signature', 'Mocktail', 'Shots', 'Other'].forEach((name, i) => {
    if (!catId.has(name)) {
      const id = did('C');
      catId.set(name, id);
      stmts.push(stmt(env, 'INSERT INTO category (id,name_en,name_vi,sort,active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)', id, name, name === 'Other' ? 'Khác' : name, i, t, t));
    }
  });
  const supRuou = did('S');
  const supCho = did('S');
  stmts.push(stmt(env, 'INSERT INTO supplier (id,name,phone,active,created_at,updated_at) VALUES (?,?,?,1,?,?)', supRuou, 'NCC Rượu (demo)', '0900000001', t, t));
  stmts.push(stmt(env, 'INSERT INTO supplier (id,name,phone,active,created_at,updated_at) VALUES (?,?,?,1,?,?)', supCho, 'Chợ Hàn (demo)', '0900000002', t, t));

  // Ingredients with a month of purchases at the start of last month.
  const ingId = new Map<string, string>();
  const purchaseBank = did('P');
  const purchaseCash = did('P');
  let totalBank = 0;
  let totalOwner = 0;
  const pAt = at(firstDay, 15, 0, o.tz_offset_min);
  for (const [key, name, kind, base, unit, per, yld, price, qty, minUnits] of INGS) {
    const id = did('G');
    ingId.set(key, id);
    const perUnit = per * (yld / 100);
    const buy = Math.ceil(qty * 1.6); // generous, so the month never runs below zero
    const qtyBase = buy * perUnit;
    const avg = qtyBase ? price / perUnit : 0;
    const spirit = unit === 'chai';
    stmts.push(stmt(env, 'INSERT INTO ingredient (id,name,kind,base_unit,purchase_unit,base_per_purchase,yield_pct,avg_cost_per_base,stock_base,min_stock_base,recipe_yield_base,default_supplier_id,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)',
      id, name, kind, base, unit, per, yld, avg, qtyBase, minUnits * perUnit, 1000, spirit ? supRuou : supCho, t, t));
    if (buy) {
      const lineTotal = buy * price;
      const pid = spirit ? purchaseBank : purchaseCash;
      if (spirit) totalBank += lineTotal; else totalOwner += lineTotal;
      stmts.push(stmt(env, 'INSERT INTO purchase_line (id,purchase_id,ingredient_id,qty_purchase_units,unit_price,line_total,qty_base) VALUES (?,?,?,?,?,?,?)', did('PL'), pid, id, buy, price, lineTotal, qtyBase));
      stmts.push(stmt(env, 'INSERT INTO stock_movement (id,ingredient_id,qty_delta,reason,ref_type,ref_id,unit_cost,business_day,at) VALUES (?,?,?,?,?,?,?,?,?)', did('M'), id, qtyBase, 'purchase', 'purchase', pid, avg, firstDay, pAt));
    }
  }
  stmts.push(stmt(env, 'INSERT INTO purchase (id,supplier_id,business_day,payment_source,total,note,staff_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', purchaseBank, supRuou, firstDay, 'bank', totalBank, 'Nhập rượu đầu tháng (demo)', c.staff!.id, pAt, pAt));
  stmts.push(stmt(env, 'INSERT INTO purchase (id,supplier_id,business_day,payment_source,total,note,staff_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', purchaseCash, supCho, firstDay, 'owner', totalOwner, 'Nhập đồ tươi, vật tư đầu tháng (demo)', c.staff!.id, pAt, pAt));
  stmts.push(stmt(env, 'INSERT INTO ledger_entry (id,business_day,direction,category,amount,source,note,ref_type,ref_id,staff_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', did('L'), firstDay, 'out', 'purchase', totalBank, 'bank', 'Nhập rượu (demo)', 'purchase', purchaseBank, c.staff!.id, pAt, pAt));
  stmts.push(stmt(env, 'INSERT INTO ledger_entry (id,business_day,direction,category,amount,source,note,ref_type,ref_id,staff_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', did('L'), firstDay, 'out', 'purchase', totalOwner, 'owner', 'Nhập đồ tươi (demo)', 'purchase', purchaseCash, c.staff!.id, pAt, pAt));

  // Ginger syrup is a sub-recipe: 1 litre = 200 g ginger + 500 g sugar. A batch was made at the start of the month.
  const syrup = ingId.get('syrup')!;
  const syrupCost = (200 * 40 + 500 * 25) ; // ₫ per litre (ginger 40 ₫/g, sugar 25 ₫/g)
  stmts.push(stmt(env, 'INSERT INTO recipe_line (id,owner_type,owner_id,ingredient_id,qty_base,sort) VALUES (?,?,?,?,?,?)', did('R'), 'ingredient', syrup, ingId.get('gung')!, 200, 0));
  stmts.push(stmt(env, 'INSERT INTO recipe_line (id,owner_type,owner_id,ingredient_id,qty_base,sort) VALUES (?,?,?,?,?,?)', did('R'), 'ingredient', syrup, ingId.get('duong')!, 500, 1));
  stmts.push(stmt(env, 'UPDATE ingredient SET stock_base=?, avg_cost_per_base=? WHERE id=?', 9000, syrupCost / 1000, syrup));

  // Items, their recipes, modifier groups on cocktails, BOGO on the five signatures.
  ITEMS.forEach(([name, cat, price, bogo, recipe], i) => {
    const id = did('I');
    stmts.push(stmt(env, 'INSERT INTO item (id,category_id,name_en,name_vi,price,active,sold_out,show_on_web,sort,created_at,updated_at) VALUES (?,?,?,?,?,1,0,1,?,?,?)', id, catId.get(cat)!, name, name, price, i, t, t));
    recipe.forEach(([k, q], j) => stmts.push(stmt(env, 'INSERT INTO recipe_line (id,owner_type,owner_id,ingredient_id,qty_base,sort) VALUES (?,?,?,?,?,?)', did('R'), 'item', id, ingId.get(k)!, q, j)));
    if (cat === 'Signature' || cat === 'Mocktail') groups.forEach((g, gi) => stmts.push(stmt(env, 'INSERT OR IGNORE INTO item_modifier_group (item_id,group_id,sort) VALUES (?,?,?)', id, g.id, gi)));
    if (bogo && promo) stmts.push(stmt(env, 'INSERT OR IGNORE INTO promotion_item (promotion_id,item_id) VALUES (?,?)', promo.id, id));
  });

  // Demo staff (PIN Linh 111111, Nam 2222).
  stmts.push(stmt(env, 'INSERT INTO staff (id,outlet_id,name,pin_salt,pin_hash,role,active,max_discount_pct,cash_out_limit,hourly_rate,created_at,updated_at) VALUES (?,?,?,?,?,?,1,20,500000,35000,?,?)', did('ST'), o.id, 'Linh (demo)', 'demo1', await hashPin('111111', 'demo1'), 'manager', t, t));
  stmts.push(stmt(env, 'INSERT INTO staff (id,outlet_id,name,pin_salt,pin_hash,role,active,max_discount_pct,cash_out_limit,hourly_rate,created_at,updated_at) VALUES (?,?,?,?,?,?,1,0,100000,25000,?,?)', did('ST'), o.id, 'Nam (demo)', 'demo2', await hashPin('2222', 'demo2'), 'staff', t, t));

  // Monthly running costs.
  const costs: [string, number, string, string][] = [['rent', 15000000, 'bank', 'Tiền thuê mặt bằng'], ['salary', 7000000, 'bank', 'Lương Linh'], ['salary', 6000000, 'bank', 'Lương Nam'], ['utilities', 2600000, 'bank', 'Điện nước'], ['utilities', 300000, 'bank', 'Internet'], ['marketing', 1500000, 'owner', 'Quảng cáo Facebook']];
  costs.forEach(([cat, amount, source, note], i) => stmts.push(stmt(env,
    'INSERT INTO ledger_entry (id,business_day,direction,category,amount,source,note,staff_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    did('L'), addDays(firstDay, i * 4), 'out', cat, amount, source, note + ' (demo)', c.staff!.id, pAt, pAt)));

  await batch(env, stmts);
  return json({ ok: true, days });
}

async function seedDay(c: Ctx, o: { id: string; tz_offset_min: number; business_day_cutoff: string }, day: string) {
  const env = c.env;
  const tz = o.tz_offset_min;
  const [items, recipes, ings, options, staff, promos, promoItems, done] = await Promise.all([
    all<{ id: string; name_vi: string; price: number; category_id: string }>(env, "SELECT id,name_vi,price,category_id FROM item WHERE id LIKE 'DEMO%' ORDER BY sort"),
    all<{ owner_id: string; owner_type: string; ingredient_id: string; qty_base: number }>(env, "SELECT owner_id,owner_type,ingredient_id,qty_base FROM recipe_line WHERE id LIKE 'DEMO%'"),
    all<{ id: string; avg_cost_per_base: number }>(env, "SELECT id,avg_cost_per_base FROM ingredient WHERE id LIKE 'DEMO%'"),
    all<{ id: string; group_id: string; name_vi: string; price_delta: number; excludes_promo: number; name_en: string }>(env, 'SELECT id,group_id,name_vi,name_en,price_delta,excludes_promo FROM modifier_option WHERE active=1'),
    all<{ id: string; role: string }>(env, "SELECT id,role FROM staff WHERE active=1 ORDER BY CASE WHEN id LIKE 'DEMO%' THEN 0 ELSE 1 END, role"),
    all<Promotion>(env, 'SELECT * FROM promotion'),
    all<PromotionItem>(env, 'SELECT promotion_id,item_id FROM promotion_item'),
    first<{ n: number }>(env, "SELECT COUNT(*) n FROM sale_order WHERE id LIKE 'DEMO%' AND business_day=?", day),
  ]);
  need(items.length, 409, 'Chạy bước tạo menu demo trước');
  if (done?.n) return json({ ok: true, skipped: true });
  const r = rng('dui-' + day);
  const pick = <T,>(arr: T[]) => arr[Math.floor(r() * arr.length)];
  const weights = ITEMS.map((x) => x[5]);
  const wSum = weights.reduce((a, b) => a + b, 0);
  const pickItem = () => { let x = r() * wSum; for (let i = 0; i < items.length; i++) { x -= weights[i] ?? 1; if (x <= 0) return items[i]; } return items[0]; };
  const costOf = new Map(ings.map((i) => [i.id, i.avg_cost_per_base]));
  const opt = (en: string) => options.find((x) => x.name_en === en);
  const sigCat = items[0].category_id;
  const stmts: D1PreparedStatement[] = [];

  // Shared drawer, opened 17:30, closed 01:30.
  const drawerId = did('DR');
  const openAt = at(day, 17, 30, tz);
  const closeAt = at(day, 25, 30, tz);
  const dow = new Date(day + 'T00:00:00Z').getUTCDay();
  const busy = dow === 5 || dow === 6 ? 3 : 0; // Fri/Sat busier
  const n = 10 + Math.floor(r() * 4) + (busy ? 2 : 0); // 10–15
  const workers = staff.slice(0, Math.max(1, Math.min(3, staff.length)));
  let cashSales = 0;
  let cashTips = 0;
  const usage = new Map<string, number>();

  for (let k = 0; k < n; k++) {
    const id = did('O');
    const minute = 18 * 60 + Math.floor(r() * 390); // 18:00–00:30
    const created = at(day, Math.floor(minute / 60), minute % 60, tz);
    const isTab = r() < 0.15;
    const lines: OrderLine[] = [];
    const nLines = 1 + Math.floor(r() * (isTab ? 4 : 3));
    for (let j = 0; j < nLines; j++) {
      const it = pickItem();
      const mods: ChosenOption[] = [];
      const cocktail = it.category_id === sigCat;
      if (cocktail && r() < 0.1) { const m = opt('Mocktail'); if (m) mods.push({ id: m.id, group_id: m.group_id, name: m.name_vi, price_delta: m.price_delta, excludes_promo: m.excludes_promo }); }
      if (cocktail && r() < 0.12) { const m = opt('Less'); if (m) mods.push({ id: m.id, group_id: m.group_id, name: m.name_vi, price_delta: 0, excludes_promo: 0 }); }
      if (cocktail && r() < 0.08) { const m = opt('Extra shot'); if (m) mods.push({ id: m.id, group_id: m.group_id, name: m.name_vi, price_delta: m.price_delta, excludes_promo: 0 }); }
      const qty = r() < 0.35 ? 2 : 1;
      const unit = it.price + mods.reduce((s, m) => s + m.price_delta, 0);
      const comp = r() < 0.04;
      lines.push({ id: did('OL'), item_id: it.id, item_name: it.name_vi, unit_price: unit, qty, modifiers: mods, line_total: unit * qty, note: null, status: 'active', sort: j,
        comp: comp ? 1 : 0, comp_reason: comp ? pick(['Khách quen', 'Bạn chủ quán', 'Xin lỗi khách']) : null, comp_by: comp ? workers[0].id : null, sent_at: created });
    }
    const paidAt = created + (isTab ? 60 + Math.floor(r() * 90) : 2 + Math.floor(r() * 5)) * 60000;
    const totals = computeTotals(lines, promos, promoItems, created, tz);
    const voided = r() < 0.04;
    const staffId = pick(workers).id;
    let cost = 0;
    for (const l of lines) {
      let lc = 0;
      for (const rl of recipes.filter((x) => x.owner_type === 'item' && x.owner_id === l.item_id)) {
        const q = rl.qty_base * l.qty;
        lc += q * (costOf.get(rl.ingredient_id) || 0);
        if (!voided) usage.set(rl.ingredient_id, (usage.get(rl.ingredient_id) || 0) + q);
      }
      cost += lc;
      stmts.push(stmt(env, 'INSERT INTO order_line (id,order_id,item_id,item_name,unit_price,qty,modifiers_json,line_total,line_cost,note,status,sort,comp,comp_reason,comp_by,sent_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        l.id, id, l.item_id, l.item_name, l.unit_price, l.qty, JSON.stringify(l.modifiers), l.line_total, Math.round(lc), null, 'active', l.sort, l.comp, l.comp_reason, l.comp_by, created));
    }
    for (const a of totals.adjustments) stmts.push(stmt(env, 'INSERT INTO order_adjustment (id,order_id,order_line_id,kind,promotion_id,amount,reason) VALUES (?,?,?,?,?,?,?)', did('A'), id, a.order_line_id, a.kind, a.promotion_id, a.amount, a.reason));
    const method = pick(['cash', 'cash', 'vietqr', 'vietqr', 'vietqr', 'card'] as const);
    const tip = !voided && r() < 0.2 ? pick([10000, 20000, 20000, 50000]) : 0;
    let tendered: number | null = null;
    let change = 0;
    if (method === 'cash') {
      const due = totals.total + tip;
      tendered = [due, Math.ceil(due / 50000) * 50000, Math.ceil(due / 100000) * 100000, 500000].filter((v) => v >= due)[Math.floor(r() * 3)] ?? due;
      change = tendered - due;
      if (!voided) { cashSales += totals.total; cashTips += tip; }
    }
    if (totals.total > 0 || tip > 0) {
      stmts.push(stmt(env, 'INSERT INTO payment (id,order_id,drawer_session_id,method,amount,tip,tendered,change_given,reference,status,confirmed_by,confirmed_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        did('PM'), id, drawerId, method, totals.total, tip, tendered, change, method === 'vietqr' ? `DUI X${String(k + 1).padStart(3, '0')}` : null, 'confirmed', staffId, paidAt, paidAt));
    }
    stmts.push(stmt(env, `INSERT INTO sale_order (id,outlet_id,device_id,short_code,business_day,staff_id,drawer_session_id,order_type,customer_label,status,subtotal,promo_total,discount_total,comp_total,tip_total,total,cost_total,stock_applied,sent_at,paid_at,void_reason,voided_by,approved_by,voided_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, o.id, c.device!.id, `X-${String(k + 1).padStart(3, '0')}`, day, staffId, drawerId, isTab ? 'dine_in' : pick(['takeaway', 'takeaway', 'dine_in']), isTab || r() < 0.5 ? pick(NAMES) : null,
      voided ? 'void' : 'paid', totals.subtotal, totals.promo_total, 0, totals.comp_total, voided ? 0 : tip, totals.total, voided ? 0 : Math.round(cost), voided ? 0 : 1,
      created, voided ? null : paidAt, voided ? pick(['Sai món', 'Khách đổi ý']) : null, voided ? staffId : null, voided ? workers[0].id : null, voided ? paidAt : null, created, paidAt));
    if (voided) stmts.push(stmt(env, 'INSERT INTO audit_log (id,outlet_id,device_id,at,actor_id,approver_id,action,entity,entity_id,reason) VALUES (?,?,?,?,?,?,?,?,?,?)', did('AU'), o.id, c.device!.id, paidAt, staffId, workers[0].id, 'void', 'order', id, 'Sai món'));
  }

  // Stock used that day, one movement per ingredient.
  for (const [ing, q] of usage) {
    stmts.push(stmt(env, 'INSERT INTO stock_movement (id,ingredient_id,qty_delta,reason,ref_type,ref_id,unit_cost,business_day,at) VALUES (?,?,?,?,?,?,?,?,?)', did('M'), ing, -q, 'sale', 'demo_day', day, costOf.get(ing) || 0, day, closeAt));
    stmts.push(stmt(env, 'UPDATE ingredient SET stock_base = stock_base - ? WHERE id=?', q, ing));
  }

  // Ice from the drawer, then the drawer closed with a small difference on some days.
  const ice = 50000 + (r() < 0.3 ? 30000 : 0);
  stmts.push(stmt(env, 'INSERT INTO cash_movement (id,drawer_session_id,business_day,direction,amount,reason,note,staff_id,device_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', did('CM'), drawerId, day, 'out', ice, 'ice', 'Mua đá', workers[0].id, c.device!.id, openAt + 1800000, openAt + 1800000));
  const expected = 500000 + cashSales + cashTips - ice;
  const diff = r() < 0.2 ? pick([-20000, -10000, 10000]) : 0;
  stmts.push(stmt(env, `INSERT INTO drawer_session (id,outlet_id,business_day,status,opened_by,opened_at,opening_float,closed_by,closed_at,counted_total,expected_total,difference,note,device_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    drawerId, o.id, day, 'closed', workers[0].id, openAt, 500000, workers[0].id, closeAt, expected + diff, expected, diff, diff ? 'Lệch tiền lẻ (demo)' : null, c.device!.id, openAt, closeAt));
  workers.forEach((w) => stmts.push(stmt(env, 'INSERT INTO staff_shift (id,staff_id,outlet_id,device_id,drawer_session_id,business_day,started_at,ended_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    did('SH'), w.id, o.id, c.device!.id, drawerId, day, openAt, closeAt, openAt, closeAt)));

  // Time clock and planned shifts for the demo staff: 17:00–01:30, sometimes a little late.
  for (const w of workers.filter((x) => x.id.startsWith('DEMO'))) {
    stmts.push(stmt(env, 'INSERT INTO work_schedule (id,staff_id,day,start,end,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', did('WS'), w.id, day, '17:00', '01:30', null, openAt, openAt));
    const late = r() < 0.15 ? 15 + Math.floor(r() * 20) : -Math.floor(r() * 10);
    const inAt = at(day, 17, 0, tz) + late * 60000;
    const outAt = closeAt + Math.floor(r() * 25) * 60000;
    stmts.push(stmt(env, 'INSERT INTO time_entry (id,staff_id,business_day,clock_in,clock_out,break_min,device_id,source,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      did('TE'), w.id, day, inAt, outAt, 30, c.device!.id, 'pos', null, inAt, outAt));
  }

  await batch(env, stmts);
  return json({ ok: true, orders: n });
}

/** Remove every demo row. Real data (ids not starting with DEMO) is never touched. */
export async function clear(c: Ctx) {
  requireRole(c, 'owner');
  const env = c.env;
  const L = "LIKE 'DEMO%'";
  await batch(env, [
    stmt(env, `DELETE FROM order_line WHERE order_id ${L}`),
    stmt(env, `DELETE FROM order_adjustment WHERE order_id ${L}`),
    stmt(env, `DELETE FROM payment WHERE order_id ${L}`),
    stmt(env, `DELETE FROM sale_order WHERE id ${L}`),
    stmt(env, `DELETE FROM cash_movement WHERE id ${L} OR drawer_session_id ${L}`),
    stmt(env, `DELETE FROM staff_shift WHERE id ${L}`),
    stmt(env, `DELETE FROM time_entry WHERE id ${L} OR staff_id ${L}`),
    stmt(env, `DELETE FROM work_schedule WHERE id ${L} OR staff_id ${L}`),
    stmt(env, `DELETE FROM drawer_session WHERE id ${L}`),
    stmt(env, `DELETE FROM stock_movement WHERE id ${L} OR ingredient_id ${L}`),
    stmt(env, `DELETE FROM stocktake_line WHERE ingredient_id ${L}`),
    stmt(env, `DELETE FROM purchase_line WHERE purchase_id ${L} OR ingredient_id ${L}`),
    stmt(env, `DELETE FROM purchase WHERE id ${L}`),
    stmt(env, `DELETE FROM recipe_line WHERE id ${L} OR owner_id ${L} OR ingredient_id ${L}`),
    stmt(env, `DELETE FROM ingredient WHERE id ${L}`),
    stmt(env, `DELETE FROM supplier WHERE id ${L}`),
    stmt(env, `DELETE FROM promotion_item WHERE item_id ${L}`),
    stmt(env, `DELETE FROM item_modifier_group WHERE item_id ${L}`),
    stmt(env, `DELETE FROM item_price_history WHERE item_id ${L}`),
    stmt(env, `DELETE FROM item WHERE id ${L}`),
    stmt(env, `DELETE FROM category WHERE id ${L}`),
    stmt(env, `DELETE FROM ledger_entry WHERE id ${L}`),
    stmt(env, `DELETE FROM staff_session WHERE staff_id ${L}`),
    stmt(env, `DELETE FROM staff WHERE id ${L}`),
    stmt(env, `DELETE FROM audit_log WHERE id ${L} OR entity_id ${L}`),
  ]);
  return json({ ok: true });
}

// Inventory: ingredients, recipes, purchases, stocktakes, batch production, costing.
import { businessDay, parseSettings, ulid } from '../shared/util';
import { all, auditStmt, batch, body, type Ctx, type Env, first, json, need, now, requireRole, stmt } from './http';

interface Ingredient {
  id: string; name: string; kind: 'raw' | 'prepared'; base_unit: string; purchase_unit: string; base_per_purchase: number;
  yield_pct: number; avg_cost_per_base: number; stock_base: number; min_stock_base: number; recipe_yield_base: number;
  default_supplier_id: string | null; active: number;
}
interface RecipeLine { id: string; owner_type: string; owner_id: string; ingredient_id: string; qty_base: number; sort: number }

async function outlet(env: Env) {
  return (await first<{ id: string; tz_offset_min: number; business_day_cutoff: string; settings_json: string }>(env, 'SELECT id,tz_offset_min,business_day_cutoff,settings_json FROM outlet LIMIT 1'))!;
}

/** Cost per base unit. A prepared ingredient with a recipe costs what its components cost. */
function makeCoster(ings: Ingredient[], recipes: RecipeLine[]) {
  const byId = new Map(ings.map((i) => [i.id, i]));
  const memo = new Map<string, number>();
  const cost = (id: string, depth = 0): number => {
    if (memo.has(id)) return memo.get(id)!;
    const ing = byId.get(id);
    if (!ing) return 0;
    let v = ing.avg_cost_per_base;
    if (ing.kind === 'prepared' && depth < 5) {
      const lines = recipes.filter((r) => r.owner_type === 'ingredient' && r.owner_id === id);
      if (lines.length && ing.recipe_yield_base > 0) {
        v = lines.reduce((s, r) => s + r.qty_base * cost(r.ingredient_id, depth + 1), 0) / ing.recipe_yield_base;
      }
    }
    memo.set(id, v);
    return v;
  };
  return cost;
}

export async function listIngredients(c: Ctx) {
  requireRole(c, 'owner', 'manager');
  const [ings, recipes] = await Promise.all([
    all<Ingredient>(c.env, 'SELECT * FROM ingredient ORDER BY active DESC, name'),
    all<RecipeLine>(c.env, "SELECT * FROM recipe_line WHERE owner_type='ingredient'"),
  ]);
  const cost = makeCoster(ings, recipes);
  return json(ings.map((i) => ({
    ...i,
    cost_per_base: cost(i.id),
    stock_value: Math.round(Math.max(0, i.stock_base) * cost(i.id)),
    low: i.active === 1 && i.min_stock_base > 0 && i.stock_base < i.min_stock_base,
  })));
}

export async function getRecipe(c: Ctx) {
  requireRole(c, 'owner', 'manager');
  return json(await all(c.env, 'SELECT r.*, i.name ingredient_name, i.base_unit FROM recipe_line r JOIN ingredient i ON i.id=r.ingredient_id WHERE r.owner_type=? AND r.owner_id=? ORDER BY r.sort', c.params.type, c.params.id));
}

export async function setRecipe(c: Ctx) {
  requireRole(c, 'owner', 'manager');
  const { type, id } = c.params;
  need(['item', 'modifier_option', 'ingredient'].includes(type), 400, 'Loại công thức không hợp lệ');
  const b = await body<{ lines: { ingredient_id: string; qty_base: number }[] }>(c);
  if (type === 'ingredient') need(!b.lines.some((l) => l.ingredient_id === id), 400, 'Công thức không thể chứa chính nó');
  const before = await all(c.env, 'SELECT ingredient_id, qty_base FROM recipe_line WHERE owner_type=? AND owner_id=?', type, id);
  await batch(c.env, [
    stmt(c.env, 'DELETE FROM recipe_line WHERE owner_type=? AND owner_id=?', type, id),
    ...b.lines.filter((l) => l.ingredient_id && Number(l.qty_base)).map((l, i) =>
      stmt(c.env, 'INSERT INTO recipe_line (id,owner_type,owner_id,ingredient_id,qty_base,sort) VALUES (?,?,?,?,?,?)', ulid(), type, id, l.ingredient_id, Number(l.qty_base), i)),
    auditStmt(c.env, { action: 'recipe_change', entity: type, entity_id: id, actor_id: c.staff!.id, device_id: c.device!.id, before, after: b.lines }, ulid()),
  ]);
  return json({ ok: true });
}

// ----- purchases -----

interface PurchaseIn {
  supplier_id?: string | null;
  supplier_name?: string;
  payment_source: 'drawer' | 'bank' | 'supplier_debt' | 'owner';
  photo_key?: string | null;
  note?: string;
  lines: { ingredient_id: string; qty_purchase_units: number; unit_price: number }[];
}

export async function createPurchase(c: Ctx) {
  requireRole(c, 'owner', 'manager');
  const b = await body<PurchaseIn>(c);
  need(b.lines?.length, 400, 'Phiếu nhập cần ít nhất một dòng');
  need(['drawer', 'bank', 'supplier_debt', 'owner'].includes(b.payment_source), 400, 'Nguồn tiền không hợp lệ');
  const env = c.env;
  const o = await outlet(env);
  const t = now();
  const day = businessDay(t, o.tz_offset_min, o.business_day_cutoff);
  const stmts: D1PreparedStatement[] = [];
  let supplierId = b.supplier_id || null;
  if (!supplierId && b.supplier_name?.trim()) {
    supplierId = ulid();
    stmts.push(stmt(env, 'INSERT INTO supplier (id,name,active,created_at,updated_at) VALUES (?,?,1,?,?)', supplierId, b.supplier_name.trim(), t, t));
  }
  const ids = [...new Set(b.lines.map((l) => l.ingredient_id))];
  const ings = await all<Ingredient>(env, `SELECT * FROM ingredient WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
  const byId = new Map(ings.map((i) => [i.id, { ...i }]));
  const purchaseId = ulid();
  let total = 0;
  for (const l of b.lines) {
    const ing = byId.get(l.ingredient_id);
    need(ing, 400, 'Nguyên liệu không tồn tại');
    const qtyUnits = Number(l.qty_purchase_units);
    const unitPrice = Math.round(Number(l.unit_price));
    need(qtyUnits > 0 && unitPrice >= 0, 400, `Số lượng/đơn giá không hợp lệ: ${ing.name}`);
    const lineTotal = Math.round(qtyUnits * unitPrice);
    const qtyBase = qtyUnits * ing.base_per_purchase * (ing.yield_pct / 100);
    total += lineTotal;
    // Weighted-average cost: (stock × old cost + purchase value) ÷ (stock + purchased qty)
    const oldStock = Math.max(0, ing.stock_base);
    const newAvg = qtyBase > 0 ? (oldStock * ing.avg_cost_per_base + lineTotal) / (oldStock + qtyBase) : ing.avg_cost_per_base;
    ing.stock_base += qtyBase;
    ing.avg_cost_per_base = newAvg;
    stmts.push(stmt(env, 'INSERT INTO purchase_line (id,purchase_id,ingredient_id,qty_purchase_units,unit_price,line_total,qty_base) VALUES (?,?,?,?,?,?,?)', ulid(), purchaseId, ing.id, qtyUnits, unitPrice, lineTotal, qtyBase));
    stmts.push(stmt(env, 'INSERT INTO stock_movement (id,ingredient_id,qty_delta,reason,ref_type,ref_id,unit_cost,business_day,at) VALUES (?,?,?,?,?,?,?,?,?)', ulid(), ing.id, qtyBase, 'purchase', 'purchase', purchaseId, qtyBase ? lineTotal / qtyBase : 0, day, t));
  }
  for (const ing of byId.values()) {
    stmts.push(stmt(env, 'UPDATE ingredient SET stock_base=?, avg_cost_per_base=?, updated_at=? WHERE id=?', ing.stock_base, ing.avg_cost_per_base, t, ing.id));
    if (supplierId && !ing.default_supplier_id) stmts.push(stmt(env, 'UPDATE ingredient SET default_supplier_id=? WHERE id=?', supplierId, ing.id));
  }
  // Money out: from the drawer it becomes a cash movement of the open drawer; otherwise a ledger entry.
  let cashMovementId: string | null = null;
  if (b.payment_source === 'drawer') {
    const drawer = await first<{ id: string; business_day: string }>(env, "SELECT id,business_day FROM drawer_session WHERE status='open' ORDER BY opened_at DESC LIMIT 1");
    need(drawer, 409, 'Không có két đang mở — chọn nguồn tiền khác');
    cashMovementId = ulid();
    stmts.push(stmt(env, 'INSERT INTO cash_movement (id,drawer_session_id,business_day,direction,amount,reason,note,photo_key,purchase_id,staff_id,device_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      cashMovementId, drawer.id, drawer.business_day, 'out', total, 'purchase', b.note || 'Nhập hàng', b.photo_key || null, purchaseId, c.staff!.id, c.device!.id, t, t));
  } else {
    stmts.push(stmt(env, 'INSERT INTO ledger_entry (id,business_day,direction,category,amount,source,note,photo_key,ref_type,ref_id,staff_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      ulid(), day, 'out', 'purchase', total, b.payment_source, b.note || 'Nhập hàng', b.photo_key || null, 'purchase', purchaseId, c.staff!.id, t, t));
  }
  stmts.unshift(stmt(env, 'INSERT INTO purchase (id,supplier_id,business_day,payment_source,total,photo_key,note,cash_movement_id,staff_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    purchaseId, supplierId, day, b.payment_source, total, b.photo_key || null, b.note || null, cashMovementId, c.staff!.id, t, t));
  stmts.push(auditStmt(env, { action: 'purchase', entity: 'purchase', entity_id: purchaseId, actor_id: c.staff!.id, device_id: c.device!.id, after: { total, lines: b.lines.length, source: b.payment_source } }, ulid()));
  await batch(env, stmts);
  return json({ id: purchaseId, total }, 201);
}

export async function listPurchases(c: Ctx) {
  requireRole(c, 'owner', 'manager');
  const rows = await all<any>(c.env, 'SELECT p.*, s.name supplier_name, st.name staff_name FROM purchase p LEFT JOIN supplier s ON s.id=p.supplier_id LEFT JOIN staff st ON st.id=p.staff_id ORDER BY p.created_at DESC LIMIT 100');
  if (!rows.length) return json([]);
  const lines = await all<any>(c.env, 'SELECT pl.*, i.name ingredient_name, i.purchase_unit FROM purchase_line pl JOIN ingredient i ON i.id=pl.ingredient_id WHERE pl.purchase_id IN (SELECT id FROM purchase ORDER BY created_at DESC LIMIT 100)');
  return json(rows.map((r) => ({ ...r, lines: lines.filter((l) => l.purchase_id === r.id) })));
}

/** Low-stock ingredients grouped by supplier, with a suggested quantity back up to 2× the minimum. */
export async function shoppingList(c: Ctx) {
  requireRole(c, 'owner', 'manager');
  const rows = await all<Ingredient & { supplier_name: string | null }>(c.env,
    'SELECT i.*, s.name supplier_name FROM ingredient i LEFT JOIN supplier s ON s.id=i.default_supplier_id WHERE i.active=1 AND i.min_stock_base > 0 AND i.stock_base < i.min_stock_base ORDER BY s.name, i.name');
  const groups = new Map<string, any[]>();
  for (const r of rows) {
    const perUnit = r.base_per_purchase * (r.yield_pct / 100) || 1;
    const suggest = Math.max(1, Math.ceil((r.min_stock_base * 2 - r.stock_base) / perUnit));
    const key = r.supplier_name || 'Chưa có nhà cung cấp';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ id: r.id, name: r.name, stock_base: r.stock_base, min_stock_base: r.min_stock_base, base_unit: r.base_unit, purchase_unit: r.purchase_unit, suggest_units: suggest });
  }
  return json([...groups.entries()].map(([supplier, items]) => ({ supplier, items })));
}

// ----- stocktake -----

export async function createStocktake(c: Ctx) {
  requireRole(c, 'owner', 'manager');
  const b = await body<{ note?: string; lines: { ingredient_id: string; counted_base: number }[] }>(c);
  need(b.lines?.length, 400, 'Chưa nhập số đếm nào');
  const env = c.env;
  const o = await outlet(env);
  const t = now();
  const day = businessDay(t, o.tz_offset_min, o.business_day_cutoff);
  const [ings, recipes] = await Promise.all([all<Ingredient>(env, 'SELECT * FROM ingredient'), all<RecipeLine>(env, "SELECT * FROM recipe_line WHERE owner_type='ingredient'")]);
  const cost = makeCoster(ings, recipes);
  const byId = new Map(ings.map((i) => [i.id, i]));
  const id = ulid();
  const stmts: D1PreparedStatement[] = [];
  let varianceValue = 0;
  const out: any[] = [];
  for (const l of b.lines) {
    const ing = byId.get(l.ingredient_id);
    need(ing, 400, 'Nguyên liệu không tồn tại');
    const counted = Number(l.counted_base);
    need(counted >= 0, 400, `Số đếm không hợp lệ: ${ing.name}`);
    const variance = counted - ing.stock_base;
    const value = Math.round(variance * cost(ing.id));
    varianceValue += value;
    out.push({ ingredient_id: ing.id, name: ing.name, base_unit: ing.base_unit, theoretical_base: ing.stock_base, counted_base: counted, variance_base: variance, variance_value: value });
    stmts.push(stmt(env, 'INSERT INTO stocktake_line (id,stocktake_id,ingredient_id,counted_base,theoretical_base,variance_base,variance_value) VALUES (?,?,?,?,?,?,?)', ulid(), id, ing.id, counted, ing.stock_base, variance, value));
    if (variance !== 0) {
      stmts.push(stmt(env, 'INSERT INTO stock_movement (id,ingredient_id,qty_delta,reason,ref_type,ref_id,unit_cost,business_day,at) VALUES (?,?,?,?,?,?,?,?,?)', ulid(), ing.id, variance, 'count', 'stocktake', id, cost(ing.id), day, t));
      stmts.push(stmt(env, 'UPDATE ingredient SET stock_base=?, updated_at=? WHERE id=?', counted, t, ing.id));
    }
  }
  stmts.unshift(stmt(env, 'INSERT INTO stocktake (id,business_day,staff_id,note,variance_value,created_at) VALUES (?,?,?,?,?,?)', id, day, c.staff!.id, b.note || null, varianceValue, t));
  stmts.push(auditStmt(env, { action: 'stocktake', entity: 'stocktake', entity_id: id, actor_id: c.staff!.id, device_id: c.device!.id, after: { lines: b.lines.length, variance_value: varianceValue } }, ulid()));
  await batch(env, stmts);
  return json({ id, business_day: day, variance_value: varianceValue, lines: out }, 201);
}

export async function listStocktakes(c: Ctx) {
  requireRole(c, 'owner', 'manager');
  return json(await all(c.env, 'SELECT s.*, st.name staff_name FROM stocktake s LEFT JOIN staff st ON st.id=s.staff_id ORDER BY s.created_at DESC LIMIT 50'));
}

export async function getStocktake(c: Ctx) {
  requireRole(c, 'owner', 'manager');
  const head = await first(c.env, 'SELECT * FROM stocktake WHERE id=?', c.params.id);
  need(head, 404, 'Không tìm thấy');
  const lines = await all(c.env, 'SELECT l.*, i.name, i.base_unit FROM stocktake_line l JOIN ingredient i ON i.id=l.ingredient_id WHERE l.stocktake_id=? ORDER BY l.variance_value', c.params.id);
  return json({ ...head, lines });
}

// ----- batch production (syrups, house spirits) -----

export async function produceBatch(c: Ctx) {
  requireRole(c, 'owner', 'manager');
  const b = await body<{ ingredient_id: string; qty_base: number }>(c);
  const env = c.env;
  const [ings, recipes] = await Promise.all([all<Ingredient>(env, 'SELECT * FROM ingredient'), all<RecipeLine>(env, "SELECT * FROM recipe_line WHERE owner_type='ingredient'")]);
  const target = ings.find((i) => i.id === b.ingredient_id);
  need(target && target.kind === 'prepared', 400, 'Chỉ pha mẻ cho nguyên liệu bán thành phẩm');
  const qty = Number(b.qty_base);
  need(qty > 0, 400, 'Số lượng không hợp lệ');
  const lines = recipes.filter((r) => r.owner_id === target.id);
  need(lines.length, 400, 'Nguyên liệu này chưa có công thức');
  const cost = makeCoster(ings, recipes);
  const o = await outlet(env);
  const t = now();
  const day = businessDay(t, o.tz_offset_min, o.business_day_cutoff);
  const factor = qty / (target.recipe_yield_base || 1000);
  const id = ulid();
  let batchCost = 0;
  const stmts: D1PreparedStatement[] = [];
  for (const r of lines) {
    const use = r.qty_base * factor;
    const uc = cost(r.ingredient_id);
    batchCost += use * uc;
    stmts.push(stmt(env, 'INSERT INTO stock_movement (id,ingredient_id,qty_delta,reason,ref_type,ref_id,unit_cost,business_day,at) VALUES (?,?,?,?,?,?,?,?,?)', ulid(), r.ingredient_id, -use, 'batch', 'batch', id, uc, day, t));
    stmts.push(stmt(env, 'UPDATE ingredient SET stock_base = stock_base - ?, updated_at=? WHERE id=?', use, t, r.ingredient_id));
  }
  const oldStock = Math.max(0, target.stock_base);
  const newAvg = (oldStock * target.avg_cost_per_base + batchCost) / (oldStock + qty);
  stmts.push(stmt(env, 'INSERT INTO stock_movement (id,ingredient_id,qty_delta,reason,ref_type,ref_id,unit_cost,business_day,at) VALUES (?,?,?,?,?,?,?,?,?)', ulid(), target.id, qty, 'batch', 'batch', id, batchCost / qty, day, t));
  stmts.push(stmt(env, 'UPDATE ingredient SET stock_base = stock_base + ?, avg_cost_per_base=?, updated_at=? WHERE id=?', qty, newAvg, t, target.id));
  stmts.push(auditStmt(env, { action: 'batch', entity: 'ingredient', entity_id: target.id, actor_id: c.staff!.id, device_id: c.device!.id, after: { qty_base: qty, cost: Math.round(batchCost) } }, ulid()));
  await batch(env, stmts);
  return json({ id, cost: Math.round(batchCost) }, 201);
}

// ----- costing -----

async function costingData(env: Env, bump?: { ingredient_id: string; pct: number }) {
  const [ings, recipes, items, options, promoItems] = await Promise.all([
    all<Ingredient>(env, 'SELECT * FROM ingredient'),
    all<RecipeLine>(env, 'SELECT * FROM recipe_line'),
    all<{ id: string; name_vi: string; price: number; category_id: string; active: number }>(env, 'SELECT id,name_vi,price,category_id,active FROM item WHERE active=1 ORDER BY sort, name_vi'),
    all<{ id: string; name_vi: string; price_delta: number; group_id: string }>(env, 'SELECT id,name_vi,price_delta,group_id FROM modifier_option WHERE active=1'),
    all<{ item_id: string }>(env, "SELECT pi.item_id FROM promotion_item pi JOIN promotion p ON p.id=pi.promotion_id WHERE p.active=1 AND p.type='bogo'"),
  ]);
  if (bump) {
    const ing = ings.find((i) => i.id === bump.ingredient_id);
    if (ing) ing.avg_cost_per_base *= 1 + bump.pct / 100;
  }
  const cost = makeCoster(ings, recipes);
  const bogo = new Set(promoItems.map((p) => p.item_id));
  const ownerCost = (type: string, id: string) =>
    recipes.filter((r) => r.owner_type === type && r.owner_id === id).reduce((s, r) => s + r.qty_base * cost(r.ingredient_id), 0);
  const usesIng = (type: string, id: string, ingId: string): boolean => {
    for (const r of recipes.filter((x) => x.owner_type === type && x.owner_id === id)) {
      if (r.ingredient_id === ingId) return true;
      if (usesIng('ingredient', r.ingredient_id, ingId)) return true;
    }
    return false;
  };
  const rows = items.map((it) => {
    const c = ownerCost('item', it.id);
    const hasRecipe = recipes.some((r) => r.owner_type === 'item' && r.owner_id === it.id);
    return {
      id: it.id, name: it.name_vi, price: it.price, category_id: it.category_id, has_recipe: hasRecipe,
      cost: Math.round(c),
      cost_pct: it.price ? (c / it.price) * 100 : 0,
      margin: Math.round(it.price - c),
      bogo: bogo.has(it.id),
      bogo_cost_pct: bogo.has(it.id) && it.price ? ((2 * c) / it.price) * 100 : null,
      uses: (ingId: string) => usesIng('item', it.id, ingId),
    };
  });
  const opts = options.map((o) => ({ id: o.id, name: o.name_vi, price_delta: o.price_delta, cost_delta: Math.round(ownerCost('modifier_option', o.id)) }));
  return { rows, opts };
}

export async function costing(c: Ctx) {
  requireRole(c, 'owner', 'manager');
  const o = await outlet(c.env);
  const threshold = parseSettings<{ cost_alert_pct?: number }>(o.settings_json).cost_alert_pct ?? 30;
  const { rows, opts } = await costingData(c.env);
  return json({ threshold, items: rows.map(({ uses, ...r }) => ({ ...r, over: r.cost_pct > threshold })), options: opts });
}

/** "If vodka goes up 10%": which items change and by how much. */
export async function simulate(c: Ctx) {
  requireRole(c, 'owner', 'manager');
  const b = await body<{ ingredient_id: string; pct: number }>(c);
  const o = await outlet(c.env);
  const threshold = parseSettings<{ cost_alert_pct?: number }>(o.settings_json).cost_alert_pct ?? 30;
  const base = await costingData(c.env);
  const bumped = await costingData(c.env, { ingredient_id: b.ingredient_id, pct: Number(b.pct) || 0 });
  const affected = base.rows
    .filter((r) => r.uses(b.ingredient_id))
    .map((r) => {
      const n = bumped.rows.find((x) => x.id === r.id)!;
      return { id: r.id, name: r.name, price: r.price, cost_before: r.cost, cost_after: n.cost, pct_before: r.cost_pct, pct_after: n.cost_pct, over: n.cost_pct > threshold };
    });
  const avgDelta = affected.length ? affected.reduce((s, a) => s + (a.pct_after - a.pct_before), 0) / affected.length : 0;
  return json({ threshold, affected_count: affected.length, avg_cost_pct_delta: avgDelta, affected });
}

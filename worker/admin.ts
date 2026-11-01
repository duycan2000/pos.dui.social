// Back-office CRUD: menu, modifiers, promotions, staff, outlet settings, media, audit log.
import { hashPin, normalizeLogin, passwordRule, pinRule, randomHex, validLogin, validPassword, validPin } from '../shared/crypto';
import type { Role } from '../shared/types';
import { ulid } from '../shared/util';
import { all, auditStmt, batch, body, type Ctx, first, HttpError, json, need, now, requireRole, stmt } from './http';

interface TableDef { cols: string[]; roles: Role[]; order: string; soft: boolean }

const TABLES: Record<string, TableDef> = {
  category: { cols: ['name_en', 'name_vi', 'sort', 'active'], roles: ['owner', 'manager'], order: 'sort', soft: true },
  item: { cols: ['category_id', 'name_en', 'name_vi', 'desc_en', 'desc_vi', 'price', 'image_key', 'active', 'sold_out', 'show_on_web', 'sort'], roles: ['owner', 'manager'], order: 'sort, name_vi', soft: true },
  modifier_group: { cols: ['name_en', 'name_vi', 'selection', 'required', 'sort'], roles: ['owner', 'manager'], order: 'sort', soft: false },
  modifier_option: { cols: ['group_id', 'name_en', 'name_vi', 'price_delta', 'is_default', 'excludes_promo', 'sort', 'active'], roles: ['owner', 'manager'], order: 'sort', soft: true },
  promotion: { cols: ['name', 'type', 'active', 'start_date', 'end_date', 'days_of_week', 'time_from', 'time_to', 'rule_json'], roles: ['owner'], order: 'name', soft: true },
  supplier: { cols: ['name', 'phone', 'note', 'active'], roles: ['owner', 'manager'], order: 'name', soft: true },
  dining_table: { cols: ['area', 'name', 'seats', 'x', 'y', 'w', 'h', 'shape', 'sort', 'active'], roles: ['owner'], order: 'area, sort, name', soft: true },
  ingredient: { cols: ['name', 'kind', 'base_unit', 'purchase_unit', 'base_per_purchase', 'yield_pct', 'avg_cost_per_base', 'min_stock_base', 'recipe_yield_base', 'default_supplier_id', 'active'], roles: ['owner', 'manager'], order: 'name', soft: true },
};

function def(c: Ctx): TableDef {
  const d = TABLES[c.params.table];
  need(d, 404, 'Bảng không tồn tại');
  requireRole(c, ...d.roles);
  return d;
}

function pick(row: Record<string, unknown>, cols: string[]) {
  const out: Record<string, unknown> = {};
  for (const k of cols) if (k in row) out[k] = typeof row[k] === 'boolean' ? (row[k] ? 1 : 0) : row[k];
  return out;
}

export async function list(c: Ctx) {
  const d = def(c);
  return json(await all(c.env, `SELECT * FROM ${c.params.table} ORDER BY ${d.order}`));
}

export async function create(c: Ctx) {
  const d = def(c);
  const table = c.params.table;
  const data = pick(await body(c), d.cols);
  if (table === 'item') need(c.staff!.role === 'owner' || !data.price, 403, 'Chỉ chủ quán được đặt giá');
  if (table === 'modifier_option') need(c.staff!.role === 'owner' || !data.price_delta, 403, 'Chỉ chủ quán được đặt giá');
  const id = ulid();
  const t = now();
  const keys = Object.keys(data);
  await batch(c.env, [
    stmt(c.env, `INSERT INTO ${table} (id,${keys.join(',')},created_at,updated_at) VALUES (?,${keys.map(() => '?').join(',')},?,?)`, id, ...keys.map((k) => data[k]), t, t),
    auditStmt(c.env, { action: 'create', entity: table, entity_id: id, actor_id: c.staff!.id, device_id: c.device!.id, after: data }, ulid()),
  ]);
  return json(await first(c.env, `SELECT * FROM ${table} WHERE id=?`, id), 201);
}

export async function update(c: Ctx) {
  const d = def(c);
  const table = c.params.table;
  const before = await first<Record<string, unknown>>(c.env, `SELECT * FROM ${table} WHERE id=?`, c.params.id);
  need(before, 404, 'Không tìm thấy');
  const data = pick(await body(c), d.cols);
  const stmts: D1PreparedStatement[] = [];
  if (table === 'item' && 'price' in data && data.price !== before.price) {
    need(c.staff!.role === 'owner', 403, 'Chỉ chủ quán được sửa giá');
    stmts.push(stmt(c.env, 'INSERT INTO item_price_history (id,item_id,old_price,new_price,staff_id,at) VALUES (?,?,?,?,?,?)', ulid(), before.id, before.price, data.price, c.staff!.id, now()));
    stmts.push(auditStmt(c.env, { action: 'price_change', entity: 'item', entity_id: String(before.id), actor_id: c.staff!.id, device_id: c.device!.id, before: { price: before.price }, after: { price: data.price } }, ulid()));
  }
  if (table === 'modifier_option' && 'price_delta' in data && data.price_delta !== before.price_delta) {
    need(c.staff!.role === 'owner', 403, 'Chỉ chủ quán được sửa giá');
    stmts.push(auditStmt(c.env, { action: 'price_change', entity: 'modifier_option', entity_id: String(before.id), actor_id: c.staff!.id, device_id: c.device!.id, before: { price_delta: before.price_delta }, after: { price_delta: data.price_delta } }, ulid()));
  }
  const keys = Object.keys(data);
  need(keys.length, 400, 'Không có gì để cập nhật');
  stmts.push(stmt(c.env, `UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(',')}, updated_at=? WHERE id=?`, ...keys.map((k) => data[k]), now(), c.params.id));
  if (table !== 'item' || keys.some((k) => k !== 'sold_out')) {
    stmts.push(auditStmt(c.env, { action: 'update', entity: table, entity_id: c.params.id, actor_id: c.staff!.id, device_id: c.device!.id, before: pick(before, keys), after: data }, ulid()));
  }
  await batch(c.env, stmts);
  return json(await first(c.env, `SELECT * FROM ${table} WHERE id=?`, c.params.id));
}

export async function remove(c: Ctx) {
  const d = def(c);
  const table = c.params.table;
  if (table === 'dining_table') {
    const busy = await first<{ n: number }>(c.env, "SELECT COUNT(*) n FROM sale_order WHERE table_id=? AND status IN ('open','awaiting_payment')", c.params.id);
    need(!busy?.n, 409, 'Bàn đang có khách. Thanh toán hoặc chuyển bàn trước khi xoá.');
  }
  if (d.soft) {
    await batch(c.env, [
      stmt(c.env, `UPDATE ${table} SET active=0, updated_at=? WHERE id=?`, now(), c.params.id),
      auditStmt(c.env, { action: 'deactivate', entity: table, entity_id: c.params.id, actor_id: c.staff!.id, device_id: c.device!.id }, ulid()),
    ]);
  } else {
    const used = await first<{ n: number }>(c.env, 'SELECT COUNT(*) n FROM modifier_option WHERE group_id=? AND active=1', c.params.id);
    need(!used?.n, 409, 'Hãy tắt hết lựa chọn trong nhóm trước');
    await batch(c.env, [
      stmt(c.env, `DELETE FROM ${table} WHERE id=?`, c.params.id),
      stmt(c.env, 'DELETE FROM item_modifier_group WHERE group_id=?', c.params.id),
      auditStmt(c.env, { action: 'delete', entity: table, entity_id: c.params.id, actor_id: c.staff!.id, device_id: c.device!.id }, ulid()),
    ]);
  }
  return json({ ok: true });
}

// ----- links -----

export async function getItemGroups(c: Ctx) {
  requireRole(c, 'owner', 'manager');
  return json(await all(c.env, 'SELECT group_id FROM item_modifier_group WHERE item_id=? ORDER BY sort', c.params.id));
}

export async function setItemGroups(c: Ctx) {
  requireRole(c, 'owner', 'manager');
  const b = await body<{ groupIds: string[] }>(c);
  await batch(c.env, [
    stmt(c.env, 'DELETE FROM item_modifier_group WHERE item_id=?', c.params.id),
    ...(b.groupIds || []).map((g, i) => stmt(c.env, 'INSERT INTO item_modifier_group (item_id,group_id,sort) VALUES (?,?,?)', c.params.id, g, i)),
    stmt(c.env, 'UPDATE item SET updated_at=? WHERE id=?', now(), c.params.id),
  ]);
  return json({ ok: true });
}

export async function getPromoItems(c: Ctx) {
  requireRole(c, 'owner', 'manager');
  return json(await all(c.env, 'SELECT item_id FROM promotion_item WHERE promotion_id=?', c.params.id));
}

export async function setPromoItems(c: Ctx) {
  requireRole(c, 'owner');
  const b = await body<{ itemIds: string[] }>(c);
  await batch(c.env, [
    stmt(c.env, 'DELETE FROM promotion_item WHERE promotion_id=?', c.params.id),
    ...(b.itemIds || []).map((it) => stmt(c.env, 'INSERT INTO promotion_item (promotion_id,item_id) VALUES (?,?)', c.params.id, it)),
    stmt(c.env, 'UPDATE promotion SET updated_at=? WHERE id=?', now(), c.params.id),
    auditStmt(c.env, { action: 'promo_items', entity: 'promotion', entity_id: c.params.id, actor_id: c.staff!.id, device_id: c.device!.id, after: b.itemIds }, ulid()),
  ]);
  return json({ ok: true });
}

// ----- staff -----

const STAFF_SAFE = 'id,name,role,active,max_discount_pct,cash_out_limit,created_at,updated_at';
/** The owner also sees pay rates. */
const staffCols = (c: Ctx) => (c.staff?.role === 'owner' ? STAFF_SAFE + ',hourly_rate,login,(pw_hash IS NOT NULL) AS has_password' : STAFF_SAFE + ',(pw_hash IS NOT NULL) AS has_password');

export async function listStaff(c: Ctx) {
  requireRole(c, 'owner', 'manager');
  return json(await all(c.env, `SELECT ${staffCols(c)} FROM staff WHERE deleted_at IS NULL ORDER BY active DESC, role, name`));
}

export async function saveStaff(c: Ctx) {
  requireRole(c, 'owner');
  const b = await body<{ name?: string; role?: Role; pin?: string; active?: number; max_discount_pct?: number; cash_out_limit?: number; hourly_rate?: number; login?: string | null; password?: string }>(c);
  if (b.hourly_rate !== undefined) need(Number.isInteger(b.hourly_rate) && b.hourly_rate >= 0 && b.hourly_rate <= 10_000_000, 400, 'Lương giờ không hợp lệ');
  const id = c.params.id || ulid();
  const existing = c.params.id ? await first<{ role: Role; active: number }>(c.env, 'SELECT role,active FROM staff WHERE id=? AND deleted_at IS NULL', id) : null;
  if (c.params.id) need(existing, 404, 'Không tìm thấy nhân viên');
  if (b.role) need(['owner', 'manager', 'staff'].includes(b.role), 400, 'Vai trò không hợp lệ');
  if (existing?.role === 'owner' && ((b.role && b.role !== 'owner') || b.active === 0)) {
    const owners = await first<{ n: number }>(c.env, "SELECT COUNT(*) n FROM staff WHERE role='owner' AND active=1");
    need((owners?.n || 0) > 1, 409, 'Phải còn ít nhất một chủ quán');
  }
  const t = now();
  const stmts: D1PreparedStatement[] = [];
  if (!existing) {
    need(b.name?.trim() && b.role, 400, 'Thiếu tên hoặc vai trò');
    need(b.pin && validPin(b.pin, b.role), 400, pinRule(b.role!));
    const salt = randomHex(8);
    const outlet = await first<{ id: string }>(c.env, 'SELECT id FROM outlet LIMIT 1');
    stmts.push(stmt(c.env, 'INSERT INTO staff (id,outlet_id,name,pin_salt,pin_hash,role,active,max_discount_pct,cash_out_limit,hourly_rate,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?,?,?,?)',
      id, outlet!.id, b.name!.trim(), salt, await hashPin(b.pin, salt), b.role, b.max_discount_pct ?? 0, b.cash_out_limit ?? 100000, b.hourly_rate ?? 0, t, t));
  } else {
    if (b.role && b.role !== 'staff' && existing.role === 'staff') need(b.pin, 400, 'Đổi lên quản lý cần đặt PIN mới 6 chữ số');
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const k of ['name', 'role', 'active', 'max_discount_pct', 'cash_out_limit', 'hourly_rate'] as const) {
      if (b[k] !== undefined) { sets.push(`${k}=?`); vals.push(b[k]); }
    }
    if (b.pin) {
      need(validPin(b.pin, b.role ?? existing.role), 400, pinRule(b.role ?? existing.role));
      const salt = randomHex(8);
      sets.push('pin_salt=?', 'pin_hash=?');
      vals.push(salt, await hashPin(b.pin, salt));
      stmts.push(stmt(c.env, 'DELETE FROM staff_session WHERE staff_id=?', id));
    }
    need(sets.length || b.login !== undefined || b.password, 400, 'Không có gì để cập nhật');
    stmts.push(stmt(c.env, `UPDATE staff SET ${[...sets, 'updated_at=?'].join(',')} WHERE id=?`, ...vals, t, id));
  }
  // Login + password (owner/manager only; staff sign in with their PIN on registered devices).
  const role = b.role ?? existing?.role;
  if (role === 'staff' && !b.password && !b.login) b.login = undefined; // nothing to set for a PIN-only staff member
  if (b.login !== undefined || b.password) {
    need(role !== 'staff', 400, 'Chỉ chủ quán và quản lý có tài khoản đăng nhập');
    if (b.login !== undefined && b.login !== null && b.login !== '') {
      need(validLogin(b.login), 400, 'Email hoặc tên đăng nhập không hợp lệ (3–64 ký tự, không dấu, không khoảng trắng)');
      const taken = await first(c.env, 'SELECT id FROM staff WHERE login=? AND id<>?', normalizeLogin(b.login), id);
      need(!taken, 409, 'Tên đăng nhập này đã có người dùng');
      stmts.push(stmt(c.env, 'UPDATE staff SET login=? WHERE id=?', normalizeLogin(b.login), id));
    } else if (b.login === null || b.login === '') {
      stmts.push(stmt(c.env, 'UPDATE staff SET login=NULL, pw_salt=NULL, pw_hash=NULL WHERE id=?', id));
    }
    if (b.password) {
      need(validPassword(b.password), 400, passwordRule);
      const hasLogin = (b.login && b.login !== '') || (await first<{ login: string | null }>(c.env, 'SELECT login FROM staff WHERE id=?', id))?.login;
      need(hasLogin, 400, 'Đặt tên đăng nhập trước khi đặt mật khẩu');
      const ps = randomHex(8);
      stmts.push(stmt(c.env, 'UPDATE staff SET pw_salt=?, pw_hash=? WHERE id=?', ps, await hashPin(b.password, ps), id));
    }
  }
  if (role === 'staff' && existing && existing.role !== 'staff') stmts.push(stmt(c.env, 'UPDATE staff SET login=NULL, pw_salt=NULL, pw_hash=NULL WHERE id=?', id));
  const safe = { ...b, pin: b.pin ? '••••' : undefined, password: b.password ? '••••' : undefined };
  stmts.push(auditStmt(c.env, { action: existing ? 'staff_update' : 'staff_create', entity: 'staff', entity_id: id, actor_id: c.staff!.id, device_id: c.device!.id, after: safe }, ulid()));
  await batch(c.env, stmts);
  return json(await first(c.env, `SELECT ${staffCols(c)} FROM staff WHERE id=?`, id));
}

/**
 * Delete a staff member (owner only). Someone with history (orders, time clock, cash, audit) is archived:
 * hidden from every list and the till, signed out, future shifts removed, but their name stays on old records.
 * Someone without history is removed completely.
 */
export async function deleteStaff(c: Ctx) {
  requireRole(c, 'owner');
  const id = c.params.id;
  const s = await first<{ id: string; name: string; role: Role; active: number }>(c.env, 'SELECT id,name,role,active FROM staff WHERE id=? AND deleted_at IS NULL', id);
  need(s, 404, 'Không tìm thấy nhân viên');
  need(id !== c.staff!.id, 409, 'Không tự xoá chính mình được');
  if (s.role === 'owner') {
    const owners = await first<{ n: number }>(c.env, "SELECT COUNT(*) n FROM staff WHERE role='owner' AND active=1 AND deleted_at IS NULL AND id<>?", id);
    need((owners?.n || 0) > 0, 409, 'Phải còn ít nhất một chủ quán');
  }
  const [open, busy, hist] = await Promise.all([
    first<{ n: number }>(c.env, 'SELECT COUNT(*) n FROM time_entry WHERE staff_id=? AND clock_out IS NULL AND deleted_at IS NULL', id),
    first<{ n: number }>(c.env, "SELECT COUNT(*) n FROM sale_order WHERE staff_id=? AND status IN ('open','awaiting_payment')", id),
    first<{ n: number }>(c.env, `SELECT
      (SELECT COUNT(*) FROM sale_order WHERE staff_id=?) + (SELECT COUNT(*) FROM time_entry WHERE staff_id=?) +
      (SELECT COUNT(*) FROM staff_shift WHERE staff_id=?) + (SELECT COUNT(*) FROM cash_movement WHERE staff_id=? OR approved_by=?) +
      (SELECT COUNT(*) FROM audit_log WHERE actor_id=? OR approver_id=?) AS n`, id, id, id, id, id, id, id),
  ]);
  need(!open?.n, 409, `${s.name} đang trong ca (chưa chấm công ra). Chấm công ra hoặc sửa giờ ra trong Giờ làm trước.`);
  need(!busy?.n, 409, `${s.name} còn tab/bàn chưa thanh toán. Thanh toán hoặc chuyển cho người khác trước.`);
  const t = now();
  const today = new Date(t + 7 * 3600000).toISOString().slice(0, 10);
  const archived = (hist?.n || 0) > 0;
  await batch(c.env, [
    archived
      ? stmt(c.env, 'UPDATE staff SET active=0, deleted_at=?, login=NULL, pw_salt=NULL, pw_hash=NULL, updated_at=? WHERE id=?', t, t, id)
      : stmt(c.env, 'DELETE FROM staff WHERE id=?', id),
    stmt(c.env, 'DELETE FROM staff_session WHERE staff_id=?', id),
    stmt(c.env, 'DELETE FROM work_schedule WHERE staff_id=? AND day >= ?', id, today),
    auditStmt(c.env, { action: 'staff_delete', entity: 'staff', entity_id: id, actor_id: c.staff!.id, device_id: c.device!.id, before: { name: s.name, role: s.role }, after: { archived } }, ulid()),
  ]);
  return json({ ok: true, archived });
}

/** Sign out every other device (lost phone, leaked password). They must be registered again. */
export async function revokeOtherDevices(c: Ctx) {
  requireRole(c, 'owner');
  const n = await first<{ n: number }>(c.env, 'SELECT COUNT(*) n FROM device WHERE id<>? AND active=1', c.device!.id);
  await batch(c.env, [
    stmt(c.env, 'UPDATE device SET active=0, updated_at=? WHERE id<>? AND active=1', now(), c.device!.id),
    stmt(c.env, 'DELETE FROM staff_session WHERE device_id<>?', c.device!.id),
    auditStmt(c.env, { action: 'devices_revoke', entity: 'device', actor_id: c.staff!.id, device_id: c.device!.id, after: { revoked: n?.n ?? 0 } }, ulid()),
  ]);
  return json({ ok: true, revoked: n?.n ?? 0 });
}

// ----- outlet -----

const OUTLET_COLS = ['name', 'tz_offset_min', 'business_day_cutoff', 'business_type', 'vietqr_bank_bin', 'vietqr_account', 'vietqr_account_name', 'receipt_header', 'receipt_footer', 'settings_json'];

export async function getOutlet(c: Ctx) {
  requireRole(c, 'owner', 'manager');
  return json(await first(c.env, 'SELECT * FROM outlet LIMIT 1'));
}

export async function saveOutlet(c: Ctx) {
  requireRole(c, 'owner');
  const data = pick(await body(c), OUTLET_COLS);
  if (data.business_day_cutoff) need(/^\d{2}:\d{2}$/.test(String(data.business_day_cutoff)), 400, 'Giờ cut-off dạng HH:MM');
  if (data.settings_json) { try { JSON.parse(String(data.settings_json)); } catch { throw new HttpError(400, 'settings_json không hợp lệ'); } }
  const before = await first<Record<string, unknown>>(c.env, 'SELECT * FROM outlet LIMIT 1');
  const keys = Object.keys(data);
  need(keys.length, 400, 'Không có gì để cập nhật');
  await batch(c.env, [
    stmt(c.env, `UPDATE outlet SET ${keys.map((k) => `${k}=?`).join(',')}, updated_at=? WHERE id=?`, ...keys.map((k) => data[k]), now(), before!.id),
    auditStmt(c.env, { action: 'settings', entity: 'outlet', entity_id: String(before!.id), actor_id: c.staff!.id, device_id: c.device!.id, before: pick(before!, keys), after: data }, ulid()),
  ]);
  return json(await first(c.env, 'SELECT * FROM outlet LIMIT 1'));
}

// ----- devices -----

export async function listDevices(c: Ctx) {
  requireRole(c, 'owner');
  return json(await all(c.env, 'SELECT id,name,order_prefix,active,last_seen_at,created_at FROM device ORDER BY created_at'));
}

export async function setDeviceActive(c: Ctx) {
  requireRole(c, 'owner');
  const b = await body<{ active: number }>(c);
  need(c.params.id !== c.device!.id || b.active, 409, 'Không thể khoá chính thiết bị đang dùng');
  await batch(c.env, [
    stmt(c.env, 'UPDATE device SET active=?, updated_at=? WHERE id=?', b.active ? 1 : 0, now(), c.params.id),
    auditStmt(c.env, { action: b.active ? 'device_enable' : 'device_disable', entity: 'device', entity_id: c.params.id, actor_id: c.staff!.id, device_id: c.device!.id }, ulid()),
  ]);
  return json({ ok: true });
}

// ----- audit -----

export async function listAudit(c: Ctx) {
  requireRole(c, 'owner', 'manager');
  const action = c.url.searchParams.get('action');
  const limit = Math.min(500, parseInt(c.url.searchParams.get('limit') || '200', 10));
  const rows = action
    ? await all(c.env, 'SELECT a.*, s.name actor_name, s2.name approver_name FROM audit_log a LEFT JOIN staff s ON s.id=a.actor_id LEFT JOIN staff s2 ON s2.id=a.approver_id WHERE a.action=? ORDER BY a.at DESC LIMIT ?', action, limit)
    : await all(c.env, 'SELECT a.*, s.name actor_name, s2.name approver_name FROM audit_log a LEFT JOIN staff s ON s.id=a.actor_id LEFT JOIN staff s2 ON s2.id=a.approver_id ORDER BY a.at DESC LIMIT ?', limit);
  return json(rows);
}

// ----- media (R2) -----

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export async function uploadMedia(c: Ctx) {
  const type = (c.req.headers.get('content-type') || '').split(';')[0];
  need(EXT[type], 415, 'Chỉ nhận ảnh JPG, PNG hoặc WebP');
  const len = parseInt(c.req.headers.get('content-length') || '0', 10);
  need(!len || len < 8 * 1024 * 1024, 413, 'Ảnh tối đa 8MB');
  const key = `u/${ulid()}.${EXT[type]}`;
  await c.env.MEDIA.put(key, c.req.body, { httpMetadata: { contentType: type } });
  return json({ key, url: `/media/${key}` }, 201);
}

export async function serveMedia(c: Ctx) {
  const key = c.url.pathname.replace(/^\/media\//, '');
  const obj = await c.env.MEDIA.get(key);
  if (!obj) return new Response('Not found', { status: 404 });
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(obj.body, { headers: h });
}

/** Public menu for the website: only active items marked "show on website". */
export async function publicMenu(c: Ctx) {
  const [cats, items] = await Promise.all([
    all(c.env, 'SELECT id,name_en,name_vi,sort FROM category WHERE active=1 ORDER BY sort'),
    all<any>(c.env, 'SELECT id,category_id,name_en,name_vi,desc_en,desc_vi,price,image_key,sold_out,sort FROM item WHERE active=1 AND show_on_web=1 ORDER BY sort, name_vi'),
  ]);
  const res = Response.json({ categories: cats, items: items.map((i) => ({ ...i, image_url: i.image_key ? `/media/${i.image_key}` : null })) });
  res.headers.set('access-control-allow-origin', '*');
  res.headers.set('cache-control', 'public, max-age=60');
  return res;
}

// ----- floor plan -----

/** Add several tables at once ("Bàn 7" … "Bàn 12"), placed on free cells of the area's grid. */
export async function bulkTables(c: Ctx) {
  requireRole(c, 'owner');
  const b = await body<{ area?: string; prefix?: string; start?: number; count?: number; seats?: number }>(c);
  const area = (b.area || '').trim() || 'Trong nhà';
  const count = Math.round(b.count || 0);
  need(count >= 1 && count <= 40, 400, 'Số bàn từ 1 đến 40');
  const start = Math.max(0, Math.round(b.start ?? 1));
  const prefix = (b.prefix ?? 'Bàn').trim();
  const existing = await all<{ x: number; y: number; w: number; h: number; sort: number }>(c.env, 'SELECT x,y,w,h,sort FROM dining_table WHERE area=? AND active=1', area);
  const used = new Set<string>();
  for (const t of existing) for (let i = 0; i < t.w; i++) for (let j = 0; j < t.h; j++) used.add(`${t.x + i},${t.y + j}`);
  const cols = 6;
  const maxSort = (await first<{ m: number }>(c.env, 'SELECT COALESCE(MAX(sort),0) m FROM dining_table'))?.m ?? 0;
  const t = now();
  const stmts: D1PreparedStatement[] = [];
  let cell = 0;
  for (let n = 0; n < count; n++) {
    // Leave a gap column/row between tables so the map reads like a room.
    while (used.has(`${(cell % (cols / 2)) * 2},${Math.floor(cell / (cols / 2)) * 2}`)) cell++;
    const x = (cell % (cols / 2)) * 2;
    const y = Math.floor(cell / (cols / 2)) * 2;
    used.add(`${x},${y}`);
    stmts.push(stmt(c.env, 'INSERT INTO dining_table (id,area,name,seats,x,y,w,h,shape,sort,active,created_at,updated_at) VALUES (?,?,?,?,?,?,1,1,?,?,1,?,?)',
      ulid(), area, `${prefix} ${start + n}`.trim(), Math.max(1, Math.round(b.seats || 4)), x, y, 'square', maxSort + n + 1, t, t));
  }
  stmts.push(auditStmt(c.env, { action: 'tables_bulk', entity: 'dining_table', actor_id: c.staff!.id, device_id: c.device!.id, after: { area, prefix, start, count } }, ulid()));
  await batch(c.env, stmts);
  return json(await all(c.env, 'SELECT * FROM dining_table WHERE active=1 ORDER BY area, sort, name'), 201);
}

export async function renameArea(c: Ctx) {
  requireRole(c, 'owner');
  const b = await body<{ from?: string; to?: string }>(c);
  need(b.from && b.to?.trim(), 400, 'Thiếu tên khu vực');
  await batch(c.env, [stmt(c.env, 'UPDATE dining_table SET area=?, updated_at=? WHERE area=?', b.to!.trim(), now(), b.from)]);
  return json({ ok: true });
}

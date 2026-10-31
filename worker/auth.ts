// Setup, device registration, staff login and the POS config snapshot.
import { hashPin, pinRule, randomHex, sha256, validPin, verifyPin } from '../shared/crypto';
import type { PosConfig, Role } from '../shared/types';
import { ulid } from '../shared/util';
import { all, auditStmt, batch, body, type Ctx, type Env, first, HttpError, json, need, now, stmt } from './http';
import { assertNotLocked, clientKey, recordFail, recordSuccess } from './throttle';

const STAFF_SESSION_MS = 12 * 3600 * 1000;

export async function needsSetup(env: Env): Promise<boolean> {
  const row = await first<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM staff');
  return !row || row.n === 0;
}

async function newDevice(env: Env, outletId: string, name: string) {
  const count = await first<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM device');
  const n = count?.n ?? 0;
  const prefix = n < 26 ? String.fromCharCode(65 + n) : 'Z' + (n - 25);
  const token = randomHex(32);
  const id = ulid();
  const t = now();
  return {
    token,
    device: { id, outlet_id: outletId, order_prefix: prefix, name },
    stmt: stmt(env, 'INSERT INTO device (id,outlet_id,order_prefix,name,token_hash,active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)',
      id, outletId, prefix, name, await sha256(token), t, t),
  };
}

/** First run only: create the outlet, the owner, starter menu structure and this device. */
export async function setup(c: Ctx) {
  need(await needsSetup(c.env), 409, 'Hệ thống đã được thiết lập');
  const b = await body<{ outletName: string; ownerName: string; ownerPin: string; deviceName: string }>(c);
  need(b.outletName?.trim() && b.ownerName?.trim(), 400, 'Thiếu tên quán hoặc tên chủ');
  need(validPin(b.ownerPin, 'owner'), 400, pinRule('owner'));
  const env = c.env;
  const t = now();
  const outletId = ulid();
  const ownerId = ulid();
  const salt = randomHex(8);
  const stmts: D1PreparedStatement[] = [
    stmt(env, 'INSERT INTO outlet (id,name,settings_json,created_at,updated_at) VALUES (?,?,?,?,?)', outletId, b.outletName.trim(),
      JSON.stringify({ cost_alert_pct: 30, done_return_seconds: 5, tax_threshold_year: 1000000000 }), t, t),
    stmt(env, 'INSERT INTO staff (id,outlet_id,name,pin_salt,pin_hash,role,active,max_discount_pct,cash_out_limit,created_at,updated_at) VALUES (?,?,?,?,?,?,1,100,100000000,?,?)',
      ownerId, outletId, b.ownerName.trim(), salt, await hashPin(b.ownerPin, salt), 'owner', t, t),
  ];
  const cats = [['Signature', 'Signature'], ['Mocktail', 'Mocktail'], ['Shots', 'Shots'], ['Other', 'Khác']];
  cats.forEach(([en, vi], i) => stmts.push(stmt(env, 'INSERT INTO category (id,name_en,name_vi,sort,active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)', ulid(), en, vi, i, t, t)));
  const groups: { en: string; vi: string; sel: string; req: number; opts: [string, string, number, number, number][] }[] = [
    { en: 'Sugar', vi: 'Đường', sel: 'single', req: 1, opts: [['Normal', 'Bình thường', 0, 1, 0], ['Less', 'Ít đường', 0, 0, 0], ['None', 'Không đường', 0, 0, 0]] },
    { en: 'Ice', vi: 'Đá', sel: 'single', req: 1, opts: [['Normal', 'Bình thường', 0, 1, 0], ['Less', 'Ít đá', 0, 0, 0], ['No ice', 'Không đá', 0, 0, 0]] },
    { en: 'Version', vi: 'Phiên bản', sel: 'single', req: 1, opts: [['Cocktail', 'Cocktail', 0, 1, 0], ['Mocktail', 'Mocktail', -20000, 0, 1]] },
    { en: 'Extras', vi: 'Thêm', sel: 'multi', req: 0, opts: [['Extra shot', 'Thêm shot', 30000, 0, 0]] },
  ];
  groups.forEach((g, gi) => {
    const gid = ulid();
    stmts.push(stmt(env, 'INSERT INTO modifier_group (id,name_en,name_vi,selection,required,sort,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', gid, g.en, g.vi, g.sel, g.req, gi, t, t));
    g.opts.forEach((o, oi) => stmts.push(stmt(env,
      'INSERT INTO modifier_option (id,group_id,name_en,name_vi,price_delta,is_default,excludes_promo,sort,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,1,?,?)',
      ulid(), gid, o[0], o[1], o[2], o[3], o[4], oi, t, t)));
  });
  stmts.push(stmt(env, 'INSERT INTO promotion (id,name,type,active,rule_json,created_at,updated_at) VALUES (?,?,?,1,?,?,?)', ulid(), 'Mua 1 tặng 1 Signature', 'bogo', '{}', t, t));
  const d = await newDevice(env, outletId, b.deviceName?.trim() || 'Máy A');
  stmts.push(d.stmt);
  stmts.push(auditStmt(env, { action: 'setup', entity: 'outlet', entity_id: outletId, actor_id: ownerId, outlet_id: outletId }, ulid()));
  await batch(env, stmts);
  return json({ deviceToken: d.token, device: d.device });
}

async function findStaffByPin(env: Env, pin: string, roles: Role[]) {
  const rows = await all<{ id: string; name: string; role: Role; pin_salt: string; pin_hash: string }>(
    env, `SELECT id,name,role,pin_salt,pin_hash FROM staff WHERE active=1 AND role IN (${roles.map(() => '?').join(',')})`, ...roles);
  for (const r of rows) if (await verifyPin(pin, r.pin_salt, r.pin_hash)) return r;
  return null;
}

/** Add another device (2nd Android, laptop for back office). Needs an owner/manager PIN. */
export async function registerDevice(c: Ctx) {
  const b = await body<{ pin: string; deviceName: string }>(c);
  need(validPin(b.pin, 'manager'), 400, pinRule('manager'));
  const key = 'register:' + clientKey(c.req);
  await assertNotLocked(c.env, key);
  const approver = await findStaffByPin(c.env, b.pin, ['owner', 'manager']);
  if (!approver) { await recordFail(c.env, key); throw new HttpError(403, 'PIN không đúng hoặc không phải quản lý'); }
  await recordSuccess(c.env, key);
  const outlet = await first<{ id: string }>(c.env, 'SELECT id FROM outlet LIMIT 1');
  need(outlet, 409, 'Chưa thiết lập quán');
  const d = await newDevice(c.env, outlet.id, b.deviceName?.trim() || 'Thiết bị mới');
  await batch(c.env, [d.stmt, auditStmt(c.env, { action: 'device_register', entity: 'device', entity_id: d.device.id, actor_id: approver.id, outlet_id: outlet.id, after: d.device }, ulid())]);
  return json({ deviceToken: d.token, device: d.device });
}

export async function resolveDevice(c: Ctx) {
  const auth = c.req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  need(token, 401, 'Thiết bị chưa đăng ký');
  const d = await first<{ id: string; outlet_id: string; order_prefix: string; name: string; active: number; last_seen_at: number | null }>(
    c.env, 'SELECT id,outlet_id,order_prefix,name,active,last_seen_at FROM device WHERE token_hash=?', await sha256(token));
  need(d && d.active, 401, 'Thiết bị chưa đăng ký hoặc đã bị khoá');
  c.device = { id: d.id, outlet_id: d.outlet_id, order_prefix: d.order_prefix, name: d.name };
  if (!d.last_seen_at || now() - d.last_seen_at > 60000) {
    await c.env.DB.prepare('UPDATE device SET last_seen_at=? WHERE id=?').bind(now(), d.id).run();
  }
}

export async function resolveStaff(c: Ctx) {
  const token = c.req.headers.get('x-staff-session') || '';
  need(token, 401, 'Cần đăng nhập quản trị');
  const s = await first<{ staff_id: string; expires_at: number; name: string; role: Role; active: number }>(c.env,
    'SELECT s.staff_id, s.expires_at, st.name, st.role, st.active FROM staff_session s JOIN staff st ON st.id=s.staff_id WHERE s.token_hash=?',
    await sha256(token));
  need(s && s.active && s.expires_at > now(), 401, 'Phiên quản trị đã hết hạn, hãy đăng nhập lại');
  c.staff = { id: s.staff_id, name: s.name, role: s.role };
}

/** Staff PIN login on the server, giving a session for back-office calls. */
export async function staffLogin(c: Ctx) {
  const b = await body<{ staffId: string; pin: string }>(c);
  const s = await first<{ id: string; name: string; role: Role; pin_salt: string; pin_hash: string; active: number }>(
    c.env, 'SELECT id,name,role,pin_salt,pin_hash,active FROM staff WHERE id=?', b.staffId);
  need(s && s.active, 404, 'Không tìm thấy nhân viên');
  const key = 'staff:' + s.id;
  await assertNotLocked(c.env, key);
  if (!(await verifyPin(b.pin || '', s.pin_salt, s.pin_hash))) { await recordFail(c.env, key); throw new HttpError(403, 'Sai PIN'); }
  await recordSuccess(c.env, key);
  const token = randomHex(32);
  await batch(c.env, [
    stmt(c.env, 'DELETE FROM staff_session WHERE expires_at < ?', now()),
    stmt(c.env, 'INSERT INTO staff_session (token_hash,staff_id,device_id,expires_at) VALUES (?,?,?,?)', await sha256(token), s.id, c.device!.id, now() + STAFF_SESSION_MS),
  ]);
  return json({ session: token, staff: { id: s.id, name: s.name, role: s.role } });
}

/** Everything a selling device needs to work offline. Staff rows include PIN hashes for offline login. */
export async function configSnapshot(env: Env, device: Ctx['device']): Promise<PosConfig> {
  const [outlet, staff, categories, items, modifierGroups, modifierOptions, itemModifierGroups, promotions, promotionItems] = await Promise.all([
    first(env, 'SELECT * FROM outlet LIMIT 1'),
    all(env, 'SELECT id,name,role,active,pin_salt,pin_hash,max_discount_pct,cash_out_limit FROM staff WHERE active=1 ORDER BY role, name'),
    all(env, 'SELECT id,name_en,name_vi,sort,active FROM category ORDER BY sort'),
    all(env, 'SELECT id,category_id,name_en,name_vi,desc_en,desc_vi,price,image_key,active,sold_out,show_on_web,sort FROM item ORDER BY sort, name_vi'),
    all(env, 'SELECT id,name_en,name_vi,selection,required,sort FROM modifier_group ORDER BY sort'),
    all(env, 'SELECT id,group_id,name_en,name_vi,price_delta,is_default,excludes_promo,sort,active FROM modifier_option WHERE active=1 ORDER BY sort'),
    all(env, 'SELECT item_id,group_id,sort FROM item_modifier_group ORDER BY sort'),
    all(env, 'SELECT * FROM promotion'),
    all(env, 'SELECT promotion_id,item_id FROM promotion_item'),
  ]);
  return { outlet, device: device!, staff, categories, items, modifierGroups, modifierOptions, itemModifierGroups, promotions, promotionItems } as PosConfig;
}

// Staff time clock (chấm công) and work schedule (lịch làm). Devices clock in/out offline through sync;
// managers correct entries and plan shifts here. Every correction is written to the audit log.
import type { TimeEntry } from '../shared/types';
import { addDays, businessDay, parseSettings, ulid } from '../shared/util';
import { all, auditStmt, batch, body, type Ctx, type Env, first, json, need, now, requirePerm, stmt } from './http';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

async function outlet(env: Env) {
  return (await first<{ tz_offset_min: number; business_day_cutoff: string; settings_json: string }>(env, 'SELECT tz_offset_min,business_day_cutoff,settings_json FROM outlet LIMIT 1'))!;
}

/** Push from a device. New entries are inserted; an existing one only gets its clock-out (never overwrites a manager's fix). */
export async function pushTimeEntry(c: Ctx, e: TimeEntry) {
  need(e.id && e.staff_id && e.clock_in, 400, 'Chấm công thiếu dữ liệu');
  const existing = await first<{ id: string; clock_out: number | null; deleted_at: number | null }>(c.env, 'SELECT id,clock_out,deleted_at FROM time_entry WHERE id=?', e.id);
  const t = now();
  if (!existing) {
    const o = await outlet(c.env);
    await batch(c.env, [stmt(c.env,
      'INSERT INTO time_entry (id,staff_id,business_day,clock_in,clock_out,break_min,device_id,source,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      e.id, e.staff_id, e.business_day || businessDay(e.clock_in, o.tz_offset_min, o.business_day_cutoff), e.clock_in, e.clock_out ?? null,
      Math.max(0, e.break_min || 0), c.device!.id, 'pos', e.note ?? null, e.created_at || t, t)]);
    return;
  }
  if (existing.deleted_at || existing.clock_out || !e.clock_out) return;
  await batch(c.env, [stmt(c.env, 'UPDATE time_entry SET clock_out=?, break_min=MAX(break_min, ?), updated_at=? WHERE id=?', e.clock_out, Math.max(0, e.break_min || 0), t, e.id)]);
}

/** For devices: who is clocked in now and the last two weeks, plus the schedule around today. */
export async function deviceTimeData(env: Env, today: string) {
  const [entries, schedule] = await Promise.all([
    all<TimeEntry>(env, 'SELECT id,staff_id,business_day,clock_in,clock_out,break_min,device_id,source,note,edited_by,edited_at,created_at,updated_at FROM time_entry WHERE deleted_at IS NULL AND (clock_out IS NULL OR business_day >= ?) ORDER BY clock_in', addDays(today, -13)),
    all(env, 'SELECT id,staff_id,day,start,end,note FROM work_schedule WHERE day BETWEEN ? AND ? ORDER BY day,start', addDays(today, -7), addDays(today, 14)),
  ]);
  return { timeEntries: entries, schedule };
}

/** Timesheet for a period. Pay rates are shown to the owner only. */
export async function sheet(c: Ctx) {
  requirePerm(c, 'time');
  const from = c.url.searchParams.get('from') || '';
  const to = c.url.searchParams.get('to') || '';
  need(DAY.test(from) && DAY.test(to) && from <= to, 400, 'Khoảng ngày không hợp lệ');
  const owner = c.staff!.role === 'owner';
  const [staff, entries, schedule, tips, o] = await Promise.all([
    all(c.env, `SELECT id,name,role,active${owner ? ',hourly_rate' : ''}, deleted_at FROM staff ORDER BY active DESC, role, name`),
    all(c.env, `SELECT t.*, e.name edited_by_name FROM time_entry t LEFT JOIN staff e ON e.id=t.edited_by
      WHERE t.deleted_at IS NULL AND (t.business_day BETWEEN ? AND ? OR (t.clock_out IS NULL AND t.business_day <= ?)) ORDER BY t.clock_in`, from, to, to),
    all(c.env, 'SELECT id,staff_id,day,start,end,note FROM work_schedule WHERE day BETWEEN ? AND ? ORDER BY day,start', from, to),
    all(c.env, `SELECT o.staff_id, COALESCE(SUM(p.tip),0) tips FROM payment p JOIN sale_order o ON o.id=p.order_id
      WHERE o.status='paid' AND p.status='confirmed' AND o.business_day BETWEEN ? AND ? GROUP BY o.staff_id`, from, to),
    outlet(c.env),
  ]);
  const st = parseSettings<{ night_premium_pct?: number; late_grace_min?: number }>(o.settings_json);
  return json({
    from, to, owner, staff, entries, schedule, tips,
    settings: { tz: o.tz_offset_min, cutoff: o.business_day_cutoff, night_premium_pct: st.night_premium_pct ?? 0, late_grace_min: st.late_grace_min ?? 10 },
  });
}

function checkTimes(clockIn: number, clockOut: number | null, breakMin: number) {
  need(Number.isFinite(clockIn) && clockIn > 0, 400, 'Giờ vào không hợp lệ');
  if (clockOut != null) {
    need(clockOut > clockIn, 400, 'Giờ ra phải sau giờ vào');
    need(clockOut - clockIn <= 24 * 3600000, 400, 'Một ca không quá 24 giờ');
    need(breakMin >= 0 && breakMin * 60000 < clockOut - clockIn, 400, 'Giờ nghỉ không hợp lệ');
  }
  need(clockIn <= now() + 3600000, 400, 'Giờ vào ở tương lai');
}

export async function addEntry(c: Ctx) {
  requirePerm(c, 'time');
  const b = await body<{ staff_id: string; clock_in: number; clock_out: number | null; break_min?: number; note?: string }>(c);
  need(b.staff_id && (await first(c.env, 'SELECT id FROM staff WHERE id=?', b.staff_id)), 400, 'Chọn nhân viên');
  need(b.note?.trim(), 400, 'Ghi lý do thêm công tay');
  checkTimes(b.clock_in, b.clock_out ?? null, b.break_min || 0);
  const o = await outlet(c.env);
  const id = ulid();
  const t = now();
  const row = { staff_id: b.staff_id, clock_in: b.clock_in, clock_out: b.clock_out ?? null, break_min: b.break_min || 0 };
  await batch(c.env, [
    stmt(c.env, 'INSERT INTO time_entry (id,staff_id,business_day,clock_in,clock_out,break_min,device_id,source,note,edited_by,edited_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, b.staff_id, businessDay(b.clock_in, o.tz_offset_min, o.business_day_cutoff), b.clock_in, row.clock_out, row.break_min, c.device!.id, 'admin', b.note!.trim(), c.staff!.id, t, t, t),
    auditStmt(c.env, { action: 'time_add', entity: 'time_entry', entity_id: id, actor_id: c.staff!.id, device_id: c.device!.id, after: row, reason: b.note!.trim() }, ulid()),
  ]);
  return json(await first(c.env, 'SELECT * FROM time_entry WHERE id=?', id), 201);
}

export async function editEntry(c: Ctx) {
  requirePerm(c, 'time');
  const b = await body<{ clock_in: number; clock_out: number | null; break_min?: number; reason?: string }>(c);
  const before = await first<TimeEntry & { deleted_at: number | null }>(c.env, 'SELECT * FROM time_entry WHERE id=?', c.params.id);
  need(before && !before.deleted_at, 404, 'Không tìm thấy lượt chấm công');
  need(b.reason?.trim(), 400, 'Ghi lý do sửa');
  checkTimes(b.clock_in, b.clock_out ?? null, b.break_min ?? 0);
  const o = await outlet(c.env);
  const t = now();
  const after = { clock_in: b.clock_in, clock_out: b.clock_out ?? null, break_min: b.break_min ?? 0 };
  await batch(c.env, [
    stmt(c.env, 'UPDATE time_entry SET clock_in=?, clock_out=?, break_min=?, business_day=?, edited_by=?, edited_at=?, updated_at=? WHERE id=?',
      after.clock_in, after.clock_out, after.break_min, businessDay(b.clock_in, o.tz_offset_min, o.business_day_cutoff), c.staff!.id, t, t, c.params.id),
    auditStmt(c.env, { action: 'time_edit', entity: 'time_entry', entity_id: c.params.id, actor_id: c.staff!.id, device_id: c.device!.id,
      before: { clock_in: before.clock_in, clock_out: before.clock_out, break_min: before.break_min }, after, reason: b.reason!.trim() }, ulid()),
  ]);
  return json(await first(c.env, 'SELECT * FROM time_entry WHERE id=?', c.params.id));
}

export async function deleteEntry(c: Ctx) {
  requirePerm(c, 'time');
  const b = await body<{ reason?: string }>(c);
  const before = await first<TimeEntry & { deleted_at: number | null }>(c.env, 'SELECT * FROM time_entry WHERE id=?', c.params.id);
  need(before && !before.deleted_at, 404, 'Không tìm thấy lượt chấm công');
  need(b.reason?.trim(), 400, 'Ghi lý do xoá');
  const t = now();
  await batch(c.env, [
    stmt(c.env, 'UPDATE time_entry SET deleted_at=?, edited_by=?, edited_at=?, updated_at=? WHERE id=?', t, c.staff!.id, t, t, c.params.id),
    auditStmt(c.env, { action: 'time_delete', entity: 'time_entry', entity_id: c.params.id, actor_id: c.staff!.id, device_id: c.device!.id,
      before: { staff_id: before.staff_id, clock_in: before.clock_in, clock_out: before.clock_out }, reason: b.reason!.trim() }, ulid()),
  ]);
  return json({ ok: true });
}

// ---------- schedule ----------

function checkShift(b: { staff_id?: string; day?: string; start?: string; end?: string }) {
  need(b.staff_id, 400, 'Chọn nhân viên');
  need(b.day && DAY.test(b.day), 400, 'Ngày không hợp lệ');
  need(b.start && HHMM.test(b.start) && b.end && HHMM.test(b.end) && b.start !== b.end, 400, 'Giờ ca dạng HH:MM, giờ vào khác giờ ra');
}

export async function addShift(c: Ctx) {
  requirePerm(c, 'time');
  const b = await body<{ staff_id: string; day: string; start: string; end: string; note?: string }>(c);
  checkShift(b);
  const id = ulid();
  const t = now();
  await batch(c.env, [stmt(c.env, 'INSERT INTO work_schedule (id,staff_id,day,start,end,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', id, b.staff_id, b.day, b.start, b.end, b.note?.trim() || null, t, t)]);
  return json(await first(c.env, 'SELECT id,staff_id,day,start,end,note FROM work_schedule WHERE id=?', id), 201);
}

export async function editShift(c: Ctx) {
  requirePerm(c, 'time');
  const b = await body<{ staff_id: string; day: string; start: string; end: string; note?: string }>(c);
  checkShift(b);
  need(await first(c.env, 'SELECT id FROM work_schedule WHERE id=?', c.params.id), 404, 'Không tìm thấy ca');
  await batch(c.env, [stmt(c.env, 'UPDATE work_schedule SET staff_id=?, day=?, start=?, end=?, note=?, updated_at=? WHERE id=?', b.staff_id, b.day, b.start, b.end, b.note?.trim() || null, now(), c.params.id)]);
  return json(await first(c.env, 'SELECT id,staff_id,day,start,end,note FROM work_schedule WHERE id=?', c.params.id));
}

export async function deleteShift(c: Ctx) {
  requirePerm(c, 'time');
  await batch(c.env, [stmt(c.env, 'DELETE FROM work_schedule WHERE id=?', c.params.id)]);
  return json({ ok: true });
}

/** Copy one week of shifts onto another week (7 days). Refuses when the target week already has shifts unless replace=true. */
export async function copyWeek(c: Ctx) {
  requirePerm(c, 'time');
  const b = await body<{ from: string; to: string; replace?: boolean }>(c);
  need(DAY.test(b.from) && DAY.test(b.to) && b.from !== b.to, 400, 'Tuần không hợp lệ');
  const src = await all<{ staff_id: string; day: string; start: string; end: string; note: string | null }>(c.env,
    'SELECT staff_id,day,start,end,note FROM work_schedule WHERE day BETWEEN ? AND ?', b.from, addDays(b.from, 6));
  need(src.length, 400, 'Tuần nguồn chưa có ca nào');
  const existing = await first<{ n: number }>(c.env, 'SELECT COUNT(*) n FROM work_schedule WHERE day BETWEEN ? AND ?', b.to, addDays(b.to, 6));
  need(!existing?.n || b.replace, 409, `Tuần đích đã có ${existing?.n} ca`);
  const shift = Math.round((Date.parse(b.to) - Date.parse(b.from)) / 86400000);
  const t = now();
  // One batch = one transaction, so a half-copied week is impossible.
  await batch(c.env, [
    stmt(c.env, 'DELETE FROM work_schedule WHERE day BETWEEN ? AND ?', b.to, addDays(b.to, 6)),
    ...src.map((s) => stmt(c.env, 'INSERT INTO work_schedule (id,staff_id,day,start,end,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      ulid(), s.staff_id, addDays(s.day, shift), s.start, s.end, s.note, t, t)),
  ]);
  return json({ ok: true, copied: src.length });
}

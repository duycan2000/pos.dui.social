// Monthly payroll (owner only): live numbers from the time clock, extra pay / deductions, till advances,
// and payslips frozen when the owner marks someone as paid (also booked as a 'salary' expense).
import { computePayroll, monthRange, type AdjKind, type PayrollRow, type TipMode } from '../shared/payroll';
import type { TimeEntry, WorkShift } from '../shared/types';
import { businessDay, parseSettings, ulid } from '../shared/util';
import { all, auditStmt, batch, body, type Ctx, type Env, first, json, need, now, requireRole, stmt } from './http';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const KINDS: AdjKind[] = ['allowance', 'bonus', 'advance', 'deduction'];

async function outlet(env: Env) {
  return (await first<{ id: string; tz_offset_min: number; business_day_cutoff: string; settings_json: string | null }>(env, 'SELECT id, tz_offset_min, business_day_cutoff, settings_json FROM outlet LIMIT 1'))!;
}

async function load(env: Env, month: string) {
  const { from, to } = monthRange(month);
  const o = await outlet(env);
  const st = parseSettings<{ night_premium_pct?: number; payroll_tips?: TipMode }>(o.settings_json);
  const [staff, entries, schedule, tips, adjustments, advances, slips] = await Promise.all([
    all<{ id: string; name: string; hourly_rate: number; active: number; deleted_at: number | null }>(env, 'SELECT id,name,hourly_rate,active,deleted_at FROM staff ORDER BY active DESC, name'),
    all<TimeEntry>(env, 'SELECT * FROM time_entry WHERE deleted_at IS NULL AND business_day BETWEEN ? AND ? ORDER BY clock_in', from, to),
    all<WorkShift>(env, 'SELECT * FROM work_schedule WHERE day BETWEEN ? AND ?', from, to),
    all<{ staff_id: string; tips: number }>(env, `SELECT o.staff_id, COALESCE(SUM(p.tip),0) tips FROM payment p JOIN sale_order o ON o.id=p.order_id
      WHERE o.status='paid' AND p.status='confirmed' AND o.business_day BETWEEN ? AND ? GROUP BY o.staff_id`, from, to),
    all<{ id: string; staff_id: string; kind: AdjKind; amount: number; note: string | null; created_at: number }>(env,
      'SELECT id,staff_id,kind,amount,note,created_at FROM payroll_adjustment WHERE month=? AND deleted_at IS NULL ORDER BY created_at', month),
    all<{ id: string; for_staff_id: string; amount: number; note: string | null; business_day: string; created_at: number }>(env,
      "SELECT id,for_staff_id,amount,note,business_day,created_at FROM cash_movement WHERE reason='advance' AND direction='out' AND for_staff_id IS NOT NULL AND business_day BETWEEN ? AND ? ORDER BY created_at", from, to),
    all<{ id: string; staff_id: string; net: number; data_json: string; method: string | null; paid_at: number; paid_by: string | null }>(env,
      'SELECT id,staff_id,net,data_json,method,paid_at,paid_by FROM payslip WHERE month=? AND voided_at IS NULL', month),
  ]);
  const cashAdvances: Record<string, number> = {};
  for (const a of advances) cashAdvances[a.for_staff_id] = (cashAdvances[a.for_staff_id] ?? 0) + a.amount;
  const tipMode: TipMode = st.payroll_tips ?? 'by_staff';
  const live = computePayroll({
    staff, entries, schedule, adjustments, cashAdvances, tipMode,
    tipsByStaff: Object.fromEntries(tips.map((t) => [t.staff_id, t.tips])),
    tz: o.tz_offset_min, cutoff: o.business_day_cutoff, nightPct: st.night_premium_pct ?? 0,
  });
  return { o, from, to, tipMode, nightPct: st.night_premium_pct ?? 0, staff, live, adjustments, advances, slips };
}

export async function getPayroll(c: Ctx) {
  requireRole(c, 'owner');
  const month = c.url.searchParams.get('month') || '';
  need(MONTH.test(month), 400, 'Tháng không hợp lệ (YYYY-MM)');
  const d = await load(c.env, month);
  // A paid person shows the frozen payslip; the live row is kept alongside to spot changes made afterwards.
  const rows = d.live.map((r) => {
    const slip = d.slips.find((s) => s.staff_id === r.staff_id);
    return slip ? { ...(JSON.parse(slip.data_json) as PayrollRow), paid: { at: slip.paid_at, method: slip.method, net: slip.net }, live_net: r.net } : { ...r, paid: null, live_net: r.net };
  });
  for (const slip of d.slips) if (!rows.some((r) => r.staff_id === slip.staff_id)) rows.push({ ...(JSON.parse(slip.data_json) as PayrollRow), paid: { at: slip.paid_at, method: slip.method, net: slip.net }, live_net: 0 });
  return json({ month, from: d.from, to: d.to, tip_mode: d.tipMode, night_pct: d.nightPct, rows, adjustments: d.adjustments, advances: d.advances });
}

export async function addAdjustment(c: Ctx) {
  requireRole(c, 'owner');
  const b = await body<{ staff_id: string; month: string; kind: AdjKind; amount: number; note?: string }>(c);
  need(MONTH.test(b.month), 400, 'Tháng không hợp lệ');
  need(KINDS.includes(b.kind), 400, 'Loại không hợp lệ');
  const amount = Math.round(Number(b.amount) || 0);
  need(amount > 0 && amount <= 1e9, 400, 'Số tiền không hợp lệ');
  need(await first(c.env, 'SELECT id FROM staff WHERE id=?', b.staff_id), 400, 'Chọn nhân viên');
  need(!(await first(c.env, 'SELECT id FROM payslip WHERE staff_id=? AND month=? AND voided_at IS NULL', b.staff_id, b.month)), 409, 'Đã trả lương tháng này — huỷ "đã trả" trước khi sửa');
  const id = ulid();
  const t = now();
  await batch(c.env, [
    stmt(c.env, 'INSERT INTO payroll_adjustment (id,staff_id,month,kind,amount,note,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)', id, b.staff_id, b.month, b.kind, amount, b.note?.trim() || null, c.staff!.id, t),
    auditStmt(c.env, { action: 'payroll_adjust', entity: 'staff', entity_id: b.staff_id, actor_id: c.staff!.id, device_id: c.device!.id, after: { month: b.month, kind: b.kind, amount }, reason: b.note?.trim() || null }, ulid()),
  ]);
  return json({ id }, 201);
}

export async function deleteAdjustment(c: Ctx) {
  requireRole(c, 'owner');
  const a = await first<{ staff_id: string; month: string; amount: number; kind: string }>(c.env, 'SELECT staff_id,month,amount,kind FROM payroll_adjustment WHERE id=? AND deleted_at IS NULL', c.params.id);
  need(a, 404, 'Không tìm thấy');
  need(!(await first(c.env, 'SELECT id FROM payslip WHERE staff_id=? AND month=? AND voided_at IS NULL', a!.staff_id, a!.month)), 409, 'Đã trả lương tháng này — huỷ "đã trả" trước khi sửa');
  await batch(c.env, [
    stmt(c.env, 'UPDATE payroll_adjustment SET deleted_at=? WHERE id=?', now(), c.params.id),
    auditStmt(c.env, { action: 'payroll_adjust_delete', entity: 'staff', entity_id: a!.staff_id, actor_id: c.staff!.id, device_id: c.device!.id, before: a }, ulid()),
  ]);
  return json({ ok: true });
}

/** Mark one person as paid for the month: freeze the row in a payslip and book the net pay as a salary expense. */
export async function pay(c: Ctx) {
  requireRole(c, 'owner');
  const b = await body<{ staff_id: string; month: string; method: 'owner' | 'bank'; note?: string }>(c);
  need(MONTH.test(b.month), 400, 'Tháng không hợp lệ');
  need(['owner', 'bank'].includes(b.method), 400, 'Chọn cách trả');
  const d = await load(c.env, b.month);
  need(!d.slips.some((s) => s.staff_id === b.staff_id), 409, 'Người này đã được đánh dấu trả lương tháng này');
  const row = d.live.find((r) => r.staff_id === b.staff_id);
  need(row, 400, 'Không có công / tiền lương trong tháng này');
  need(!row!.open_entries, 400, 'Còn ca chưa chấm ra — sửa trong Giờ làm trước khi trả lương');
  const t = now();
  const id = ulid();
  const ledgerId = row!.net > 0 ? ulid() : null;
  const today = businessDay(t, d.o.tz_offset_min, d.o.business_day_cutoff);
  const stmts = [
    stmt(c.env, 'INSERT INTO payslip (id,staff_id,month,net,data_json,method,ledger_id,paid_by,paid_at) VALUES (?,?,?,?,?,?,?,?,?)', id, b.staff_id, b.month, row!.net, JSON.stringify(row), b.method, ledgerId, c.staff!.id, t),
    auditStmt(c.env, { action: 'payroll_pay', entity: 'staff', entity_id: b.staff_id, actor_id: c.staff!.id, device_id: c.device!.id, after: { month: b.month, net: row!.net, method: b.method }, reason: b.note?.trim() || null }, ulid()),
  ];
  if (ledgerId) stmts.push(stmt(c.env, "INSERT INTO ledger_entry (id,business_day,direction,category,amount,source,note,ref_type,ref_id,staff_id,created_at,updated_at) VALUES (?,?,'out','salary',?,?,?,'payslip',?,?,?,?)",
    ledgerId, today, row!.net, b.method, `Lương ${b.month.slice(5)}/${b.month.slice(0, 4)} · ${row!.name}`, id, c.staff!.id, t, t));
  await batch(c.env, stmts);
  return json({ id, net: row!.net });
}

export async function unpay(c: Ctx) {
  requireRole(c, 'owner');
  const b = await body<{ staff_id: string; month: string }>(c);
  const slip = await first<{ id: string; ledger_id: string | null; net: number }>(c.env, 'SELECT id,ledger_id,net FROM payslip WHERE staff_id=? AND month=? AND voided_at IS NULL', b.staff_id, b.month);
  need(slip, 404, 'Chưa đánh dấu trả lương');
  const t = now();
  const stmts = [
    stmt(c.env, 'UPDATE payslip SET voided_at=? WHERE id=?', t, slip!.id),
    auditStmt(c.env, { action: 'payroll_unpay', entity: 'staff', entity_id: b.staff_id, actor_id: c.staff!.id, device_id: c.device!.id, before: { month: b.month, net: slip!.net } }, ulid()),
  ];
  if (slip!.ledger_id) stmts.push(stmt(c.env, 'UPDATE ledger_entry SET voided=1, updated_at=? WHERE id=?', t, slip!.ledger_id));
  await batch(c.env, stmts);
  return json({ ok: true });
}

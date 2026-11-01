// Tax book (Mẫu S1a-HKD), charts data and the weekly/monthly verdict with loss & fraud signals.
import type { TaxInfo } from '../shared/types';
import { addDays, businessDay, daysBetween, parseSettings } from '../shared/util';
import { periodSummary } from './finance';
import { all, type Ctx, type Env, first, json, need, now, requireRole } from './http';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

async function outlet(env: Env) {
  return (await first<{ name: string; tz_offset_min: number; business_day_cutoff: string; settings_json: string }>(env, 'SELECT name,tz_offset_min,business_day_cutoff,settings_json FROM outlet LIMIT 1'))!;
}

function range(c: Ctx) {
  const from = c.url.searchParams.get('from') || '';
  const to = c.url.searchParams.get('to') || '';
  need(DAY.test(from) && DAY.test(to) && from <= to, 400, 'Khoảng ngày không hợp lệ');
  need(daysBetween(from, to) <= 400, 400, 'Tối đa khoảng 13 tháng');
  return { from, to };
}

// ---------------- Sổ doanh thu S1a-HKD ----------------

/** Rows for the S1a-HKD book: every paid order (or one line per day), net of promotions; tips are not revenue. */
export async function s1a(c: Ctx) {
  requireRole(c, 'owner', 'manager');
  const { from, to } = range(c);
  const o = await outlet(c.env);
  const info = parseSettings<{ tax_info?: TaxInfo }>(o.settings_json).tax_info ?? {};
  const mode = (c.url.searchParams.get('mode') || info.mode || 'order') === 'day' ? 'day' : 'order';
  const rows = mode === 'day'
    ? await all<{ day: string; amount: number }>(c.env, "SELECT business_day day, COALESCE(SUM(total),0) amount FROM sale_order WHERE status='paid' AND business_day BETWEEN ? AND ? GROUP BY business_day ORDER BY business_day", from, to)
    : await all<{ day: string; amount: number }>(c.env, "SELECT business_day day, total amount FROM sale_order WHERE status='paid' AND business_day BETWEEN ? AND ? ORDER BY business_day, paid_at LIMIT 50000", from, to);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return json({ from, to, mode, outlet_name: o.name, info, rows, total });
}

// ---------------- charts ----------------

export async function analytics(c: Ctx) {
  requireRole(c, 'owner', 'manager');
  const { from, to } = range(c);
  const o = await outlet(c.env);
  const tz = o.tz_offset_min * 60;
  const len = daysBetween(from, to);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(len - 1));
  const monthStart = addDays(to.slice(0, 7) + '-01', 0);
  const m12 = new Date(Date.UTC(+monthStart.slice(0, 4), +monthStart.slice(5, 7) - 12, 1)).toISOString().slice(0, 10);
  const [daily, prevDaily, months, monthOpex, monthDrawer, heat, methods, items, staff] = await Promise.all([
    all(c.env, "SELECT business_day day, COALESCE(SUM(total),0) revenue, COUNT(*) orders, COALESCE(SUM(cost_total),0) cogs FROM sale_order WHERE status='paid' AND business_day BETWEEN ? AND ? GROUP BY business_day ORDER BY business_day", from, to),
    all(c.env, "SELECT business_day day, COALESCE(SUM(total),0) revenue FROM sale_order WHERE status='paid' AND business_day BETWEEN ? AND ? GROUP BY business_day ORDER BY business_day", prevFrom, prevTo),
    all(c.env, "SELECT substr(business_day,1,7) month, COALESCE(SUM(total),0) revenue, COALESCE(SUM(cost_total),0) cogs, COUNT(*) orders FROM sale_order WHERE status='paid' AND business_day >= ? AND business_day <= ? GROUP BY month ORDER BY month", m12, to),
    all(c.env, "SELECT substr(business_day,1,7) month, COALESCE(SUM(amount),0) s FROM ledger_entry WHERE voided=0 AND direction='out' AND category<>'purchase' AND business_day >= ? AND business_day <= ? GROUP BY month", m12, to),
    all(c.env, "SELECT substr(business_day,1,7) month, COALESCE(SUM(amount),0) s FROM cash_movement WHERE direction='out' AND reason<>'purchase' AND business_day >= ? AND business_day <= ? GROUP BY month", m12, to),
    all(c.env, "SELECT CAST(strftime('%w', business_day) AS INTEGER) dow, CAST(((paid_at/1000 + ?) % 86400) / 3600 AS INTEGER) h, COALESCE(SUM(total),0) s, COUNT(*) n FROM sale_order WHERE status='paid' AND business_day BETWEEN ? AND ? GROUP BY dow, h", tz, from, to),
    all(c.env, "SELECT o.business_day day, p.method, COALESCE(SUM(p.amount),0) s FROM payment p JOIN sale_order o ON o.id=p.order_id WHERE o.status='paid' AND p.status='confirmed' AND o.business_day BETWEEN ? AND ? GROUP BY o.business_day, p.method", from, to),
    all(c.env, "SELECT l.item_name name, SUM(l.qty) qty, SUM(CASE WHEN l.comp=1 THEN 0 ELSE l.line_total END) revenue, SUM(l.line_cost) cost FROM order_line l JOIN sale_order o ON o.id=l.order_id WHERE o.status='paid' AND l.status='active' AND o.business_day BETWEEN ? AND ? GROUP BY l.item_name ORDER BY revenue DESC LIMIT 12", from, to),
    all(c.env, "SELECT s.name, COUNT(*) orders, COALESCE(SUM(o.total),0) revenue FROM sale_order o JOIN staff s ON s.id=o.staff_id WHERE o.status='paid' AND o.business_day BETWEEN ? AND ? GROUP BY s.name ORDER BY revenue DESC", from, to),
  ]);
  const opex = new Map<string, number>();
  for (const r of [...monthOpex, ...monthDrawer] as { month: string; s: number }[]) opex.set(r.month, (opex.get(r.month) || 0) + r.s);
  return json({
    from, to, prev_from: prevFrom, prev_to: prevTo, daily, prev_daily: prevDaily,
    months: (months as { month: string; revenue: number; cogs: number; orders: number }[]).map((m) => ({ ...m, opex: opex.get(m.month) || 0, profit: m.revenue - m.cogs - (opex.get(m.month) || 0) })),
    heat, methods, items, staff,
  });
}

// ---------------- verdict & signals ----------------

export type Level = 'good' | 'info' | 'warn' | 'alert';
export interface Finding { level: Level; area: string; title: string; text: string; link?: string }

function weekStart(day: string) {
  const d = new Date(day + 'T00:00:00Z');
  return addDays(day, -((d.getUTCDay() + 6) % 7));
}
const vn = (n: number) => Math.round(n).toLocaleString('vi-VN') + ' ₫';
const pc = (n: number) => (Math.round(n * 10) / 10).toString().replace('.', ',') + '%';

/**
 * Week or month verdict: profit or loss, and the signals bar owners watch for leakage and theft —
 * voids (above all after payment), comps, lines removed after sending, drawer shortages, transfers
 * confirmed by hand instead of by the bank, stock losses at stocktake, cash taken from the drawer,
 * labour cost and unpaid tabs. Thresholds are rules of thumb, explained in each finding.
 */
export async function insights(c: Ctx) {
  requireRole(c, 'owner', 'manager');
  const o = await outlet(c.env);
  const st = parseSettings<{ cost_alert_pct?: number }>(o.settings_json);
  const today = businessDay(now(), o.tz_offset_min, o.business_day_cutoff);
  const period = c.url.searchParams.get('period') === 'week' ? 'week' : 'month';
  const date = c.url.searchParams.get('date') || today;
  need(DAY.test(date), 400, 'Ngày không hợp lệ');
  const start = period === 'week' ? weekStart(date) : date.slice(0, 8) + '01';
  const end = period === 'week' ? addDays(start, 6) : addDays(new Date(Date.UTC(+start.slice(0, 4), +start.slice(5, 7), 1)).toISOString().slice(0, 10), -1);
  const to = end > today ? today : end;
  const partial = end > today;
  need(start <= today, 400, 'Kỳ này chưa bắt đầu');
  const days = daysBetween(start, to);
  // Previous period, same number of days, so a month-to-date compares with the same days last month.
  const prevStart = period === 'week' ? addDays(start, -7) : new Date(Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 2, 1)).toISOString().slice(0, 10);
  const prevTo = addDays(prevStart, days - 1);
  const env = c.env;
  const [cur, prev, daily, voids, voidByStaff, comps, removed, drawers, manualQr, unmatched, stock, labour, salary, cashOut, stale, ordersByStaff] = await Promise.all([
    periodSummary(env, start, to),
    periodSummary(env, prevStart, prevTo),
    all<{ day: string; s: number }>(env, "SELECT business_day day, COALESCE(SUM(total),0) s FROM sale_order WHERE status='paid' AND business_day BETWEEN ? AND ? GROUP BY day", start, to),
    first<{ n: number; v: number; after: number; after_v: number }>(env, `SELECT COUNT(*) n, COALESCE(SUM(subtotal),0) v,
      COALESCE(SUM(CASE WHEN paid_at IS NOT NULL THEN 1 ELSE 0 END),0) after, COALESCE(SUM(CASE WHEN paid_at IS NOT NULL THEN total ELSE 0 END),0) after_v
      FROM sale_order WHERE status='void' AND merged_into IS NULL AND business_day BETWEEN ? AND ?`, start, to),
    all<{ name: string; n: number }>(env, "SELECT s.name, COUNT(*) n FROM sale_order o JOIN staff s ON s.id=o.voided_by WHERE o.status='void' AND o.merged_into IS NULL AND o.business_day BETWEEN ? AND ? GROUP BY s.name ORDER BY n DESC", start, to),
    all<{ name: string; n: number; v: number }>(env, `SELECT COALESCE(s.name,'?') name, SUM(l.qty) n, SUM(l.unit_price*l.qty) v FROM order_line l JOIN sale_order o ON o.id=l.order_id LEFT JOIN staff s ON s.id=l.comp_by
      WHERE l.comp=1 AND l.status='active' AND o.status='paid' AND o.business_day BETWEEN ? AND ? GROUP BY name ORDER BY v DESC`, start, to),
    all<{ name: string; n: number; v: number }>(env, `SELECT COALESCE(s.name,'?') name, SUM(l.qty) n, SUM(l.unit_price*l.qty) v FROM order_line l JOIN sale_order o ON o.id=l.order_id LEFT JOIN staff s ON s.id=l.removed_by
      WHERE l.status='removed' AND o.business_day BETWEEN ? AND ? GROUP BY name ORDER BY n DESC`, start, to),
    first<{ n: number; short_n: number; short: number; over: number }>(env, `SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN difference < 0 THEN 1 ELSE 0 END),0) short_n,
      COALESCE(SUM(CASE WHEN difference < 0 THEN difference ELSE 0 END),0) short, COALESCE(SUM(CASE WHEN difference > 0 THEN difference ELSE 0 END),0) over
      FROM drawer_session WHERE status='closed' AND business_day BETWEEN ? AND ?`, start, to),
    first<{ n: number; v: number }>(env, `SELECT COUNT(*) n, COALESCE(SUM(p.amount),0) v FROM payment p JOIN sale_order o ON o.id=p.order_id
      WHERE p.method='vietqr' AND p.status='confirmed' AND p.bank_txn_id IS NULL AND p.confirmed_by IS NOT NULL AND o.status='paid' AND o.business_day BETWEEN ? AND ?`, start, to),
    first<{ n: number; v: number }>(env, "SELECT COUNT(*) n, COALESCE(SUM(amount),0) v FROM bank_txn WHERE status='unmatched' AND created_at >= ?", Date.parse(start + 'T00:00:00Z') - o.tz_offset_min * 60000),
    first<{ n: number; v: number }>(env, 'SELECT COUNT(*) n, COALESCE(SUM(variance_value),0) v FROM stocktake WHERE business_day BETWEEN ? AND ?', start, to),
    first<{ minutes: number; pay: number }>(env, `SELECT COALESCE(SUM((t.clock_out - t.clock_in)/60000.0 - t.break_min),0) minutes,
      COALESCE(SUM(((t.clock_out - t.clock_in)/60000.0 - t.break_min) * s.hourly_rate / 60.0),0) pay
      FROM time_entry t JOIN staff s ON s.id=t.staff_id WHERE t.deleted_at IS NULL AND t.clock_out IS NOT NULL AND t.business_day BETWEEN ? AND ?`, start, to),
    first<{ v: number }>(env, "SELECT COALESCE(SUM(amount),0) v FROM ledger_entry WHERE voided=0 AND direction='out' AND category='salary' AND business_day BETWEEN ? AND ?", start, to),
    all<{ name: string; n: number; v: number; nophoto: number }>(env, `SELECT COALESCE(s.name,'?') name, COUNT(*) n, COALESCE(SUM(m.amount),0) v, COALESCE(SUM(CASE WHEN m.photo_key IS NULL THEN 1 ELSE 0 END),0) nophoto
      FROM cash_movement m LEFT JOIN staff s ON s.id=m.staff_id WHERE m.direction='out' AND m.business_day BETWEEN ? AND ? GROUP BY name ORDER BY v DESC`, start, to),
    first<{ tabs: number; transfers: number }>(env, `SELECT COALESCE(SUM(CASE WHEN status='open' THEN 1 ELSE 0 END),0) tabs, COALESCE(SUM(CASE WHEN status='awaiting_payment' THEN 1 ELSE 0 END),0) transfers
      FROM sale_order WHERE status IN ('open','awaiting_payment') AND created_at < ?`, now() - 24 * 3600000),
    all<{ name: string; n: number }>(env, "SELECT s.name, COUNT(*) n FROM sale_order o JOIN staff s ON s.id=o.staff_id WHERE o.status IN ('paid','void') AND o.merged_into IS NULL AND o.business_day BETWEEN ? AND ? GROUP BY s.name", start, to),
  ]);

  const f: Finding[] = [];
  const rev = cur.revenue;
  // Labour: the salary actually booked, or the timesheet estimate when nothing is booked yet.
  const labourEst = Math.round(labour?.pay || 0);
  const labourUsed = salary!.v > 0 ? 0 : labourEst; // booked salary is already inside opex
  const profit = cur.pnl.net_profit - labourUsed;
  const margin = rev ? (profit / rev) * 100 : 0;
  const prevProfit = prev.pnl.net_profit;
  const label = period === 'week' ? 'tuần' : 'tháng';

  // 1. Profit or loss
  if (!rev && !cur.pnl.opex) {
    f.push({ level: 'info', area: 'Lãi lỗ', title: `Chưa có số liệu ${label} này`, text: 'Chưa có đơn đã thanh toán hay khoản chi nào trong kỳ.' });
  } else {
    f.push({
      level: profit >= 0 ? 'good' : 'alert', area: 'Lãi lỗ',
      title: profit >= 0 ? `${label[0].toUpperCase() + label.slice(1)} này đang LÃI ${vn(profit)}` : `${label[0].toUpperCase() + label.slice(1)} này đang LỖ ${vn(-profit)}`,
      text: `Doanh thu ${vn(rev)} − giá vốn ${vn(cur.pnl.cogs)} − chi phí ${vn(cur.pnl.opex)}${labourUsed ? ` − lương ước tính theo giờ công ${vn(labourUsed)}` : ''} = ${vn(profit)} (biên lãi ${pc(margin)}).`
        + (partial ? ` Tính đến hôm nay (${days} ngày).` : '')
        + (cur.pnl.opex === 0 ? ' Chưa ghi khoản chi nào (mặt bằng, điện nước…) trong Sổ thu chi nên lãi đang cao hơn thực tế.' : ''),
      link: 'admin/ledger',
    });
  }
  // 2. Revenue trend
  if (prev.revenue > 0 && rev > 0) {
    const d = ((rev - prev.revenue) / prev.revenue) * 100;
    f.push({ level: d >= -10 ? (d >= 5 ? 'good' : 'info') : 'warn', area: 'Doanh thu',
      title: `Doanh thu ${d >= 0 ? 'tăng' : 'giảm'} ${pc(Math.abs(d))} so với cùng số ngày kỳ trước`,
      text: `${vn(rev)} so với ${vn(prev.revenue)}. ${cur.orders} đơn (kỳ trước ${prev.orders}), trung bình ${vn(cur.aov)}/đơn (kỳ trước ${vn(prev.aov)}).`
        + (prevProfit ? ` Lãi kỳ trước: ${vn(prevProfit)}.` : '') });
  }
  if (daily.length >= 3) {
    const sorted = [...daily].sort((a, b) => b.s - a.s);
    const dow = (d: string) => ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][new Date(d + 'T00:00:00Z').getUTCDay()];
    f.push({ level: 'info', area: 'Doanh thu', title: `Ngày đông nhất ${dow(sorted[0].day)} ${sorted[0].day.slice(8)}/${sorted[0].day.slice(5, 7)}: ${vn(sorted[0].s)}`,
      text: `Ngày vắng nhất ${dow(sorted[sorted.length - 1].day)} ${sorted[sorted.length - 1].day.slice(8)}/${sorted[sorted.length - 1].day.slice(5, 7)}: ${vn(sorted[sorted.length - 1].s)}. Có ${days - daily.length} ngày không có đơn nào.` });
  }
  // 3. Cost of goods
  const target = st.cost_alert_pct ?? 30;
  if (rev > 0 && cur.pnl.cogs > 0) {
    const cp = cur.pnl.cogs_pct;
    f.push({ level: cp > target + 5 ? 'alert' : cp > target ? 'warn' : 'good', area: 'Giá vốn',
      title: `Giá vốn ${pc(cp)} doanh thu (mục tiêu ≤ ${target}%)`,
      text: cp > target ? 'Cao hơn mục tiêu: xem món nào lỗ ở trang Giá vốn, kiểm tra giá nhập tăng, rót dư, hoặc mua 1 tặng 1 đang ăn vào lãi.' : 'Trong mức mục tiêu.', link: 'admin/costing' });
  } else if (rev > 0) {
    f.push({ level: 'info', area: 'Giá vốn', title: 'Chưa tính được giá vốn', text: 'Món chưa có công thức hoặc nguyên liệu chưa có giá nhập, nên chưa biết lãi gộp thật.', link: 'admin/costing' });
  }
  // 4. Stock loss at stocktake (pour cost leak / drinks given away without an order)
  if (stock && stock.n > 0) {
    const loss = -Math.min(0, stock.v);
    const lp = cur.pnl.cogs ? (loss / cur.pnl.cogs) * 100 : 0;
    f.push({ level: lp > 5 ? 'alert' : lp > 2 ? 'warn' : 'good', area: 'Hao hụt kho',
      title: loss ? `Kiểm kê thiếu ${vn(loss)} (${pc(lp)} giá vốn)` : 'Kiểm kê khớp sổ',
      text: loss ? 'Rượu, nguyên liệu dùng nhiều hơn công thức × số ly đã bán. Nguyên nhân thường gặp: rót dư, pha hỏng không ghi, uống/cho ly không lên đơn. Trên 2% nên xem từng nguyên liệu.' : `${stock.n} lần kiểm kê trong kỳ.`, link: 'admin/stocktakes' });
  } else if (rev > 0) {
    f.push({ level: 'info', area: 'Hao hụt kho', title: `Chưa kiểm kê ${label} này`, text: 'Kiểm kê rượu mạnh và nguyên liệu chính ít nhất mỗi tuần là cách chắc nhất để phát hiện rót dư hoặc bán không lên đơn.', link: 'admin/stocktake' });
  }
  // 5. Voids
  const orders = cur.orders + (voids?.n || 0);
  if (voids && voids.n > 0) {
    const rate = orders ? (voids.n / orders) * 100 : 0;
    f.push({ level: voids.after > 0 ? 'alert' : rate > 3 ? 'warn' : 'info', area: 'Huỷ đơn',
      title: `${voids.n} đơn huỷ (${pc(rate)} số đơn), trị giá ${vn(voids.v)}`,
      text: (voids.after ? `${voids.after} đơn bị huỷ SAU KHI đã thu tiền (${vn(voids.after_v)}) — dạng gian lận phổ biến nhất: thu tiền rồi huỷ đơn để giữ lại tiền mặt. Kiểm tra từng đơn. ` : '')
        + (rate > 3 ? 'Tỷ lệ huỷ trên 3% là cao với quán bar. ' : '')
        + (voidByStaff.length ? 'Người huỷ: ' + voidByStaff.map((v) => `${v.name} ${v.n}`).join(', ') + '.' : ''), link: 'admin/audit' });
    // A person who voids far more than their share of orders.
    for (const v of voidByStaff) {
      const theirs = ordersByStaff.find((s) => s.name === v.name)?.n || 0;
      if (v.n >= 3 && theirs && v.n / theirs > Math.max(0.06, (2 * voids.n) / Math.max(1, orders))) {
        f.push({ level: 'warn', area: 'Huỷ đơn', title: `${v.name} huỷ ${v.n}/${theirs} đơn của mình`, text: 'Cao gấp đôi mức chung của quán. Chưa chắc là gian lận (có thể do mới, hay bấm nhầm) nhưng nên xem lý do huỷ.', link: 'admin/audit' });
      }
    }
  } else if (cur.orders > 0) {
    f.push({ level: 'good', area: 'Huỷ đơn', title: 'Không có đơn huỷ', text: 'Tốt.' });
  }
  // 6. Comps
  const compV = comps.reduce((s, x) => s + x.v, 0);
  if (compV > 0) {
    const cp = cur.gross ? (compV / cur.gross) * 100 : 0;
    f.push({ level: cp > 5 ? 'warn' : 'info', area: 'Ly mời',
      title: `Mời ${comps.reduce((s, x) => s + x.n, 0)} ly, giá bán ${vn(compV)} (${pc(cp)} doanh thu gộp)`,
      text: 'Người duyệt: ' + comps.map((x) => `${x.name} ${vn(x.v)}`).join(', ') + '.' + (cp > 5 ? ' Trên 5% là nhiều — đặt hạn mức mời theo tuần cho quản lý.' : ''), link: 'admin/audit' });
  }
  // 7. Lines removed after sending to the bar
  const remN = removed.reduce((s, x) => s + x.n, 0);
  if (remN > 0) {
    f.push({ level: remN > 10 ? 'warn' : 'info', area: 'Bỏ món đã gửi', title: `${remN} ly bị bỏ sau khi đã gửi quầy bar (${vn(removed.reduce((s, x) => s + x.v, 0))})`,
      text: 'Theo người bỏ: ' + removed.map((x) => `${x.name} ${x.n}`).join(', ') + '. Ly đã pha mà bị bỏ khỏi đơn có thể là ly bị bán ngoài.', link: 'admin/audit' });
  }
  // 8. Drawer
  if (drawers && drawers.n > 0) {
    f.push({ level: drawers.short_n >= 3 || drawers.short < -200000 ? 'alert' : drawers.short_n > 0 ? 'warn' : 'good', area: 'Két tiền',
      title: drawers.short_n ? `Két thiếu ${drawers.short_n}/${drawers.n} lần đóng, tổng ${vn(-drawers.short)}` : `Két khớp cả ${drawers.n} lần đóng`,
      text: (drawers.short_n >= 3 ? 'Thiếu lặp lại nhiều lần thường không phải do thối nhầm. Đối chiếu ca và người đứng két những ngày thiếu. ' : '')
        + (drawers.over ? `Thừa ${vn(drawers.over)} (thường do quên lên đơn, thu tiền chưa ghi).` : '') });
  }
  if (cashOut.length) {
    const v = cashOut.reduce((s, x) => s + x.v, 0);
    const noPhoto = cashOut.reduce((s, x) => s + x.nophoto, 0);
    f.push({ level: noPhoto > 5 ? 'warn' : 'info', area: 'Chi từ két', title: `Chi từ két ${vn(v)} (${cashOut.reduce((s, x) => s + x.n, 0)} lần)`,
      text: cashOut.map((x) => `${x.name} ${vn(x.v)}`).join(', ') + '.' + (noPhoto ? ` ${noPhoto} khoản không có ảnh hoá đơn.` : ''), link: 'admin/ledger' });
  }
  // 9. Bank transfers
  if (manualQr && manualQr.n > 0) {
    const webhook = !!c.env.BANK_WEBHOOK_KEY;
    f.push({ level: webhook ? 'alert' : 'info', area: 'Chuyển khoản',
      title: `${manualQr.n} đơn chuyển khoản được xác nhận TAY (${vn(manualQr.v)})`,
      text: webhook ? 'Đã bật tự xác nhận qua ngân hàng nhưng vẫn có đơn bấm "đã nhận" bằng tay. Đối chiếu sao kê: đây là chỗ ảnh chuyển khoản giả lọt qua.' : 'Bật tự xác nhận qua SePay để ngân hàng xác nhận thay người.', link: 'admin/bank' });
  }
  if (unmatched && unmatched.n > 0) {
    f.push({ level: 'info', area: 'Chuyển khoản', title: `${unmatched.n} khoản tiền vào chưa khớp đơn (${vn(unmatched.v)})`, text: 'Khách ghi sai nội dung hoặc tiền không phải bán hàng. Khớp tay ở trang Giao dịch ngân hàng.', link: 'admin/bank' });
  }
  // 10. Labour
  if (labour && labour.minutes > 0 && rev > 0) {
    const hours = labour.minutes / 60;
    const lab = salary!.v || labourEst;
    const lp = (lab / rev) * 100;
    f.push({ level: lp > 35 ? 'warn' : 'info', area: 'Nhân sự',
      title: `${Math.round(hours)} giờ công · ${vn(rev / hours)} doanh thu mỗi giờ công`,
      text: lab ? `Chi phí lương ${salary!.v ? 'đã ghi' : 'ước tính theo giờ công'} ${vn(lab)} = ${pc(lp)} doanh thu.${lp > 35 ? ' Trên 35% là cao với quán bar: xem lại lịch ca giờ vắng.' : ''}` : 'Chưa đặt lương giờ nên chưa tính được chi phí lương.', link: 'admin/time' });
  }
  // 11. Loose ends
  if (stale && (stale.tabs || stale.transfers)) {
    f.push({ level: 'warn', area: 'Việc tồn', title: `${stale.tabs} tab/bàn và ${stale.transfers} đơn chờ chuyển khoản treo quá 24 giờ`, text: 'Đơn treo lâu dễ bị quên thu tiền hoặc bị huỷ âm thầm. Thanh toán hoặc huỷ có lý do.' });
  }
  if (cur.tips > 0) f.push({ level: 'info', area: 'Tip', title: `Tip ${vn(cur.tips)}`, text: 'Không tính vào doanh thu. Chia theo người thu ở Tổng quan.' });

  const order: Record<Level, number> = { alert: 0, warn: 1, info: 2, good: 3 };
  const head = f.shift()!;
  f.sort((a, b) => order[a.level] - order[b.level]);
  return json({
    period, from: start, to, end, partial, prev_from: prevStart, prev_to: prevTo,
    summary: { revenue: rev, orders: cur.orders, aov: cur.aov, cogs: cur.pnl.cogs, opex: cur.pnl.opex, labour_estimate: labourUsed, profit, margin, prev_revenue: prev.revenue, prev_profit: prevProfit },
    findings: [head, ...f],
    counts: { alert: f.filter((x) => x.level === 'alert').length + (head.level === 'alert' ? 1 : 0), warn: f.filter((x) => x.level === 'warn').length },
  });
}

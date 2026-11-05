// S22 — end my shift (one tap) or close the shared drawer (count cash, manager, online). S23 — Z-report.
import { useEffect, useState } from 'react';
import { DENOMINATIONS, type ZReport } from '../../shared/types';
import { fmtDay, hhmm, vnd } from '../../shared/util';
import { api } from '../lib/api';
import { kv } from '../lib/db';
import { endMyShift, openEntry, getManagerSession, getState, lock, navigate, setState, staffName, toast, useStore, orderTitle } from '../lib/store';
import { runSync } from '../lib/sync';
import { Icon, Sheet, TopBar } from '../ui';

export default function CloseShift() {
  const staff = useStore((s) => s.staff)!;
  const shift = useStore((s) => s.shift);
  const drawer = useStore((s) => s.drawer);
  const orders = useStore((s) => s.orders);
  const net = useStore((s) => s.net);
  const [mode, setMode] = useState<'menu' | 'count' | 'report'>('menu');
  const [askEnd, setAskEnd] = useState(false);
  useStore((s) => s.timeEntries);
  const clocked = openEntry(staff.id);
  const tz = useStore((s) => s.config!.outlet.tz_offset_min);
  const [z, setZ] = useState<ZReport | null>(null);
  const myShiftOrders = orders.filter((o) => shift && o.staff_shift_id === shift.id && o.status === 'paid');
  const awaiting = orders.filter((o) => o.status === 'awaiting_payment' && o.drawer_session_id === drawer?.id);
  const openTabs = orders.filter((o) => o.status === 'open');
  const myTips = myShiftOrders.reduce((s, o) => s + (o.tip_total || 0), 0);

  if (mode === 'report' && z) return <ZView z={z} />;
  if (mode === 'count' && drawer) return <CountDrawer onBack={() => setMode('menu')} onClosed={(r) => { setZ(r); setMode('report'); }} />;

  return (
    <div className="screen">
      <TopBar title="Kết ca / Đóng két" onBack={() => navigate('order')} />
      <div className="scroll pad col gap16" style={{ paddingTop: 0 }}>
        <div className="card col gap12">
          <div className="bold">Kết thúc ca của tôi</div>
          <div className="small muted">{shift ? `Bắt đầu ${new Date(shift.started_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} · ${myShiftOrders.length} đơn · ${vnd(myShiftOrders.reduce((s, o) => s + o.total, 0))}${myTips ? ` · tip ${vnd(myTips)}` : ''}` : 'Bạn chưa mở ca'}</div>
          <p className="small muted" style={{ margin: 0 }}>Két vẫn mở cho người khác. Không cần đếm tiền.</p>
          <button className="btn block" onClick={() => setAskEnd(true)}><Icon name="door" />Kết thúc ca & đăng xuất</button>
        </div>
        <div className="card col gap12">
          <div className="bold">Đóng két cuối ngày</div>
          {drawer ? (
            <div className="small muted">Két mở {fmtDay(drawer.business_day)} lúc {new Date(drawer.opened_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} bởi {staffName(drawer.opened_by)} · đầu ca {vnd(drawer.opening_float)}</div>
          ) : <div className="small muted">Không có két đang mở.</div>}
          {net.pending > 0 && <div className="banner">Còn {net.pending} bản ghi chưa đồng bộ trên máy này. Đồng bộ trước khi đóng két.</div>}
          {awaiting.length > 0 && <div className="banner">Còn {awaiting.length} đơn chờ chuyển khoản. Xác nhận hoặc huỷ trước khi đóng.</div>}
          {openTabs.length > 0 && <div className="banner danger">Còn {openTabs.length} tab đang mở ({openTabs.map((t) => orderTitle(t) || t.short_code).join(', ')}). Thanh toán hoặc huỷ tab trước khi đóng két.</div>}
          {!net.online && <div className="banner danger">Đóng két cần có mạng để cộng tiền từ tất cả máy.</div>}
          <p className="small muted" style={{ margin: 0 }}>Cần quản lý. Ca của mọi người trên két này sẽ kết thúc.</p>
          <button className="btn primary block" disabled={!drawer || !net.online || openTabs.length > 0} onClick={async () => { await runSync(); setMode('count'); }}>Đếm tiền & đóng két</button>
        </div>
        <p className="small faint">Đang đăng nhập: {staff.name}</p>
      </div>
      {askEnd && (
        <Sheet middle onClose={() => setAskEnd(false)}>
          <h2>Kết thúc ca?</h2>
          <p className="small muted" style={{ marginTop: 4 }}>Bạn sẽ được đăng xuất khỏi máy bán hàng.{clocked ? ` Đang chấm công từ ${hhmm(clocked.clock_in, tz)}.` : ''}</p>
          <div className="col gap12 mt16">
            {clocked && <button className="btn primary lg" onClick={() => { setAskEnd(false); endMyShift(true); }}><Icon name="clock" size={20} />Kết ca & chấm công ra</button>}
            <button className={'btn lg' + (clocked ? '' : ' primary')} onClick={() => { setAskEnd(false); endMyShift(false); }}>{clocked ? 'Chỉ đăng xuất (vẫn đang làm)' : 'Kết thúc ca'}</button>
            <button className="btn ghost" onClick={() => setAskEnd(false)}>Huỷ</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function CountDrawer({ onBack, onClosed }: { onBack: () => void; onClosed: (z: ZReport) => void }) {
  const drawer = useStore((s) => s.drawer)!;
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [pre, setPre] = useState<ZReport | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<ZReport>('GET', `/api/drawer/${drawer.id}/zreport`).then(setPre).catch((e) => toast(e.message, true)); }, [drawer.id]);
  const counted = Object.entries(counts).reduce((s, [d, n]) => s + Number(d) * (n || 0), 0);
  const diff = pre ? counted - pre.expected_cash : 0;
  const close = async () => {
    setBusy(true);
    try {
      const m = await getManagerSession('Đóng két cần quản lý nhập PIN', 'approve');
      if (!m) return;
      const r = await api<ZReport>('POST', `/api/drawer/${drawer.id}/close`, { counted: counts, note: note.trim() || undefined }, { session: m.session });
      const drawers = getState().drawers.map((d) => (d.id === drawer.id ? { ...d, status: 'closed' as const } : d));
      await kv.set('drawers', drawers);
      const me = getState().staff;
      if (me && getState().shift) await kv.set('shift:' + me.id, { ...getState().shift, ended_at: Date.now() });
      setState({ drawers, drawer: null, shift: null });
      runSync();
      onClosed(r);
    } catch (e) {
      toast((e as Error).message, true);
    } finally { setBusy(false); }
  };
  return (
    <div className="screen">
      <TopBar title="Đóng két" sub={`Ngày kinh doanh ${fmtDay(drawer.business_day)}`} onBack={onBack} />
      <div className="scroll pad col" style={{ paddingTop: 0 }}>
        {DENOMINATIONS.map((d) => (
          <div key={d} className="row between" style={{ padding: '4px 0' }}>
            <span className="mono" style={{ width: 90 }}>{vnd(d, false)}</span>
            <input className="input mono" style={{ width: 110, textAlign: 'center' }} inputMode="numeric" placeholder="0" value={counts[d] ?? ''}
              onChange={(e) => setCounts({ ...counts, [d]: parseInt(e.target.value.replace(/\D/g, ''), 10) || 0 })} />
            <span className="mono right" style={{ width: 110 }}>{vnd(d * (counts[d] || 0), false)}</span>
          </div>
        ))}
        <div className="card col mt16" style={{ gap: 0 }}>
          <div className="kv"><span className="muted">Đếm được</span><span className="mono bold">{vnd(counted)}</span></div>
          <div className="kv"><span className="muted">Dự kiến</span><span className="mono">{pre ? vnd(pre.expected_cash) : '…'}</span></div>
          <div className="kv small faint"><span>= đầu ca {pre ? vnd(pre.opening_float, false) : ''} + tiền mặt bán {pre ? vnd(pre.cash_sales, false) : ''} + tip tiền mặt {pre ? vnd(pre.tips.cash, false) : ''} + thu {pre ? vnd(pre.cash_in, false) : ''} − chi {pre ? vnd(pre.cash_out, false) : ''}</span></div>
          <div className={'kv total ' + (diff === 0 ? 'ok' : 'danger')}><span>Chênh lệch</span><span className="mono">{pre ? (diff > 0 ? '+' : '') + vnd(diff) : '…'}</span></div>
        </div>
        {pre && pre.pending_vietqr > 0 && <div className="banner mt8">{pre.pending_vietqr} đơn chờ chuyển khoản chưa được tính.</div>}
        <label className="field mt16"><span>Ghi chú {diff !== 0 ? '(bắt buộc khi chênh lệch)' : ''}</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      <div className="cartbar"><button className="btn primary lg block" disabled={busy || !pre || (diff !== 0 && !note.trim())} onClick={close}>Đóng két</button></div>
    </div>
  );
}

function ZView({ z }: { z: ZReport }) {
  const tz = useStore((s) => s.config!.outlet.tz_offset_min);
  const row = (k: string, v: string, cls = '') => <div className={'kv ' + cls}><span className="muted">{k}</span><span className="mono">{v}</span></div>;
  return (
    <div className="screen">
      <TopBar title="Báo cáo cuối ca (Z)" sub={`Ngày kinh doanh ${fmtDay(z.business_day)}`} />
      <div className="scroll pad col gap12" style={{ paddingTop: 0 }}>
        <div className="card col" style={{ gap: 0 }}>
          {row('Mở / đóng', `${hhmm(z.opened_at, tz)} – ${z.closed_at ? hhmm(z.closed_at, tz) : ''}`)}
          {row('Số đơn', String(z.orders))}
          {row('Doanh thu gộp', vnd(z.gross_sales))}
          {row('Khuyến mãi / giảm giá', '−' + vnd(z.promo_total + z.discount_total))}
          {row('Doanh thu thuần', vnd(z.net_sales), 'total')}
        </div>
        <div className="card col" style={{ gap: 0 }}>
          {row('Tiền mặt', vnd(z.by_method.cash))}
          {row('VietQR', vnd(z.by_method.vietqr))}
          {row('Thẻ', vnd(z.by_method.card))}
          {row('Đơn huỷ', `${z.voids} · ${vnd(z.void_value)}`)}
          {row('Ly mời (giá bán)', vnd(z.comp_value ?? 0))}
          {row('Tip', `${vnd((z.tips?.cash ?? 0) + (z.tips?.vietqr ?? 0) + (z.tips?.card ?? 0))} (tiền mặt ${vnd(z.tips?.cash ?? 0, false)})`)}
        </div>
        <div className="card col" style={{ gap: 0 }}>
          {row('Đầu ca', vnd(z.opening_float))}
          {row('Thu / chi két', `+${vnd(z.cash_in, false)} / −${vnd(z.cash_out, false)}`)}
          {row('Dự kiến trong két', vnd(z.expected_cash))}
          {row('Đếm được', vnd(z.counted_cash ?? 0))}
          {row('Chênh lệch', vnd(z.difference ?? 0), 'total ' + ((z.difference ?? 0) === 0 ? 'ok' : 'danger'))}
        </div>
      </div>
      <div className="cartbar"><button className="btn primary lg block" onClick={lock}>Đăng xuất</button></div>
    </div>
  );
}

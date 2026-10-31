// S02 — open the shared drawer with a float (first person of the day), or just start my shift.
import { useState } from 'react';
import { DENOMINATIONS } from '../../shared/types';
import { fmtDay, vnd } from '../../shared/util';
import { lock, openDrawerAndShift, staffName, today, useStore } from '../lib/store';
import { MoneyInput, TopBar } from '../ui';

export default function OpenShift() {
  const drawer = useStore((s) => s.drawer);
  const staff = useStore((s) => s.staff)!;
  const cfg = useStore((s) => s.config)!;
  const [float, setFloat] = useState(500000);
  const [byDenom, setByDenom] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const counted = Object.entries(counts).reduce((s, [d, n]) => s + Number(d) * (n || 0), 0);
  const amount = byDenom ? counted : float;
  const go = async () => { setBusy(true); try { await openDrawerAndShift(amount, byDenom ? counts : null); } finally { setBusy(false); } };

  return (
    <div className="screen">
      <TopBar title="Mở ca" sub={`${staff.name} · ngày kinh doanh ${fmtDay(today())}`} onBack={lock} />
      <div className="scroll pad col gap16">
        {drawer ? (
          <>
            <div className="banner ok">Két đang mở từ {new Date(drawer.opened_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} bởi {staffName(drawer.opened_by)} · đầu ca {vnd(drawer.opening_float)}</div>
            <p className="muted">Bạn dùng chung két này. Bắt đầu ca để ghi giờ làm và doanh số của bạn.</p>
          </>
        ) : (
          <>
            <p className="muted" style={{ margin: 0 }}>Bạn là người đầu tiên hôm nay. Đếm tiền đầu ca trong két ({cfg.outlet.name}).</p>
            {!byDenom && <MoneyInput label="Tiền đầu ca" value={float} onChange={setFloat} />}
            <label className="check"><input type="checkbox" checked={byDenom} onChange={(e) => setByDenom(e.target.checked)} /> Đếm theo mệnh giá</label>
            {byDenom && (
              <div className="col">
                {DENOMINATIONS.map((d) => (
                  <div key={d} className="row between">
                    <span className="mono" style={{ width: 90 }}>{vnd(d, false)}</span>
                    <input className="input mono" style={{ width: 110, textAlign: 'center' }} inputMode="numeric" value={counts[d] ?? ''} placeholder="0"
                      onChange={(e) => setCounts({ ...counts, [d]: parseInt(e.target.value.replace(/\D/g, ''), 10) || 0 })} />
                    <span className="mono right" style={{ width: 110 }}>{vnd(d * (counts[d] || 0), false)}</span>
                  </div>
                ))}
                <div className="kv total"><span>Tổng</span><span className="mono">{vnd(counted)}</span></div>
              </div>
            )}
          </>
        )}
      </div>
      <div className="cartbar">
        <button className="btn primary lg block" disabled={busy} onClick={go}>{drawer ? 'Bắt đầu ca' : `Mở két · ${vnd(amount)}`}</button>
      </div>
    </div>
  );
}

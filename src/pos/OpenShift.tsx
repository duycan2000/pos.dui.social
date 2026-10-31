// S02 — open the shared drawer with a float (first person of the day), or just start my shift.
import { useState } from 'react';
import { DENOMINATIONS } from '../../shared/types';
import { fmtDay, vnd } from '../../shared/util';
import { lock, openDrawerAndShift, staffName, today, useStore } from '../lib/store';
import { Icon, Keypad, Segmented, TopBar } from '../ui';

export default function OpenShift() {
  const drawer = useStore((s) => s.drawer);
  const staff = useStore((s) => s.staff)!;
  const [float, setFloat] = useState(500000);
  const [mode, setMode] = useState<'amount' | 'denoms'>('amount');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const counted = Object.entries(counts).reduce((s, [d, n]) => s + Number(d) * (n || 0), 0);
  const amount = mode === 'denoms' ? counted : float;
  const go = async () => { setBusy(true); try { await openDrawerAndShift(amount, mode === 'denoms' ? counts : null); } finally { setBusy(false); } };

  return (
    <div className="screen">
      <TopBar title={drawer ? 'Bắt đầu ca' : 'Mở két'} sub={`${staff.name} · ngày kinh doanh ${fmtDay(today())}`} onBack={lock} />
      <div className="scroll pad col gap16">
        {drawer ? (
          <div className="card col gap12">
            <div className="row gap12">
              <div className="iconbtn" style={{ background: 'var(--ok-soft)', color: 'var(--ok)' }}><Icon name="wallet" /></div>
              <div className="col" style={{ gap: 2 }}>
                <b>Két đang mở</b>
                <span className="small muted">Từ {new Date(drawer.opened_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} · {staffName(drawer.opened_by)} · đầu ca {vnd(drawer.opening_float)}</span>
              </div>
            </div>
            <p className="small muted" style={{ margin: 0 }}>Bạn dùng chung két này. Bắt đầu ca để ghi giờ làm, doanh số và tip của bạn.</p>
          </div>
        ) : (
          <>
            <p className="muted" style={{ margin: 0 }}>Bạn là người đầu tiên hôm nay. Đếm tiền lẻ để sẵn trong két.</p>
            <Segmented value={mode} onChange={setMode} options={[['amount', 'Nhập tổng'], ['denoms', 'Đếm theo mệnh giá']]} />
            {mode === 'amount' ? (
              <>
                <div className="amount-card"><div className="label">Tiền đầu ca</div><div className="value">{vnd(float)}</div></div>
                <Keypad value={float} onChange={setFloat} />
              </>
            ) : (
              <div className="list">
                {DENOMINATIONS.map((d) => (
                  <div key={d} className="li">
                    <span className="mono grow">{vnd(d, false)}</span>
                    <input className="input mono" style={{ width: 96, textAlign: 'center' }} inputMode="numeric" value={counts[d] ?? ''} placeholder="0" aria-label={`Số tờ ${vnd(d)}`}
                      onChange={(e) => setCounts({ ...counts, [d]: parseInt(e.target.value.replace(/\D/g, ''), 10) || 0 })} />
                    <span className="mono right muted" style={{ width: 96 }}>{vnd(d * (counts[d] || 0), false)}</span>
                  </div>
                ))}
                <div className="li"><b className="grow">Tổng</b><b className="mono">{vnd(counted)}</b></div>
              </div>
            )}
          </>
        )}
      </div>
      <div className="ticketbar">
        <button className="btn primary xl block" disabled={busy} onClick={go}>{drawer ? 'Bắt đầu ca' : `Mở két · ${vnd(amount)}`}</button>
      </div>
    </div>
  );
}

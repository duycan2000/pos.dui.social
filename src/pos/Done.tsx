// S15 — paid. Shows change; returns to a new order after a few seconds (configurable).
import { useEffect, useState } from 'react';
import { vnd } from '../../shared/util';
import { navigate, settings, useStore } from '../lib/store';
import { Icon } from '../ui';

export default function Done() {
  const last = useStore((s) => s.lastPaid);
  const secs = settings().done_return_seconds ?? 5;
  const [left, setLeft] = useState(last?.change ? Math.max(secs, 8) : secs);
  useEffect(() => {
    if (left <= 0) { navigate('order'); return; }
    const t = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  if (!last) { navigate('order'); return null; }
  const o = last.order;
  return (
    <div className="screen">
      <div className="scroll pad col center" style={{ alignItems: 'center', gap: 12, paddingTop: 64 }}>
        <div style={{ width: 88, height: 88, borderRadius: 44, background: 'var(--ok-soft)', color: 'var(--ok)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="check" size={48} /></div>
        <div className="big">Đã thanh toán</div>
        <div className="muted">#{o.short_code}{o.customer_label ? ` · ${o.customer_label}` : ''} · {vnd(o.total)}</div>
        {last.change > 0 && (
          <div className="card col center" style={{ alignItems: 'center', minWidth: 240 }}>
            <span className="muted">Tiền thối</span>
            <span className="huge mono accent">{vnd(last.change)}</span>
          </div>
        )}
        <p className="small faint">In hoá đơn sẽ có ở bản P2 (máy in Bluetooth).</p>
      </div>
      <div className="cartbar"><button className="btn primary lg block" onClick={() => navigate('order')}>Đơn mới ({left}s)</button></div>
    </div>
  );
}

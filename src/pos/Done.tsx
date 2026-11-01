// S15 — paid. Change in big type, print/reprint, and back to a new order after a few seconds.
import { useEffect, useState } from 'react';
import { vnd } from '../../shared/util';
import { printerSettings } from '../lib/printer';
import { receiptDoc, tryPrint } from '../lib/receipts';
import { navigate, settings, toast, useStore, orderTitle } from '../lib/store';
import { Icon } from '../ui';

export default function Done() {
  const last = useStore((s) => s.lastPaid);
  const cfg = useStore((s) => s.config)!;
  const secs = settings().done_return_seconds ?? 5;
  const [left, setLeft] = useState(last?.change ? Math.max(secs, 10) : secs);
  const [paused, setPaused] = useState(false);
  const back = last?.order.table_id ? 'tables' : 'order';
  useEffect(() => {
    if (paused) return;
    if (left <= 0) { navigate(back); return; }
    const t = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(t);
  }, [left, paused]);
  if (!last) { navigate('order'); return null; }
  const o = last.order;
  const tip = o.tip_total || 0;
  const print = async () => {
    setPaused(true);
    const err = await tryPrint(receiptDoc(cfg, o));
    toast(err ?? 'Đã gửi lệnh in', !!err);
  };
  return (
    <div className="screen">
      <div className="scroll pad col center" style={{ alignItems: 'center', gap: 14, paddingTop: 64 }}>
        <div className="success-ring">
          <Icon name="check" size={52} />
          {/* a small burst of confetti, pure CSS */}
          <span className="burst" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <i key={i} style={{ ['--a' as string]: `${i * 30}deg`, ['--d' as string]: `${(i % 3) * 40}ms` }} />)}</span>
        </div>
        <div className="big">Đã thanh toán</div>
        <div className="muted">#{o.short_code}{orderTitle(o) ? ` · ${orderTitle(o)}` : ''} · {vnd(o.total)}</div>
        {last.change > 0 && (
          <div className="card col center" style={{ alignItems: 'center', minWidth: 260, gap: 2 }}>
            <span className="muted small">Tiền thối cho khách</span>
            <span className="huge mono accent">{vnd(last.change)}</span>
          </div>
        )}
        {tip > 0 && <span className="badge ok">Tip {vnd(tip)}</span>}
        <button className="btn" onClick={print}><Icon name="printer" size={20} />{printerSettings().mode === 'none' ? 'Cài máy in để in hoá đơn' : 'In hoá đơn'}</button>
      </div>
      <div className="ticketbar"><button className="btn primary xl block" onClick={() => navigate(back)}>{back === 'tables' ? 'Về sơ đồ bàn' : 'Đơn mới'} {paused ? '' : `(${left}s)`}</button></div>
    </div>
  );
}

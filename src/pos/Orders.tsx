// S16 — today's orders. Staff see their own; managers see all devices.
import { useEffect, useState } from 'react';
import type { Order } from '../../shared/types';
import { fmtDay, hhmm, vnd } from '../../shared/util';
import { outbox } from '../lib/db';
import { can, navigate, staffName, today, useStore, orderTitle } from '../lib/store';
import { Empty, Segmented, TopBar } from '../ui';

const METHOD: Record<string, string> = { cash: 'Tiền mặt', vietqr: 'VietQR', card: 'Thẻ' };
type F = 'all' | 'paid' | 'awaiting_payment' | 'open' | 'void';

export function methodLabel(o: Order) {
  const m = [...new Set(o.payments.filter((p) => p.status !== 'cancelled').map((p) => METHOD[p.method]))];
  return m.join(' + ') || (o.status === 'open' ? 'Tab đang mở' : '—');
}

export default function Orders() {
  const orders = useStore((s) => s.orders);
  const staff = useStore((s) => s.staff)!;
  const cfg = useStore((s) => s.config)!;
  const pendingFlag = useStore((s) => s.net.pending);
  const [f, setF] = useState<F>('all');
  const [unsynced, setUnsynced] = useState<Set<string>>(new Set());
  useEffect(() => { outbox.all().then((r) => setUnsynced(new Set(r.filter((x) => x.type === 'order').map((x) => x.id)))); }, [pendingFlag, orders]);
  const day = today();
  const mine = can('orders_all', staff) ? orders : orders.filter((o) => o.staff_id === staff.id);
  const todays = mine.filter((o) => o.business_day === day || o.status === 'awaiting_payment' || o.status === 'open');
  const list = todays.filter((o) => f === 'all' || o.status === f);
  const paidSum = todays.filter((o) => o.status === 'paid' && o.business_day === day).reduce((s, o) => s + o.total, 0);
  const cnt = (s: F) => todays.filter((o) => o.status === s).length;

  return (
    <div className="screen wide">
      <TopBar title="Đơn hôm nay" sub={`${fmtDay(day)} · ${can('orders_all', staff) ? 'tất cả máy' : 'của bạn'} · đã thu ${vnd(paidSum)}`} onBack={() => navigate('order')} />
      <div className="scroll pad col gap12" style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
        <Segmented value={f} onChange={setF} options={[['all', 'Tất cả'], ['paid', `Đã TT`], ['awaiting_payment', `Chờ CK ${cnt('awaiting_payment') || ''}`], ['open', `Tab ${cnt('open') || ''}`], ['void', 'Huỷ']]} />
        {!list.length && <Empty>Chưa có đơn</Empty>}
        {list.length > 0 && (
          <div className="list">
            {list.map((o) => (
              <button key={o.id} className="li" onClick={() => navigate('order/' + o.id)}>
                <div className="grow col" style={{ gap: 2 }}>
                  <span className="semibold">#{o.short_code}<span className="muted"> · {hhmm(o.created_at, cfg.outlet.tz_offset_min)}{orderTitle(o) ? ` · ${orderTitle(o)}` : ''}</span></span>
                  <span className="small muted">{methodLabel(o)} · {staffName(o.staff_id)}{unsynced.has(o.id) && <span className="accent"> · chưa đồng bộ</span>}{o.tip_total ? <span className="ok"> · tip {vnd(o.tip_total, false)}</span> : null}</span>
                </div>
                {o.status === 'awaiting_payment' && <span className="badge info">Chờ CK</span>}
                {o.status === 'open' && <span className="badge">Tab</span>}
                {o.status === 'void' && <span className="badge danger">Huỷ</span>}
                <span className={'mono semibold' + (o.status === 'void' ? ' faint' : '')} style={o.status === 'void' ? { textDecoration: 'line-through' } : undefined}>{vnd(o.total, false)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

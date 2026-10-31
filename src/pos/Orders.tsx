// S16 — today's orders. Staff see their own; managers see all devices.
import { useEffect, useState } from 'react';
import type { Order } from '../../shared/types';
import { fmtDay, hhmm, vnd } from '../../shared/util';
import { outbox } from '../lib/db';
import { isManager, navigate, staffName, today, useStore } from '../lib/store';
import { Empty, TopBar } from '../ui';

const FILTERS = [['all', 'Tất cả'], ['paid', 'Đã TT'], ['awaiting_payment', 'Chờ CK'], ['void', 'Đã huỷ']] as const;
const METHOD: Record<string, string> = { cash: 'Tiền mặt', vietqr: 'VietQR', card: 'Thẻ' };

export function methodLabel(o: Order) {
  const m = [...new Set(o.payments.filter((p) => p.status !== 'cancelled').map((p) => METHOD[p.method]))];
  return m.join(' + ') || '—';
}

export default function Orders() {
  const orders = useStore((s) => s.orders);
  const staff = useStore((s) => s.staff)!;
  const cfg = useStore((s) => s.config)!;
  const pendingFlag = useStore((s) => s.net.pending);
  const [f, setF] = useState<(typeof FILTERS)[number][0]>('all');
  const [unsynced, setUnsynced] = useState<Set<string>>(new Set());
  useEffect(() => { outbox.all().then((r) => setUnsynced(new Set(r.filter((x) => x.type === 'order').map((x) => x.id)))); }, [pendingFlag, orders]);
  const day = today();
  const mine = isManager(staff) ? orders : orders.filter((o) => o.staff_id === staff.id);
  const list = mine.filter((o) => (o.business_day === day || o.status === 'awaiting_payment') && (f === 'all' || o.status === f));
  const paidSum = mine.filter((o) => o.business_day === day && o.status === 'paid').reduce((s, o) => s + o.total, 0);

  return (
    <div className="screen">
      <TopBar title="Đơn hôm nay" sub={`Ngày kinh doanh ${fmtDay(day)} · ${isManager(staff) ? 'tất cả máy' : 'của bạn'} · ${vnd(paidSum)}`} onBack={() => navigate('order')} />
      <nav className="chips">
        {FILTERS.map(([k, l]) => <button key={k} className={'chip' + (f === k ? ' on' : '')} onClick={() => setF(k)}>{l}{k === 'awaiting_payment' ? ` (${mine.filter((o) => o.status === 'awaiting_payment').length})` : ''}</button>)}
      </nav>
      <div className="scroll">
        {!list.length && <Empty>Chưa có đơn</Empty>}
        <div className="list">
          {list.map((o) => (
            <button key={o.id} className="li" onClick={() => navigate('order/' + o.id)}>
              <div className="grow col" style={{ gap: 2 }}>
                <span className="bold">#{o.short_code} · {hhmm(o.created_at, cfg.outlet.tz_offset_min)}{o.customer_label ? ` · ${o.customer_label}` : ''}</span>
                <span className="small muted">{methodLabel(o)} · {staffName(o.staff_id)}{unsynced.has(o.id) ? ' · ' : ''}{unsynced.has(o.id) && <span className="warn">chưa đồng bộ</span>}</span>
              </div>
              {o.status === 'awaiting_payment' && <span className="badge">Chờ CK</span>}
              {o.status === 'void' && <span className="badge danger">Huỷ</span>}
              <span className={'mono bold' + (o.status === 'void' ? ' faint' : '')} style={o.status === 'void' ? { textDecoration: 'line-through' } : undefined}>{vnd(o.total, false)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// S17 — order detail. Confirm a pending transfer, or void with reason + manager approval (S18).
import { useState } from 'react';
import { hhmm, vnd } from '../../shared/util';
import { confirmTransfer, navigate, optionLabel, requestApproval, staffName, useStore, voidOrder } from '../lib/store';
import { Icon, TopBar } from '../ui';
import { QrImage } from './Checkout';
import { methodLabel } from './Orders';

const STATUS: Record<string, string> = { paid: 'Đã thanh toán', awaiting_payment: 'Chờ chuyển khoản', void: 'Đã huỷ', open: 'Đang mở' };

export default function OrderDetail({ id }: { id: string }) {
  const o = useStore((s) => s.orders.find((x) => x.id === id));
  const cfg = useStore((s) => s.config)!;
  const [showQr, setShowQr] = useState(false);
  if (!o) return <div className="screen"><TopBar title="Không tìm thấy đơn" onBack={() => navigate('orders')} /></div>;
  const tz = cfg.outlet.tz_offset_min;
  const doVoid = async () => {
    const r = await requestApproval({ title: `Huỷ đơn #${o.short_code} · ${vnd(o.total)}`, reasonRequired: true, reasons: ['Sai món', 'Khách đổi ý', 'Nhập trùng', 'Khách không trả'] });
    if (r) await voidOrder(o.id, r.reason, r.approver.id);
  };
  return (
    <div className="screen">
      <TopBar title={`#${o.short_code}`} sub={STATUS[o.status]} onBack={() => navigate('orders')} />
      <div className="scroll pad col gap12" style={{ paddingTop: 0 }}>
        <div className="card col" style={{ gap: 0 }}>
          <div className="kv"><span className="muted">Giờ / nhân viên</span><span>{hhmm(o.created_at, tz)} · {staffName(o.staff_id)}</span></div>
          {o.customer_label && <div className="kv"><span className="muted">Khách</span><span>{o.customer_label}</span></div>}
          <div className="kv"><span className="muted">Loại</span><span>{{ takeaway: 'Mang đi', dine_in: 'Tại chỗ', message: 'Tin nhắn' }[o.order_type]}</span></div>
        </div>
        <div className="card col" style={{ gap: 0 }}>
          {o.lines.filter((l) => l.status === 'active').map((l) => (
            <div key={l.id} className="kv">
              <span>{l.qty}× {l.item_name}{optionLabel(l.modifiers) || l.note ? <span className="small muted"><br />{[optionLabel(l.modifiers), l.note].filter(Boolean).join(' · ')}</span> : null}</span>
              <span className="mono">{vnd(l.line_total, false)}</span>
            </div>
          ))}
          {o.adjustments.map((a) => <div key={a.id} className="kv small"><span className="accent">{a.kind === 'promo' ? 'Mua 1 tặng 1' : 'Giảm giá'}</span><span className="mono accent">−{vnd(a.amount, false)}</span></div>)}
          <div className="kv total"><span>Tổng</span><span className="mono">{vnd(o.total)}</span></div>
          <div className="kv small"><span className="muted">Thanh toán</span><span>{methodLabel(o)}</span></div>
          {o.payments.filter((p) => p.change_given > 0).map((p) => <div key={p.id} className="kv small"><span className="muted">Khách đưa / thối</span><span className="mono">{vnd(p.tendered || 0, false)} / {vnd(p.change_given, false)}</span></div>)}
        </div>
        {o.status === 'void' && <div className="banner danger">Huỷ lúc {o.voided_at ? hhmm(o.voided_at, tz) : ''} bởi {staffName(o.voided_by)} · duyệt {staffName(o.approved_by)} · lý do: {o.void_reason}</div>}
        {o.status === 'awaiting_payment' && (
          <div className="card col gap12">
            <span className="small muted">Chờ chuyển khoản {vnd(o.total)} · nội dung {o.payments.find((p) => p.method === 'vietqr')?.reference}</span>
            {showQr ? <QrImage amount={o.total} code={o.short_code} /> : <button className="btn" onClick={() => setShowQr(true)}><Icon name="qr" />Hiện lại mã QR</button>}
          </div>
        )}
      </div>
      <div className="cartbar col">
        {o.status === 'awaiting_payment' && <button className="btn ok lg block" onClick={() => confirmTransfer(o.id)}><Icon name="check" />Đã nhận chuyển khoản</button>}
        {o.status !== 'void' && <button className="btn danger block" onClick={doVoid}>Huỷ đơn (void)</button>}
        <p className="tiny faint" style={{ textAlign: 'center', margin: 0 }}>Đơn đã thanh toán không sửa được. Hoàn tiền một phần và in lại hoá đơn có ở bản P2.</p>
      </div>
    </div>
  );
}

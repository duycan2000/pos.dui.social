// S17 — order detail: reprint, confirm a pending transfer, open a tab, or void with reason + manager (S18).
import { useState } from 'react';
import { hhmm, vnd } from '../../shared/util';
import { receiptDoc, tryPrint } from '../lib/receipts';
import { confirmTransfer, navigate, openTab, optionLabel, requestApproval, staffName, toast, useStore, voidOrder } from '../lib/store';
import { Icon, TopBar } from '../ui';
import { QrImage } from './Checkout';
import { methodLabel } from './Orders';

const STATUS: Record<string, string> = { paid: 'Đã thanh toán', awaiting_payment: 'Chờ chuyển khoản', void: 'Đã huỷ', open: 'Tab đang mở' };

export default function OrderDetail({ id }: { id: string }) {
  const o = useStore((s) => s.orders.find((x) => x.id === id));
  const cfg = useStore((s) => s.config)!;
  const [showQr, setShowQr] = useState(false);
  if (!o) return <div className="screen"><TopBar title="Không tìm thấy đơn" onBack={() => navigate('orders')} /></div>;
  const tz = cfg.outlet.tz_offset_min;
  const doVoid = async () => {
    const r = await requestApproval({ title: `Huỷ ${o.status === 'open' ? 'tab' : 'đơn'} #${o.short_code} · ${vnd(o.total)}`, reasonRequired: true, reasons: ['Sai món', 'Khách đổi ý', 'Nhập trùng', 'Khách không trả'] });
    if (r) await voidOrder(o.id, r.reason, r.approver.id);
  };
  const print = async () => { const err = await tryPrint(receiptDoc(cfg, o)); toast(err ?? 'Đã gửi lệnh in', !!err); };
  return (
    <div className="screen">
      <TopBar title={`#${o.short_code}${o.customer_label ? ' · ' + o.customer_label : ''}`} sub={STATUS[o.status]} onBack={() => navigate('orders')}
        right={o.status === 'paid' ? <button className="iconbtn" aria-label="In lại hoá đơn" onClick={print}><Icon name="printer" /></button> : undefined} />
      <div className="scroll pad col gap12">
        <div className="card col" style={{ gap: 0 }}>
          <div className="kv"><span className="muted">Giờ · nhân viên</span><span>{hhmm(o.created_at, tz)} · {staffName(o.staff_id)}</span></div>
          <div className="kv"><span className="muted">Loại</span><span>{{ takeaway: 'Mang đi', dine_in: 'Tại chỗ', message: 'Tin nhắn' }[o.order_type]}</span></div>
          <div className="kv"><span className="muted">Thanh toán</span><span>{methodLabel(o)}</span></div>
        </div>
        <div className="card col" style={{ gap: 0 }}>
          {o.lines.map((l) => (
            <div key={l.id} className="kv" style={l.status === 'removed' ? { opacity: 0.45, textDecoration: 'line-through' } : undefined}>
              <span>{l.qty}× {l.item_name}{optionLabel(l.modifiers) || l.note ? <span className="small muted"><br />{[optionLabel(l.modifiers), l.note].filter(Boolean).join(' · ')}</span> : null}
                {l.comp ? <><br /><span className="badge violet">Mời · {l.comp_reason}</span></> : null}
                {l.status === 'removed' ? <><br /><span className="small danger">Bỏ: {l.removed_reason}</span></> : null}</span>
              <span className="mono">{l.comp ? 'Mời' : vnd(l.unit_price * l.qty, false)}</span>
            </div>
          ))}
          <hr className="sep" />
          {o.promo_total > 0 && <div className="kv small accent"><span>Mua 1 tặng 1</span><span className="mono">−{vnd(o.promo_total, false)}</span></div>}
          {!!o.comp_total && <div className="kv small" style={{ color: 'var(--violet)' }}><span>Mời</span><span className="mono">−{vnd(o.comp_total, false)}</span></div>}
          <div className="kv total"><span>Tổng</span><span className="mono">{vnd(o.total)}</span></div>
          {o.payments.filter((p) => p.status === 'confirmed').map((p) => (
            <div key={p.id} className="kv small"><span className="muted">{methodLabel({ ...o, payments: [p] })}{p.tendered && p.method === 'cash' ? ` · đưa ${vnd(p.tendered, false)} · thối ${vnd(p.change_given, false)}` : ''}{p.bank_txn_id ? ' · tự xác nhận' : ''}</span><span className="mono">{vnd(p.amount, false)}{p.tip ? <span className="ok"> + tip {vnd(p.tip, false)}</span> : null}</span></div>
          ))}
        </div>
        {o.status === 'void' && <div className="banner danger">Huỷ lúc {o.voided_at ? hhmm(o.voided_at, tz) : ''} bởi {staffName(o.voided_by)} · duyệt {staffName(o.approved_by)} · lý do: {o.void_reason}</div>}
        {o.status === 'awaiting_payment' && (
          <div className="card col gap12">
            <span className="small muted">Chờ chuyển khoản {vnd(o.total)} · nội dung {o.payments.find((p) => p.method === 'vietqr')?.reference}{cfg.features?.bankWebhook ? ' · sẽ tự xác nhận khi tiền vào' : ''}</span>
            {showQr ? <QrImage amount={o.total} code={o.short_code} /> : <button className="btn" onClick={() => setShowQr(true)}><Icon name="qr" />Hiện lại mã QR</button>}
          </div>
        )}
      </div>
      <div className="ticketbar" style={{ flexDirection: 'column' }}>
        {o.status === 'open' && <button className="btn primary lg block" onClick={async () => { await openTab(o.id); navigate(window.matchMedia('(min-width: 980px)').matches ? 'order' : 'cart'); }}><Icon name="tab" />Mở tab để gọi thêm / thanh toán</button>}
        {o.status === 'awaiting_payment' && <button className="btn ok lg block" onClick={() => confirmTransfer(o.id)}><Icon name="check" />Đã nhận chuyển khoản</button>}
        {o.status !== 'void' && <button className="btn danger block" onClick={doVoid}>{o.status === 'open' ? 'Huỷ tab' : 'Huỷ đơn (void)'}</button>}
      </div>
    </div>
  );
}

// S07 — open tabs, shared between devices. Tap a tab to add a round or take payment.
import { useState } from 'react';
import { vnd } from '../../shared/util';
import { cartCount, cartTotals, clearCart, getState, navigate, openTab, setCartMeta, staffName, toast, useStore } from '../lib/store';
import { runSync } from '../lib/sync';
import { Confirm, Empty, Icon, Sheet, TopBar } from '../ui';

function since(ms: number) {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  return m < 60 ? `${m} phút` : `${Math.floor(m / 60)} giờ ${m % 60} phút`;
}

const goTicket = () => navigate(window.matchMedia('(min-width: 980px)').matches ? 'order' : 'cart');

export default function Tabs() {
  const orders = useStore((s) => s.orders);
  const cart = useStore((s) => s.cart);
  const [q, setQ] = useState('');
  const [newTab, setNewTab] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const tabs = orders.filter((o) => o.status === 'open' && (!q || (o.customer_label || '').toLowerCase().includes(q.toLowerCase()) || o.short_code.includes(q.toUpperCase())))
    .sort((a, b) => a.created_at - b.created_at);
  const cartBusy = cartCount(cart.lines) > 0 && !cart.tabCode;

  const open = async (id: string) => {
    if (cartBusy && getState().cart.id !== id) { setPending(id); return; }
    await openTab(id);
    goTicket();
  };

  return (
    <div className="screen wide">
      <TopBar title="Tab đang mở" sub={`${tabs.length} tab · dùng chung mọi máy`} onBack={() => navigate('order')}
        right={<button className="iconbtn" aria-label="Làm mới" onClick={() => runSync()}><Icon name="sync" /></button>} />
      <div className="scroll pad col gap16">
        <label className="search"><Icon name="search" size={18} /><input placeholder="Tìm tên khách hoặc mã tab" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <div className="tabgrid">
          <button className="tabcard new" onClick={() => setNewTab(true)}><Icon name="plus" size={28} /><b>Mở tab mới</b></button>
          {tabs.map((t) => {
            const total = cartTotals(t.lines).total;
            const n = t.lines.filter((l) => l.status === 'active').reduce((s, l) => s + l.qty, 0);
            return (
              <button key={t.id} className="tabcard" onClick={() => open(t.id)}>
                <div className="row between"><span className="nm ellipsis">{t.customer_label || 'Không tên'}</span><span className="badge muted">#{t.short_code}</span></div>
                <span className="small muted"><Icon name="clock" size={14} /> {since(t.created_at)} · {n} món · {staffName(t.staff_id)}</span>
                <span className="big mono" style={{ marginTop: 'auto' }}>{vnd(total)}</span>
              </button>
            );
          })}
        </div>
        {!tabs.length && <Empty icon="tab">Không có tab nào đang mở</Empty>}
      </div>
      {newTab && <NewTab onClose={() => setNewTab(false)} busy={cartBusy} />}
      {pending && (
        <Confirm title="Đơn đang làm dở" text="Đơn hiện tại chưa lưu sẽ bị bỏ để mở tab này. Muốn giữ thì quay lại và bấm Lưu tab." okText="Bỏ đơn, mở tab" danger
          onCancel={() => setPending(null)} onOk={async () => { const id = pending; setPending(null); await openTab(id); goTicket(); }} />
      )}
    </div>
  );
}

function NewTab({ onClose, busy }: { onClose: () => void; busy: boolean }) {
  const [name, setName] = useState('');
  const go = async () => {
    if (!busy) await clearCart();
    await setCartMeta({ customer_label: name.trim(), order_type: 'dine_in' });
    toast(busy ? 'Đã đặt tên tab cho đơn đang làm — bấm Lưu tab' : `Tab ${name.trim()}: chọn món rồi bấm Lưu tab`);
    navigate('order');
  };
  return (
    <Sheet middle onClose={onClose}>
      <h2>Mở tab mới</h2>
      <p className="small muted" style={{ marginTop: 4 }}>Khách gọi nhiều lượt, thanh toán một lần.{busy ? ' Đơn đang làm sẽ thành tab này.' : ''}</p>
      <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên khách, bàn hoặc đặc điểm" onKeyDown={(e) => e.key === 'Enter' && name.trim() && go()} />
      <div className="row mt16">
        <button className="btn grow" onClick={onClose}>Huỷ</button>
        <button className="btn primary grow" disabled={!name.trim()} onClick={go}>Tiếp tục chọn món</button>
      </div>
    </Sheet>
  );
}

// S05 — review the order: pickup name, order type, quantities, notes, BOGO, then Pay.
import { useEffect, useState } from 'react';
import type { OrderLine } from '../../shared/types';
import { vnd } from '../../shared/util';
import { cartTotals, clearCart, navigate, optionLabel, peekShortCode, setCartMeta, updateLine, useStore } from '../lib/store';
import { Confirm, Icon, Sheet, TopBar } from '../ui';

const TYPES = [['takeaway', 'Mang đi'], ['dine_in', 'Tại chỗ'], ['message', 'WhatsApp/Messenger']] as const;

export default function Cart() {
  const cart = useStore((s) => s.cart);
  const [code, setCode] = useState('');
  const [edit, setEdit] = useState<OrderLine | null>(null);
  const [askClear, setAskClear] = useState(false);
  useEffect(() => { peekShortCode().then(setCode); }, []);
  const lines = cart.lines.filter((l) => l.status === 'active');
  const t = cartTotals(cart.lines);
  useEffect(() => { if (!lines.length) navigate('order'); }, [lines.length]);

  return (
    <div className="screen">
      <TopBar title={`Đơn #${code}`} onBack={() => navigate('order')}
        right={<button className="iconbtn" aria-label="Xoá đơn" onClick={() => setAskClear(true)}><Icon name="trash" /></button>} />
      <div className="scroll pad col gap12" style={{ paddingTop: 0 }}>
        <label className="field"><span>Tên khách / số gọi</span>
          <input className="input" value={cart.customer_label} onChange={(e) => setCartMeta({ customer_label: e.target.value })} placeholder="VD: John · 12" />
        </label>
        <div className="opts">
          {TYPES.map(([k, label]) => <button key={k} className={'opt' + (cart.order_type === k ? ' on' : '')} onClick={() => setCartMeta({ order_type: k })}>{label}</button>)}
        </div>
        <div className="list" style={{ marginTop: 4 }}>
          {lines.map((l) => {
            const promo = t.adjustments.filter((a) => a.order_line_id === l.id).reduce((s, a) => s + a.amount, 0);
            const opts = optionLabel(l.modifiers);
            return (
              <div key={l.id} className="li" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 6 }}>
                <div className="row" style={{ width: '100%' }}>
                  <button className="grow col" style={{ gap: 2, border: 0, background: 'none', padding: 0, textAlign: 'left' }} onClick={() => setEdit(l)}>
                    <span className="bold">{l.item_name}</span>
                    {(opts || l.note) && <span className="small muted">{[opts, l.note].filter(Boolean).join(' · ')}</span>}
                  </button>
                  <div className="row" style={{ gap: 4 }}>
                    <button className="iconbtn" aria-label="Giảm" onClick={() => updateLine(l.id, { qty: l.qty - 1 })}><Icon name="minus" size={18} /></button>
                    <span className="bold mono" style={{ minWidth: 24, textAlign: 'center' }}>{l.qty}</span>
                    <button className="iconbtn" aria-label="Tăng" onClick={() => updateLine(l.id, { qty: l.qty + 1 })}><Icon name="plus" size={18} /></button>
                  </div>
                  <span className="mono right" style={{ minWidth: 84 }}>{vnd(l.unit_price * l.qty, false)}</span>
                </div>
                {promo > 0 && <div className="row between small" style={{ width: '100%' }}><span className="badge">Mua 1 tặng 1</span><span className="mono accent">−{vnd(promo, false)}</span></div>}
              </div>
            );
          })}
        </div>
        <div className="card col" style={{ gap: 0 }}>
          <div className="kv"><span className="muted">Tạm tính</span><span className="mono">{vnd(t.subtotal)}</span></div>
          {t.promo_total > 0 && <div className="kv"><span className="muted">Khuyến mãi</span><span className="mono accent">−{vnd(t.promo_total)}</span></div>}
          <div className="kv total"><span>Tổng</span><span className="mono">{vnd(t.total)}</span></div>
        </div>
      </div>
      <div className="cartbar row">
        <button className="btn lg" onClick={() => navigate('order')}>+ Thêm món</button>
        <button className="btn primary lg grow" onClick={() => navigate('checkout')}>Thanh toán · {vnd(t.total)}</button>
      </div>
      {edit && <LineSheet line={edit} onClose={() => setEdit(null)} />}
      {askClear && <Confirm title="Xoá toàn bộ đơn?" text="Các món trong giỏ sẽ bị xoá." okText="Xoá đơn" danger onCancel={() => setAskClear(false)} onOk={() => { setAskClear(false); clearCart(); navigate('order'); }} />}
    </div>
  );
}

function LineSheet({ line, onClose }: { line: OrderLine; onClose: () => void }) {
  const [note, setNote] = useState(line.note ?? '');
  const [qty, setQty] = useState(line.qty);
  const save = async () => { await updateLine(line.id, { note: note.trim() || null, qty }); onClose(); };
  return (
    <Sheet onClose={onClose}>
      <h2>{line.item_name}</h2>
      {optionLabel(line.modifiers) && <p className="muted small" style={{ marginTop: -6 }}>{optionLabel(line.modifiers)}</p>}
      <label className="field"><span>Ghi chú</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <div className="row between mt16">
        <span className="muted">Số lượng</span>
        <div className="row">
          <button className="iconbtn" aria-label="Giảm" onClick={() => setQty(Math.max(1, qty - 1))}><Icon name="minus" /></button>
          <span className="big mono" style={{ minWidth: 36, textAlign: 'center' }}>{qty}</span>
          <button className="iconbtn" aria-label="Tăng" onClick={() => setQty(qty + 1)}><Icon name="plus" /></button>
        </div>
      </div>
      <div className="row mt16">
        <button className="btn danger" onClick={async () => { await updateLine(line.id, { qty: 0 }); onClose(); }}><Icon name="trash" size={18} />Xoá món</button>
        <button className="btn primary grow" onClick={save}>Lưu</button>
      </div>
    </Sheet>
  );
}

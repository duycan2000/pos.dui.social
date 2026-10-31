// The ticket (S05): the order being built — or an open tab with its earlier rounds.
// Shown as the right-hand panel on wide screens and full screen on phones.
import { useEffect, useState } from 'react';
import type { OrderLine } from '../../shared/types';
import { vnd } from '../../shared/util';
import { preBillDoc, tryPrint } from '../lib/receipts';
import {
  cartAsOrder, cartCount, cartTotals, clearCart, compLine, getState, navigate, optionLabel, peekShortCode, removeLine, requestApproval, saveToTab,
  setCartMeta, staffName, toast, updateLine, useStore, voidOrder,
} from '../lib/store';
import { Confirm, Icon, Segmented, Sheet } from '../ui';

const TYPES: [string, string][] = [['takeaway', 'Mang đi'], ['dine_in', 'Tại chỗ'], ['message', 'Tin nhắn']];

export default function Ticket({ onBack }: { onBack?: () => void }) {
  const cart = useStore((s) => s.cart);
  const cfg = useStore((s) => s.config)!;
  const orders = useStore((s) => s.orders);
  const [code, setCode] = useState('');
  const [edit, setEdit] = useState<OrderLine | null>(null);
  const [askClear, setAskClear] = useState(false);
  const [askName, setAskName] = useState(false);
  useEffect(() => { peekShortCode().then(setCode); }, [cart.id, cart.tabCode, orders.length]);
  const t = cartTotals(cart.lines);
  const count = cartCount(cart.lines);
  const isTab = !!cart.tabCode;
  const newCount = cart.lines.filter((l) => l.status === 'active' && !l.sent_at).length;
  const visible = cart.lines.filter((l) => l.status === 'active' || l.sent_at);

  const doSaveTab = async () => {
    if (!getState().cart.customer_label.trim()) { setAskName(true); return; }
    const o = await saveToTab();
    toast(`Đã lưu tab ${o.customer_label} · #${o.short_code}`);
    onBack?.();
  };
  const cancelTab = async () => {
    const r = await requestApproval({ title: `Huỷ cả tab #${cart.tabCode}`, reasonRequired: true, reasons: ['Khách về không gọi', 'Mở nhầm', 'Gộp sang tab khác'] });
    if (r) { await voidOrder(cart.id, r.reason, r.approver.id); onBack?.(); }
  };
  const preBill = async () => {
    const err = await tryPrint(await preBillDoc(cfg, await cartAsOrder()));
    toast(err ?? 'Đã in bill cho khách', !!err);
  };

  return (
    <div className="ticket">
      <div className="ticket-head">
        <div className="row">
          {onBack && <button className="iconbtn" aria-label="Quay lại" onClick={onBack}><Icon name="back" /></button>}
          <div className="grow col" style={{ gap: 0 }}>
            <span className="big ellipsis">{isTab ? `Tab ${cart.customer_label || ''}` : 'Đơn mới'}</span>
            <span className="small muted">#{code}{isTab ? ' · đang mở' : ''}</span>
          </div>
          <button className="iconbtn" aria-label="In bill cho khách" disabled={!count} onClick={preBill}><Icon name="printer" /></button>
          {isTab
            ? <button className="iconbtn" aria-label="Huỷ tab" onClick={cancelTab}><Icon name="trash" /></button>
            : <button className="iconbtn" aria-label="Xoá đơn" disabled={!count} onClick={() => setAskClear(true)}><Icon name="trash" /></button>}
        </div>
        <input className="input" value={cart.customer_label} onChange={(e) => setCartMeta({ customer_label: e.target.value })} placeholder="Tên khách / số gọi" aria-label="Tên khách / số gọi" />
        <Segmented value={cart.order_type} options={TYPES as [typeof cart.order_type, string][]} onChange={(v) => setCartMeta({ order_type: v })} />
      </div>

      <div className="ticket-lines">
        {!visible.length && (
          <div className="empty" style={{ paddingTop: 56 }}>
            <div className="ico"><Icon name="receipt" size={26} /></div>
            <div>Chưa có món</div>
            <div className="small faint">Chạm vào món để thêm · giữ lâu để chọn tuỳ chọn</div>
          </div>
        )}
        {isTab && visible.some((l) => l.sent_at) && <div className="section-title" style={{ margin: '12px 16px 4px' }}>Đã gửi</div>}
        {visible.filter((l) => l.sent_at).map((l) => <Line key={l.id} l={l} promo={promoOf(t, l.id)} onTap={() => setEdit(l)} />)}
        {isTab && newCount > 0 && <div className="section-title" style={{ margin: '12px 16px 4px' }}>Lượt mới</div>}
        {visible.filter((l) => !l.sent_at).map((l) => <Line key={l.id} l={l} promo={promoOf(t, l.id)} onTap={() => setEdit(l)} />)}
      </div>

      <div className="ticket-foot">
        <div className="col" style={{ gap: 0 }}>
          <div className="kv small"><span className="muted">Tạm tính · {count} món</span><span className="mono">{vnd(t.subtotal)}</span></div>
          {t.promo_total > 0 && <div className="kv small"><span className="accent">Mua 1 tặng 1</span><span className="mono accent">−{vnd(t.promo_total)}</span></div>}
          {t.comp_total > 0 && <div className="kv small"><span style={{ color: 'var(--violet)' }}>Mời</span><span className="mono" style={{ color: 'var(--violet)' }}>−{vnd(t.comp_total)}</span></div>}
          <div className="kv total"><span>Tổng</span><span className="mono">{vnd(t.total)}</span></div>
        </div>
        <div className="row">
          <button className="btn lg" style={{ flex: '0 0 auto' }} disabled={!newCount && !(!isTab && count)} onClick={doSaveTab}>
            <Icon name="tab" size={20} />{isTab ? 'Gửi lượt' : 'Lưu tab'}
          </button>
          <button className="btn primary lg grow" disabled={!count} onClick={() => navigate('checkout')}>Thanh toán</button>
        </div>
      </div>

      {edit && <LineSheet line={cart.lines.find((x) => x.id === edit.id) ?? edit} onClose={() => setEdit(null)} />}
      {askClear && <Confirm title="Xoá toàn bộ đơn?" text="Các món chưa lưu sẽ bị xoá." okText="Xoá đơn" danger onCancel={() => setAskClear(false)} onOk={() => { setAskClear(false); clearCart(); }} />}
      {askName && <NameSheet onClose={() => setAskName(false)} onDone={async (name) => { await setCartMeta({ customer_label: name, order_type: cart.order_type === 'takeaway' ? 'dine_in' : cart.order_type }); setAskName(false); setTimeout(doSaveTab, 0); }} />}
    </div>
  );
}

function promoOf(t: ReturnType<typeof cartTotals>, lineId: string) {
  return t.adjustments.filter((a) => a.order_line_id === lineId && a.kind === 'promo').reduce((s, a) => s + a.amount, 0);
}

function Line({ l, promo, onTap }: { l: OrderLine; promo: number; onTap: () => void }) {
  const opts = optionLabel(l.modifiers);
  const removed = l.status === 'removed';
  return (
    <div className={'tline' + (removed ? ' removed' : '')} onClick={onTap} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onTap()}>
      <span className="nm"><span className="q">{l.qty}×</span>{l.item_name}</span>
      <span className="mono semibold">{l.comp ? <span style={{ color: 'var(--violet)' }}>Mời</span> : vnd(l.unit_price * l.qty, false)}</span>
      {(opts || l.note || promo > 0 || l.comp || removed) && (
        <span className="meta small muted">
          {opts && <span>{opts}</span>}
          {l.note && <span>· {l.note}</span>}
          {promo > 0 && <span className="badge">1+1 −{vnd(promo, false)}</span>}
          {!!l.comp && <span className="badge violet">Mời · {l.comp_reason}</span>}
          {removed && <span className="badge danger">Đã bỏ · {l.removed_reason}</span>}
        </span>
      )}
    </div>
  );
}

function LineSheet({ line, onClose }: { line: OrderLine; onClose: () => void }) {
  const [note, setNote] = useState(line.note ?? '');
  const [qty, setQty] = useState(line.qty);
  const sent = !!line.sent_at;
  const removed = line.status === 'removed';
  const save = async () => { await updateLine(line.id, { note: note.trim() || null, qty }); onClose(); };
  return (
    <Sheet onClose={onClose}>
      <h2>{line.item_name}</h2>
      <p className="muted small" style={{ marginTop: 0 }}>{[optionLabel(line.modifiers), sent ? 'đã gửi quầy bar' : null].filter(Boolean).join(' · ') || ' '}</p>
      {removed ? (
        <div className="banner danger">Món này đã bị bỏ: {line.removed_reason} ({staffName(line.removed_by)})</div>
      ) : (
        <div className="col gap16">
          {!sent && (
            <>
              <label className="field"><span>Ghi chú cho quầy bar</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: ít chua, không đường" /></label>
              <div className="row between">
                <span className="muted">Số lượng</span>
                <div className="stepper">
                  <button aria-label="Giảm" onClick={() => setQty(Math.max(1, qty - 1))}><Icon name="minus" /></button>
                  <span className="mono">{qty}</span>
                  <button aria-label="Tăng" onClick={() => setQty(qty + 1)}><Icon name="plus" /></button>
                </div>
              </div>
            </>
          )}
          <button className={'btn ' + (line.comp ? 'outline' : 'soft')} style={line.comp ? undefined : { background: 'var(--violet-soft)', color: 'var(--violet)' }}
            onClick={async () => { if (await compLine(line.id, !line.comp)) onClose(); }}>
            <Icon name="gift" size={20} />{line.comp ? 'Bỏ mời — tính tiền lại' : 'Mời ly này (miễn phí, vẫn trừ kho)'}
          </button>
          <div className="row">
            <button className="btn danger" onClick={async () => { if (await removeLine(line.id)) onClose(); }}><Icon name="trash" size={18} />{sent ? 'Bỏ món đã gửi' : 'Xoá món'}</button>
            {!sent && <button className="btn primary grow" onClick={save}>Lưu</button>}
            {sent && <button className="btn grow" onClick={onClose}>Đóng</button>}
          </div>
          {sent && <p className="tiny faint" style={{ margin: 0 }}>Món đã gửi quầy bar không sửa được số lượng. Bỏ món cần quản lý duyệt và được ghi nhật ký.</p>}
        </div>
      )}
    </Sheet>
  );
}

function NameSheet({ onClose, onDone }: { onClose: () => void; onDone: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <Sheet middle onClose={onClose}>
      <h2>Tên tab</h2>
      <p className="small muted" style={{ marginTop: 4 }}>Tên khách hoặc số bàn để tìm lại tab.</p>
      <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: John, Bàn 3, Áo đỏ" onKeyDown={(e) => e.key === 'Enter' && name.trim() && onDone(name.trim())} />
      <div className="row mt16">
        <button className="btn grow" onClick={onClose}>Huỷ</button>
        <button className="btn primary grow" disabled={!name.trim()} onClick={() => onDone(name.trim())}>Lưu tab</button>
      </div>
    </Sheet>
  );
}

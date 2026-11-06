// Tách bill: pick what one guest (or a few) pays for; those lines become their own order on the same table.
// Split evenly (chia đều) lives in Checkout as a payment method.
import { useState } from 'react';
import { computeTotals } from '../../shared/pricing';
import type { OrderLine } from '../../shared/types';
import { vnd } from '../../shared/util';
import { navigate, openTab, optionLabel, orderTitle, splitOrder, toast, useStore } from '../lib/store';
import { Icon, TopBar } from '../ui';

export default function Split() {
  const cfg = useStore((s) => s.config)!;
  const cart = useStore((s) => s.cart);
  const order = useStore((s) => s.orders.find((o) => o.id === s.cart.id && o.status === 'open'));
  const [take, setTake] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const back = () => navigate(window.matchMedia('(min-width: 980px)').matches ? 'order' : 'cart');
  if (!order) {
    return (
      <div className="screen">
        <TopBar title="Tách bill" onBack={back} />
        <div className="scroll pad"><div className="banner">Chỉ tách được tab hoặc bàn đã gửi món. Gửi món / lưu tab trước, rồi mở lại để tách.</div></div>
      </div>
    );
  }
  const unsent = cart.lines.some((l) => l.status === 'active' && !l.sent_at);
  const lines = order.lines.filter((l) => l.status === 'active');
  const tot = (ls: OrderLine[]) => computeTotals(ls.map((l) => ({ ...l })), cfg.promotions, cfg.promotionItems, Date.now(), cfg.outlet.tz_offset_min);
  const moved = lines.filter((l) => take[l.id]).map((l) => ({ ...l, qty: take[l.id] }));
  const kept = lines.map((l) => ({ ...l, qty: l.qty - (take[l.id] || 0) })).filter((l) => l.qty > 0);
  const tm = tot(moved);
  const tk = tot(kept);
  const nMoved = moved.reduce((a, l) => a + l.qty, 0);
  const set = (l: OrderLine, n: number) => setTake({ ...take, [l.id]: Math.max(0, Math.min(l.qty, n)) });
  const go = async (payNow: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const part = await splitOrder(order.id, take);
      if (payNow) { await openTab(part.id); navigate('checkout'); }
      else { toast(`Đã tách #${part.short_code} · ${vnd(part.total)} — thanh toán sau ở Bàn / Tab`); back(); }
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  };
  return (
    <div className="screen">
      <TopBar title="Tách bill" sub={`#${order.short_code}${orderTitle(order) ? ' · ' + orderTitle(order) : ''}`} onBack={back} />
      <div className="scroll pad col gap12" style={{ paddingTop: 8 }}>
        {unsent && <div className="banner danger"><Icon name="warn" size={18} />Đơn còn món chưa gửi. Gửi món trước rồi tách.</div>}
        <p className="small muted" style={{ margin: 0 }}>Chọn món khách muốn trả riêng. Phần chọn thành đơn riêng (cùng bàn), phần còn lại ở đơn cũ. Chia đều theo đầu người: bấm Thanh toán › Chia đều.</p>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn sm" onClick={() => setTake({})}>Bỏ chọn</button>
        </div>
        <div className="list">
          {lines.map((l) => {
            const n = take[l.id] || 0;
            return (
              <div key={l.id} className={'li splitrow' + (n ? ' on' : '')} style={{ minHeight: 0, padding: '10px 12px' }}>
                <button className="grow col" style={{ gap: 1, border: 0, background: 'none', color: 'inherit', textAlign: 'left', padding: 0 }} onClick={() => set(l, n ? 0 : l.qty)}>
                  <span><b>{l.qty}×</b> {l.item_name}</span>
                  <span className="tiny muted">{[optionLabel(l.modifiers), l.note, l.comp ? 'Mời' : ''].filter(Boolean).join(' · ') || vnd(l.unit_price)}</span>
                </button>
                {l.qty > 1 ? (
                  <span className="stepper">
                    <button aria-label="Bớt" disabled={!n} onClick={() => set(l, n - 1)}><Icon name="minus" size={16} /></button>
                    <span>{n}</span>
                    <button aria-label="Thêm" disabled={n >= l.qty} onClick={() => set(l, n + 1)}><Icon name="plus" size={16} /></button>
                  </span>
                ) : (
                  <input type="checkbox" className="bigcheck" checked={!!n} onChange={(e) => set(l, e.target.checked ? 1 : 0)} aria-label={`Tách ${l.item_name}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="cartbar col" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 10 }}>
          <div className="card grow col" style={{ gap: 0, padding: '8px 12px' }}><span className="tiny muted">Ở lại đơn cũ</span><b className="mono">{vnd(tk.total)}</b></div>
          <div className="card grow col" style={{ gap: 0, padding: '8px 12px', borderColor: nMoved ? 'var(--accent)' : undefined }}><span className="tiny muted">Tách ra · {nMoved} món</span><b className="mono accent">{vnd(tm.total)}</b></div>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <button className="btn lg" disabled={busy || unsent || !nMoved || !kept.length} onClick={() => go(false)}>Tách, trả sau</button>
          <button className="btn primary lg grow" disabled={busy || unsent || !nMoved || !kept.length} onClick={() => go(true)}>Tách & thanh toán {nMoved ? vnd(tm.total) : ''}</button>
        </div>
      </div>
    </div>
  );
}

// Requests from the table QR menu: a banner on the order screen / floor map and a sheet to accept or decline.
// Accepting an order puts it on the table's open order and sends it to the bar like any round.
import { useState } from 'react';
import type { GuestOrder } from '../../shared/types';
import { hhmm, vnd } from '../../shared/util';
import { acceptGuestOrder, navigate, optionLabel, rejectGuestOrder, tableById, toast, useStore } from '../lib/store';
import { Icon, Sheet } from '../ui';

const KIND: Record<GuestOrder['kind'], string> = { order: 'Gọi món', call: 'Gọi nhân viên', bill: 'Xin thanh toán' };

export function GuestBanner() {
  const list = useStore((s) => s.guestOrders);
  const [open, setOpen] = useState(false);
  if (!list.length) return null;
  const orders = list.filter((g) => g.kind === 'order').length;
  return (
    <>
      <button className="banner guestbanner" style={{ border: 0, width: '100%', textAlign: 'left', marginTop: 8, alignItems: 'center' }} onClick={() => setOpen(true)}>
        <span className="bell"><Icon name="bell" size={18} /></span>
        <span className="grow"><b>{list.length} yêu cầu từ khách</b>{orders ? ` · ${orders} đơn gọi món` : ''} — {list.slice(0, 3).map((g) => tableById(g.table_id)?.name ?? 'Bàn').join(', ')}</span>
        <b>Xem</b>
      </button>
      {open && <GuestSheet onClose={() => setOpen(false)} />}
    </>
  );
}

export function GuestSheet({ onClose, tableId }: { onClose: () => void; tableId?: string }) {
  const all = useStore((s) => s.guestOrders);
  const tz = useStore((s) => s.config!.outlet.tz_offset_min);
  const list = tableId ? all.filter((g) => g.table_id === tableId) : all;
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<GuestOrder | null>(null);
  const accept = async (g: GuestOrder) => {
    setBusy(g.id);
    try {
      await acceptGuestOrder(g);
      toast(g.kind === 'order' ? `Đã nhận đơn ${tableById(g.table_id)?.name ?? ''} và gửi quầy` : 'Đã xử lý');
      if (g.kind === 'bill') { onClose(); navigate('tables'); }
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(null); }
  };
  if (!list.length) { setTimeout(onClose, 0); return null; }
  return (
    <Sheet onClose={onClose}>
      <h2>Yêu cầu từ khách (QR)</h2>
      <p className="small muted" style={{ margin: '4px 0 12px' }}>Kiểm tra đúng bàn rồi bấm Nhận: món được thêm vào đơn của bàn và in phiếu pha chế. Khách thấy trạng thái trên điện thoại.</p>
      <div className="col gap12">
        {list.map((g) => (
          <div key={g.id} className="card col" style={{ gap: 6 }}>
            <div className="row between">
              <b>{tableById(g.table_id)?.name ?? 'Bàn ?'} · {KIND[g.kind]}</b>
              <span className="tiny muted">{hhmm(g.created_at, tz)}{g.lang === 'en' ? ' · EN' : ''}</span>
            </div>
            {g.guest_name && <span className="small">Khách: <b>{g.guest_name}</b></span>}
            {g.lines.map((l, i) => (
              <div key={i} className="row between small">
                <span><b>{l.qty}×</b> {l.name}{(() => { const opt = optionLabel(l.option_ids.map((id, k) => ({ id, group_id: '', name: l.options[k] ?? '', price_delta: 0, excludes_promo: 0 }))); const extra = [opt, l.note].filter(Boolean).join(' · '); return extra ? <span className="muted"> · {extra}</span> : null; })()}</span>
                <span className="mono">{vnd(l.unit_price * l.qty, false)}</span>
              </div>
            ))}
            {g.note && <span className="small muted">Ghi chú: {g.note}</span>}
            {g.kind === 'order' && <div className="kv small"><span className="muted">Tổng</span><span className="mono bold">{vnd(g.total)}</span></div>}
            <div className="row" style={{ gap: 8 }}>
              <button className="btn" disabled={!!busy} onClick={() => setRejecting(g)}>{g.kind === 'order' ? 'Từ chối' : 'Bỏ qua'}</button>
              <button className="btn primary grow" disabled={!!busy} onClick={() => accept(g)}>
                {busy === g.id ? 'Đang gửi…' : g.kind === 'order' ? 'Nhận & gửi quầy' : g.kind === 'bill' ? 'Đã biết · mở sơ đồ bàn' : 'Đã đến bàn'}
              </button>
            </div>
          </div>
        ))}
      </div>
      {rejecting && (
        <Sheet middle onClose={() => setRejecting(null)}>
          <h2>Từ chối yêu cầu?</h2>
          <p className="small muted">Khách sẽ thấy lý do trên điện thoại.</p>
          <div className="col gap8 mt8">
            {(rejecting.kind === 'order' ? ['Món đã hết', 'Quầy sắp đóng', 'Nhân viên sẽ ra bàn xác nhận', 'Gọi nhầm bàn'] : ['Đã xử lý']).map((r) => (
              <button key={r} className="btn block" onClick={async () => { const g = rejecting; setRejecting(null); try { await rejectGuestOrder(g, r); } catch (e) { toast((e as Error).message, true); } }}>{r}</button>
            ))}
          </div>
        </Sheet>
      )}
    </Sheet>
  );
}

// S03 — the main selling screen. Tap = add with default options, long-press = options (S04).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChosenOption, Item } from '../../shared/types';
import { vnd, vndShort } from '../../shared/util';
import { addToCart, cartCount, cartTotals, defaultOptions, isManager, lock, navigate, peekShortCode, useStore } from '../lib/store';
import { Icon, Sheet } from '../ui';

export default function OrderScreen() {
  const cfg = useStore((s) => s.config)!;
  const cart = useStore((s) => s.cart);
  const staff = useStore((s) => s.staff)!;
  const shift = useStore((s) => s.shift);
  const drawer = useStore((s) => s.drawer);
  const net = useStore((s) => s.net);
  const orders = useStore((s) => s.orders);
  const [cat, setCat] = useState<string>('');
  const [q, setQ] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [modItem, setModItem] = useState<Item | null>(null);
  const [code, setCode] = useState('');
  useEffect(() => { peekShortCode().then(setCode); }, [orders.length]);

  const cats = cfg.categories.filter((c) => c.active);
  const activeCat = cat || cats[0]?.id || '';
  const promoItems = useMemo(() => new Set(cfg.promotionItems.filter((p) => cfg.promotions.some((x) => x.id === p.promotion_id && x.active)).map((p) => p.item_id)), [cfg]);
  const items = cfg.items.filter((i) => i.active && (q ? (i.name_vi + ' ' + i.name_en).toLowerCase().includes(q.toLowerCase()) : i.category_id === activeCat));
  const inCart = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of cart.lines) if (l.status === 'active') m.set(l.item_id, (m.get(l.item_id) || 0) + l.qty);
    return m;
  }, [cart]);
  const totals = cartTotals(cart.lines);
  const count = cartCount();
  const pendingQr = orders.filter((o) => o.status === 'awaiting_payment').length;
  const noDrawer = !drawer || !shift || shift.drawer_session_id !== drawer.id;

  const needsChoice = (it: Item) => {
    const groups = cfg.itemModifierGroups.filter((g) => g.item_id === it.id).map((g) => cfg.modifierGroups.find((x) => x.id === g.group_id)).filter(Boolean);
    return groups.some((g) => g!.required && !cfg.modifierOptions.some((o) => o.group_id === g!.id && o.is_default));
  };
  const quickAdd = (it: Item) => {
    if (it.sold_out) return;
    if (needsChoice(it)) return setModItem(it);
    addToCart(it, defaultOptions(it));
    navigator.vibrate?.(15);
  };

  return (
    <div className="screen">
      <header className="topbar">
        <button className="iconbtn" aria-label="Mở menu" onClick={() => setMenuOpen(true)}><Icon name="menu" /></button>
        <div className="grow col" style={{ gap: 0 }}>
          <span className="bold" style={{ fontSize: 17 }}>Đơn mới #{code}</span>
          <button className="small muted row" style={{ border: 0, background: 'none', padding: 0, gap: 6 }} onClick={() => navigate('sync')}>
            <span className={'dot' + (!net.online ? ' off' : net.pending ? ' busy' : '')} />
            {!net.online ? `Offline · ${net.pending} chờ gửi` : net.pending ? `${net.pending} chờ gửi` : 'Đã đồng bộ'} · {staff.name}
          </button>
        </div>
        <button className="btn sm" onClick={() => navigate('orders')} aria-label="Đơn hôm nay">
          Đơn{pendingQr ? <span className="badge">{pendingQr} chờ CK</span> : null}
        </button>
      </header>

      {noDrawer && (
        <div className="pad" style={{ paddingTop: 0 }}>
          <button className="banner danger" style={{ width: '100%', border: 0, textAlign: 'left' }} onClick={() => navigate('open-shift')}>
            Két chưa mở hoặc đã đóng. Bấm để mở ca trước khi bán.
          </button>
        </div>
      )}

      <nav className="chips" aria-label="Danh mục">
        {cats.map((c) => (
          <button key={c.id} className={'chip' + (!q && c.id === activeCat ? ' on' : '')} onClick={() => { setCat(c.id); setQ(''); }}>{c.name_vi}</button>
        ))}
      </nav>
      <div style={{ padding: '0 12px 12px' }}>
        <label className="search"><Icon name="search" size={18} />
          <input placeholder="Tìm món" aria-label="Tìm món" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button className="iconbtn ghost" style={{ width: 32, height: 32 }} aria-label="Xoá tìm" onClick={() => setQ('')}><Icon name="close" size={16} /></button>}
        </label>
      </div>

      <div className="scroll" style={{ padding: '0 12px 12px' }}>
        {!items.length && <p className="muted center row" style={{ minHeight: 120 }}>{cfg.items.length ? 'Không có món' : 'Chưa có món. Vào Quản trị › Menu để thêm.'}</p>}
        <div className="grid2 items">
          {items.map((it) => <Tile key={it.id} item={it} bogo={promoItems.has(it.id)} qty={inCart.get(it.id) || 0} onTap={() => quickAdd(it)} onLong={() => !it.sold_out && setModItem(it)} />)}
        </div>
      </div>

      <div className="cartbar">
        <button className="btn primary lg block between" style={{ justifyContent: 'space-between' }} disabled={!count} onClick={() => navigate('cart')}>
          <span>{count} món · {vnd(totals.total)}</span>
          <span>Xem giỏ ›</span>
        </button>
      </div>

      {modItem && <ModifierSheet item={modItem} onClose={() => setModItem(null)} />}
      {menuOpen && <MenuDrawer onClose={() => setMenuOpen(false)} manager={isManager(staff)} pendingQr={pendingQr} />}
    </div>
  );
}

function Tile({ item, bogo, qty, onTap, onLong }: { item: Item; bogo: boolean; qty: number; onTap: () => void; onLong: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const long = useRef(false);
  const start = () => { long.current = false; timer.current = setTimeout(() => { long.current = true; onLong(); }, 450); };
  const end = () => { clearTimeout(timer.current); };
  if (item.sold_out) {
    return (
      <button className="tile out" disabled>
        <span className="name">{item.name_vi}</span>
        <span className="small bold">Hết hàng</span>
      </button>
    );
  }
  return (
    <button className="tile" onPointerDown={start} onPointerUp={end} onPointerLeave={end} onPointerCancel={end}
      onClick={() => { if (!long.current) onTap(); }} onContextMenu={(e) => e.preventDefault()}>
      {qty > 0 && <span className="qty">{qty}</span>}
      <span className="name" style={{ paddingRight: qty ? 28 : 0 }}>{item.name_vi}</span>
      <span className="row between" style={{ width: '100%' }}>
        <span className="price">{vndShort(item.price)}</span>
        {bogo && <span className="badge">MUA 1 TẶNG 1</span>}
      </span>
    </button>
  );
}

/** S04 — options, note and quantity for one item. */
export function ModifierSheet({ item, onClose }: { item: Item; onClose: () => void }) {
  const cfg = useStore((s) => s.config)!;
  const groups = cfg.itemModifierGroups.filter((g) => g.item_id === item.id).sort((a, b) => a.sort - b.sort)
    .map((g) => cfg.modifierGroups.find((x) => x.id === g.group_id)!).filter(Boolean);
  const [chosen, setChosen] = useState<ChosenOption[]>(() => defaultOptions(item));
  const [note, setNote] = useState('');
  const [qty, setQty] = useState(1);
  const toggle = (gid: string, single: boolean, o: (typeof cfg.modifierOptions)[number]) => {
    const opt: ChosenOption = { id: o.id, group_id: gid, name: o.name_vi, price_delta: o.price_delta, excludes_promo: o.excludes_promo };
    setChosen((c) => {
      const has = c.some((x) => x.id === o.id);
      if (single) return [...c.filter((x) => x.group_id !== gid), opt];
      return has ? c.filter((x) => x.id !== o.id) : [...c, opt];
    });
  };
  const missing = groups.filter((g) => g.required && !chosen.some((c) => c.group_id === g.id));
  const unit = item.price + chosen.reduce((s, m) => s + m.price_delta, 0);
  const add = async () => { await addToCart(item, chosen, qty, note.trim() || null); onClose(); };
  return (
    <Sheet onClose={onClose}>
      <div className="row between"><h2 style={{ margin: 0 }}>{item.name_vi}</h2><span className="accent bold">{vnd(item.price)}</span></div>
      <div style={{ height: 12 }} />
      {groups.map((g) => (
        <div key={g.id} className="opt-group">
          <div className="label">{g.name_vi}{g.required ? ' *' : ''}{g.selection === 'multi' ? ' (chọn nhiều)' : ''}</div>
          <div className="opts">
            {cfg.modifierOptions.filter((o) => o.group_id === g.id).map((o) => (
              <button key={o.id} className={'opt' + (chosen.some((c) => c.id === o.id) ? ' on' : '')} onClick={() => toggle(g.id, g.selection === 'single', o)}>
                {o.name_vi}{o.price_delta ? ` ${o.price_delta > 0 ? '+' : '−'}${vndShort(Math.abs(o.price_delta))}` : ''}
              </button>
            ))}
          </div>
        </div>
      ))}
      <label className="field"><span>Ghi chú</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: ít chua" /></label>
      <div className="row between mt16">
        <span className="muted">Số lượng</span>
        <div className="row">
          <button className="iconbtn" aria-label="Giảm" onClick={() => setQty(Math.max(1, qty - 1))}><Icon name="minus" /></button>
          <span className="big mono" style={{ minWidth: 36, textAlign: 'center' }}>{qty}</span>
          <button className="iconbtn" aria-label="Tăng" onClick={() => setQty(qty + 1)}><Icon name="plus" /></button>
        </div>
      </div>
      <button className="btn primary lg block mt16" disabled={missing.length > 0} onClick={add}>
        {missing.length ? `Chọn ${missing.map((g) => g.name_vi).join(', ')}` : `Thêm · ${vnd(unit * qty)}`}
      </button>
    </Sheet>
  );
}

function MenuDrawer({ onClose, manager, pendingQr }: { onClose: () => void; manager: boolean; pendingQr: number }) {
  const go = (r: string) => { onClose(); navigate(r); };
  const staff = useStore((s) => s.staff)!;
  return (
    <div className="drawer" role="dialog" aria-modal="true">
      <nav className="panel">
        <div className="pad"><div className="bold">{staff.name}</div><div className="small muted">{staff.role === 'owner' ? 'Chủ quán' : staff.role === 'manager' ? 'Quản lý' : 'Nhân viên'}</div></div>
        <button className="item" onClick={() => go('orders')}><Icon name="list" />Đơn hôm nay{pendingQr ? <span className="badge">{pendingQr} chờ CK</span> : null}</button>
        <button className="item" onClick={() => go('cashmove')}><Icon name="wallet" />Thu / chi két</button>
        <button className="item" onClick={() => go('sync')}><Icon name="sync" />Đồng bộ</button>
        <button className="item" onClick={() => go('close')}><Icon name="door" />Kết ca / Đóng két</button>
        {manager && <button className="item" onClick={() => go('admin')}><Icon name="settings" />Quản trị</button>}
        <div className="grow" />
        <button className="item" onClick={() => { onClose(); lock(); }}><Icon name="lock" />Khoá máy (đổi người)</button>
      </nav>
      <div className="shade" onClick={onClose} />
    </div>
  );
}

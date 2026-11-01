// S03 — main selling screen. Menu on the left; on wide screens the ticket stays open on the right (Square-style).
// Tap = add with default options, long-press = options (S04).
import { useMemo, useRef, useState } from 'react';
import type { ChosenOption, Item } from '../../shared/types';
import { vnd, vndShort } from '../../shared/util';
import { mediaUrl } from '../lib/api';
import { addToCart, minusItem, cartCount, cartTotals, defaultOptions, isManager, lock, navigate, useStore } from '../lib/store';
import { appVersion, CAT_COLORS, Icon, Sheet } from '../ui';
import Ticket from './Ticket';

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

  const cats = cfg.categories.filter((c) => c.active);
  const catColor = new Map(cats.map((c, i) => [c.id, CAT_COLORS[i % CAT_COLORS.length]]));
  const activeCat = cat || cats[0]?.id || '';
  const promoItems = useMemo(() => new Set(cfg.promotionItems.filter((p) => cfg.promotions.some((x) => x.id === p.promotion_id && x.active)).map((p) => p.item_id)), [cfg]);
  const items = cfg.items.filter((i) => i.active && (q ? (i.name_vi + ' ' + i.name_en).toLowerCase().includes(q.toLowerCase()) : i.category_id === activeCat));
  const inCart = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of cart.lines) if (l.status === 'active' && !l.sent_at) m.set(l.item_id, (m.get(l.item_id) || 0) + l.qty);
    return m;
  }, [cart]);
  const totals = cartTotals(cart.lines);
  const count = cartCount(cart.lines);
  const pendingQr = orders.filter((o) => o.status === 'awaiting_payment').length;
  const openTabs = orders.filter((o) => o.status === 'open' && !o.table_id).length;
  const busyTables = new Set(orders.filter((o) => o.table_id && (o.status === 'open' || o.status === 'awaiting_payment')).map((o) => o.table_id)).size;
  const hasTables = !!cfg.tables?.length;
  const noDrawer = !drawer || !shift || shift.drawer_session_id !== drawer.id;

  const needsChoice = (it: Item) => {
    const groups = cfg.itemModifierGroups.filter((g) => g.item_id === it.id).map((g) => cfg.modifierGroups.find((x) => x.id === g.group_id)).filter(Boolean);
    return groups.some((g) => g!.required && !cfg.modifierOptions.some((o) => o.group_id === g!.id && o.is_default));
  };
  const quickAdd = (it: Item) => {
    if (it.sold_out) return;
    if (needsChoice(it)) return setModItem(it);
    addToCart(it, defaultOptions(it));
    navigator.vibrate?.(12);
  };

  return (
    <div className="pos">
      <main className="pos-main">
        <header className="topbar">
          <button className="iconbtn" aria-label="Mở menu" onClick={() => setMenuOpen(true)}><Icon name="menu" /></button>
          <div className="grow col" style={{ gap: 0 }}>
            <span className="brand">{cfg.outlet.name.toUpperCase()}</span>
            <button className="small muted row" style={{ border: 0, background: 'none', padding: 0, gap: 6 }} onClick={() => navigate('sync')}>
              <span className={'dot' + (!net.online ? ' off' : net.pending ? ' busy' : '')} />
              <span className="ellipsis">{!net.online ? `Offline · ${net.pending} chờ gửi` : net.pending ? `Đang gửi ${net.pending}` : 'Đã đồng bộ'} · {staff.name}</span>
            </button>
          </div>
          {hasTables && (
            <button className="pill" onClick={() => navigate('tables')} aria-label={`Sơ đồ bàn: ${busyTables} bàn có khách`}>
              <Icon name="table" size={18} /><span className="phone-hide">Bàn</span>{busyTables > 0 && <span className="count">{busyTables}</span>}
            </button>
          )}
          <button className="pill" onClick={() => navigate('tabs')} aria-label={`Tab đang mở: ${openTabs}`}>
            <Icon name="tab" size={18} /><span className="phone-hide">Tab</span>{openTabs > 0 && <span className="count">{openTabs}</span>}
          </button>
          <button className="pill" onClick={() => navigate('orders')} aria-label="Đơn hôm nay">
            <Icon name="list" size={18} /><span className="phone-hide">Đơn</span>{pendingQr > 0 && <span className="count blue">{pendingQr}</span>}
          </button>
        </header>

        {noDrawer && (
          <div style={{ padding: '12px 16px 0' }}>
            <button className="banner danger" style={{ width: '100%', border: 0, textAlign: 'left' }} onClick={() => navigate('open-shift')}>
              <Icon name="warn" size={18} /> Két chưa mở hoặc đã đóng. Chạm để mở ca trước khi bán.
            </button>
          </div>
        )}

        <nav className="chips" aria-label="Danh mục">
          {cats.map((c) => (
            <button key={c.id} className={'chip' + (!q && c.id === activeCat ? ' on' : '')} onClick={() => { setCat(c.id); setQ(''); }}>
              <span className="dot" style={{ background: catColor.get(c.id) }} />{c.name_vi}
            </button>
          ))}
        </nav>
        <div style={{ padding: '0 16px 12px' }}>
          <label className="search"><Icon name="search" size={18} />
            <input placeholder="Tìm món" aria-label="Tìm món" value={q} onChange={(e) => setQ(e.target.value)} />
            {q && <button className="iconbtn ghost" style={{ width: 32, height: 32 }} aria-label="Xoá tìm" onClick={() => setQ('')}><Icon name="close" size={16} /></button>}
          </label>
        </div>

        <div className="scroll" style={{ padding: '0 16px 16px' }}>
          {!items.length && (
            <div className="empty"><div className="ico"><Icon name="search" size={26} /></div>
              <div>{cfg.items.length ? 'Không có món' : 'Chưa có món nào'}</div>
              {!cfg.items.length && isManager(staff) && <button className="btn soft" onClick={() => navigate('admin/menu')}>Thêm món trong Quản trị</button>}
            </div>
          )}
          <div className="grid">
            {items.map((it) => (
              <Tile key={it.id} item={it} color={catColor.get(it.category_id) ?? CAT_COLORS[0]} bogo={promoItems.has(it.id)} qty={inCart.get(it.id) || 0}
                onTap={() => quickAdd(it)} onLong={() => !it.sold_out && setModItem(it)} onMinus={() => { minusItem(it.id); navigator.vibrate?.(8); }} />
            ))}
          </div>
        </div>

        <div className="ticketbar phone-only">
          <button className="summary" disabled={!count && !cart.tabCode && !cart.table_id} onClick={() => navigate('cart')}>
            <span className="row" style={{ gap: 0 }}><span className="n">{count}</span>{cart.table_id ? (cfg.tables?.find((t) => t.id === cart.table_id)?.name ?? 'Bàn') : cart.tabCode ? `Tab ${cart.customer_label}` : 'Xem đơn'}</span>
            <span className="mono">{vnd(totals.total)}</span>
          </button>
        </div>
      </main>

      <aside className="pos-side" aria-label="Đơn hiện tại"><Ticket /></aside>

      {modItem && <ModifierSheet item={modItem} onClose={() => setModItem(null)} />}
      {menuOpen && <MenuDrawer onClose={() => setMenuOpen(false)} manager={isManager(staff)} pendingQr={pendingQr} openTabs={openTabs} />}
    </div>
  );
}

function Tile({ item, color, bogo, qty, onTap, onLong, onMinus }: { item: Item; color: string; bogo: boolean; qty: number; onTap: () => void; onLong: () => void; onMinus: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const long = useRef(false);
  const start = () => { long.current = false; timer.current = setTimeout(() => { long.current = true; onLong(); }, 450); };
  const end = () => { clearTimeout(timer.current); };
  const style = { ['--cat' as string]: color };
  if (item.sold_out) {
    return (
      <button className="tile out" style={style} disabled>
        <span className="name">{item.name_vi}</span>
        <span className="small bold">Hết hàng</span>
      </button>
    );
  }
  return (
    <div className="tilewrap">
    <button className={'tile' + (qty ? ' in' : '')} style={style} onPointerDown={start} onPointerUp={end} onPointerLeave={end} onPointerCancel={end}
      onClick={() => { if (!long.current) onTap(); }} onContextMenu={(e) => e.preventDefault()} aria-label={`${item.name_vi}, ${vnd(item.price)}${qty ? `, đã chọn ${qty}` : ''}`}>
      {item.image_key && <span className="photo" style={{ backgroundImage: `url(${mediaUrl(item.image_key)})` }} />}
      <span className="name" style={{ paddingRight: qty ? 54 : 0 }}>{item.name_vi}</span>
      <span className="row between" style={{ width: '100%' }}>
        <span className="price">{vndShort(item.price)}</span>
        {bogo && <span className="badge">1+1</span>}
      </span>
    </button>
    {/* Tap the tile = +1, tap this pill = −1 (undo a double tap). */}
    {qty > 0 && <button className="tile-minus" aria-label={`Bớt 1 ${item.name_vi}, đang có ${qty}`} onClick={onMinus}><Icon name="minus" size={16} />{qty}</button>}
    </div>
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
      <div className="row between" style={{ marginBottom: 16 }}>
        <h2>{item.name_vi}</h2>
        <span className="big mono">{vnd(item.price)}</span>
      </div>
      {groups.map((g) => (
        <div key={g.id} className="opt-group">
          <div className="label">{g.name_vi}{g.required ? ' · bắt buộc' : ''}{g.selection === 'multi' ? ' · chọn nhiều' : ''}</div>
          <div className="opts">
            {cfg.modifierOptions.filter((o) => o.group_id === g.id).map((o) => (
              <button key={o.id} className={'opt' + (chosen.some((c) => c.id === o.id) ? ' on' : '')} onClick={() => toggle(g.id, g.selection === 'single', o)}>
                {o.name_vi}{o.price_delta ? ` ${o.price_delta > 0 ? '+' : '−'}${vndShort(Math.abs(o.price_delta))}` : ''}
              </button>
            ))}
          </div>
        </div>
      ))}
      <label className="field"><span>Ghi chú cho quầy bar</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: ít chua" /></label>
      <div className="row between mt16">
        <span className="muted">Số lượng</span>
        <div className="stepper">
          <button aria-label="Giảm" onClick={() => setQty(Math.max(1, qty - 1))}><Icon name="minus" /></button>
          <span className="mono">{qty}</span>
          <button aria-label="Tăng" onClick={() => setQty(qty + 1)}><Icon name="plus" /></button>
        </div>
      </div>
      <button className="btn primary xl block mt16" disabled={missing.length > 0} onClick={add}>
        {missing.length ? `Chọn ${missing.map((g) => g.name_vi).join(', ')}` : `Thêm vào đơn · ${vnd(unit * qty)}`}
      </button>
    </Sheet>
  );
}

function MenuDrawer({ onClose, manager, pendingQr, openTabs }: { onClose: () => void; manager: boolean; pendingQr: number; openTabs: number }) {
  const go = (r: string) => { onClose(); navigate(r); };
  const staff = useStore((s) => s.staff)!;
  const cfg = useStore((s) => s.config)!;
  return (
    <div className="drawer" role="dialog" aria-modal="true">
      <nav className="panel">
        <div className="who">
          <span className="circle">{staff.name.slice(0, 1).toUpperCase()}</span>
          <div className="col" style={{ gap: 0 }}>
            <b>{staff.name}</b>
            <span className="small muted">{staff.role === 'owner' ? 'Chủ quán' : staff.role === 'manager' ? 'Quản lý' : 'Nhân viên'} · {cfg.device.name}</span>
          </div>
        </div>
        <button className="navitem" onClick={() => go('order')}><Icon name="home" />Bán hàng</button>
        <button className="navitem" onClick={() => go('tables')}><Icon name="table" />Sơ đồ bàn</button>
        <button className="navitem" onClick={() => go('tabs')}><Icon name="tab" />Tab đang mở{openTabs ? <span className="badge end">{openTabs}</span> : null}</button>
        <button className="navitem" onClick={() => go('orders')}><Icon name="list" />Đơn hôm nay{pendingQr ? <span className="badge info end">{pendingQr} chờ CK</span> : null}</button>
        <button className="navitem" onClick={() => go('cashmove')}><Icon name="wallet" />Thu / chi két</button>
        <button className="navitem" onClick={() => go('clock')}><Icon name="clock" />Chấm công · lịch làm</button>
        <button className="navitem" onClick={() => go('printer')}><Icon name="printer" />Máy in</button>
        <button className="navitem" onClick={() => go('sync')}><Icon name="sync" />Đồng bộ</button>
        <button className="navitem" onClick={() => go('close')}><Icon name="door" />Kết ca / Đóng két</button>
        {manager && <button className="navitem" onClick={() => go('admin')}><Icon name="settings" />Quản trị</button>}
        <div className="grow" />
        <button className="navitem" onClick={() => { onClose(); lock(); }}><Icon name="lock" />Khoá máy · đổi người</button>
        <span className="tiny faint" style={{ padding: '4px 16px 8px' }}>Dui POS {appVersion()}</span>
      </nav>
      <div className="shade" onClick={onClose} />
    </div>
  );
}

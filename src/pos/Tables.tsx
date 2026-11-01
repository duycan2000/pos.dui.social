// Floor plan (sơ đồ bàn). Tables are free, busy (guests drinking, unpaid) or waiting for payment after the
// pre-bill. Tap a free table to open it, a busy one for its bill: add a round, print tạm tính, move, merge, pay.
import { useEffect, useMemo, useState } from 'react';
import type { DiningTable, Order } from '../../shared/types';
import { hhmm, vnd, vndShort } from '../../shared/util';
import { post } from '../lib/api';
import { preBillDoc, tryPrint } from '../lib/receipts';
import {
  cartCount, cartTotals, getManagerSession, getState, markPrebill, mergeOrders, moveTable, navigate, openTab, optionLabel,
  requestApproval, staffName, startTable, tableOrders, toast, useStore, voidOrder,
} from '../lib/store';
import { runSync } from '../lib/sync';
import { Confirm, Empty, Icon, PrinterBanner, Segmented, Sheet, TopBar } from '../ui';

type Status = 'free' | 'busy' | 'bill' | 'transfer';
const STATUS_LABEL: Record<Status, string> = { free: 'Trống', busy: 'Có khách', bill: 'Đã in tạm tính', transfer: 'Chờ chuyển khoản' };

export function since(ms: number) {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  return m < 60 ? `${m}′` : `${Math.floor(m / 60)}g${String(m % 60).padStart(2, '0')}`;
}

function statusOf(orders: Order[] | undefined): Status {
  if (!orders?.length) return 'free';
  if (orders.some((o) => o.status === 'awaiting_payment')) return 'transfer';
  if (orders.every((o) => o.prebill_at)) return 'bill';
  return 'busy';
}

const goTicket = () => navigate(window.matchMedia('(min-width: 980px)').matches ? 'order' : 'cart');

function loadView(): 'map' | 'list' {
  try { return (localStorage.getItem('tables.view') as 'map' | 'list') || 'map'; } catch { return 'map'; }
}

export default function Tables() {
  const cfg = useStore((s) => s.config)!;
  const orders = useStore((s) => s.orders);
  const staff = useStore((s) => s.staff)!;
  const tables = cfg.tables ?? [];
  const areas = useMemo(() => [...new Set(tables.map((t) => t.area))], [tables]);
  const [area, setArea] = useState('');
  const [view, setView] = useState<'map' | 'list'>(loadView);
  const [pick, setPick] = useState<DiningTable | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t); }, []);
  useEffect(() => { try { localStorage.setItem('tables.view', view); } catch { /* private mode */ } }, [view]);

  const byTable = tableOrders(orders);
  const current = area && areas.includes(area) ? area : areas[0] ?? '';
  const shown = tables.filter((t) => t.area === current);
  const counts = { free: 0, busy: 0, bill: 0, transfer: 0 } as Record<Status, number>;
  for (const t of tables) counts[statusOf(byTable.get(t.id))]++;
  const busyCount = tables.length - counts.free;
  const owner = staff.role === 'owner';
  const [adding, setAdding] = useState(false);
  const addBtn = owner ? <button className="iconbtn" aria-label="Thêm bàn" onClick={() => setAdding(true)}><Icon name="plus" /></button> : null;
  const addSheet = adding ? <AddTable area={current || 'Trong nhà'} onClose={() => setAdding(false)} onAdded={(a) => { setAdding(false); setArea(a); }} /> : null;

  if (!tables.length) {
    return (
      <div className="screen wide">
        <TopBar title="Sơ đồ bàn" onBack={() => navigate('order')} />
        <div className="pad">
          <Empty icon="table">Chưa có bàn nào</Empty>
          {owner ? <button className="btn primary block" onClick={() => setAdding(true)}>+ Thêm bàn</button> : <p className="small muted" style={{ textAlign: 'center' }}>Chủ quán thêm bàn ở đây.</p>}
        </div>
        {addSheet}
      </div>
    );
  }

  return (
    <div className="screen wide">
      <TopBar title="Sơ đồ bàn" sub={`${busyCount}/${tables.length} bàn có khách`} onBack={() => navigate('order')}
        right={<>
          {addBtn}
          <button className="iconbtn" aria-label={view === 'map' ? 'Xem dạng danh sách' : 'Xem dạng sơ đồ'} onClick={() => setView(view === 'map' ? 'list' : 'map')}><Icon name={view === 'map' ? 'list' : 'grid'} /></button>
          <button className="iconbtn" aria-label="Làm mới" onClick={() => runSync()}><Icon name="sync" /></button>
        </>} />
      {areas.length > 1 && (
        <nav className="chips" aria-label="Khu vực">
          {areas.map((a) => {
            const busy = tables.filter((t) => t.area === a && byTable.has(t.id)).length;
            return <button key={a} className={'chip' + (a === current ? ' on' : '')} onClick={() => setArea(a)}>{a}{busy ? <span className="badge" style={{ marginLeft: 6 }}>{busy}</span> : null}</button>;
          })}
        </nav>
      )}
      <div style={{ padding: '0 16px' }}><PrinterBanner /></div>
      <div className="legend" aria-label="Chú thích">
        {(['free', 'busy', 'bill', 'transfer'] as Status[]).map((s) => <span key={s} className={'lg ' + s}><i />{STATUS_LABEL[s]} · {counts[s]}</span>)}
      </div>
      <div className="scroll" style={{ padding: '4px 16px 96px' }}>
        {view === 'map' ? <FloorMap tables={shown} byTable={byTable} onPick={setPick} /> : (
          <div className="tablelist">
            {shown.map((t) => <TableTile key={t.id} t={t} orders={byTable.get(t.id)} onPick={setPick} />)}
          </div>
        )}
      </div>
      <div className="ticketbar">
        <button className="btn lg grow" onClick={() => { navigate('order'); }}><Icon name="receipt" size={20} />Mang đi / không bàn</button>
      </div>
      {addSheet}
      {pick && (byTable.get(pick.id)?.length
        ? <BusyTableSheet table={pick} orders={byTable.get(pick.id)!} onClose={() => setPick(null)} />
        : <FreeTableSheet table={pick} onClose={() => setPick(null)} />)}
    </div>
  );
}

/** Tables placed on a grid as arranged in Quản trị › Sơ đồ bàn. Scrolls sideways on a narrow phone. */
export function FloorMap({ tables, byTable, onPick, selected }: { tables: DiningTable[]; byTable: Map<string, Order[]>; onPick: (t: DiningTable) => void; selected?: string | null }) {
  const cols = Math.max(1, ...tables.map((t) => t.x + t.w));
  const rows = Math.max(1, ...tables.map((t) => t.y + t.h));
  // Empty columns/rows (the aisles between tables) stay narrow so the room still fits a phone screen.
  const usedC = new Set<number>(), usedR = new Set<number>();
  for (const t of tables) { for (let i = 0; i < t.w; i++) usedC.add(t.x + i); for (let j = 0; j < t.h; j++) usedR.add(t.y + j); }
  const tc = Array.from({ length: cols }, (_, i) => (usedC.has(i) ? 'minmax(76px, 150px)' : '18px')).join(' ');
  const tr = Array.from({ length: rows }, (_, j) => (usedR.has(j) ? '84px' : '14px')).join(' ');
  return (
    <div className="floorwrap">
      <div className="floor" style={{ gridTemplateColumns: tc, gridTemplateRows: tr }}>
        {tables.map((t) => (
          <div key={t.id} style={{ gridColumn: `${t.x + 1} / span ${t.w}`, gridRow: `${t.y + 1} / span ${t.h}`, display: 'flex' }}>
            <TableTile t={t} orders={byTable.get(t.id)} onPick={onPick} selected={selected === t.id} />
          </div>
        ))}
      </div>
    </div>
  );
}

function TableTile({ t, orders, onPick, selected }: { t: DiningTable; orders?: Order[]; onPick: (t: DiningTable) => void; selected?: boolean }) {
  const st = statusOf(orders);
  const total = (orders ?? []).reduce((s, o) => s + (o.status === 'open' ? cartTotals(o.lines).total : o.total), 0);
  const first = orders?.length ? Math.min(...orders.map((o) => o.created_at)) : 0;
  const guests = (orders ?? []).reduce((s, o) => s + (o.guests || 0), 0);
  return (
    <button className={`tbl ${st} ${t.shape}${selected ? ' sel' : ''}`} onClick={() => onPick(t)}
      aria-label={`${t.name}, ${STATUS_LABEL[st]}${st !== 'free' ? `, ${vnd(total)}` : ''}`}>
      <span className="tn">{t.name}</span>
      {st === 'free' ? <span className="tiny muted">{t.seats} chỗ</span> : (
        <>
          <span className="tt mono">{vndShort(total)}</span>
          <span className="tiny tm">{since(first)}{guests ? ` · ${guests} khách` : ''}{(orders?.length ?? 0) > 1 ? ` · ${orders!.length} đơn` : ''}</span>
        </>
      )}
    </button>
  );
}

function FreeTableSheet({ table, onClose }: { table: DiningTable; onClose: () => void }) {
  const cart = useStore((s) => s.cart);
  const [guests, setGuests] = useState<number>(Math.min(2, table.seats));
  const busy = cartCount(cart.lines) > 0 && !cart.tabCode;
  const go = async (keep: boolean) => {
    await startTable(table.id, guests || null, keep);
    toast(`${table.name}: chọn món rồi bấm Gửi món`);
    navigate('order');
  };
  return (
    <Sheet middle onClose={onClose}>
      <h2>{table.name}</h2>
      <p className="small muted" style={{ marginTop: 4 }}>{table.area} · {table.seats} chỗ · đang trống</p>
      <div className="label small muted mt16">Số khách</div>
      <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
        {[1, 2, 3, 4, 5, 6, 8].map((n) => <button key={n} className={'opt' + (guests === n ? ' on' : '')} style={{ minWidth: 48 }} onClick={() => setGuests(n)}>{n}</button>)}
        <div className="stepper">
          <button aria-label="Giảm" onClick={() => setGuests(Math.max(1, guests - 1))}><Icon name="minus" /></button>
          <span className="mono">{guests}</span>
          <button aria-label="Tăng" onClick={() => setGuests(guests + 1)}><Icon name="plus" /></button>
        </div>
      </div>
      <div className="col gap12 mt16">
        {busy ? (
          <>
            <button className="btn primary lg" onClick={() => go(true)}>Đưa đơn đang chọn ({cartCount(cart.lines)} món) vào {table.name}</button>
            <button className="btn lg" onClick={() => go(false)}>Bỏ đơn đang chọn, mở bàn mới</button>
          </>
        ) : <button className="btn primary lg" onClick={() => go(false)}>Mở bàn · chọn món</button>}
      </div>
    </Sheet>
  );
}

function BusyTableSheet({ table, orders, onClose }: { table: DiningTable; orders: Order[]; onClose: () => void }) {
  const cfg = useStore((s) => s.config)!;
  const cart = useStore((s) => s.cart);
  const [idx, setIdx] = useState(0);
  const [mode, setMode] = useState<'move' | 'merge' | null>(null);
  const [askMergeAll, setAskMergeAll] = useState(false);
  const o = orders[Math.min(idx, orders.length - 1)];
  const tz = cfg.outlet.tz_offset_min;
  const t = o.status === 'open' ? cartTotals(o.lines) : { subtotal: o.subtotal, promo_total: o.promo_total, comp_total: o.comp_total ?? 0, total: o.total };
  const lines = o.lines.filter((l) => l.status === 'active');
  const unsentHere = cart.id === o.id && cart.lines.some((l) => l.status === 'active' && !l.sent_at);
  const otherCartBusy = cartCount(cart.lines) > 0 && !cart.tabCode && cart.id !== o.id;

  const addRound = async () => {
    if (otherCartBusy) { toast('Đơn đang chọn dở trên máy chưa lưu. Gửi hoặc xoá đơn đó trước.', true); return; }
    await openTab(o.id);
    goTicket();
  };
  const prebill = async () => {
    const err = await tryPrint(await preBillDoc(cfg, { ...o, ...t, lines }));
    if (err) { toast(err, true); return; }
    await markPrebill(o.id);
    toast(`Đã in tạm tính ${table.name} — bàn vẫn chưa thanh toán`);
    onClose();
  };
  const pay = async () => {
    if (otherCartBusy) { toast('Đơn đang chọn dở trên máy chưa lưu. Gửi hoặc xoá đơn đó trước.', true); return; }
    await openTab(o.id);
    navigate('checkout');
  };
  const cancel = async () => {
    const r = await requestApproval({ title: `Huỷ ${table.name} #${o.short_code}`, reasonRequired: true, reasons: ['Khách về không gọi', 'Mở nhầm bàn', 'Khách bỏ về'] });
    if (r) { await voidOrder(o.id, r.reason, r.approver.id); onClose(); }
  };
  const mergeAll = async () => {
    setAskMergeAll(false);
    try {
      for (const other of orders.slice(1)) if (other.status === 'open') await mergeOrders(orders[0].id, other.id);
      toast(`Đã gộp thành 1 đơn ${table.name}`);
      onClose();
    } catch (e) { toast((e as Error).message, true); }
  };

  if (o.status === 'awaiting_payment') {
    return (
      <Sheet onClose={onClose}>
        <h2>{table.name}</h2>
        <div className="banner info mt16">Đơn #{o.short_code} đang chờ khách chuyển khoản {vnd(o.total)}. Bàn tự trống khi tiền vào hoặc khi xác nhận trong Đơn hôm nay.</div>
        <button className="btn lg block mt16" onClick={() => navigate('order/' + o.id)}>Mở đơn</button>
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose}>
      <div className="row between">
        <h2>{table.name}</h2>
        <span className="badge muted">#{o.short_code}</span>
      </div>
      <p className="small muted" style={{ margin: '4px 0 0' }}>
        Vào {hhmm(o.created_at, tz)} ({since(o.created_at)}) · {o.guests ? `${o.guests} khách · ` : ''}{staffName(o.staff_id)}{o.customer_label ? ` · ${o.customer_label}` : ''}
      </p>
      {orders.length > 1 && (
        <div className="col gap12 mt16">
          <div className="banner"><Icon name="warn" size={18} /><span>Bàn đang có {orders.length} đơn (thường do 2 máy cùng mở bàn). Nên gộp lại.</span></div>
          <Segmented value={String(idx)} onChange={(v) => setIdx(Number(v))} options={orders.map((x, i) => [String(i), `#${x.short_code}`] as [string, string])} />
          <button className="btn" onClick={() => setAskMergeAll(true)}><Icon name="merge" size={18} />Gộp thành 1 đơn</button>
        </div>
      )}
      {o.prebill_at && <div className="banner info mt16"><Icon name="printer" size={18} />Đã in tạm tính lúc {hhmm(o.prebill_at, tz)}. Khách chưa thanh toán.</div>}
      {unsentHere && <div className="banner mt16">Máy này còn món chọn dở cho bàn này chưa gửi.</div>}
      <div className="list mt16" style={{ maxHeight: 260, overflowY: 'auto' }}>
        {lines.map((l) => (
          <div key={l.id} className="li" style={{ minHeight: 0, padding: '10px 14px' }}>
            <span className="grow col" style={{ gap: 0 }}>
              <span><b>{l.qty}×</b> {l.item_name}</span>
              {(optionLabel(l.modifiers) || l.note) && <span className="tiny muted">{[optionLabel(l.modifiers), l.note].filter(Boolean).join(' · ')}</span>}
            </span>
            <span className="mono small">{l.comp ? <span style={{ color: 'var(--violet)' }}>Mời</span> : vnd(l.unit_price * l.qty, false)}</span>
          </div>
        ))}
        {!lines.length && <div className="li muted small">Chưa có món</div>}
      </div>
      <div className="col" style={{ gap: 2, marginTop: 12 }}>
        {t.promo_total > 0 && <div className="kv small"><span className="accent">Mua 1 tặng 1</span><span className="mono accent">−{vnd(t.promo_total)}</span></div>}
        {(t.comp_total ?? 0) > 0 && <div className="kv small"><span style={{ color: 'var(--violet)' }}>Mời</span><span className="mono" style={{ color: 'var(--violet)' }}>−{vnd(t.comp_total ?? 0)}</span></div>}
        <div className="kv total"><span>Tạm tính</span><span className="mono">{vnd(t.total)}</span></div>
      </div>
      <div className="tableacts mt16">
        <button className="btn lg" onClick={addRound}><Icon name="plus" size={20} />Gọi thêm</button>
        <button className="btn lg" onClick={prebill}><Icon name="printer" size={20} />{o.prebill_at ? 'In lại tạm tính' : 'In tạm tính'}</button>
        <button className="btn" onClick={() => setMode('move')}><Icon name="move" size={18} />Chuyển bàn</button>
        <button className="btn" onClick={() => setMode('merge')}><Icon name="merge" size={18} />Gộp bàn</button>
      </div>
      <button className="btn primary xl block mt16" onClick={pay}>Thanh toán · {vnd(t.total)}</button>
      <button className="btn ghost danger-text block mt8" onClick={cancel}>Huỷ bàn</button>
      {mode && <TablePicker mode={mode} from={table} order={o} onClose={() => setMode(null)} onDone={onClose} />}
      {askMergeAll && <Confirm title={`Gộp ${orders.length} đơn của ${table.name}?`} text="Tất cả món về một đơn để thanh toán một lần." okText="Gộp" onCancel={() => setAskMergeAll(false)} onOk={mergeAll} />}
    </Sheet>
  );
}

/** Choose a table to move an order to (free tables), or to merge with (busy tables). */
export function TablePicker({ mode, from, order, onClose, onDone }: { mode: 'move' | 'merge' | 'assign'; from?: DiningTable | null; order?: Order; onClose: () => void; onDone?: () => void }) {
  const cfg = useStore((s) => s.config)!;
  const orders = useStore((s) => s.orders);
  const byTable = tableOrders(orders);
  const tables = (cfg.tables ?? []).filter((t) => t.id !== from?.id);
  const areas = [...new Set(tables.map((t) => t.area))];
  const [confirm, setConfirm] = useState<DiningTable | null>(null);
  const busyOpen = (t: DiningTable) => !!byTable.get(t.id)?.some((o) => o.status === 'open');
  const can = (t: DiningTable) => (mode === 'merge' ? busyOpen(t) : mode === 'assign' ? !byTable.has(t.id) : !byTable.get(t.id)?.some((o) => o.status !== 'open'));
  const choose = async (t: DiningTable) => {
    const busy = byTable.get(t.id)?.find((o) => o.status === 'open');
    if (mode === 'merge' || ((mode === 'move') && busy)) { setConfirm(t); return; }
    try {
      if (mode === 'assign') await moveTable(getState().cart.id, t.id);
      else if (order) await moveTable(order.id, t.id);
      toast(mode === 'assign' ? `Đơn thuộc ${t.name}` : `Đã chuyển sang ${t.name}`);
      onClose(); onDone?.();
    } catch (e) { toast((e as Error).message, true); }
  };
  const doMerge = async () => {
    const t = confirm!;
    setConfirm(null);
    const other = byTable.get(t.id)!.find((o) => o.status === 'open')!;
    try {
      if (!order) return;
      // "Chuyển" onto a busy table and "Gộp" both end with one bill; merge keeps the earlier order.
      const [target, source] = mode === 'move' ? [other, order] : [order, other];
      await mergeOrders(target.id, source.id);
      toast(mode === 'move' ? `Đã gộp vào ${t.name}` : `Đã gộp ${t.name} vào ${from?.name ?? ''}`);
      onClose(); onDone?.();
    } catch (e) { toast((e as Error).message, true); }
  };
  return (
    <Sheet onClose={onClose}>
      <h2>{mode === 'merge' ? `Gộp bàn nào vào ${from?.name ?? 'bàn này'}?` : mode === 'move' ? `Chuyển ${from?.name ?? 'đơn'} sang bàn…` : 'Chọn bàn'}</h2>
      <p className="small muted" style={{ marginTop: 4 }}>
        {mode === 'merge' ? 'Chọn bàn đang có khách. Món của bàn đó chuyển sang đây, thanh toán chung một bill.' : mode === 'move' ? 'Bàn trống: chuyển cả đơn sang. Bàn có khách: gộp chung bill.' : 'Đơn đang chọn sẽ thuộc bàn này.'}
      </p>
      {areas.map((a) => (
        <div key={a}>
          {areas.length > 1 && <div className="section-title">{a}</div>}
          <div className="pickgrid">
            {tables.filter((t) => t.area === a).map((t) => {
              const st = statusOf(byTable.get(t.id));
              return (
                <button key={t.id} className={`tbl ${st} ${t.shape}`} disabled={!can(t)} onClick={() => choose(t)}>
                  <span className="tn">{t.name}</span>
                  <span className="tiny muted">{st === 'free' ? `${t.seats} chỗ` : STATUS_LABEL[st]}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {confirm && (
        <Confirm title={`Gộp với ${confirm.name}?`} text={`${confirm.name} đang có khách (#${byTable.get(confirm.id)![0].short_code}). Món của hai bàn gộp thành một bill.`}
          okText="Gộp bàn" onCancel={() => setConfirm(null)} onOk={doMerge} />
      )}
    </Sheet>
  );
}

/** Owner only: add a table straight from the floor plan. It goes on the next free spot; drag it in Quản trị › Sơ đồ bàn. */
function AddTable({ area, onClose, onAdded }: { area: string; onClose: () => void; onAdded: (area: string) => void }) {
  const cfg = useStore((s) => s.config)!;
  const online = useStore((s) => s.net.online);
  const tables = cfg.tables ?? [];
  const areas = [...new Set(tables.map((t) => t.area))];
  const nums = tables.map((t) => parseInt(t.name.replace(/\D+/g, ''), 10)).filter((n) => !isNaN(n));
  const [name, setName] = useState(`Bàn ${(nums.length ? Math.max(...nums) : 0) + 1}`);
  const [where, setWhere] = useState(areas.includes(area) ? area : areas[0] ?? 'Trong nhà');
  const [newArea, setNewArea] = useState('');
  const [seats, setSeats] = useState(4);
  const [busy, setBusy] = useState(false);
  const target = (where === '__new' ? newArea : where).trim();
  const save = async () => {
    setBusy(true);
    try {
      const session = await getManagerSession('Thêm bàn — nhập PIN chủ quán');
      if (!session) return;
      // Next free cell, leaving a gap between tables like the starter layout.
      const used = new Set<string>();
      for (const t of tables.filter((t) => t.area === target)) for (let i = 0; i < t.w; i++) for (let j = 0; j < t.h; j++) used.add(`${t.x + i},${t.y + j}`);
      let cell = 0;
      while (used.has(`${(cell % 3) * 2},${Math.floor(cell / 3) * 2}`)) cell++;
      await post('/api/admin/t/dining_table', { area: target, name: name.trim(), seats, x: (cell % 3) * 2, y: Math.floor(cell / 3) * 2, w: 1, h: 1, shape: 'square', sort: tables.length + 1, active: 1 });
      await runSync();
      toast(`Đã thêm ${name.trim()}`);
      onAdded(target);
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  };
  return (
    <Sheet middle onClose={onClose}>
      <h2>Thêm bàn</h2>
      <div className="col gap12 mt16">
        <label className="field"><span>Tên bàn</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Bàn 7, Sofa, Quầy 3" /></label>
        <div className="field"><span>Khu vực</span>
          <div className="row wrap" style={{ gap: 8 }}>
            {areas.map((a) => <button key={a} className={'opt' + (where === a ? ' on' : '')} onClick={() => setWhere(a)}>{a}</button>)}
            <button className={'opt' + (where === '__new' ? ' on' : '')} onClick={() => setWhere('__new')}>+ Khu mới</button>
          </div>
        </div>
        {where === '__new' && <input className="input" autoFocus value={newArea} onChange={(e) => setNewArea(e.target.value)} placeholder="VD: Sân trước, Tầng 2" />}
        <div className="row between">
          <span className="muted">Số ghế</span>
          <div className="stepper">
            <button aria-label="Bớt ghế" onClick={() => setSeats(Math.max(1, seats - 1))}><Icon name="minus" /></button>
            <span className="mono">{seats}</span>
            <button aria-label="Thêm ghế" onClick={() => setSeats(seats + 1)}><Icon name="plus" /></button>
          </div>
        </div>
        {!online && <div className="banner danger">Thêm bàn cần có mạng.</div>}
        <button className="btn primary lg" disabled={busy || !online || !name.trim() || !target} onClick={save}>{busy ? 'Đang thêm…' : 'Thêm bàn'}</button>
        <button className="btn ghost" onClick={() => navigate('admin/tables')}>Sắp xếp sơ đồ, đổi tên, xoá bàn…</button>
      </div>
    </Sheet>
  );
}

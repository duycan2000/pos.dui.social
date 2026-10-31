// App state + actions for the till. A small external store read with useSyncExternalStore.
import { useSyncExternalStore } from 'react';
import { verifyPin } from '../../shared/crypto';
import { computeTotals, type Totals } from '../../shared/pricing';
import type {
  AuditEntry, CashMovement, ChosenOption, DrawerSession, Item, Order, OrderLine, Payment, PosConfig, StaffPublic, StaffShift,
} from '../../shared/types';
import { addDays, businessDay, parseSettings, ulid } from '../../shared/util';
import { api, setDeviceToken, setStaffSession } from './api';
import { kv, outbox, table } from './db';

export interface Cart {
  id: string;
  created_at: number;
  lines: OrderLine[];
  customer_label: string;
  order_type: Order['order_type'];
}

export interface Approval {
  title: string;
  reasonRequired: boolean;
  reasons?: string[];
  /** Always ask a PIN, even for a logged-in manager (needed to open a server session). */
  forcePin?: boolean;
  resolve: (r: { approver: StaffPublic; pin: string; reason: string } | null) => void;
}

export interface AppState {
  boot: 'loading' | 'setup' | 'register' | 'ready';
  config: PosConfig | null;
  staff: StaffPublic | null;
  shift: StaffShift | null;
  drawer: DrawerSession | null;
  drawers: DrawerSession[];
  cart: Cart;
  orders: Order[];
  cashMoves: CashMovement[];
  net: { online: boolean; busy: boolean; pending: number; lastSync: number | null; lastError: string | null };
  route: string;
  toast: { msg: string; error?: boolean } | null;
  adminSession: string | null;
  approval: Approval | null;
  lastPaid: { order: Order; change: number } | null;
}

const newCart = (): Cart => ({ id: ulid(), created_at: Date.now(), lines: [], customer_label: '', order_type: 'takeaway' });

let state: AppState = {
  boot: 'loading', config: null, staff: null, shift: null, drawer: null, drawers: [], cart: newCart(), orders: [], cashMoves: [],
  net: { online: navigator.onLine, busy: false, pending: 0, lastSync: null, lastError: null },
  route: 'login', toast: null, adminSession: null, approval: null, lastPaid: null,
};
const listeners = new Set<() => void>();

export function getState() { return state; }
export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}
export function useStore<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => sel(state));
}

// ---------- helpers ----------

export function today(cfg = state.config): string {
  if (!cfg) return '';
  return businessDay(Date.now(), cfg.outlet.tz_offset_min, cfg.outlet.business_day_cutoff);
}
export function settings() {
  return parseSettings<{ done_return_seconds?: number; cost_alert_pct?: number; tax_threshold_year?: number }>(state.config?.outlet.settings_json);
}
export function isManager(s: StaffPublic | null = state.staff) {
  return !!s && (s.role === 'owner' || s.role === 'manager');
}
export function staffName(id: string | null | undefined) {
  return state.config?.staff.find((s) => s.id === id)?.name ?? '—';
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string, error = false) {
  setState({ toast: { msg, error } });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setState({ toast: null }), error ? 4500 : 2500);
}

export function navigate(route: string) {
  setState({ route });
  if (location.hash !== '#' + route) history.replaceState(null, '', '#' + route);
}

async function audit(e: Omit<AuditEntry, 'id' | 'at' | 'outlet_id' | 'device_id'>) {
  const row: AuditEntry = { id: ulid(), at: Date.now(), outlet_id: null, device_id: state.config?.device.id ?? null, ...e };
  await outbox.add('audit_log', row);
}

async function refreshPending() {
  setState((s) => ({ net: { ...s.net, pending: 0 } }));
  const n = await outbox.count();
  setState((s) => ({ net: { ...s.net, pending: n } }));
}
export { refreshPending };

let syncKick: () => void = () => {};
export function setSyncKick(fn: () => void) { syncKick = fn; }

// ---------- boot ----------

export async function boot() {
  const token = await kv.get<string>('deviceToken');
  if (!token) {
    try {
      const r = await api<{ needsSetup: boolean }>('GET', '/api/setup/status');
      setState({ boot: r.needsSetup ? 'setup' : 'register' });
    } catch {
      setState({ boot: 'register', toast: { msg: 'Cần có mạng để đăng ký thiết bị lần đầu', error: true } });
    }
    return;
  }
  setDeviceToken(token);
  await loadLocal();
  setState({ boot: 'ready' });
  navigate('login');
}

export async function loadLocal() {
  const [config, drawers, orders, cash] = await Promise.all([
    kv.get<PosConfig>('config'), kv.get<DrawerSession[]>('drawers'), table<Order>('orders').all(), table<CashMovement>('cash').all(),
  ]);
  const cart = (await kv.get<Cart>('cart')) || newCart();
  setState({ config: config ?? null, drawers: drawers ?? [], orders: sortOrders(orders), cashMoves: cash, cart });
  pickDrawer();
  await refreshPending();
}

function sortOrders(o: Order[]) {
  return [...o].sort((a, b) => b.created_at - a.created_at);
}

/** The drawer this device sells into: the open one, newest first. */
export function pickDrawer() {
  const open = state.drawers.filter((d) => d.status === 'open').sort((a, b) => b.opened_at - a.opened_at);
  setState({ drawer: open[0] ?? null });
}

export async function completeRegistration(token: string) {
  await kv.set('deviceToken', token);
  setDeviceToken(token);
  setState({ boot: 'ready' });
  syncKick();
  navigate('login');
}

// ---------- login / shift ----------

export async function login(staff: StaffPublic, pin: string): Promise<boolean> {
  if (!(await verifyPin(pin, staff.pin_salt, staff.pin_hash))) return false;
  const shift = (await kv.get<StaffShift>('shift:' + staff.id)) ?? null;
  setState({ staff, shift: shift && !shift.ended_at ? shift : null, adminSession: null });
  setStaffSession('');
  pickDrawer();
  if (isManager(staff) && navigator.onLine) {
    api<{ session: string }>('POST', '/api/auth/staff', { staffId: staff.id, pin })
      .then((r) => { setState({ adminSession: r.session }); setStaffSession(r.session); })
      .catch(() => {});
  }
  const s = getState();
  navigate(s.shift && s.drawer && s.shift.drawer_session_id === s.drawer.id ? 'order' : 'open-shift');
  return true;
}

export function lock() {
  setStaffSession('');
  setState({ staff: null, adminSession: null });
  navigate('login');
}

export async function openDrawerAndShift(openingFloat: number, counts: Record<string, number> | null) {
  const s = getState();
  const cfg = s.config!;
  const t = Date.now();
  const day = today();
  let drawer = s.drawer;
  if (!drawer) {
    drawer = {
      id: ulid(), outlet_id: cfg.outlet.id, business_day: day, status: 'open', opened_by: s.staff!.id, opened_at: t,
      opening_float: openingFloat, opening_count_json: counts ? JSON.stringify(counts) : null, closed_by: null, closed_at: null,
      counted_json: null, counted_total: null, expected_total: null, difference: null, note: null, device_id: cfg.device.id, created_at: t, updated_at: t,
    };
    const drawers = [...s.drawers, drawer];
    await kv.set('drawers', drawers);
    await outbox.add('drawer_session', drawer);
    setState({ drawers, drawer });
  }
  const shift: StaffShift = {
    id: ulid(), staff_id: s.staff!.id, outlet_id: cfg.outlet.id, device_id: cfg.device.id, drawer_session_id: drawer.id,
    business_day: day, started_at: t, ended_at: null, created_at: t, updated_at: t,
  };
  await kv.set('shift:' + shift.staff_id, shift);
  await outbox.add('staff_shift', shift);
  setState({ shift });
  await refreshPending();
  syncKick();
  navigate('order');
}

export async function endMyShift() {
  const s = getState();
  if (s.shift) {
    const ended = { ...s.shift, ended_at: Date.now(), updated_at: Date.now() };
    await kv.set('shift:' + ended.staff_id, ended);
    await outbox.add('staff_shift', ended);
    await refreshPending();
    syncKick();
  }
  setState({ shift: null });
  lock();
}

// ---------- cart ----------

async function saveCart(cart: Cart) {
  setState({ cart });
  await kv.set('cart', cart);
}

export function defaultOptions(item: Item): ChosenOption[] {
  const cfg = state.config!;
  const groups = cfg.itemModifierGroups.filter((g) => g.item_id === item.id).map((g) => cfg.modifierGroups.find((x) => x.id === g.group_id)!).filter(Boolean);
  const out: ChosenOption[] = [];
  for (const g of groups) {
    const opts = cfg.modifierOptions.filter((o) => o.group_id === g.id);
    const def = opts.filter((o) => o.is_default);
    const pick = def.length ? (g.selection === 'single' ? [def[0]] : def) : g.required && g.selection === 'single' && opts[0] ? [opts[0]] : [];
    for (const o of pick) out.push({ id: o.id, group_id: g.id, name: o.name_vi, price_delta: o.price_delta, excludes_promo: o.excludes_promo });
  }
  return out;
}

/** Hide "default" choices (Bình thường) from the line label; show only what differs. */
export function optionLabel(mods: ChosenOption[]) {
  const cfg = state.config;
  return mods.filter((m) => !cfg?.modifierOptions.find((o) => o.id === m.id)?.is_default).map((m) => m.name).join(', ');
}

export async function addToCart(item: Item, mods: ChosenOption[], qty = 1, note: string | null = null) {
  const cart = state.cart;
  const key = (l: { item_id: string; modifiers: ChosenOption[]; note: string | null }) => l.item_id + '|' + l.modifiers.map((m) => m.id).sort().join(',') + '|' + (l.note || '');
  const unit = item.price + mods.reduce((s, m) => s + m.price_delta, 0);
  const k = key({ item_id: item.id, modifiers: mods, note });
  const lines = cart.lines.map((l) => ({ ...l }));
  const same = lines.find((l) => l.status === 'active' && key(l) === k);
  if (same) same.qty += qty;
  else lines.push({ id: ulid(), item_id: item.id, item_name: item.name_vi, unit_price: unit, qty, modifiers: mods, line_total: unit * qty, note, status: 'active', sort: lines.length });
  await saveCart({ ...cart, lines, created_at: cart.lines.length ? cart.created_at : Date.now() });
}

export async function updateLine(id: string, patch: Partial<OrderLine>) {
  const lines = state.cart.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)).filter((l) => l.qty > 0);
  await saveCart({ ...state.cart, lines });
}

export async function setCartMeta(patch: Partial<Pick<Cart, 'customer_label' | 'order_type'>>) {
  await saveCart({ ...state.cart, ...patch });
}

export async function clearCart() {
  await saveCart(newCart());
}

export function cartTotals(lines = state.cart.lines): Totals {
  const cfg = state.config;
  if (!cfg) return { subtotal: 0, promo_total: 0, discount_total: 0, total: 0, adjustments: [] };
  const copy = lines.map((l) => ({ ...l }));
  return computeTotals(copy, cfg.promotions, cfg.promotionItems, Date.now(), cfg.outlet.tz_offset_min);
}

export function cartCount() {
  return state.cart.lines.filter((l) => l.status === 'active').reduce((s, l) => s + l.qty, 0);
}

// ---------- orders ----------

async function nextShortCode(): Promise<string> {
  const day = today();
  const c = (await kv.get<{ day: string; n: number }>('counter')) ?? { day, n: 0 };
  const n = c.day === day ? c.n + 1 : 1;
  await kv.set('counter', { day, n });
  return `${state.config!.device.order_prefix}-${String(n).padStart(3, '0')}`;
}

export async function peekShortCode(): Promise<string> {
  const day = today();
  const c = (await kv.get<{ day: string; n: number }>('counter')) ?? { day, n: 0 };
  const n = c.day === day ? c.n + 1 : 1;
  return `${state.config?.device.order_prefix ?? 'A'}-${String(n).padStart(3, '0')}`;
}

async function saveOrder(o: Order) {
  await table<Order>('orders').put(o);
  await outbox.add('order', o);
  setState((s) => ({ orders: sortOrders([o, ...s.orders.filter((x) => x.id !== o.id)]) }));
  await refreshPending();
  syncKick();
}

/** Turn the cart into an order: paid now, or awaiting a bank transfer (VietQR). */
export async function finalizeCart(status: 'paid' | 'awaiting_payment', payments: Payment[]): Promise<Order> {
  const s = getState();
  const cfg = s.config!;
  const t = Date.now();
  const lines = s.cart.lines.filter((l) => l.status === 'active').map((l) => ({ ...l }));
  const totals = computeTotals(lines, cfg.promotions, cfg.promotionItems, t, cfg.outlet.tz_offset_min);
  const order: Order = {
    id: s.cart.id, outlet_id: cfg.outlet.id, device_id: cfg.device.id, short_code: await nextShortCode(),
    business_day: businessDay(t, cfg.outlet.tz_offset_min, cfg.outlet.business_day_cutoff),
    staff_id: s.staff!.id, staff_shift_id: s.shift?.id ?? null, drawer_session_id: s.drawer?.id ?? null,
    order_type: s.cart.order_type, customer_label: s.cart.customer_label.trim() || null, status,
    subtotal: totals.subtotal, promo_total: totals.promo_total, discount_total: totals.discount_total, total: totals.total,
    sent_at: t, paid_at: status === 'paid' ? t : null, void_reason: null, voided_by: null, approved_by: null, voided_at: null,
    created_at: t, updated_at: t, lines, adjustments: totals.adjustments,
    payments: payments.map((p) => ({ ...p, drawer_session_id: s.drawer?.id ?? null })),
  };
  await saveOrder(order);
  await clearCart();
  return order;
}

export function makePayment(method: Payment['method'], amount: number, extra: Partial<Payment> = {}): Payment {
  const confirmed = extra.status !== 'pending';
  return {
    id: ulid(), method, amount, tendered: null, change_given: 0, reference: null, status: confirmed ? 'confirmed' : 'pending',
    confirmed_by: confirmed ? state.staff?.id ?? null : null, confirmed_at: confirmed ? Date.now() : null,
    drawer_session_id: state.drawer?.id ?? null, created_at: Date.now(), ...extra,
  };
}

export async function confirmTransfer(orderId: string) {
  const o = state.orders.find((x) => x.id === orderId);
  if (!o || o.status !== 'awaiting_payment') return;
  const t = Date.now();
  const updated: Order = {
    ...o, status: 'paid', paid_at: t, updated_at: t,
    payments: o.payments.map((p) => (p.status === 'pending' ? { ...p, status: 'confirmed', confirmed_by: state.staff!.id, confirmed_at: t } : p)),
  };
  await saveOrder(updated);
  toast(`Đã xác nhận chuyển khoản #${o.short_code}`);
}

export async function voidOrder(orderId: string, reason: string, approverId: string) {
  const o = state.orders.find((x) => x.id === orderId);
  if (!o || o.status === 'void') return;
  const t = Date.now();
  const updated: Order = { ...o, status: 'void', void_reason: reason, voided_by: state.staff!.id, approved_by: approverId, voided_at: t, updated_at: t };
  await audit({ actor_id: state.staff!.id, approver_id: approverId, action: 'void', entity: 'order', entity_id: o.id, before_json: JSON.stringify({ status: o.status, total: o.total }), after_json: null, reason });
  await saveOrder(updated);
  toast(`Đã huỷ đơn #${o.short_code}`);
}

// ---------- cash in / out ----------

export async function addCashMove(direction: 'in' | 'out', amount: number, reason: string, note: string | null, photoKey: string | null, approvedBy: string | null) {
  const s = getState();
  if (!s.drawer) throw new Error('Chưa mở két');
  const t = Date.now();
  const m: CashMovement = {
    id: ulid(), drawer_session_id: s.drawer.id, business_day: today(), direction, amount, reason, note, photo_key: photoKey,
    purchase_id: null, staff_id: s.staff!.id, approved_by: approvedBy, device_id: s.config!.device.id, created_at: t, updated_at: t,
  };
  await table<CashMovement>('cash').put(m);
  await outbox.add('cash_movement', m);
  if (approvedBy) await audit({ actor_id: s.staff!.id, approver_id: approvedBy, action: 'cash_' + direction, entity: 'cash_movement', entity_id: m.id, before_json: null, after_json: JSON.stringify({ amount, reason }), reason: note });
  setState((st) => ({ cashMoves: [m, ...st.cashMoves] }));
  await refreshPending();
  syncKick();
}

// ---------- manager approval (S18) ----------

export function requestApproval(opts: Omit<Approval, 'resolve'>): Promise<{ approver: StaffPublic; pin: string; reason: string } | null> {
  return new Promise((resolve) => setState({ approval: { ...opts, resolve: (r) => { setState({ approval: null }); resolve(r); } } }));
}

// ---------- housekeeping ----------

/** Keep only recent business days on the device. */
export async function pruneLocal() {
  const cfg = state.config;
  if (!cfg) return;
  const keepFrom = addDays(today(), -3);
  const pendingIds = new Set((await outbox.all()).map((r) => r.id));
  for (const o of state.orders) if (o.business_day < keepFrom && !pendingIds.has(o.id)) await table<Order>('orders').del(o.id);
  for (const m of state.cashMoves) if (m.business_day < keepFrom && !pendingIds.has(m.id)) await table<CashMovement>('cash').del(m.id);
  setState((s) => ({ orders: s.orders.filter((o) => o.business_day >= keepFrom || pendingIds.has(o.id)), cashMoves: s.cashMoves.filter((m) => m.business_day >= keepFrom || pendingIds.has(m.id)) }));
}

/**
 * A back-office session on the server for a manager/owner. Uses the logged-in manager's session if there
 * is one; otherwise asks for a manager PIN (S18) and signs that manager in. Needs network.
 */
export async function getManagerSession(title: string): Promise<{ session: string; approverId: string } | null> {
  const s = getState();
  if (isManager(s.staff) && s.adminSession) return { session: s.adminSession, approverId: s.staff!.id };
  const r = await requestApproval({ title, reasonRequired: false, forcePin: true });
  if (!r) return null;
  try {
    const res = await api<{ session: string }>('POST', '/api/auth/staff', { staffId: r.approver.id, pin: r.pin });
    if (r.approver.id === getState().staff?.id) { setState({ adminSession: res.session }); setStaffSession(res.session); }
    return { session: res.session, approverId: r.approver.id };
  } catch (e) {
    toast((e as Error).message, true);
    return null;
  }
}

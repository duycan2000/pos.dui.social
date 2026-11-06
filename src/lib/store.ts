// App state + actions for the till. A small external store read with useSyncExternalStore.
import { useSyncExternalStore } from 'react';
import { verifyPin } from '../../shared/crypto';
import { computeTotals, type Totals } from '../../shared/pricing';
import type {
  AuditEntry, CashMovement, ChosenOption, DiningTable, DrawerSession, Item, Order, OrderLine, Payment, PosConfig, StaffPublic, StaffShift,
  TimeEntry, WorkShift, LowStock,
} from '../../shared/types';
import { addDays, businessDay, parseSettings, ulid } from '../../shared/util';
import { api, setDeviceToken, setStaffSession } from './api';
import { kv, outbox, table } from './db';
import { loadPrinter } from './printer';
import { canAdmin, hasPerm, type Perm } from '../../shared/perms';

export interface Cart {
  id: string;
  created_at: number;
  lines: OrderLine[];
  customer_label: string;
  order_type: Order['order_type'];
  /** Set when the cart is an open tab loaded for another round or for payment. */
  tabCode?: string | null;
  /** Dine-in table and number of guests. */
  table_id?: string | null;
  guests?: number | null;
}

export interface Approval {
  title: string;
  reasonRequired: boolean;
  reasons?: string[];
  /** Always ask a PIN, even for a logged-in manager (needed to open a server session). */
  forcePin?: boolean;
  /** Who may approve: a permission (default 'approve') or the owner only. */
  need?: Perm | 'owner';
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
  /** Time clock: open entries and the last two weeks (from the server plus not-yet-pushed local ones). */
  timeEntries: TimeEntry[];
  schedule: WorkShift[];
  /** Ingredients under their minimum and the menu items that use them (from the last pull). */
  lowStock: LowStock | null;
}

const newCart = (): Cart => ({ id: ulid(), created_at: Date.now(), lines: [], customer_label: '', order_type: 'takeaway' });

let state: AppState = {
  boot: 'loading', config: null, staff: null, shift: null, drawer: null, drawers: [], cart: newCart(), orders: [], cashMoves: [],
  net: { online: navigator.onLine, busy: false, pending: 0, lastSync: null, lastError: null },
  route: 'login', toast: null, adminSession: null, approval: null, lastPaid: null, timeEntries: [], schedule: [], lowStock: null,
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
/** The latest row for a person (permissions may have changed since they logged in). */
function fresh(s: StaffPublic | null) {
  return s ? state.config?.staff.find((x) => x.id === s.id) ?? s : null;
}
/** Has this permission (shared/perms.ts). Owner: always. */
export function can(p: Perm, s: StaffPublic | null = state.staff) {
  return hasPerm(fresh(s), p);
}
/** Can open Quản trị (owner, or any back-office permission). */
export function isManager(s: StaffPublic | null = state.staff) {
  return canAdmin(fresh(s));
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
  if (state.staff) rememberSession();
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
  if (!(await resumeSession())) navigate('login');
}

// A reload (or Android killing the app in the background) must not throw the person out mid-order.
// The signed-in staff member and the screen they were on are kept on the device until they lock it,
// for at most RESUME_MS of inactivity.
const RESUME_MS = 8 * 3600 * 1000;
let touchTimer: ReturnType<typeof setTimeout> | undefined;

function rememberSession() {
  clearTimeout(touchTimer);
  touchTimer = setTimeout(() => {
    const s = getState();
    if (s.staff) kv.set('session', { staffId: s.staff.id, at: Date.now(), route: s.route.startsWith('admin') ? 'order' : s.route });
  }, 300);
}

async function resumeSession(): Promise<boolean> {
  const saved = await kv.get<{ staffId: string; at: number; route: string }>('session');
  const staff = saved && Date.now() - saved.at < RESUME_MS ? state.config?.staff.find((x) => x.id === saved.staffId && x.active) : undefined;
  if (!saved || !staff) { if (saved) await kv.del('session'); return false; }
  const shift = (await kv.get<StaffShift>('shift:' + staff.id)) ?? null;
  setState({ staff, shift: shift && !shift.ended_at ? shift : null });
  pickDrawer();
  const s = getState();
  const ready = s.shift && s.drawer && s.shift.drawer_session_id === s.drawer.id;
  // Payment screens are rebuilt from the saved cart, so going back to the order is always safe.
  const safe = ['order', 'cart', 'tables', 'tabs', 'orders', 'clock', 'cashmove', 'printer', 'sync', 'close'];
  navigate(!ready ? 'open-shift' : safe.includes(saved.route) || saved.route.startsWith('order/') ? saved.route : 'order');
  return true;
}

export async function loadLocal() {
  await loadPrinter();
  const [config, drawers, orders, cash] = await Promise.all([
    kv.get<PosConfig>('config'), kv.get<DrawerSession[]>('drawers'), table<Order>('orders').all(), table<CashMovement>('cash').all(),
  ]);
  const cart = (await kv.get<Cart>('cart')) || newCart();
  const [timeEntries, schedule, lowStock] = await Promise.all([kv.get<TimeEntry[]>('timeEntries'), kv.get<WorkShift[]>('schedule'), kv.get<LowStock>('lowStock')]);
  setState({ lowStock: lowStock ?? null, config: config ?? null, drawers: drawers ?? [], orders: sortOrders(orders), cashMoves: cash, cart, timeEntries: timeEntries ?? [], schedule: schedule ?? [] });
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
  if ((isManager(staff) || can('approve', staff)) && navigator.onLine) {
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
  clearTimeout(touchTimer);
  kv.del('session');
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
  if (!openEntry(shift.staff_id)) await clockIn(shift.staff_id); // selling means working
  await refreshPending();
  syncKick();
  navigate('order');
}

export async function endMyShift(alsoClockOut = false) {
  const s = getState();
  if (alsoClockOut && s.staff && openEntry(s.staff.id)) await clockOut(s.staff.id);
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
// The cart is the order being built on this device. For an open tab it holds the tab itself:
// lines already sent carry sent_at, new rounds do not.

async function saveCart(cart: Cart) {
  setState({ cart });
  if (state.staff) rememberSession();
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
  // Only merge into a line that has not been sent yet and is not a comp.
  const same = lines.find((l) => l.status === 'active' && !l.sent_at && !l.comp && key(l) === k);
  if (same) same.qty += qty;
  else lines.push({ id: ulid(), item_id: item.id, item_name: item.name_vi, unit_price: unit, qty, modifiers: mods, line_total: unit * qty, note, status: 'active', sort: lines.length });
  await saveCart({ ...cart, lines, created_at: cart.lines.length ? cart.created_at : Date.now() });
}

export async function updateLine(id: string, patch: Partial<OrderLine>) {
  const lines = state.cart.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)).filter((l) => l.qty > 0 || l.sent_at);
  await saveCart({ ...state.cart, lines });
}

/** Remove a line. A line already sent to the bar (tab round) needs a reason and a manager, and is kept as removed. */
export async function removeLine(id: string): Promise<boolean> {
  const l = state.cart.lines.find((x) => x.id === id);
  if (!l) return false;
  if (!l.sent_at) { await updateLine(id, { qty: 0 }); return true; }
  const r = await requestApproval({ title: `Bỏ món đã gửi: ${l.qty}× ${l.item_name}`, reasonRequired: true, reasons: ['Khách đổi ý', 'Pha sai', 'Gọi nhầm', 'Hết nguyên liệu'] });
  if (!r) return false;
  await updateLine(id, { status: 'removed', removed_by: state.staff!.id, removed_reason: r.reason });
  await audit({ actor_id: state.staff!.id, approver_id: r.approver.id, action: 'line_remove', entity: 'order', entity_id: state.cart.id, before_json: JSON.stringify({ item: l.item_name, qty: l.qty }), after_json: null, reason: r.reason });
  return true;
}

/** +1 on a ticket line. A line already sent to the bar never changes: the extra drink becomes a new round line. */
export async function plusOne(id: string) {
  const l = state.cart.lines.find((x) => x.id === id);
  if (!l || l.status !== 'active') return;
  if (!l.sent_at && !l.comp) { await updateLine(id, { qty: l.qty + 1 }); return; }
  const item = state.config?.items.find((i) => i.id === l.item_id);
  if (item) await addToCart(item, l.modifiers, 1, l.note);
}

/**
 * −1 on a ticket line. Not sent yet: just fewer (0 removes it). Already sent to the bar: needs a manager and a
 * reason, and one unit is kept as a removed line so the audit trail shows exactly what was taken off.
 */
export async function minusOne(id: string): Promise<boolean> {
  const l = state.cart.lines.find((x) => x.id === id);
  if (!l || l.status !== 'active') return false;
  if (!l.sent_at) { await updateLine(id, { qty: l.qty - 1 }); return true; }
  if (l.qty <= 1) return removeLine(id);
  const r = await requestApproval({ title: `Bỏ 1 ly đã gửi: ${l.item_name}`, reasonRequired: true, reasons: ['Bấm nhầm', 'Khách đổi ý', 'Pha sai', 'Hết nguyên liệu'] });
  if (!r) return false;
  const removed: OrderLine = { ...l, id: ulid(), qty: 1, line_total: l.unit_price, status: 'removed', removed_by: state.staff!.id, removed_reason: r.reason, sort: state.cart.lines.length };
  const lines = [...state.cart.lines.map((x) => (x.id === id ? { ...x, qty: x.qty - 1, line_total: x.unit_price * (x.qty - 1) } : x)), removed];
  await saveCart({ ...state.cart, lines });
  await audit({ actor_id: state.staff!.id, approver_id: r.approver.id, action: 'line_remove', entity: 'order', entity_id: state.cart.id, before_json: JSON.stringify({ item: l.item_name, qty: l.qty }), after_json: JSON.stringify({ qty: l.qty - 1 }), reason: r.reason });
  return true;
}

/** −1 from the menu tile: undo the latest tap on that item (only lines not sent yet). */
export async function minusItem(itemId: string) {
  const l = [...state.cart.lines].reverse().find((x) => x.item_id === itemId && x.status === 'active' && !x.sent_at && !x.comp);
  if (l) await updateLine(l.id, { qty: l.qty - 1 });
}

export const COMP_REASONS = ['Khách quen', 'Bạn chủ quán', 'Nhân viên', 'Xin lỗi khách', 'Khuyến mãi riêng'];

/** Ly mời: free for the guest, still deducted from stock. Needs a manager and a reason. */
export async function compLine(id: string, on: boolean): Promise<boolean> {
  const l = state.cart.lines.find((x) => x.id === id);
  if (!l) return false;
  if (!on) { await updateLine(id, { comp: 0, comp_reason: null, comp_by: null }); return true; }
  const r = await requestApproval({ title: `Mời: ${l.qty}× ${l.item_name} (${(l.unit_price * l.qty).toLocaleString('vi-VN')} ₫)`, reasonRequired: true, reasons: COMP_REASONS });
  if (!r) return false;
  await updateLine(id, { comp: 1, comp_reason: r.reason, comp_by: r.approver.id });
  await audit({ actor_id: state.staff!.id, approver_id: r.approver.id, action: 'comp', entity: 'order', entity_id: state.cart.id, before_json: null, after_json: JSON.stringify({ item: l.item_name, qty: l.qty, value: l.unit_price * l.qty }), reason: r.reason });
  return true;
}

export async function setCartMeta(patch: Partial<Pick<Cart, 'customer_label' | 'order_type' | 'table_id' | 'guests'>>) {
  await saveCart({ ...state.cart, ...patch });
}

export async function clearCart() {
  await saveCart(newCart());
}

export function cartTotals(lines = state.cart.lines): Totals {
  const cfg = state.config;
  if (!cfg) return { subtotal: 0, promo_total: 0, discount_total: 0, comp_total: 0, total: 0, adjustments: [] };
  const copy = lines.map((l) => ({ ...l }));
  return computeTotals(copy, cfg.promotions, cfg.promotionItems, Date.now(), cfg.outlet.tz_offset_min);
}

export function cartCount(lines = state.cart.lines) {
  return lines.filter((l) => l.status === 'active').reduce((s, l) => s + l.qty, 0);
}

// ---------- orders & tabs ----------

async function nextShortCode(): Promise<string> {
  const day = today();
  const c = (await kv.get<{ day: string; n: number }>('counter')) ?? { day, n: 0 };
  const n = c.day === day ? c.n + 1 : 1;
  await kv.set('counter', { day, n });
  return `${state.config!.device.order_prefix}-${String(n).padStart(3, '0')}`;
}

export async function peekShortCode(): Promise<string> {
  if (state.cart.tabCode) return state.cart.tabCode;
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

async function buildOrder(status: Order['status'], payments: Payment[]): Promise<{ order: Order; newLines: OrderLine[] }> {
  const s = getState();
  const cfg = s.config!;
  const t = Date.now();
  const existing = s.cart.tabCode ? s.orders.find((o) => o.id === s.cart.id) : undefined;
  const newLines = s.cart.lines.filter((l) => l.status === 'active' && !l.sent_at);
  const lines = s.cart.lines.map((l) => ({ ...l, sent_at: l.sent_at ?? t }));
  const totals = computeTotals(lines.map((l) => ({ ...l })), cfg.promotions, cfg.promotionItems, t, cfg.outlet.tz_offset_min);
  for (const l of lines) l.line_total = l.unit_price * l.qty;
  const order: Order = {
    id: s.cart.id, outlet_id: cfg.outlet.id, device_id: existing?.device_id ?? cfg.device.id,
    short_code: s.cart.tabCode ?? (await nextShortCode()),
    business_day: existing?.business_day ?? businessDay(t, cfg.outlet.tz_offset_min, cfg.outlet.business_day_cutoff),
    staff_id: existing?.staff_id ?? s.staff!.id, staff_shift_id: existing?.staff_shift_id ?? s.shift?.id ?? null,
    drawer_session_id: s.drawer?.id ?? existing?.drawer_session_id ?? null,
    order_type: s.cart.table_id ? 'dine_in' : s.cart.order_type, customer_label: s.cart.customer_label.trim() || null, status,
    table_id: s.cart.table_id ?? null, guests: s.cart.guests ?? null,
    // A new round makes an earlier pre-bill out of date.
    prebill_at: newLines.length ? null : existing?.prebill_at ?? null, merged_into: null,
    subtotal: totals.subtotal, promo_total: totals.promo_total, discount_total: totals.discount_total, comp_total: totals.comp_total,
    tip_total: payments.reduce((a, p) => a + (p.tip || 0), 0), total: totals.total,
    sent_at: existing?.sent_at ?? t, paid_at: status === 'paid' ? t : null, void_reason: null, voided_by: null, approved_by: null, voided_at: null,
    created_at: existing?.created_at ?? s.cart.created_at ?? t, updated_at: t, lines, adjustments: totals.adjustments,
    payments: payments.map((p) => ({ ...p, drawer_session_id: s.drawer?.id ?? null })),
  };
  return { order, newLines };
}

let printHook: (kind: 'ticket' | 'receipt', order: Order, newLines: OrderLine[]) => void = () => {};
export function setPrintHook(fn: typeof printHook) { printHook = fn; }

/** Save the cart as an open tab (new tab or a new round on an existing one). */
export async function saveToTab(): Promise<Order> {
  const { order, newLines } = await buildOrder('open', []);
  await saveOrder(order);
  if (newLines.length) printHook('ticket', order, newLines);
  await clearCart();
  return order;
}

/** Load an open tab into the cart to add a round, remove lines or take payment. */
export async function openTab(orderId: string) {
  const o = state.orders.find((x) => x.id === orderId && x.status === 'open');
  if (!o) return;
  await saveCart({ id: o.id, created_at: o.created_at, lines: o.lines.map((l) => ({ ...l })), customer_label: o.customer_label ?? '', order_type: o.order_type, tabCode: o.short_code, table_id: o.table_id ?? null, guests: o.guests ?? null });
}

/** Turn the cart into an order: paid now, or awaiting a bank transfer (VietQR). */
export async function finalizeCart(status: 'paid' | 'awaiting_payment', payments: Payment[]): Promise<Order> {
  const { order, newLines } = await buildOrder(status, payments);
  await saveOrder(order);
  if (newLines.length) printHook('ticket', order, newLines);
  if (status === 'paid') printHook('receipt', order, []);
  await clearCart();
  return order;
}

export function makePayment(method: Payment['method'], amount: number, extra: Partial<Payment> = {}): Payment {
  const confirmed = extra.status !== 'pending';
  return {
    id: ulid(), method, amount, tip: 0, tendered: null, change_given: 0, reference: null, status: confirmed ? 'confirmed' : 'pending',
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
  printHook('receipt', updated, []);
  toast(`Đã xác nhận chuyển khoản #${o.short_code}`);
}

export async function voidOrder(orderId: string, reason: string, approverId: string) {
  const o = state.orders.find((x) => x.id === orderId);
  if (!o || o.status === 'void') return;
  const t = Date.now();
  const updated: Order = { ...o, status: 'void', void_reason: reason, voided_by: state.staff!.id, approved_by: approverId, voided_at: t, updated_at: t };
  await audit({ actor_id: state.staff!.id, approver_id: approverId, action: 'void', entity: 'order', entity_id: o.id, before_json: JSON.stringify({ status: o.status, total: o.total }), after_json: null, reason });
  await saveOrder(updated);
  if (state.cart.id === o.id) await clearCart();
  toast(o.status === 'open' ? `Đã huỷ tab #${o.short_code}` : `Đã huỷ đơn #${o.short_code}`);
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
  const old = (o: Order) => o.business_day < keepFrom && !pendingIds.has(o.id) && o.status !== 'open' && o.status !== 'awaiting_payment';
  for (const o of state.orders) if (old(o)) await table<Order>('orders').del(o.id);
  for (const m of state.cashMoves) if (m.business_day < keepFrom && !pendingIds.has(m.id)) await table<CashMovement>('cash').del(m.id);
  setState((s) => ({ orders: s.orders.filter((o) => !old(o)), cashMoves: s.cashMoves.filter((m) => m.business_day >= keepFrom || pendingIds.has(m.id)) }));
}

/**
 * A back-office session on the server for a manager/owner. Uses the logged-in manager's session if there
 * is one; otherwise asks for a manager PIN (S18) and signs that manager in. Needs network.
 */
export async function getManagerSession(title: string, need?: Perm | 'owner'): Promise<{ session: string; approverId: string } | null> {
  const s = getState();
  const mine = need === 'owner' ? s.staff?.role === 'owner' : need ? can(need) : isManager(s.staff);
  if (mine && s.adminSession) return { session: s.adminSession, approverId: s.staff!.id };
  const r = await requestApproval({ title, reasonRequired: false, forcePin: true, need });
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

/** The current cart as an order-shaped object, for printing a bill before payment. */
export async function cartAsOrder(): Promise<Order> {
  const s = getState();
  const cfg = s.config!;
  const t = cartTotals(s.cart.lines);
  const existing = s.cart.tabCode ? s.orders.find((o) => o.id === s.cart.id) : undefined;
  const now = Date.now();
  return {
    id: s.cart.id, outlet_id: cfg.outlet.id, device_id: cfg.device.id, short_code: await peekShortCode(),
    business_day: existing?.business_day ?? today(), staff_id: existing?.staff_id ?? s.staff?.id ?? '', staff_shift_id: null, drawer_session_id: s.drawer?.id ?? null,
    order_type: s.cart.order_type, customer_label: s.cart.customer_label.trim() || null, status: 'open', table_id: s.cart.table_id ?? null, guests: s.cart.guests ?? null,
    subtotal: t.subtotal, promo_total: t.promo_total, discount_total: t.discount_total, comp_total: t.comp_total, total: t.total,
    sent_at: null, paid_at: null, void_reason: null, voided_by: null, approved_by: null, voided_at: null,
    created_at: existing?.created_at ?? s.cart.created_at ?? now, updated_at: now, lines: s.cart.lines.filter((l) => l.status === 'active'), adjustments: t.adjustments, payments: [],
  };
}

// ---------- tables (dine-in) ----------
// A table order is an open tab with table_id. It stays unpaid while the guests drink: send rounds,
// print a pre-bill (tạm tính) when they ask, then take payment and the table frees itself.

export function tableById(id: string | null | undefined): DiningTable | undefined {
  return id ? state.config?.tables?.find((t) => t.id === id) : undefined;
}

/** "Bàn 3 · John", "John" or "" — how an order is named on screen and on paper. */
export function orderTitle(o: Pick<Order, 'table_id' | 'customer_label'>) {
  return [tableById(o.table_id)?.name, o.customer_label].filter(Boolean).join(' · ');
}

/** Open orders (tabs, tables, waiting transfers) per table. */
export function tableOrders(orders = state.orders) {
  const m = new Map<string, Order[]>();
  for (const o of orders) {
    if (!o.table_id || (o.status !== 'open' && o.status !== 'awaiting_payment')) continue;
    m.set(o.table_id, [...(m.get(o.table_id) ?? []), o]);
  }
  return m;
}

/** Start a new order on a free table. With keepCart the items already picked go to this table. */
export async function startTable(tableId: string, guests: number | null, keepCart = false) {
  const base = keepCart && !state.cart.tabCode ? state.cart : newCart();
  await saveCart({ ...base, order_type: 'dine_in', table_id: tableId, guests });
}

function mustNotHaveUnsent(orderId: string) {
  const c = state.cart;
  if (c.id === orderId && c.lines.some((l) => l.status === 'active' && !l.sent_at)) {
    throw new Error('Bàn này đang có món chọn dở trên máy. Gửi món hoặc xoá trước.');
  }
}

/** Move an open order to another table (chuyển bàn). */
export async function moveTable(orderId: string, tableId: string) {
  const o = state.orders.find((x) => x.id === orderId);
  if (!o) {
    // Not saved yet: just change the cart.
    if (state.cart.id === orderId) await saveCart({ ...state.cart, table_id: tableId, order_type: 'dine_in' });
    return;
  }
  const t = Date.now();
  const updated: Order = { ...o, table_id: tableId, order_type: 'dine_in', updated_at: t };
  await audit({ actor_id: state.staff!.id, approver_id: null, action: 'table_move', entity: 'order', entity_id: o.id, before_json: JSON.stringify({ table: tableById(o.table_id)?.name ?? null }), after_json: JSON.stringify({ table: tableById(tableId)?.name }), reason: null });
  await saveOrder(updated);
  if (state.cart.id === orderId) await saveCart({ ...state.cart, table_id: tableId, order_type: 'dine_in' });
}

/** Merge one open order into another (gộp bàn). The source keeps no lines and is closed as merged. */
export async function mergeOrders(targetId: string, sourceId: string) {
  const s = getState();
  const cfg = s.config!;
  const target = s.orders.find((x) => x.id === targetId && x.status === 'open');
  const source = s.orders.find((x) => x.id === sourceId && x.status === 'open');
  if (!target || !source || target.id === source.id) throw new Error('Chỉ gộp được hai bàn/tab đang mở');
  mustNotHaveUnsent(targetId);
  mustNotHaveUnsent(sourceId);
  const t = Date.now();
  const lines = [...target.lines, ...source.lines.map((l, i) => ({ ...l, sort: target.lines.length + i }))];
  const totals = computeTotals(lines.map((l) => ({ ...l })), cfg.promotions, cfg.promotionItems, t, cfg.outlet.tz_offset_min);
  const merged: Order = {
    ...target, lines, subtotal: totals.subtotal, promo_total: totals.promo_total, discount_total: totals.discount_total, comp_total: totals.comp_total, total: totals.total,
    adjustments: totals.adjustments, guests: (target.guests || 0) + (source.guests || 0) || null, prebill_at: null, updated_at: t,
  };
  const closed: Order = {
    ...source, status: 'void', merged_into: target.id, void_reason: `Gộp vào ${orderTitle(target) || '#' + target.short_code}`, voided_by: s.staff!.id, approved_by: s.staff!.id, voided_at: t,
    lines: [], adjustments: [], subtotal: 0, promo_total: 0, discount_total: 0, comp_total: 0, total: 0, updated_at: t,
  };
  await audit({ actor_id: s.staff!.id, approver_id: null, action: 'table_merge', entity: 'order', entity_id: target.id, before_json: JSON.stringify({ from: source.short_code, total: source.total }), after_json: JSON.stringify({ into: target.short_code, total: merged.total }), reason: null });
  await saveOrder(merged); // target first: on the server its lines take over the source's lines
  await saveOrder(closed);
  if (state.cart.id === sourceId || state.cart.id === targetId) await openTab(targetId);
  return merged;
}

/** Record that the pre-bill was printed. The order stays open and unpaid. */
export async function markPrebill(orderId: string) {
  const o = state.orders.find((x) => x.id === orderId && x.status === 'open');
  if (!o) return;
  await saveOrder({ ...o, prebill_at: Date.now(), updated_at: Date.now() });
}

// ---------- time clock (chấm công) ----------

export function openEntry(staffId: string) {
  return state.timeEntries.filter((e) => e.staff_id === staffId && !e.clock_out).sort((a, b) => b.clock_in - a.clock_in)[0];
}

async function saveEntry(e: TimeEntry) {
  const list = [e, ...state.timeEntries.filter((x) => x.id !== e.id)].sort((a, b) => a.clock_in - b.clock_in);
  await kv.set('timeEntries', list);
  await outbox.add('time_entry', e);
  setState({ timeEntries: list });
  await refreshPending();
  syncKick();
}

export async function clockIn(staffId: string) {
  const cfg = state.config!;
  const t = Date.now();
  const e: TimeEntry = {
    id: ulid(), staff_id: staffId, business_day: businessDay(t, cfg.outlet.tz_offset_min, cfg.outlet.business_day_cutoff), clock_in: t, clock_out: null,
    break_min: 0, device_id: cfg.device.id, source: 'pos', note: null, created_at: t, updated_at: t,
  };
  await saveEntry(e);
  return e;
}

export async function clockOut(staffId: string, breakMin = 0) {
  const e = openEntry(staffId);
  if (!e) return null;
  const t = Date.now();
  const done: TimeEntry = { ...e, clock_out: t, break_min: Math.max(0, Math.min(breakMin, Math.floor((t - e.clock_in) / 60000) - 1)), updated_at: t };
  await saveEntry(done);
  return done;
}

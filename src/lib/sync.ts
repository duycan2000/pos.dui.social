// Outbox sync. Selling never waits for the network: records queue locally and go up when online.
import type { CashMovement, DrawerSession, Order, PosConfig, StaffShift } from '../../shared/types';
import { api, ApiError } from './api';
import { kv, outbox, table } from './db';
import { getState, pickDrawer, pruneLocal, refreshPending, setState, setSyncKick } from './store';

let running = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;

export function startSync() {
  setSyncKick(() => { clearTimeout(timer); timer = setTimeout(runSync, 300); });
  window.addEventListener('online', () => { setState((s) => ({ net: { ...s.net, online: true } })); runSync(); });
  window.addEventListener('offline', () => setState((s) => ({ net: { ...s.net, online: false } })));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) runSync(); });
  setInterval(runSync, 15000);
  setInterval(pruneLocal, 3600 * 1000);
  runSync();
}

export async function runSync() {
  if (getState().boot !== 'ready') return;
  if (running) { again = true; return; }
  running = true;
  setState((s) => ({ net: { ...s.net, busy: true } }));
  try {
    await pushAll();
    await pullAll();
    setState((s) => ({ net: { ...s.net, online: true, lastSync: Date.now(), lastError: null } }));
  } catch (e) {
    const err = e as ApiError;
    setState((s) => ({ net: { ...s.net, online: err.status !== 0 ? s.net.online : false, lastError: err.message } }));
    if (err.status === 401) setState({ toast: { msg: 'Thiết bị bị khoá hoặc chưa đăng ký. Liên hệ chủ quán.', error: true } });
  } finally {
    running = false;
    setState((s) => ({ net: { ...s.net, busy: false } }));
    await refreshPending();
    if (again) { again = false; runSync(); }
  }
}

async function pushAll() {
  for (;;) {
    // Small batches: on Workers Free one request may run at most 50 D1 queries (a paid order uses ~8).
    const rows = (await outbox.all()).slice(0, 5);
    if (!rows.length) return;
    const res = await api<{ results: { id: string; ok: boolean; error?: string }[] }>('POST', '/api/sync/push', {
      records: rows.map((r) => ({ type: r.type, data: r.data })),
    });
    const done: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = res.results[i];
      if (r?.ok) done.push(rows[i].seq!);
      else await outbox.markError(rows[i].seq!, r?.error || 'Lỗi không rõ');
    }
    await outbox.remove(done);
    if (done.length < rows.length) return; // leave failing records for the sync screen
  }
}

async function pullAll() {
  const since = (await kv.get<number>('cursor')) ?? 0;
  const r = await api<{ serverTime: number; config: PosConfig; drawers: DrawerSession[]; shifts: StaffShift[]; orders: Order[]; cashMovements: CashMovement[] }>(
    'GET', `/api/sync/pull?since=${since}`,
  );
  const pending = new Set((await outbox.all()).map((x) => x.id));
  await kv.set('config', r.config);

  // Drawers: the server is the source of truth, but keep local ones not yet pushed.
  const local = getState().drawers.filter((d) => pending.has(d.id));
  const drawers = [...r.drawers.filter((d) => !pending.has(d.id)), ...local];
  await kv.set('drawers', drawers);

  const orders = r.orders.filter((o) => !pending.has(o.id));
  await table<Order>('orders').putMany(orders);
  const cash = r.cashMovements.filter((m) => !pending.has(m.id));
  await table<CashMovement>('cash').putMany(cash);

  // If my shift was ended on the server (drawer closed elsewhere), drop it.
  const me = getState().staff;
  let shift = getState().shift;
  if (me && shift) {
    const srv = r.shifts.find((x) => x.id === shift!.id);
    if (srv?.ended_at) { shift = null; await kv.set('shift:' + me.id, srv); }
  }

  const byId = new Map(getState().orders.map((o) => [o.id, o]));
  for (const o of orders) byId.set(o.id, o);
  const cm = new Map(getState().cashMoves.map((m) => [m.id, m]));
  for (const m of cash) cm.set(m.id, m);
  // Refresh the logged-in staff record (role or PIN may have changed).
  const staff = me ? r.config.staff.find((s) => s.id === me.id) ?? null : null;
  setState({
    config: r.config, drawers, shift, staff: me ? staff : null,
    orders: [...byId.values()].sort((a, b) => b.created_at - a.created_at),
    cashMoves: [...cm.values()],
  });
  pickDrawer();
  await kv.set('cursor', r.serverTime - 5000);
}

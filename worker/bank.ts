// Bank transfer webhooks (SePay, Casso) → automatic confirmation of VietQR payments.
//
// Setup: in Cloudflare, Worker › Settings › Variables and Secrets, add a secret BANK_WEBHOOK_KEY.
// In SePay: webhook URL https://<your-worker>/api/webhooks/bank, authentication "API Key" = the same key
//   (SePay sends "Authorization: Apikey <key>").
// In Casso: webhook URL the same, Security Key = the same key (sent as a header) — or add ?key=<key> to the URL.
import { parseOrderCode } from '../shared/pricing';
import { addDays, businessDay, ulid } from '../shared/util';
import { confirmByTransfer } from './sync';
import { all, auditStmt, batch, body, type Ctx, type Env, first, HttpError, json, need, now, requirePerm, stmt } from './http';

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** The key may come as "Authorization: Apikey <key>" (SePay), a "secure-token" header (Casso) or ?key=. */
function presentedKeys(c: Ctx): string[] {
  const auth = c.req.headers.get('authorization') || '';
  const m = auth.match(/^(?:apikey|bearer)\s+(.+)$/i);
  return [m?.[1], c.req.headers.get('secure-token'), c.req.headers.get('x-api-key'), c.url.searchParams.get('key')]
    .filter((x): x is string => !!x).map((x) => x.trim());
}

interface Txn { id: string; provider: string; amount: number; content: string; account: string | null; bank: string | null; reference: string | null; txn_at: string | null }

function normalize(payload: any): Txn[] {
  // SePay: one transaction per call
  if (payload && typeof payload.transferAmount === 'number') {
    if (payload.transferType && payload.transferType !== 'in') return [];
    return [{
      id: 'sepay:' + payload.id, provider: 'sepay', amount: Math.round(payload.transferAmount),
      content: String(payload.content || payload.description || ''), account: payload.accountNumber ?? null, bank: payload.gateway ?? null,
      reference: payload.referenceCode || null, txn_at: payload.transactionDate ?? null,
    }];
  }
  // Casso: { error, data: [ ... ] }
  if (payload && Array.isArray(payload.data)) {
    return payload.data
      .filter((d: any) => Number(d.amount) > 0)
      .map((d: any) => ({
        id: 'casso:' + d.id, provider: 'casso', amount: Math.round(Number(d.amount)), content: String(d.description || ''),
        account: d.bank_sub_acc_id ?? d.subAccId ?? null, bank: d.bankName ?? null, reference: d.tid ?? null, txn_at: d.when ?? null,
      }));
  }
  return [];
}

export async function webhook(c: Ctx) {
  const key = (c.env as Env & { BANK_WEBHOOK_KEY?: string }).BANK_WEBHOOK_KEY;
  need(key, 503, 'Chưa cài BANK_WEBHOOK_KEY');
  if (!presentedKeys(c).some((k) => safeEqual(k, key))) throw new HttpError(401, 'Sai khoá webhook');
  const txns = normalize(await body(c));
  const outlet = await first<{ tz_offset_min: number; business_day_cutoff: string }>(c.env, 'SELECT tz_offset_min,business_day_cutoff FROM outlet LIMIT 1');
  const fromDay = outlet ? addDays(businessDay(now(), outlet.tz_offset_min, outlet.business_day_cutoff), -1) : '0000-00-00';
  for (const t of txns) {
    const code = parseOrderCode(t.content);
    const ins = await c.env.DB.prepare(
      'INSERT OR IGNORE INTO bank_txn (id,provider,amount,content,account,bank,reference,txn_at,code,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    ).bind(t.id, t.provider, t.amount, t.content, t.account, t.bank, t.reference, t.txn_at, code, 'unmatched', now(), now()).run() as { meta?: { changes?: number } };
    if (ins?.meta?.changes === 0) continue; // retry or replay: already processed
    if (!code) continue;
    const order = await first<{ id: string }>(c.env,
      "SELECT id FROM sale_order WHERE short_code=? AND status='awaiting_payment' AND total<=? AND business_day>=? ORDER BY created_at DESC LIMIT 1",
      code, t.amount, fromDay);
    if (order) await confirmByTransfer(c.env, order.id, t);
  }
  // Both SePay and Casso (strict mode) treat this body as success.
  return json({ success: true });
}

/** S12 polls this while showing the QR: has a transfer for this code and amount arrived? */
export async function check(c: Ctx) {
  const code = c.url.searchParams.get('code') || '';
  const amount = parseInt(c.url.searchParams.get('amount') || '0', 10);
  need(/^[A-Z]-\d{3,4}$/.test(code) && amount > 0, 400, 'Thiếu mã đơn hoặc số tiền');
  const txn = await first<{ id: string; amount: number; reference: string | null }>(c.env,
    "SELECT id,amount,reference FROM bank_txn WHERE code=? AND status='unmatched' AND amount>=? AND created_at > ? ORDER BY created_at DESC LIMIT 1",
    code, amount, now() - 3 * 3600000);
  if (!txn) return json({ found: false });
  await c.env.DB.prepare("UPDATE bank_txn SET status='claimed', updated_at=? WHERE id=? AND status='unmatched'").bind(now(), txn.id).run();
  return json({ found: true, txn });
}

export async function listTxns(c: Ctx) {
  requirePerm(c, 'ledger');
  return json(await all(c.env,
    'SELECT b.*, o.short_code order_code, o.total order_total FROM bank_txn b LEFT JOIN sale_order o ON o.id=b.order_id ORDER BY b.created_at DESC LIMIT 200'));
}

export async function ignoreTxn(c: Ctx) {
  requirePerm(c, 'ledger');
  const b = await body<{ note?: string }>(c);
  await batch(c.env, [
    stmt(c.env, "UPDATE bank_txn SET status='ignored', note=?, updated_at=? WHERE id=? AND status IN ('unmatched','claimed')", b.note || null, now(), c.params.id),
    auditStmt(c.env, { action: 'bank_ignore', entity: 'bank_txn', entity_id: c.params.id, actor_id: c.staff!.id, device_id: c.device!.id, reason: b.note || null }, ulid()),
  ]);
  return json({ ok: true });
}

/** Match a transfer by hand to an order that is waiting for payment (wrong note, typo…). */
export async function matchTxn(c: Ctx) {
  requirePerm(c, 'ledger');
  const b = await body<{ order_code: string }>(c);
  const txn = await first<{ id: string; amount: number; reference: string | null; status: string }>(c.env, 'SELECT id,amount,reference,status FROM bank_txn WHERE id=?', c.params.id);
  need(txn && (txn.status === 'unmatched' || txn.status === 'claimed'), 409, 'Giao dịch đã được xử lý');
  const order = await first<{ id: string }>(c.env, "SELECT id FROM sale_order WHERE short_code=? AND status='awaiting_payment' ORDER BY created_at DESC LIMIT 1", (b.order_code || '').toUpperCase());
  need(order, 404, 'Không có đơn chờ chuyển khoản với mã này');
  const ok = await confirmByTransfer(c.env, order.id, txn);
  need(ok, 409, 'Số tiền chuyển nhỏ hơn tổng đơn');
  await batch(c.env, [auditStmt(c.env, { action: 'bank_match', entity: 'bank_txn', entity_id: txn.id, actor_id: c.staff!.id, device_id: c.device!.id, after: { order: b.order_code } }, ulid())]);
  return json({ ok: true });
}

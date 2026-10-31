// Incoming bank transfers from SePay/Casso: what was matched automatically, and what needs a look.
import { useState } from 'react';
import { vnd } from '../../shared/util';
import { get, post } from '../lib/api';
import { useStore } from '../lib/store';
import { Empty, Segmented, Sheet } from '../ui';
import { Loading, Page, run, Text, useLoad } from './common';

interface Txn { id: string; provider: string; amount: number; content: string | null; bank: string | null; reference: string | null; txn_at: string | null; code: string | null; status: string; order_code: string | null; order_total: number | null; note: string | null; created_at: number }
const STATUS: Record<string, [string, string]> = { matched: ['Đã khớp', 'ok'], unmatched: ['Chưa khớp', 'danger'], claimed: ['Đang xử lý', 'info'], ignored: ['Bỏ qua', 'muted'] };

export default function BankTxns() {
  const cfg = useStore((s) => s.config);
  const list = useLoad(() => get<Txn[]>('/api/admin/bank-txns'));
  const [f, setF] = useState<'all' | 'unmatched' | 'matched'>('all');
  const [sel, setSel] = useState<Txn | null>(null);
  const rows = (list.data ?? []).filter((t) => f === 'all' || (f === 'unmatched' ? t.status === 'unmatched' || t.status === 'claimed' : t.status === 'matched'));
  return (
    <Page title="Giao dịch ngân hàng" sub="Tiền vào từ SePay / Casso">
      {!cfg?.features?.bankWebhook && <div className="banner">Chưa bật tự xác nhận chuyển khoản. Xem hướng dẫn ở Cài đặt › Webhook ngân hàng.</div>}
      <Segmented value={f} onChange={setF} options={[['all', 'Tất cả'], ['unmatched', 'Cần xem'], ['matched', 'Đã khớp']]} />
      <Loading error={list.error} loading={list.loading && !list.data} />
      {list.data && !rows.length && <Empty icon="bank">Chưa có giao dịch</Empty>}
      {rows.length > 0 && (
        <div className="list">
          {rows.map((t) => (
            <button key={t.id} className="li" onClick={() => setSel(t)}>
              <span className="grow col" style={{ gap: 2 }}>
                <span className="semibold ellipsis">{t.content || '—'}</span>
                <span className="small muted">{t.txn_at ?? new Date(t.created_at).toLocaleString('vi-VN')} · {t.bank ?? t.provider}{t.order_code ? ` · đơn #${t.order_code}` : t.code ? ` · mã ${t.code}` : ''}</span>
              </span>
              <span className={'badge ' + STATUS[t.status][1]}>{STATUS[t.status][0]}</span>
              <span className="mono semibold ok">+{vnd(t.amount, false)}</span>
            </button>
          ))}
        </div>
      )}
      <p className="tiny faint">Giao dịch có nội dung “DUI A012” và đủ số tiền sẽ tự khớp với đơn. Giao dịch chưa khớp: bấm vào để gán tay vào đơn đang chờ hoặc bỏ qua.</p>
      {sel && <TxnSheet t={sel} onClose={() => setSel(null)} onDone={() => { setSel(null); list.reload(); }} />}
    </Page>
  );
}

function TxnSheet({ t, onClose, onDone }: { t: Txn; onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState(t.code ?? '');
  const open = t.status === 'unmatched' || t.status === 'claimed';
  return (
    <Sheet onClose={onClose}>
      <h2>+{vnd(t.amount)}</h2>
      <p className="small muted" style={{ marginTop: 4 }}>{t.content}</p>
      <div className="card col" style={{ gap: 0 }}>
        <div className="kv small"><span className="muted">Ngân hàng</span><span>{t.bank ?? '—'}</span></div>
        <div className="kv small"><span className="muted">Mã tham chiếu</span><span className="mono">{t.reference ?? '—'}</span></div>
        <div className="kv small"><span className="muted">Thời gian</span><span>{t.txn_at ?? '—'}</span></div>
        <div className="kv small"><span className="muted">Trạng thái</span><span>{STATUS[t.status][0]}{t.order_code ? ` · đơn #${t.order_code} (${vnd(t.order_total ?? 0)})` : ''}</span></div>
        {t.note && <div className="kv small"><span className="muted">Ghi chú</span><span>{t.note}</span></div>}
      </div>
      {open && (
        <div className="col gap12 mt16">
          <Text label="Gán vào đơn đang chờ CK (mã đơn, VD A-012)" value={code} onChange={(v) => setCode(v.toUpperCase())} />
          <div className="row">
            <button className="btn danger" onClick={async () => { if (await run(() => post(`/api/admin/bank-txns/${encodeURIComponent(t.id)}/ignore`, { note: 'Không phải tiền bán hàng' }), 'Đã bỏ qua')) onDone(); }}>Bỏ qua</button>
            <button className="btn primary grow" disabled={!/^[A-Z]-\d{3,4}$/.test(code)} onClick={async () => { if (await run(() => post(`/api/admin/bank-txns/${encodeURIComponent(t.id)}/match`, { order_code: code }), 'Đã khớp vào đơn')) onDone(); }}>Khớp vào đơn</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

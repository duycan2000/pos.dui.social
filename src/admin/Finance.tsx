// Finance dashboard (cash flow and P&L shown separately) and the cash book.
import { useState } from 'react';
import { addDays, fmtDay, vnd } from '../../shared/util';
import { get, mediaUrl, post } from '../lib/api';
import { requestApproval, today, useStore } from '../lib/store';
import { Empty, MoneyInput, Sheet } from '../ui';
import { REASON_LABEL } from '../pos/CashMove';
import { Loading, Page, PhotoPicker, pct, run, Select, Text, useLoad } from './common';

export function useRange() {
  const t = today();
  const [from, setFrom] = useState(t);
  const [to, setTo] = useState(t);
  const month = t.slice(0, 7);
  const prevMonthEnd = addDays(month + '-01', -1);
  const presets: [string, string, string][] = [
    ['Hôm nay', t, t], ['Hôm qua', addDays(t, -1), addDays(t, -1)], ['7 ngày', addDays(t, -6), t],
    ['Tháng này', month + '-01', t], ['Tháng trước', prevMonthEnd.slice(0, 7) + '-01', prevMonthEnd],
  ];
  const picker = (
    <div className="col" style={{ gap: 8 }}>
      <div className="chips" style={{ padding: 0 }}>
        {presets.map(([l, f, e]) => <button key={l} className={'chip' + (from === f && to === e ? ' on' : '')} onClick={() => { setFrom(f); setTo(e); }}>{l}</button>)}
      </div>
      <div className="row">
        <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Từ ngày" />
        <span className="muted">→</span>
        <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Đến ngày" />
      </div>
    </div>
  );
  return { from, to, picker };
}

interface Summary {
  orders: number; gross: number; promo: number; discount: number; revenue: number; aov: number; by_method: Record<string, number>;
  cash_flow: { in: number; out: number; net: number; sales_in: number; other_in: number };
  pnl: { revenue: number; cogs: number; gross_profit: number; opex: number; net_profit: number; cogs_pct: number };
  expense_by_category: Record<string, number>;
}

export const CATEGORY: Record<string, string> = {
  purchase: 'Nhập hàng', salary: 'Lương', rent: 'Mặt bằng', utilities: 'Điện nước, internet', marketing: 'Marketing', bank_fee: 'Phí ngân hàng',
  repair: 'Sửa chữa', supplies: 'Vật tư', other_out: 'Chi khác', other_in: 'Thu khác', owner_capital: 'Chủ góp vốn',
  drawer_ice: 'Đá (két)', drawer_fruit: 'Trái cây (két)', drawer_supplies: 'Vật tư (két)', drawer_change: 'Đổi tiền (két)', drawer_other: 'Khác (két)',
};

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (!prev) return <div className="d faint">kỳ trước: —</div>;
  const d = ((cur - prev) / Math.abs(prev)) * 100;
  return <div className={'d ' + (d >= 0 ? 'ok' : 'danger')}>{d >= 0 ? '▲' : '▼'} {pct(Math.abs(d))} so với kỳ trước</div>;
}

export function Dashboard() {
  const { from, to, picker } = useRange();
  const d = useLoad(() => get<{ current: Summary; previous: Summary; by_hour: { h: number; s: number; n: number }[]; top_items: { name: string; qty: number; revenue: number; cost: number }[]; by_day: { day: string; s: number }[]; prev_from: string; prev_to: string }>(`/api/fin/dashboard?from=${from}&to=${to}`), [from, to]);
  const c = d.data?.current;
  const p = d.data?.previous;
  const maxHour = Math.max(1, ...(d.data?.by_hour ?? []).map((x) => x.s));
  const maxDay = Math.max(1, ...(d.data?.by_day ?? []).map((x) => x.s));
  const maxTop = Math.max(1, ...(d.data?.top_items ?? []).map((x) => x.qty));
  return (
    <Page title="Tổng quan" sub={d.data ? `So với ${fmtDay(d.data.prev_from)} – ${fmtDay(d.data.prev_to)}` : undefined}>
      {picker}
      <Loading error={d.error} loading={d.loading && !d.data} />
      {c && p && (
        <>
          <div className="stats">
            <div className="stat"><div className="small muted">Doanh thu thuần</div><div className="v">{vnd(c.revenue)}</div><Delta cur={c.revenue} prev={p.revenue} /></div>
            <div className="stat"><div className="small muted">Số đơn</div><div className="v">{c.orders}</div><Delta cur={c.orders} prev={p.orders} /></div>
            <div className="stat"><div className="small muted">TB mỗi đơn</div><div className="v">{vnd(c.aov)}</div><Delta cur={c.aov} prev={p.aov} /></div>
            <div className="stat"><div className="small muted">Chi phí khuyến mãi</div><div className="v">{vnd(c.promo + c.discount)}</div><Delta cur={c.promo + c.discount} prev={p.promo + p.discount} /></div>
          </div>
          <div className="form-grid">
            <div className="card col" style={{ gap: 0 }}>
              <b style={{ marginBottom: 6 }}>Dòng tiền</b>
              <span className="tiny faint" style={{ marginBottom: 6 }}>Tiền thật vào/ra trong kỳ. Ngày nhập nhiều hàng sẽ âm — bình thường.</span>
              <div className="kv"><span className="muted">Tiền bán hàng</span><span className="mono">{vnd(c.cash_flow.sales_in)}</span></div>
              <div className="kv"><span className="muted">Thu khác</span><span className="mono">{vnd(c.cash_flow.other_in)}</span></div>
              <div className="kv"><span className="muted">Tiền ra (gồm nhập hàng)</span><span className="mono danger">{vnd(-c.cash_flow.out)}</span></div>
              <div className={'kv total ' + (c.cash_flow.net >= 0 ? 'ok' : 'danger')}><span>Dòng tiền ròng</span><span className="mono">{vnd(c.cash_flow.net)}</span></div>
            </div>
            <div className="card col" style={{ gap: 0 }}>
              <b style={{ marginBottom: 6 }}>Lãi lỗ (P&L)</b>
              <span className="tiny faint" style={{ marginBottom: 6 }}>Giá vốn tính theo ly đã bán; hàng còn trong kho chưa phải chi phí.</span>
              <div className="kv"><span className="muted">Doanh thu</span><span className="mono">{vnd(c.pnl.revenue)}</span></div>
              <div className="kv"><span className="muted">Giá vốn hàng bán ({pct(c.pnl.cogs_pct)})</span><span className="mono">{vnd(-c.pnl.cogs)}</span></div>
              <div className="kv"><span className="muted">Lãi gộp</span><span className="mono">{vnd(c.pnl.gross_profit)}</span></div>
              <div className="kv"><span className="muted">Chi phí vận hành</span><span className="mono">{vnd(-c.pnl.opex)}</span></div>
              <div className={'kv total ' + (c.pnl.net_profit >= 0 ? 'ok' : 'danger')}><span>Lãi ròng</span><span className="mono">{vnd(c.pnl.net_profit)}</span></div>
            </div>
          </div>
          <div className="card col" style={{ gap: 0 }}>
            <b style={{ marginBottom: 6 }}>Theo phương thức</b>
            {Object.entries({ cash: 'Tiền mặt', vietqr: 'VietQR', card: 'Thẻ' }).map(([k, l]) => (
              <div key={k} className="kv"><span className="muted">{l}</span><span className="mono">{vnd(c.by_method[k] || 0)} · {pct(c.revenue ? ((c.by_method[k] || 0) / c.revenue) * 100 : 0, 0)}</span></div>
            ))}
          </div>
          {d.data!.by_day.length > 1 && (
            <div className="card"><b>Theo ngày</b>
              <div className="bars mt8">{d.data!.by_day.map((x) => <div key={x.day} className="bar"><span>{fmtDay(x.day).slice(0, 5)}</span><div className="track"><div className="fill" style={{ width: (x.s / maxDay) * 100 + '%' }} /></div><span className="mono right">{vnd(x.s, false)}</span></div>)}</div>
            </div>
          )}
          <div className="card"><b>Theo giờ (giờ thanh toán)</b>
            {!d.data!.by_hour.length ? <Empty>Chưa có đơn</Empty> : (
              <div className="bars mt8">{d.data!.by_hour.map((x) => <div key={x.h} className="bar"><span>{String(x.h).padStart(2, '0')}:00 · {x.n} đơn</span><div className="track"><div className="fill" style={{ width: (x.s / maxHour) * 100 + '%' }} /></div><span className="mono right">{vnd(x.s, false)}</span></div>)}</div>
            )}
          </div>
          <div className="card"><b>Món bán chạy</b>
            {!d.data!.top_items.length ? <Empty>Chưa có đơn</Empty> : (
              <div className="bars mt8">{d.data!.top_items.map((x) => <div key={x.name} className="bar"><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.name}</span><div className="track"><div className="fill" style={{ width: (x.qty / maxTop) * 100 + '%' }} /></div><span className="mono right">{x.qty} ly</span></div>)}</div>
            )}
          </div>
          {Object.keys(c.expense_by_category).length > 0 && (
            <div className="card col" style={{ gap: 0 }}><b style={{ marginBottom: 6 }}>Tiền ra theo danh mục</b>
              {Object.entries(c.expense_by_category).sort((a, b) => b[1] - a[1]).map(([k, v]) => <div key={k} className="kv"><span className="muted">{CATEGORY[k] ?? k}</span><span className="mono">{vnd(v)}</span></div>)}
            </div>
          )}
        </>
      )}
    </Page>
  );
}

const SOURCE: Record<string, string> = { bank: 'Tài khoản ngân hàng', owner: 'Tiền túi chủ', supplier_debt: 'Nợ nhà cung cấp', drawer: 'Két' };

export function Ledger() {
  const { from, to, picker } = useRange();
  const owner = useStore((s) => s.staff?.role === 'owner');
  const data = useLoad(() => get<{ ledger: any[]; drawer: any[] }>(`/api/fin/ledger?from=${from}&to=${to}`), [from, to]);
  const [adding, setAdding] = useState(false);
  const all = [
    ...(data.data?.ledger ?? []).map((l) => ({ ...l, kind: 'ledger' })),
    ...(data.data?.drawer ?? []).map((m) => ({ ...m, kind: 'drawer', category: 'drawer_' + m.reason, source: 'drawer' })),
  ].sort((a, b) => b.created_at - a.created_at);
  const sumIn = all.filter((x) => x.direction === 'in' && !x.voided).reduce((s, x) => s + x.amount, 0);
  const sumOut = all.filter((x) => x.direction === 'out' && !x.voided).reduce((s, x) => s + x.amount, 0);
  const voidEntry = async (id: string) => {
    const r = await requestApproval({ title: 'Huỷ khoản thu chi', reasonRequired: true });
    if (r) { await run(() => post(`/api/fin/ledger/${id}/void`, { reason: r.reason }), 'Đã huỷ'); data.reload(); }
  };
  return (
    <Page title="Sổ thu chi" sub={`Thu ${vnd(sumIn)} · Chi ${vnd(sumOut)}`} right={<button className="btn sm primary" onClick={() => setAdding(true)}>+ Khoản</button>}>
      {picker}
      <p className="tiny faint" style={{ margin: 0 }}>Doanh thu bán hàng không ghi ở đây (lấy từ POS). Khoản chi từ két ghi ở màn Thu/chi của ca và hiện kèm “(két)”.</p>
      <Loading error={data.error} loading={data.loading && !data.data} />
      {data.data && !all.length && <Empty>Chưa có khoản nào</Empty>}
      <div className="list">
        {all.map((x) => (
          <div key={x.id} className="li" style={{ opacity: x.voided ? 0.4 : 1 }}>
            <span className="grow col" style={{ gap: 2 }}>
              <span>{CATEGORY[x.category] ?? REASON_LABEL[x.reason] ?? x.category}{x.note ? ` · ${x.note}` : ''}{x.voided ? ' · đã huỷ' : ''}</span>
              <span className="small muted">{fmtDay(x.business_day)} · {SOURCE[x.source] ?? x.source} · {x.staff_name ?? ''}{x.photo_key ? ' · ' : ''}{x.photo_key && <a href={mediaUrl(x.photo_key)} target="_blank" rel="noreferrer">ảnh</a>}</span>
            </span>
            <span className={'mono bold ' + (x.direction === 'out' ? 'danger' : 'ok')}>{x.direction === 'out' ? '−' : '+'}{vnd(x.amount, false)}</span>
            {owner && x.kind === 'ledger' && !x.voided && !x.ref_type && <button className="btn sm ghost" onClick={() => voidEntry(x.id)}>Huỷ</button>}
          </div>
        ))}
      </div>
      {adding && <AddEntry onClose={() => setAdding(false)} onSaved={() => { setAdding(false); data.reload(); }} />}
    </Page>
  );
}

function AddEntry({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ direction: 'out', category: 'rent', amount: 0, source: 'bank', note: '', business_day: today(), photo_key: null as string | null });
  const cats = f.direction === 'out' ? ['salary', 'rent', 'utilities', 'marketing', 'bank_fee', 'repair', 'supplies', 'purchase', 'other_out'] : ['other_in', 'owner_capital'];
  const save = async () => { if (await run(() => post('/api/fin/ledger', f), 'Đã ghi sổ')) onSaved(); };
  return (
    <Sheet onClose={onClose}>
      <h2>Khoản thu chi</h2>
      <div className="col gap12">
        <div className="opts">
          <button className={'opt' + (f.direction === 'out' ? ' on' : '')} onClick={() => setF({ ...f, direction: 'out', category: 'rent' })}>Chi</button>
          <button className={'opt' + (f.direction === 'in' ? ' on' : '')} onClick={() => setF({ ...f, direction: 'in', category: 'other_in' })}>Thu</button>
        </div>
        <Select label="Danh mục" value={f.category} onChange={(v) => setF({ ...f, category: v })} options={cats.map((c) => [c, CATEGORY[c]])} />
        <MoneyInput label="Số tiền" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
        <Select label="Nguồn tiền" value={f.source} onChange={(v) => setF({ ...f, source: v })} options={[['bank', 'Tài khoản ngân hàng'], ['owner', 'Tiền túi chủ'], ['supplier_debt', 'Nợ (chưa trả)']]} />
        <Text label="Ngày" type="date" value={f.business_day} onChange={(v) => setF({ ...f, business_day: v })} />
        <Text label="Ghi chú" value={f.note} onChange={(v) => setF({ ...f, note: v })} />
        <PhotoPicker label="Chứng từ" value={f.photo_key} onChange={(k) => setF({ ...f, photo_key: k })} />
        {f.category === 'purchase' && <p className="tiny faint" style={{ margin: 0 }}>Nhập hàng nên ghi bằng Phiếu nhập để kho và giá vốn tự cập nhật.</p>}
        <button className="btn primary lg" disabled={f.amount <= 0} onClick={save}>Lưu</button>
      </div>
    </Sheet>
  );
}

// S28 — promotions. P1: BOGO on the signature drinks (pairs across items, cheaper one free).
import { useEffect, useState } from 'react';
import type { Item, Promotion } from '../../shared/types';
import { vnd } from '../../shared/util';
import { get, post, put } from '../lib/api';
import { Loading, Page, run, Text, Toggle, useLoad } from './common';

const DAYS = [['1', 'T2'], ['2', 'T3'], ['3', 'T4'], ['4', 'T5'], ['5', 'T6'], ['6', 'T7'], ['0', 'CN']];

export default function Promotions() {
  const promos = useLoad(() => get<Promotion[]>('/api/admin/t/promotion'));
  const items = useLoad(() => get<Item[]>('/api/admin/t/item'));
  const [sel, setSel] = useState<Promotion | null>(null);
  const [itemIds, setItemIds] = useState<string[]>([]);
  useEffect(() => { if (!sel && promos.data?.length) setSel(promos.data[0]); }, [promos.data]); // eslint-disable-line
  useEffect(() => { if (sel?.id) get<{ item_id: string }[]>(`/api/admin/promotion/${sel.id}/items`).then((r) => setItemIds(r.map((x) => x.item_id))); }, [sel?.id]);

  const save = async () => {
    if (!sel) return;
    const { id, ...rest } = sel as Promotion & { created_at?: number; updated_at?: number };
    delete (rest as any).created_at; delete (rest as any).updated_at;
    const saved = await run(() => (id ? put<Promotion>(`/api/admin/t/promotion/${id}`, rest) : post<Promotion>('/api/admin/t/promotion', rest)));
    if (!saved) return;
    await run(() => put(`/api/admin/promotion/${saved.id}/items`, { itemIds }), 'Đã lưu khuyến mãi');
    setSel(saved);
    promos.reload();
  };
  const days = sel?.days_of_week ? sel.days_of_week.split(',') : [];
  const toggleDay = (d: string) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
    setSel({ ...sel!, days_of_week: next.length && next.length < 7 ? next.join(',') : null });
  };

  return (
    <Page title="Khuyến mãi" sub="P1: Mua 1 tặng 1" right={<button className="btn sm" onClick={() => setSel({ id: '', name: 'Mua 1 tặng 1', type: 'bogo', active: 1, start_date: null, end_date: null, days_of_week: null, time_from: null, time_to: null, rule_json: '{}' })}>+ Chương trình</button>}>
      <Loading error={promos.error} loading={promos.loading && !promos.data} />
      <div className="chips" style={{ padding: 0 }}>
        {(promos.data ?? []).map((p) => <button key={p.id} className={'chip' + (sel?.id === p.id ? ' on' : '')} onClick={() => setSel(p)}>{p.name}{p.active ? '' : ' (tắt)'}</button>)}
      </div>
      {sel && (
        <div className="col gap12">
          <Text label="Tên chương trình" value={sel.name} onChange={(v) => setSel({ ...sel, name: v })} />
          <Toggle label="Đang chạy" checked={!!sel.active} onChange={(v) => setSel({ ...sel, active: v ? 1 : 0 })} />
          <p className="small muted" style={{ margin: 0 }}>Luật: các món chọn bên dưới được ghép cặp chéo, ly rẻ hơn mỗi cặp miễn phí. 3 ly → miễn 1, 4 ly → miễn 2. Món chọn tuỳ chọn “không áp khuyến mãi” (bản mocktail) không được tính.</p>
          <div className="form-grid">
            <Text label="Từ ngày (để trống = luôn)" type="date" value={sel.start_date} onChange={(v) => setSel({ ...sel, start_date: v || null })} />
            <Text label="Đến ngày" type="date" value={sel.end_date} onChange={(v) => setSel({ ...sel, end_date: v || null })} />
            <Text label="Từ giờ (để trống = cả ngày)" type="time" value={sel.time_from} onChange={(v) => setSel({ ...sel, time_from: v || null })} />
            <Text label="Đến giờ" type="time" value={sel.time_to} onChange={(v) => setSel({ ...sel, time_to: v || null })} />
          </div>
          <div className="field"><span className="small muted">Ngày trong tuần (không chọn = mọi ngày)</span>
            <div className="opts">{DAYS.map(([d, l]) => <button key={d} className={'opt' + (days.includes(d) ? ' on' : '')} onClick={() => toggleDay(d)}>{l}</button>)}</div>
          </div>
          <div className="section-title">Món áp dụng ({itemIds.length})</div>
          <div className="list">
            {(items.data ?? []).filter((i) => i.active).map((i) => (
              <label key={i.id} className="li check">
                <input type="checkbox" checked={itemIds.includes(i.id)} onChange={(e) => setItemIds(e.target.checked ? [...itemIds, i.id] : itemIds.filter((x) => x !== i.id))} />
                <span className="grow">{i.name_vi}</span><span className="mono small muted">{vnd(i.price)}</span>
              </label>
            ))}
          </div>
          <button className="btn primary lg" onClick={save}>Lưu khuyến mãi</button>
        </div>
      )}
    </Page>
  );
}

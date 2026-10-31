// Costing: cost per drink, cost %, margin, real cost % under BOGO, and "what if an ingredient goes up".
import { useState } from 'react';
import { vnd } from '../../shared/util';
import { get, post } from '../lib/api';
import { navigate } from '../lib/store';
import { Loading, Num, Page, pct, run, Select, useLoad } from './common';
import type { Ingredient } from './Inventory';

interface Row { id: string; name: string; price: number; cost: number; cost_pct: number; margin: number; bogo: boolean; bogo_cost_pct: number | null; has_recipe: boolean; over: boolean }
interface Sim { threshold: number; affected_count: number; avg_cost_pct_delta: number; affected: { id: string; name: string; cost_before: number; cost_after: number; pct_before: number; pct_after: number; over: boolean }[] }

export default function Costing() {
  const data = useLoad(() => get<{ threshold: number; items: Row[]; options: { id: string; name: string; price_delta: number; cost_delta: number }[] }>('/api/inv/costing'));
  const ings = useLoad(() => get<Ingredient[]>('/api/inv/ingredients'));
  const [sort, setSort] = useState<'cost_pct' | 'margin' | 'name'>('cost_pct');
  const [simIng, setSimIng] = useState('');
  const [simPct, setSimPct] = useState(10);
  const [sim, setSim] = useState<Sim | null>(null);
  const rows = [...(data.data?.items ?? [])].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : sort === 'margin' ? a.margin - b.margin : b.cost_pct - a.cost_pct));
  const noRecipe = rows.filter((r) => !r.has_recipe).length;
  const runSim = async () => { const r = await run(() => post<Sim>('/api/inv/simulate', { ingredient_id: simIng, pct: simPct })); if (r) setSim(r); };

  return (
    <Page title="Giá vốn" sub={data.data ? `Cảnh báo khi cost > ${data.data.threshold}%` : undefined}>
      <Loading error={data.error} loading={data.loading && !data.data} />
      {noRecipe > 0 && <div className="banner">{noRecipe} món chưa có công thức nên giá vốn = 0. Bấm vào món để nhập.</div>}
      <div className="chips" style={{ padding: 0 }}>
        {([['cost_pct', 'Cost % cao trước'], ['margin', 'Lãi thấp trước'], ['name', 'Tên']] as const).map(([k, l]) => <button key={k} className={'chip' + (sort === k ? ' on' : '')} onClick={() => setSort(k)}>{l}</button>)}
      </div>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>Món</th><th className="num">Giá bán</th><th className="num">Giá vốn</th><th className="num">Cost %</th><th className="num">Lãi gộp</th><th className="num">Cost % khi BOGO</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.over ? 'over' : ''} onClick={() => navigate('admin/item/' + r.id)} style={{ cursor: 'pointer' }}>
                <td>{r.name}{!r.has_recipe ? <span className="faint"> · chưa có CT</span> : ''}</td>
                <td className="num">{vnd(r.price, false)}</td><td className="num">{vnd(r.cost, false)}</td><td className="num">{pct(r.cost_pct)}</td>
                <td className="num">{vnd(r.margin, false)}</td>
                <td className="num">{r.bogo ? <span className={r.bogo_cost_pct! > (data.data?.threshold ?? 30) ? 'danger' : 'warn'}>{pct(r.bogo_cost_pct)}</span> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="tiny faint" style={{ margin: 0 }}>Cost % khi BOGO = giá vốn 2 ly ÷ giá 1 ly, tức lãi thật khi khách dùng mua 1 tặng 1.</p>

      {(data.data?.options ?? []).some((o) => o.cost_delta) && (
        <>
          <div className="section-title">Tuỳ chọn có trừ kho</div>
          <div className="list">{data.data!.options.filter((o) => o.cost_delta).map((o) => <div key={o.id} className="li"><span className="grow">{o.name}</span><span className="small muted">giá {vnd(o.price_delta)} · vốn {vnd(o.cost_delta)}</span></div>)}</div>
        </>
      )}

      <div className="section-title">Mô phỏng tăng giá nguyên liệu</div>
      <div className="card col gap12">
        <div className="form-grid">
          <Select label="Nguyên liệu" value={simIng} onChange={setSimIng} options={[['', '— chọn —'], ...(ings.data ?? []).filter((i) => i.active).map((i) => [i.id, i.name] as [string, string])]} />
          <Num label="Tăng (%)" value={simPct} onChange={setSimPct} />
        </div>
        <button className="btn primary" disabled={!simIng} onClick={runSim}>Tính</button>
        {sim && (
          <>
            <div className="banner">{sim.affected_count} món bị ảnh hưởng · cost trung bình {sim.avg_cost_pct_delta >= 0 ? '+' : ''}{pct(sim.avg_cost_pct_delta, 2)}</div>
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>Món</th><th className="num">Vốn trước</th><th className="num">Vốn sau</th><th className="num">Cost % sau</th></tr></thead>
                <tbody>{sim.affected.map((a) => <tr key={a.id} className={a.over ? 'over' : ''}><td>{a.name}</td><td className="num">{vnd(a.cost_before, false)}</td><td className="num">{vnd(a.cost_after, false)}</td><td className="num">{pct(a.pct_after)}</td></tr>)}</tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Page>
  );
}

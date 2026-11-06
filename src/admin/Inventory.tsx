// Inventory: stock list with low-stock alerts, ingredient edit (+ sub-recipe, batch), purchases, shopping list, stocktake.
import { useEffect, useState } from 'react';
import { fmtDay, vnd } from '../../shared/util';
import { get, mediaUrl, post, put } from '../lib/api';
import { navigate, toast } from '../lib/store';
import { Empty, Icon, MoneyInput, Sheet } from '../ui';
import { Loading, Num, Page, PhotoPicker, qty, run, Select, Text, Toggle, useLoad } from './common';
import RecipeEditor, { useIngredients } from './Recipe';

export interface Ingredient {
  id: string; name: string; kind: 'raw' | 'prepared'; base_unit: string; purchase_unit: string; base_per_purchase: number; yield_pct: number;
  avg_cost_per_base: number; stock_base: number; min_stock_base: number; recipe_yield_base: number; default_supplier_id: string | null; active: number;
  cost_per_base: number; stock_value: number; low: boolean;
}
interface Supplier { id: string; name: string; phone: string | null; active: number }

const perUnit = (i: Pick<Ingredient, 'base_per_purchase' | 'yield_pct'>) => i.base_per_purchase * (i.yield_pct / 100) || 1;
export const stockText = (i: Ingredient) => `${qty(i.stock_base, 0)} ${i.base_unit} ≈ ${qty(i.stock_base / perUnit(i))} ${i.purchase_unit}`;

export function Inventory() {
  const list = useLoad(() => get<Ingredient[]>('/api/inv/ingredients'));
  const [q, setQ] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [suggest, setSuggest] = useState(false);
  const rows = (list.data ?? []).filter((i) => (i.active || !onlyLow) && (!onlyLow || i.low) && i.name.toLowerCase().includes(q.toLowerCase()));
  const lowCount = (list.data ?? []).filter((i) => i.low).length;
  const value = (list.data ?? []).reduce((s, i) => s + (i.active ? i.stock_value : 0), 0);
  return (
    <Page title="Kho" sub={`Giá trị tồn ${vnd(value)}`} right={<button className="btn sm primary" onClick={() => navigate('admin/ingredient/new')}><Icon name="plus" size={16} />Nguyên liệu</button>}>
      <div className="row wrap">
        <button className="btn sm" onClick={() => navigate('admin/purchase')}>Nhập hàng</button>
        <button className="btn sm" onClick={() => navigate('admin/purchases')}>Lịch sử nhập</button>
        <button className="btn sm" onClick={() => navigate('admin/stocktake')}>Kiểm kê</button>
        <button className="btn sm" onClick={() => navigate('admin/stocktakes')}>Lịch sử kiểm kê</button>
        <button className={'btn sm' + (lowCount ? ' danger' : '')} onClick={() => navigate('admin/shopping')}>Cần mua ({lowCount})</button>
        <button className="btn sm" onClick={() => setSuggest(true)}>Gợi ý mức tối thiểu</button>
      </div>
      {list.data && list.data.some((i) => i.active) && !list.data.some((i) => i.min_stock_base > 0) && (
        <button className="banner" style={{ border: 0, textAlign: 'left', width: '100%' }} onClick={() => setSuggest(true)}>
          <Icon name="warn" size={18} /><span>Chưa đặt mức tối thiểu cho nguyên liệu nào nên app chưa cảnh báo sắp hết được. Chạm để app gợi ý theo lượng bán thực tế.</span>
        </button>
      )}
      {suggest && <SuggestMin onClose={(saved) => { setSuggest(false); if (saved) list.reload(); }} />}
      <div className="row">
        <label className="search grow"><Icon name="search" size={18} /><input placeholder="Tìm nguyên liệu" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <Toggle label="Sắp hết" checked={onlyLow} onChange={setOnlyLow} />
      </div>
      <Loading error={list.error} loading={list.loading && !list.data} />
      {list.data && !list.data.length && <Empty>Chưa có nguyên liệu. Thêm rượu, syrup, trái cây, ly, ống hút…</Empty>}
      <div className="list">
        {rows.map((i) => (
          <button key={i.id} className="li" style={{ opacity: i.active ? 1 : 0.45 }} onClick={() => navigate('admin/ingredient/' + i.id)}>
            <span className="grow col" style={{ gap: 2 }}>
              <span className="bold">{i.name}{i.kind === 'prepared' ? <span className="badge muted" style={{ marginLeft: 6 }}>pha sẵn</span> : null}</span>
              <span className={'small ' + (i.low ? 'danger' : 'muted')}>{stockText(i)}{i.min_stock_base ? ` · tối thiểu ${qty(i.min_stock_base / perUnit(i))} ${i.purchase_unit}` : ''}</span>
            </span>
            <span className="col right" style={{ gap: 2 }}>
              <span className="mono small">{vnd(i.cost_per_base * perUnit(i), false)}/{i.purchase_unit}</span>
              {i.low && <span className="badge danger">Sắp hết</span>}
            </span>
          </button>
        ))}
      </div>
    </Page>
  );
}

interface Suggestion { id: string; name: string; base_unit: string; purchase_unit: string; per_unit: number; daily_base: number; stock_base: number; min_stock_base: number; suggest_base: number; suggest_units: number }

/** Minimum levels from real use: average daily use × days until the next delivery, rounded up to whole units. */
function SuggestMin({ onClose }: { onClose: (saved: boolean) => void }) {
  const [days, setDays] = useState(14);
  const [cover, setCover] = useState(3);
  const [rows, setRows] = useState<Suggestion[] | null>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [err, setErr] = useState('');
  useEffect(() => {
    setRows(null);
    post<{ rows: Suggestion[] }>('/api/inv/suggest-min', { days, cover })
      .then((r) => { setRows(r.rows); setPick(new Set(r.rows.filter((x) => Math.abs(x.suggest_base - x.min_stock_base) > 1e-6).map((x) => x.id))); })
      .catch((e) => setErr((e as Error).message));
  }, [days, cover]);
  const save = async () => {
    const apply = (rows ?? []).filter((r) => pick.has(r.id)).map((r) => ({ id: r.id, min_stock_base: r.suggest_base }));
    if (await run(() => post('/api/inv/suggest-min', { apply }), `Đã đặt mức tối thiểu cho ${apply.length} nguyên liệu`)) onClose(true);
  };
  const u = (base: number, r: Suggestion) => Math.round((base / r.per_unit) * 10) / 10;
  return (
    <Sheet onClose={() => onClose(false)}>
      <h2>Gợi ý mức tối thiểu</h2>
      <p className="small muted" style={{ margin: '4px 0 12px' }}>Dựa trên lượng bán thực tế. Khi tồn kho xuống dưới mức này, app báo "sắp hết" trên máy bán hàng và đưa vào danh sách cần mua.</p>
      <div className="row wrap" style={{ gap: 12 }}>
        <Select label="Tính theo" value={String(days)} onChange={(v) => setDays(+v)} options={[['7', '7 ngày qua'], ['14', '14 ngày qua'], ['30', '30 ngày qua']]} />
        <Select label="Đủ dùng trong" value={String(cover)} onChange={(v) => setCover(+v)} options={[['2', '2 ngày'], ['3', '3 ngày'], ['5', '5 ngày'], ['7', '7 ngày']]} />
      </div>
      {err && <div className="banner danger mt8">{err}</div>}
      {!rows && !err && <div className="small muted mt16">Đang tính…</div>}
      {rows && !rows.length && <div className="small muted mt16">Chưa có dữ liệu bán hàng trừ kho trong khoảng này. Cần gắn công thức cho món để app biết mỗi ly dùng bao nhiêu.</div>}
      <div className="col mt8" style={{ gap: 0 }}>
        {(rows ?? []).map((r) => (
          <label key={r.id} className="permrow">
            <span className="grow col" style={{ gap: 1 }}>
              <b className="small">{r.name}</b>
              <span className="tiny muted">Dùng ~{u(r.daily_base, r)} {r.purchase_unit}/ngày · tồn {u(r.stock_base, r)} · hiện tối thiểu {r.min_stock_base ? u(r.min_stock_base, r) : '—'}</span>
            </span>
            <b className="small mono">{r.suggest_units} {r.purchase_unit}</b>
            <input type="checkbox" checked={pick.has(r.id)} onChange={(e) => { const n = new Set(pick); if (e.target.checked) n.add(r.id); else n.delete(r.id); setPick(n); }} />
          </label>
        ))}
      </div>
      <button className="btn primary lg block mt16" disabled={!pick.size} onClick={save}>Đặt mức tối thiểu ({pick.size})</button>
    </Sheet>
  );
}

export function IngredientEdit({ id }: { id: string }) {
  const isNew = !id || id === 'new';
  const sup = useLoad(() => get<Supplier[]>('/api/admin/t/supplier'));
  const ings = useIngredients();
  const [f, setF] = useState<Partial<Ingredient>>({ name: '', kind: 'raw', base_unit: 'ml', purchase_unit: 'chai', base_per_purchase: 700, yield_pct: 100, min_stock_base: 0, recipe_yield_base: 1000, active: 1, avg_cost_per_base: 0 });
  const [startCost, setStartCost] = useState(0);
  const [batchQty, setBatchQty] = useState(0);
  const [loaded, setLoaded] = useState(isNew);
  const load = () => get<Ingredient[]>('/api/inv/ingredients').then((all) => { const x = all.find((i) => i.id === id); if (x) setF(x); setLoaded(true); });
  useEffect(() => { if (!isNew) load(); }, [id]); // eslint-disable-line
  const pu = perUnit({ base_per_purchase: f.base_per_purchase || 1, yield_pct: f.yield_pct || 100 });

  const save = async () => {
    if (!f.name?.trim()) return;
    const body: Record<string, unknown> = { name: f.name, kind: f.kind, base_unit: f.base_unit, purchase_unit: f.purchase_unit, base_per_purchase: f.base_per_purchase, yield_pct: f.yield_pct, min_stock_base: f.min_stock_base, recipe_yield_base: f.recipe_yield_base, default_supplier_id: f.default_supplier_id || null, active: f.active };
    if (isNew && startCost) body.avg_cost_per_base = startCost / pu;
    const saved = await run(() => (isNew ? post<Ingredient>('/api/admin/t/ingredient', body) : put<Ingredient>(`/api/admin/t/ingredient/${id}`, body)), 'Đã lưu nguyên liệu');
    if (saved && isNew) navigate('admin/ingredient/' + saved.id);
    else if (saved) load();
  };
  const produce = async () => {
    const r = await run(() => post<{ cost: number }>('/api/inv/batch', { ingredient_id: id, qty_base: batchQty }));
    if (r) { setBatchQty(0); load(); toast(`Đã pha ${qty(batchQty, 0)} ${f.base_unit} · giá vốn ${vnd(r.cost)}`); }
  };

  return (
    <Page title={isNew ? 'Nguyên liệu mới' : f.name || ''} back="admin/inventory" footer={<button className="btn primary lg block" onClick={save}>Lưu</button>}>
      {!loaded && <p className="muted">Đang tải…</p>}
      {!isNew && f.stock_base != null && <div className="banner">Tồn: {stockText(f as Ingredient)} · giá vốn {vnd((f.cost_per_base ?? 0) * pu)}/{f.purchase_unit}</div>}
      <div className="form-grid">
        <Text label="Tên" value={f.name} onChange={(v) => setF({ ...f, name: v })} placeholder="VD: Vodka Absolut 700ml" />
        <Select label="Loại" value={f.kind} onChange={(v) => setF({ ...f, kind: v as 'raw' | 'prepared' })} options={[['raw', 'Nguyên liệu mua về'], ['prepared', 'Bán thành phẩm pha sẵn (syrup, rượu ngâm)']]} />
        <Select label="Đơn vị dùng (đơn vị chuẩn)" value={f.base_unit} onChange={(v) => setF({ ...f, base_unit: v })} options={[['ml', 'ml'], ['g', 'g'], ['cái', 'cái']]} />
        <Text label="Đơn vị mua" value={f.purchase_unit} onChange={(v) => setF({ ...f, purchase_unit: v })} placeholder="chai, kg, thùng, bịch" />
        <Num label={`1 ${f.purchase_unit || 'đơn vị mua'} = ? ${f.base_unit}`} value={f.base_per_purchase} onChange={(v) => setF({ ...f, base_per_purchase: v })} />
        <Num label="Tỷ lệ dùng được (yield %)" value={f.yield_pct} onChange={(v) => setF({ ...f, yield_pct: v })} />
        <Num label={`Mức tối thiểu (${f.purchase_unit})`} value={Math.round(((f.min_stock_base || 0) / pu) * 100) / 100} onChange={(v) => setF({ ...f, min_stock_base: v * pu })} />
        <Select label="Nhà cung cấp mặc định" value={f.default_supplier_id ?? ''} onChange={(v) => setF({ ...f, default_supplier_id: v || null })} options={[['', '—'], ...(sup.data ?? []).map((s) => [s.id, s.name] as [string, string])]} />
        {isNew && <MoneyInput label={`Giá vốn ban đầu / ${f.purchase_unit} (nếu chưa nhập hàng)`} value={startCost} onChange={setStartCost} />}
      </div>
      <p className="tiny faint" style={{ margin: 0 }}>VD: mua 1 kg chanh, yield 40% nước cốt → đơn vị dùng ml, 1 kg = 1000, yield 40 → kho cộng 400 ml.</p>
      {!isNew && <Toggle label="Đang dùng" checked={!!f.active} onChange={(v) => setF({ ...f, active: v ? 1 : 0 })} />}
      {!isNew && f.kind === 'prepared' && (
        <>
          <div className="section-title">Công thức pha (sub-recipe)</div>
          <div className="card col gap12">
            <Num label={`Công thức bên dưới làm ra bao nhiêu ${f.base_unit}`} value={f.recipe_yield_base} onChange={(v) => setF({ ...f, recipe_yield_base: v })} />
            <RecipeEditor ownerType="ingredient" ownerId={id} ings={ings} excludeId={id} note="Lượng nguyên liệu cho một mẻ. Giá vốn món dùng syrup này tính theo công thức; kho trừ syrup thành phẩm." />
          </div>
          <div className="section-title">Pha mẻ</div>
          <div className="card row wrap">
            <div className="grow"><Num label={`Số lượng pha (${f.base_unit})`} value={batchQty} onChange={setBatchQty} /></div>
            <button className="btn primary" disabled={batchQty <= 0} onClick={produce} style={{ alignSelf: 'flex-end' }}>Pha mẻ · trừ nguyên liệu</button>
          </div>
        </>
      )}
    </Page>
  );
}

const SOURCES: [string, string][] = [['drawer', 'Tiền mặt trong két'], ['bank', 'Chuyển khoản'], ['owner', 'Tiền túi chủ'], ['supplier_debt', 'Nợ nhà cung cấp']];

export function PurchaseNew() {
  const ings = useLoad(() => get<Ingredient[]>('/api/inv/ingredients'));
  const sup = useLoad(() => get<Supplier[]>('/api/admin/t/supplier'));
  const [supplierId, setSupplierId] = useState('');
  const [newSupplier, setNewSupplier] = useState('');
  const [source, setSource] = useState('bank');
  const [photo, setPhoto] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<{ ingredient_id: string; qty_purchase_units: number; unit_price: number }[]>([{ ingredient_id: '', qty_purchase_units: 1, unit_price: 0 }]);
  const [busy, setBusy] = useState(false);
  const byId = new Map((ings.data ?? []).map((i) => [i.id, i]));
  const total = lines.reduce((s, l) => s + Math.round(l.qty_purchase_units * l.unit_price), 0);
  const valid = lines.some((l) => l.ingredient_id && l.qty_purchase_units > 0);
  const setLine = (i: number, p: Partial<(typeof lines)[number]>) => setLines(lines.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const save = async () => {
    setBusy(true);
    const r = await run(() => post('/api/inv/purchases', {
      supplier_id: supplierId === '__new' ? null : supplierId || null, supplier_name: supplierId === '__new' ? newSupplier : undefined,
      payment_source: source, photo_key: photo, note: note || undefined, lines: lines.filter((l) => l.ingredient_id && l.qty_purchase_units > 0),
    }), `Đã nhập hàng ${vnd(total)}`);
    setBusy(false);
    if (r) navigate('admin/purchases');
  };
  return (
    <Page title="Phiếu nhập hàng" back="admin/inventory" footer={<button className="btn primary lg block" disabled={!valid || busy} onClick={save}>Lưu phiếu · {vnd(total)}</button>}>
      <Loading error={ings.error} loading={ings.loading && !ings.data} />
      <div className="form-grid">
        <Select label="Nhà cung cấp" value={supplierId} onChange={setSupplierId} options={[['', '— không ghi —'], ...(sup.data ?? []).filter((s) => s.active).map((s) => [s.id, s.name] as [string, string]), ['__new', '+ Nhà cung cấp mới']]} />
        {supplierId === '__new' && <Text label="Tên nhà cung cấp mới" value={newSupplier} onChange={setNewSupplier} />}
        <Select label="Trả bằng" value={source} onChange={setSource} options={SOURCES} />
      </div>
      {source === 'drawer' && <p className="small muted" style={{ margin: 0 }}>Tiền sẽ ghi là khoản chi của két đang mở.</p>}
      <div className="section-title">Hàng nhập</div>
      {lines.map((l, i) => {
        const ing = byId.get(l.ingredient_id);
        return (
          <div key={i} className="card col gap12">
            <div className="row">
              <select className="input grow" value={l.ingredient_id} onChange={(e) => setLine(i, { ingredient_id: e.target.value })}>
                <option value="">— chọn nguyên liệu —</option>
                {(ings.data ?? []).filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              <button className="iconbtn ghost" aria-label="Bỏ dòng" onClick={() => setLines(lines.filter((_, k) => k !== i))}>✕</button>
            </div>
            <div className="row">
              <div className="grow"><Num label={`Số lượng (${ing?.purchase_unit ?? 'đơn vị'})`} value={l.qty_purchase_units} onChange={(v) => setLine(i, { qty_purchase_units: v })} /></div>
              <div className="grow"><MoneyInput label={`Đơn giá / ${ing?.purchase_unit ?? 'đơn vị'}`} value={l.unit_price} onChange={(v) => setLine(i, { unit_price: v })} /></div>
            </div>
            <div className="row between small"><span className="muted">{ing ? `= +${qty(l.qty_purchase_units * perUnit(ing), 0)} ${ing.base_unit} vào kho` : ''}</span><b className="mono">{vnd(Math.round(l.qty_purchase_units * l.unit_price))}</b></div>
          </div>
        );
      })}
      <button className="btn" onClick={() => setLines([...lines, { ingredient_id: '', qty_purchase_units: 1, unit_price: 0 }])}>+ Thêm dòng</button>
      <PhotoPicker label="Ảnh hoá đơn" value={photo} onChange={setPhoto} />
      <Text label="Ghi chú" value={note} onChange={setNote} />
    </Page>
  );
}

export function Purchases() {
  const list = useLoad(() => get<any[]>('/api/inv/purchases'));
  const src = Object.fromEntries(SOURCES);
  return (
    <Page title="Lịch sử nhập hàng" back="admin/inventory" right={<button className="btn sm primary" onClick={() => navigate('admin/purchase')}>+ Phiếu</button>}>
      <Loading error={list.error} loading={list.loading && !list.data} />
      {list.data && !list.data.length && <Empty>Chưa có phiếu nhập</Empty>}
      {(list.data ?? []).map((p) => (
        <div key={p.id} className="card col" style={{ gap: 6 }}>
          <div className="row between"><b>{fmtDay(p.business_day)} · {p.supplier_name ?? 'Không ghi NCC'}</b><b className="mono">{vnd(p.total)}</b></div>
          <div className="small muted">{src[p.payment_source]} · {p.staff_name ?? ''}{p.note ? ` · ${p.note}` : ''}</div>
          {p.lines.map((l: any) => <div key={l.id} className="row between small"><span>{l.ingredient_name} × {qty(l.qty_purchase_units)} {l.purchase_unit}</span><span className="mono">{vnd(l.line_total, false)}</span></div>)}
          {p.photo_key && <a href={mediaUrl(p.photo_key)} target="_blank" rel="noreferrer" className="small">Xem ảnh hoá đơn</a>}
        </div>
      ))}
    </Page>
  );
}

export function ShoppingList() {
  const list = useLoad(() => get<{ supplier: string; items: { id: string; name: string; stock_base: number; min_stock_base: number; base_unit: string; purchase_unit: string; suggest_units: number }[] }[]>('/api/inv/shopping-list'));
  const text = (list.data ?? []).map((g) => `${g.supplier}:\n` + g.items.map((i) => `- ${i.name}: ${i.suggest_units} ${i.purchase_unit}`).join('\n')).join('\n\n');
  return (
    <Page title="Cần mua" back="admin/inventory" right={text ? <button className="btn sm" onClick={() => navigator.clipboard?.writeText(text).then(() => toast('Đã chép danh sách'))}>Chép</button> : undefined}>
      <Loading error={list.error} loading={list.loading && !list.data} />
      {list.data && !list.data.length && <Empty>Không có gì dưới mức tối thiểu</Empty>}
      {(list.data ?? []).map((g) => (
        <div key={g.supplier} className="card col" style={{ gap: 6 }}>
          <b>{g.supplier}</b>
          {g.items.map((i) => (
            <div key={i.id} className="row between small">
              <span>{i.name} <span className="danger">({qty(i.stock_base, 0)}/{qty(i.min_stock_base, 0)} {i.base_unit})</span></span>
              <b>{i.suggest_units} {i.purchase_unit}</b>
            </div>
          ))}
        </div>
      ))}
      <p className="tiny faint">Gợi ý mua đủ để lên gấp đôi mức tối thiểu.</p>
    </Page>
  );
}

export function StocktakeNew() {
  const list = useLoad(() => get<Ingredient[]>('/api/inv/ingredients'));
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [showTheo, setShowTheo] = useState(false);
  const [note, setNote] = useState('');
  const [result, setResult] = useState<{ variance_value: number; lines: { name: string; base_unit: string; theoretical_base: number; counted_base: number; variance_base: number; variance_value: number }[] } | null>(null);
  const items = (list.data ?? []).filter((i) => i.active);
  const entered = Object.entries(counts).filter(([, v]) => v.trim() !== '');
  const save = async () => {
    const byId = new Map(items.map((i) => [i.id, i]));
    const lines = entered.map(([id, v]) => ({ ingredient_id: id, counted_base: Number(v.replace(',', '.')) * perUnit(byId.get(id)!) }));
    const r = await run(() => post<NonNullable<typeof result>>('/api/inv/stocktakes', { note, lines }), 'Đã lưu kiểm kê');
    if (r) setResult(r);
  };
  if (result) {
    return (
      <Page title="Kết quả kiểm kê" back="admin/inventory">
        <div className={'banner ' + (result.variance_value < 0 ? 'danger' : 'ok')}>Hao hụt: {vnd(result.variance_value)}</div>
        <VarianceTable lines={result.lines} />
      </Page>
    );
  }
  return (
    <Page title="Kiểm kê" back="admin/inventory" footer={<button className="btn primary lg block" disabled={!entered.length} onClick={save}>Lưu kiểm kê ({entered.length} dòng)</button>}>
      <p className="small muted" style={{ margin: 0 }}>Nhập số đếm theo đơn vị mua. Chai đang mở nhập phần lẻ, VD 1,6 chai. Dòng để trống sẽ không thay đổi.</p>
      <Toggle label="Hiện tồn lý thuyết (tắt để đếm khách quan)" checked={showTheo} onChange={setShowTheo} />
      <Loading error={list.error} loading={list.loading && !list.data} />
      <div className="list">
        {items.map((i) => (
          <div key={i.id} className="li">
            <span className="grow col" style={{ gap: 2 }}><span>{i.name}</span>{showTheo && <span className="small muted">{stockText(i)}</span>}</span>
            <input className="input mono" style={{ width: 96, textAlign: 'center' }} inputMode="decimal" placeholder="—" value={counts[i.id] ?? ''} onChange={(e) => setCounts({ ...counts, [i.id]: e.target.value })} />
            <span className="small muted" style={{ width: 44 }}>{i.purchase_unit}</span>
          </div>
        ))}
      </div>
      <Text label="Ghi chú" value={note} onChange={setNote} />
    </Page>
  );
}

function VarianceTable({ lines }: { lines: { name: string; base_unit: string; theoretical_base: number; counted_base: number; variance_base: number; variance_value: number }[] }) {
  return (
    <div className="table-wrap">
      <table className="t">
        <thead><tr><th>Nguyên liệu</th><th className="num">Lý thuyết</th><th className="num">Thực tế</th><th className="num">Chênh</th><th className="num">Giá trị</th></tr></thead>
        <tbody>
          {lines.map((l, k) => (
            <tr key={k} className={l.variance_base < 0 ? 'over' : ''}>
              <td>{l.name}</td><td className="num">{qty(l.theoretical_base, 0)} {l.base_unit}</td><td className="num">{qty(l.counted_base, 0)}</td>
              <td className="num">{l.variance_base > 0 ? '+' : ''}{qty(l.variance_base, 0)}</td><td className="num">{vnd(l.variance_value, false)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Stocktakes({ id }: { id?: string }) {
  const list = useLoad(() => get<any[]>('/api/inv/stocktakes'));
  const detail = useLoad(() => (id ? get<any>(`/api/inv/stocktakes/${id}`) : Promise.resolve(null)), [id]);
  if (id && detail.data) {
    return (
      <Page title={`Kiểm kê ${fmtDay(detail.data.business_day)}`} back="admin/stocktakes">
        <div className={'banner ' + (detail.data.variance_value < 0 ? 'danger' : 'ok')}>Hao hụt: {vnd(detail.data.variance_value)}{detail.data.note ? ` · ${detail.data.note}` : ''}</div>
        <VarianceTable lines={detail.data.lines} />
      </Page>
    );
  }
  return (
    <Page title="Lịch sử kiểm kê" back="admin/inventory">
      <Loading error={list.error} loading={list.loading && !list.data} />
      {list.data && !list.data.length && <Empty>Chưa kiểm kê lần nào</Empty>}
      <div className="list">
        {(list.data ?? []).map((s) => (
          <button key={s.id} className="li" onClick={() => navigate('admin/stocktakes/' + s.id)}>
            <span className="grow">{fmtDay(s.business_day)} · {s.staff_name ?? ''}</span>
            <span className={'mono ' + (s.variance_value < 0 ? 'danger' : 'ok')}>{vnd(s.variance_value)}</span>
          </button>
        ))}
      </div>
    </Page>
  );
}

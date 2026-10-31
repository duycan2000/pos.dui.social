// Recipe editor used by items, modifier options and prepared ingredients (sub-recipes).
import { useEffect, useState } from 'react';
import { vnd } from '../../shared/util';
import { get, put } from '../lib/api';
import { qty, run } from './common';

export interface Ing { id: string; name: string; base_unit: string; cost_per_base: number; kind: string; active: number }

export function useIngredients() {
  const [ings, setIngs] = useState<Ing[]>([]);
  useEffect(() => { get<Ing[]>('/api/inv/ingredients').then(setIngs).catch(() => {}); }, []);
  return ings;
}

export default function RecipeEditor({ ownerType, ownerId, ings, excludeId, note, allowNegative, onSaved }: {
  ownerType: 'item' | 'modifier_option' | 'ingredient'; ownerId: string; ings: Ing[]; excludeId?: string; note?: string; allowNegative?: boolean; onSaved?: (cost: number) => void;
}) {
  const [lines, setLines] = useState<{ ingredient_id: string; qty_base: number }[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    get<{ ingredient_id: string; qty_base: number }[]>(`/api/inv/recipe/${ownerType}/${ownerId}`).then((r) => { setLines(r.map((x) => ({ ingredient_id: x.ingredient_id, qty_base: x.qty_base }))); setLoaded(true); });
  }, [ownerType, ownerId]);
  const byId = new Map(ings.map((i) => [i.id, i]));
  const cost = lines.reduce((s, l) => s + l.qty_base * (byId.get(l.ingredient_id)?.cost_per_base || 0), 0);
  const save = async () => {
    await run(() => put(`/api/inv/recipe/${ownerType}/${ownerId}`, { lines: lines.filter((l) => l.ingredient_id && l.qty_base) }), 'Đã lưu công thức');
    onSaved?.(cost);
  };
  const options = ings.filter((i) => i.active && i.id !== excludeId);
  if (!loaded) return <p className="muted small">Đang tải công thức…</p>;
  return (
    <div className="col gap12">
      {note && <p className="small muted" style={{ margin: 0 }}>{note}</p>}
      {lines.map((l, idx) => {
        const ing = byId.get(l.ingredient_id);
        return (
          <div key={idx} className="row">
            <select className="input grow" value={l.ingredient_id} onChange={(e) => setLines(lines.map((x, i) => (i === idx ? { ...x, ingredient_id: e.target.value } : x)))}>
              <option value="">— chọn nguyên liệu —</option>
              {options.map((i) => <option key={i.id} value={i.id}>{i.name}{i.kind === 'prepared' ? ' (pha sẵn)' : ''}</option>)}
            </select>
            <input className="input mono" style={{ width: 90 }} type="number" inputMode="decimal" step="any" value={l.qty_base || ''} placeholder="0"
              onChange={(e) => setLines(lines.map((x, i) => (i === idx ? { ...x, qty_base: Number(e.target.value) } : x)))} />
            <span className="small muted" style={{ width: 30 }}>{ing?.base_unit}</span>
            <span className="mono small right" style={{ width: 70 }}>{ing ? vnd(l.qty_base * ing.cost_per_base, false) : ''}</span>
            <button className="iconbtn ghost" aria-label="Bỏ dòng" onClick={() => setLines(lines.filter((_, i) => i !== idx))}>✕</button>
          </div>
        );
      })}
      <div className="row between">
        <button className="btn sm" onClick={() => setLines([...lines, { ingredient_id: '', qty_base: 0 }])}>+ Nguyên liệu</button>
        <span className="small">Giá vốn: <b className="mono">{vnd(cost)}</b></span>
      </div>
      {allowNegative && <p className="tiny faint" style={{ margin: 0 }}>Số âm = bớt nguyên liệu so với công thức gốc (VD: bản mocktail −{qty(30)} ml vodka).</p>}
      <button className="btn primary" onClick={save}>Lưu công thức</button>
    </div>
  );
}

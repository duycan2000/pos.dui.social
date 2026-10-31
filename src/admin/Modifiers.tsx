// S27 — modifier groups and options: price delta, default, excluded from BOGO, stock deduction per option.
import { useState } from 'react';
import type { ModifierGroup, ModifierOption } from '../../shared/types';
import { vnd } from '../../shared/util';
import { del, get, post, put } from '../lib/api';
import { useStore } from '../lib/store';
import { Sheet } from '../ui';
import { Loading, Num, Page, run, Select, Text, Toggle, useLoad } from './common';
import RecipeEditor, { useIngredients } from './Recipe';

export default function Modifiers() {
  const groups = useLoad(() => get<ModifierGroup[]>('/api/admin/t/modifier_group'));
  const options = useLoad(() => get<ModifierOption[]>('/api/admin/t/modifier_option'));
  const owner = useStore((s) => s.staff?.role === 'owner');
  const ings = useIngredients();
  const [g, setG] = useState<Partial<ModifierGroup> | null>(null);
  const [o, setO] = useState<Partial<ModifierOption> | null>(null);

  const saveGroup = async () => {
    if (!g?.name_vi?.trim()) return;
    const body = { name_vi: g.name_vi, name_en: g.name_en || g.name_vi, selection: g.selection || 'single', required: g.required ? 1 : 0, sort: g.sort ?? (groups.data?.length ?? 0) };
    await run(() => (g.id ? put(`/api/admin/t/modifier_group/${g.id}`, body) : post('/api/admin/t/modifier_group', body)), 'Đã lưu nhóm');
    setG(null); groups.reload();
  };
  const saveOption = async () => {
    if (!o?.name_vi?.trim() || !o.group_id) return;
    const body = { group_id: o.group_id, name_vi: o.name_vi, name_en: o.name_en || o.name_vi, price_delta: owner ? o.price_delta ?? 0 : undefined, is_default: o.is_default ? 1 : 0, excludes_promo: o.excludes_promo ? 1 : 0, sort: o.sort ?? 0, active: o.active ?? 1 };
    const saved = await run(() => (o.id ? put<ModifierOption>(`/api/admin/t/modifier_option/${o.id}`, body) : post<ModifierOption>('/api/admin/t/modifier_option', body)), 'Đã lưu lựa chọn');
    if (saved && !o.id) setO(saved); else setO(null);
    options.reload();
  };

  return (
    <Page title="Tuỳ chọn món" sub="Gắn nhóm vào món trong trang sửa món" right={<button className="btn sm primary" onClick={() => setG({ selection: 'single', required: 0 })}>+ Nhóm</button>}>
      <Loading error={groups.error} loading={groups.loading && !groups.data} />
      {(groups.data ?? []).map((grp) => (
        <div key={grp.id} className="card col gap12">
          <div className="row between">
            <button style={{ border: 0, background: 'none', padding: 0, textAlign: 'left' }} onClick={() => setG(grp)}>
              <b>{grp.name_vi}</b> <span className="small muted">({grp.selection === 'single' ? 'chọn 1' : 'chọn nhiều'}{grp.required ? ', bắt buộc' : ''})</span>
            </button>
            <button className="btn sm" onClick={() => setO({ group_id: grp.id, price_delta: 0, active: 1, sort: (options.data ?? []).filter((x) => x.group_id === grp.id).length })}>+ Lựa chọn</button>
          </div>
          <div className="opts">
            {(options.data ?? []).filter((x) => x.group_id === grp.id).map((op) => (
              <button key={op.id} className={'opt' + (op.is_default ? ' on' : '')} style={!op.active ? { opacity: 0.4 } : undefined} onClick={() => setO(op)}>
                {op.name_vi}{op.price_delta ? ` ${op.price_delta > 0 ? '+' : ''}${vnd(op.price_delta, false)}` : ''}{op.excludes_promo ? ' · không KM' : ''}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="tiny faint">Viền vàng = lựa chọn mặc định (bấm 1 lần ở màn bán là thêm món với lựa chọn này).</p>

      {g && (
        <Sheet onClose={() => setG(null)}>
          <h2>{g.id ? 'Sửa nhóm' : 'Nhóm mới'}</h2>
          <div className="col gap12">
            <Text label="Tên tiếng Việt" value={g.name_vi} onChange={(v) => setG({ ...g, name_vi: v })} />
            <Text label="Tên tiếng Anh" value={g.name_en} onChange={(v) => setG({ ...g, name_en: v })} />
            <Select label="Kiểu chọn" value={g.selection} onChange={(v) => setG({ ...g, selection: v as 'single' | 'multi' })} options={[['single', 'Chọn 1'], ['multi', 'Chọn nhiều']]} />
            <Toggle label="Bắt buộc" checked={!!g.required} onChange={(v) => setG({ ...g, required: v ? 1 : 0 })} />
            <div className="row">
              {g.id && <button className="btn danger" onClick={async () => { await run(() => del(`/api/admin/t/modifier_group/${g.id}`), 'Đã xoá nhóm'); setG(null); groups.reload(); }}>Xoá</button>}
              <button className="btn primary grow" onClick={saveGroup}>Lưu</button>
            </div>
          </div>
        </Sheet>
      )}
      {o && (
        <Sheet onClose={() => setO(null)}>
          <h2>{o.id ? 'Sửa lựa chọn' : 'Lựa chọn mới'}</h2>
          <div className="col gap12">
            <Text label="Tên tiếng Việt" value={o.name_vi} onChange={(v) => setO({ ...o, name_vi: v })} />
            <Text label="Tên tiếng Anh" value={o.name_en} onChange={(v) => setO({ ...o, name_en: v })} />
            {owner ? <Num label="Cộng/trừ tiền (₫, số âm để giảm)" value={o.price_delta} onChange={(v) => setO({ ...o, price_delta: Math.round(v) })} />
              : <p className="small muted">Giá: {vnd(o.price_delta ?? 0)} (chỉ chủ quán sửa giá)</p>}
            <Toggle label="Mặc định" checked={!!o.is_default} onChange={(v) => setO({ ...o, is_default: v ? 1 : 0 })} />
            <Toggle label="Không áp khuyến mãi (VD: bản mocktail)" checked={!!o.excludes_promo} onChange={(v) => setO({ ...o, excludes_promo: v ? 1 : 0 })} />
            <Toggle label="Đang dùng" checked={o.active !== 0} onChange={(v) => setO({ ...o, active: v ? 1 : 0 })} />
            <button className="btn primary" onClick={saveOption}>Lưu</button>
            {o.id && (
              <div className="card">
                <div className="bold small" style={{ marginBottom: 8 }}>Trừ kho thêm khi chọn</div>
                <RecipeEditor ownerType="modifier_option" ownerId={o.id} ings={ings} allowNegative note="VD: Thêm shot = +15 ml rượu. Bản mocktail = −30 ml vodka, +30 ml rượu không cồn." />
              </div>
            )}
          </div>
        </Sheet>
      )}
    </Page>
  );
}

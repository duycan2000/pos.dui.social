// S26 — edit an item: names EN/VI, price (owner only, logged), photo, website flag, modifier groups, recipe.
import { useEffect, useState } from 'react';
import type { Category, Item, ModifierGroup } from '../../shared/types';
import { vnd } from '../../shared/util';
import { del, get, post, put } from '../lib/api';
import { navigate, useStore } from '../lib/store';
import { Loading, Num, Page, PhotoPicker, pct, run, Select, Text, Toggle, useLoad } from './common';
import RecipeEditor, { useIngredients } from './Recipe';

export default function ItemEdit({ id }: { id: string }) {
  const isNew = !id || id.startsWith('new');
  const catParam = new URLSearchParams(location.hash.split('?')[1] || '').get('cat') || '';
  const owner = useStore((s) => s.staff?.role === 'owner');
  const cats = useLoad(() => get<Category[]>('/api/admin/t/category'));
  const groups = useLoad(() => get<ModifierGroup[]>('/api/admin/t/modifier_group'));
  const ings = useIngredients();
  const [it, setIt] = useState<Partial<Item>>({ category_id: catParam, name_vi: '', name_en: '', price: 0, active: 1, sold_out: 0, show_on_web: 1, sort: 99 });
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [cost, setCost] = useState<number | null>(null);
  const [loading, setLoading] = useState(!isNew);

  useEffect(() => {
    if (isNew) return;
    Promise.all([get<Item[]>('/api/admin/t/item'), get<{ group_id: string }[]>(`/api/admin/item/${id}/groups`)]).then(([items, g]) => {
      const found = items.find((x) => x.id === id);
      if (found) setIt(found);
      setGroupIds(g.map((x) => x.group_id));
      setLoading(false);
    });
  }, [id, isNew]);
  useEffect(() => { if (isNew && !it.category_id && cats.data?.[0]) setIt((x) => ({ ...x, category_id: cats.data![0].id })); }, [cats.data]); // eslint-disable-line

  const save = async () => {
    if (!it.name_vi?.trim() || !it.category_id) return;
    const body = { ...it, name_en: it.name_en || it.name_vi };
    delete (body as any).id; delete (body as any).created_at; delete (body as any).updated_at;
    if (!owner) delete (body as any).price;
    const saved = await run(() => (isNew ? post<Item>('/api/admin/t/item', body) : put<Item>(`/api/admin/t/item/${id}`, body)), 'Đã lưu món');
    if (!saved) return;
    await run(() => put(`/api/admin/item/${saved.id}/groups`, { groupIds }));
    if (isNew) navigate('admin/item/' + saved.id);
  };
  const toggleGroup = (gid: string) => setGroupIds(groupIds.includes(gid) ? groupIds.filter((g) => g !== gid) : [...groupIds, gid]);

  return (
    <Page title={isNew ? 'Món mới' : it.name_vi || 'Sửa món'} back="admin/menu" footer={<button className="btn primary lg block" onClick={save}>Lưu món</button>}>
      <Loading error={null} loading={loading} />
      <div className="form-grid">
        <Text label="Tên tiếng Việt" value={it.name_vi} onChange={(v) => setIt({ ...it, name_vi: v })} />
        <Text label="Tên tiếng Anh" value={it.name_en} onChange={(v) => setIt({ ...it, name_en: v })} />
        <Select label="Danh mục" value={it.category_id} onChange={(v) => setIt({ ...it, category_id: v })} options={(cats.data ?? []).map((c) => [c.id, c.name_vi])} />
        {owner ? <Num label="Giá bán (₫)" value={it.price} onChange={(v) => setIt({ ...it, price: Math.round(v) })} />
          : <div className="field"><span>Giá bán</span><div className="input row">{vnd(it.price || 0)} <span className="tiny faint">(chỉ chủ quán sửa giá)</span></div></div>}
        <Text label="Mô tả tiếng Việt" value={it.desc_vi} onChange={(v) => setIt({ ...it, desc_vi: v })} />
        <Text label="Mô tả tiếng Anh" value={it.desc_en} onChange={(v) => setIt({ ...it, desc_en: v })} />
      </div>
      <PhotoPicker value={it.image_key ?? null} onChange={(k) => setIt({ ...it, image_key: k })} />
      <div className="row wrap gap16">
        <Toggle label="Hiện trên website" checked={!!it.show_on_web} onChange={(v) => setIt({ ...it, show_on_web: v ? 1 : 0 })} />
        <Toggle label="Hết hàng" checked={!!it.sold_out} onChange={(v) => setIt({ ...it, sold_out: v ? 1 : 0 })} />
        <Toggle label="Đang bán" checked={!!it.active} onChange={(v) => setIt({ ...it, active: v ? 1 : 0 })} />
      </div>
      <div className="section-title">Nhóm tuỳ chọn</div>
      <div className="row wrap">
        {(groups.data ?? []).map((g) => <Toggle key={g.id} label={g.name_vi} checked={groupIds.includes(g.id)} onChange={() => toggleGroup(g.id)} />)}
      </div>
      {!isNew && (
        <>
          <div className="section-title">Công thức & giá vốn {cost != null && it.price ? <span className="accent">· cost {pct((cost / it.price) * 100)}</span> : null}</div>
          <div className="card">
            <RecipeEditor ownerType="item" ownerId={id} ings={ings} onSaved={setCost} note="Lượng cho 1 ly, gồm cả ly, nắp, ống hút nếu muốn theo dõi. Mỗi ly bán ra kho tự trừ đúng các lượng này." />
          </div>
          {it.active ? <button className="btn danger" onClick={async () => { await run(() => del(`/api/admin/t/item/${id}`), 'Đã tắt món'); navigate('admin/menu'); }}>Tắt món này</button> : null}
        </>
      )}
      {isNew && <p className="small muted">Lưu món trước, rồi nhập công thức.</p>}
    </Page>
  );
}

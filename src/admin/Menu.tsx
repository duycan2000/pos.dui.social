// S25 — menu items by category: on/off, sold out, order. Same data feeds the website.
import { useState } from 'react';
import type { Category, Item } from '../../shared/types';
import { vnd } from '../../shared/util';
import { del, get, post, put } from '../lib/api';
import { navigate } from '../lib/store';
import { Icon, Sheet } from '../ui';
import { Loading, Num, Page, run, Text, useLoad } from './common';

export default function Menu() {
  const cats = useLoad(() => get<Category[]>('/api/admin/t/category'));
  const items = useLoad(() => get<Item[]>('/api/admin/t/item'));
  const [cat, setCat] = useState('');
  const [editCat, setEditCat] = useState<Partial<Category> | null>(null);
  const active = cat || cats.data?.find((c) => c.active)?.id || '';
  const list = (items.data ?? []).filter((i) => i.category_id === active);

  const patch = async (it: Item, p: Partial<Item>) => {
    items.setData((items.data ?? []).map((x) => (x.id === it.id ? { ...x, ...p } : x)));
    await run(() => put(`/api/admin/t/item/${it.id}`, p));
  };
  const move = async (it: Item, dir: -1 | 1) => {
    const idx = list.findIndex((x) => x.id === it.id);
    const other = list[idx + dir];
    if (!other) return;
    await run(async () => {
      await put(`/api/admin/t/item/${it.id}`, { sort: idx + dir });
      await put(`/api/admin/t/item/${other.id}`, { sort: idx });
      await Promise.all(list.map((x, i) => (x.sort !== i && x.id !== it.id && x.id !== other.id ? put(`/api/admin/t/item/${x.id}`, { sort: i }) : null)));
    });
    items.reload();
  };
  const saveCat = async () => {
    if (!editCat?.name_vi?.trim()) return;
    const body = { name_vi: editCat.name_vi, name_en: editCat.name_en || editCat.name_vi, sort: editCat.sort ?? (cats.data?.length ?? 0), active: editCat.active ?? 1 };
    await run(() => (editCat.id ? put(`/api/admin/t/category/${editCat.id}`, body) : post('/api/admin/t/category', body)), 'Đã lưu danh mục');
    setEditCat(null);
    cats.reload();
  };

  return (
    <Page title="Menu & món" sub="Dùng chung với website" right={<button className="btn sm primary" onClick={() => navigate('admin/item/new?cat=' + active)}><Icon name="plus" size={16} />Món</button>}>
      <Loading error={cats.error || items.error} loading={cats.loading && !cats.data} />
      <div className="chips" style={{ padding: 0 }}>
        {(cats.data ?? []).map((c) => (
          <button key={c.id} className={'chip' + (c.id === active ? ' on' : '')} style={!c.active ? { opacity: 0.5 } : undefined}
            onClick={() => setCat(c.id)} onDoubleClick={() => setEditCat(c)}>{c.name_vi}</button>
        ))}
        <button className="chip" onClick={() => setEditCat({})}>+ Danh mục</button>
        {active && <button className="chip" onClick={() => setEditCat(cats.data!.find((c) => c.id === active)!)}>Sửa danh mục</button>}
      </div>
      <div className="list">
        {list.map((it, i) => (
          <div key={it.id} className="li" style={{ opacity: it.active ? 1 : 0.5 }}>
            <div className="col" style={{ gap: 0 }}>
              <button className="iconbtn ghost" style={{ height: 28 }} aria-label="Lên" disabled={i === 0} onClick={() => move(it, -1)}>▲</button>
              <button className="iconbtn ghost" style={{ height: 28 }} aria-label="Xuống" disabled={i === list.length - 1} onClick={() => move(it, 1)}>▼</button>
            </div>
            <button className="grow col" style={{ gap: 2, border: 0, background: 'none', textAlign: 'left', padding: 0 }} onClick={() => navigate('admin/item/' + it.id)}>
              <span className="bold">{it.name_vi}</span>
              <span className="small muted">{vnd(it.price)}{it.show_on_web ? '' : ' · ẩn trên web'}{it.active ? '' : ' · đã tắt'}</span>
            </button>
            <button className={'btn sm ' + (it.sold_out ? 'danger' : 'ok')} onClick={() => patch(it, { sold_out: it.sold_out ? 0 : 1 })}>{it.sold_out ? 'Hết hàng' : 'Còn'}</button>
          </div>
        ))}
        {!list.length && !items.loading && <p className="muted">Chưa có món trong danh mục này.</p>}
      </div>
      <p className="tiny faint">Bấm “Còn / Hết hàng” để bật tắt nhanh. Tắt hẳn món trong trang sửa món.</p>
      {editCat && (
        <Sheet onClose={() => setEditCat(null)}>
          <h2>{editCat.id ? 'Sửa danh mục' : 'Danh mục mới'}</h2>
          <div className="col gap12">
            <Text label="Tên tiếng Việt" value={editCat.name_vi} onChange={(v) => setEditCat({ ...editCat, name_vi: v })} />
            <Text label="Tên tiếng Anh" value={editCat.name_en} onChange={(v) => setEditCat({ ...editCat, name_en: v })} />
            <Num label="Thứ tự" value={editCat.sort} onChange={(v) => setEditCat({ ...editCat, sort: v })} />
            <div className="row">
              {editCat.id && <button className="btn danger" onClick={async () => { await run(() => (editCat.active ? del(`/api/admin/t/category/${editCat.id}`) : put(`/api/admin/t/category/${editCat.id}`, { active: 1 }))); setEditCat(null); cats.reload(); }}>{editCat.active ? 'Ẩn' : 'Hiện lại'}</button>}
              <button className="btn primary grow" onClick={saveCat}>Lưu</button>
            </div>
          </div>
        </Sheet>
      )}
    </Page>
  );
}

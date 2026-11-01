// Quản trị › Sơ đồ bàn. Arrange tables on a grid per area: tap an empty cell to add a table, drag a table to
// move it, tap it to rename / change seats, shape and size. Changes reach the selling devices on the next sync.
import { useMemo, useRef, useState } from 'react';
import type { DiningTable } from '../../shared/types';
import { del as apiDel, get, post, put } from '../lib/api';
import { toast } from '../lib/store';
import { Confirm, Icon, Segmented, Sheet } from '../ui';
import { Loading, Num, Page, run, Select, Text, useLoad } from './common';

type T = DiningTable & { active: number };
const SIZES: [string, string][] = [['1x1', '1 ô'], ['2x1', 'Dài ngang'], ['1x2', 'Dài dọc'], ['2x2', 'Lớn']];

export default function FloorEditor() {
  const list = useLoad(() => get<T[]>('/api/admin/t/dining_table'));
  const tables = (list.data ?? []).filter((t) => t.active);
  const [extraAreas, setExtraAreas] = useState<string[]>([]);
  const areas = useMemo(() => [...new Set([...tables.map((t) => t.area), ...extraAreas])], [tables, extraAreas]);
  const [area, setArea] = useState('');
  const current = area && areas.includes(area) ? area : areas[0] ?? 'Trong nhà';
  const shown = tables.filter((t) => t.area === current);
  const [edit, setEdit] = useState<T | null>(null);
  const [bulk, setBulk] = useState(false);
  const [newArea, setNewArea] = useState<string | null>(null);
  const [rename, setRename] = useState<string | null>(null);

  const nextName = () => {
    const nums = tables.map((t) => parseInt(t.name.replace(/\D+/g, ''), 10)).filter((n) => !isNaN(n));
    return `Bàn ${(nums.length ? Math.max(...nums) : 0) + 1}`;
  };
  const addAt = async (x: number, y: number) => {
    const r = await run(() => post<T>('/api/admin/t/dining_table', { area: current, name: nextName(), seats: 4, x, y, w: 1, h: 1, shape: 'square', sort: tables.length + 1, active: 1 }), 'Đã thêm bàn');
    if (r) { await list.reload(); setEdit(r); }
  };
  const move = async (t: T, x: number, y: number) => {
    list.setData((d) => (d ?? []).map((r) => (r.id === t.id ? { ...r, x, y } : r)));
    await run(() => put(`/api/admin/t/dining_table/${t.id}`, { x, y }));
    list.reload();
  };

  return (
    <Page title="Sơ đồ bàn" sub={`${tables.length} bàn · ${areas.length} khu vực`}
      right={<button className="btn sm primary" onClick={() => setBulk(true)}>+ Nhiều bàn</button>}>
      <Loading error={list.error} loading={list.loading && !list.data} />
      <nav className="row wrap" aria-label="Khu vực">
        {areas.map((a) => <button key={a} className={'chip' + (a === current ? ' on' : '')} onClick={() => setArea(a)}>{a} · {tables.filter((t) => t.area === a).length}</button>)}
        <button className="chip" onClick={() => setNewArea('')}><Icon name="plus" size={16} />Khu vực</button>
        {tables.some((t) => t.area === current) && <button className="btn sm ghost" onClick={() => setRename(current)}><Icon name="edit" size={16} />Đổi tên khu</button>}
      </nav>
      <p className="small muted" style={{ margin: 0 }}>Chạm ô trống để thêm bàn · kéo bàn để đổi chỗ · chạm bàn để sửa tên, số ghế, hình dạng.</p>
      <Grid tables={shown} onAdd={addAt} onMove={move} onEdit={setEdit} />
      <p className="tiny faint" style={{ margin: 0 }}>Máy bán hàng nhận sơ đồ mới sau lần đồng bộ tiếp theo (tối đa 15 giây). Bàn đang có khách không xoá được.</p>

      {edit && <EditTable t={edit} areas={areas} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />}
      {bulk && <BulkAdd area={current} start={parseInt(nextName().replace(/\D+/g, ''), 10)} onClose={() => setBulk(false)} onDone={() => { setBulk(false); list.reload(); }} />}
      {newArea !== null && (
        <Sheet middle onClose={() => setNewArea(null)}>
          <h2>Khu vực mới</h2>
          <p className="small muted" style={{ marginTop: 4 }}>VD: Sân trước, Tầng 2, Quầy bar.</p>
          <input className="input" autoFocus value={newArea} onChange={(e) => setNewArea(e.target.value)} placeholder="Tên khu vực" />
          <button className="btn primary block mt16" disabled={!newArea.trim()} onClick={() => { const a = newArea.trim(); setExtraAreas((x) => [...x, a]); setArea(a); setNewArea(null); toast('Chạm ô trống để thêm bàn vào ' + a); }}>Tạo khu vực</button>
        </Sheet>
      )}
      {rename !== null && <RenameArea from={current} onClose={() => setRename(null)} onDone={(to) => { setRename(null); setArea(to); list.reload(); }} />}
    </Page>
  );
}

function Grid({ tables, onAdd, onMove, onEdit }: { tables: T[]; onAdd: (x: number, y: number) => void; onMove: (t: T, x: number, y: number) => void; onEdit: (t: T) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cols = Math.min(12, Math.max(6, ...tables.map((t) => t.x + t.w + 1)));
  const rows = Math.max(4, ...tables.map((t) => t.y + t.h + 1));
  const [drag, setDrag] = useState<{ id: string; sx: number; sy: number; dx: number; dy: number; cx: number; cy: number } | null>(null);
  const covered = new Set<string>();
  for (const t of tables) for (let i = 0; i < t.w; i++) for (let j = 0; j < t.h; j++) covered.add(`${t.x + i},${t.y + j}`);

  /** Grid cell nearest to a table's top-left corner at screen position (px, py). */
  const cellAt = (px: number, py: number) => {
    const r = ref.current!.getBoundingClientRect();
    const cw = (r.width - 20) / cols;
    const ch = (r.height - 20) / rows;
    return { x: Math.max(0, Math.min(cols - 1, Math.round((px - r.left - 10) / cw))), y: Math.max(0, Math.min(rows, Math.round((py - r.top - 10) / ch))) };
  };
  const fits = (t: T, x: number, y: number) => {
    if (x + t.w > 12) return false;
    for (const o of tables) {
      if (o.id === t.id) continue;
      if (x < o.x + o.w && x + t.w > o.x && y < o.y + o.h && y + t.h > o.y) return false;
    }
    return true;
  };
  const cells: JSX.Element[] = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (covered.has(`${x},${y}`)) continue;
    cells.push(<button key={`c${x},${y}`} className="cell" style={{ gridColumn: x + 1, gridRow: y + 1 }} aria-label={`Thêm bàn ở cột ${x + 1}, hàng ${y + 1}`} onClick={() => onAdd(x, y)}>+</button>);
  }
  return (
    <div className="floorwrap">
      <div ref={ref} className="editor" style={{ gridTemplateColumns: `repeat(${cols}, minmax(64px, 1fr))`, gridTemplateRows: `repeat(${rows}, 72px)` }}>
        {cells}
        {tables.map((t) => {
          const d = drag?.id === t.id ? drag : null;
          // Offset of the grab point inside the table, so the drop cell is where the table's top-left lands.
          const tgt = d ? cellAt(d.sx + d.dx - d.cx, d.sy + d.dy - d.cy) : null;
          return (
            <button key={t.id} className={`tbl ${t.shape}${d ? ' drag' : ''}${tgt && fits(t, tgt.x, tgt.y) ? ' drop' : ''}`}
              style={{ gridColumn: `${t.x + 1} / span ${t.w}`, gridRow: `${t.y + 1} / span ${t.h}`, transform: d ? `translate(${d.dx}px, ${d.dy}px)` : undefined }}
              onPointerDown={(e) => {
                (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setDrag({ id: t.id, sx: e.clientX, sy: e.clientY, dx: 0, dy: 0, cx: e.clientX - r.left, cy: e.clientY - r.top });
              }}
              onPointerMove={(e) => { if (drag?.id === t.id) setDrag({ ...drag, dx: e.clientX - drag.sx, dy: e.clientY - drag.sy }); }}
              onPointerUp={() => {
                const dd = drag;
                setDrag(null);
                if (!dd || dd.id !== t.id) return;
                if (Math.abs(dd.dx) + Math.abs(dd.dy) < 8) { onEdit(t); return; }
                const c = cellAt(dd.sx + dd.dx - dd.cx, dd.sy + dd.dy - dd.cy);
                if (c.x === t.x && c.y === t.y) return;
                if (!fits(t, c.x, c.y)) { toast('Chỗ đó đã có bàn', true); return; }
                onMove(t, c.x, c.y);
              }}
              onPointerCancel={() => setDrag(null)}>
              <span className="tn">{t.name}</span>
              <span className="tiny muted">{t.seats} chỗ</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EditTable({ t, areas, onClose, onSaved }: { t: T; areas: string[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(t);
  const [customArea, setCustomArea] = useState(false);
  const [askDel, setAskDel] = useState(false);
  const save = async () => {
    const ok = await run(() => put(`/api/admin/t/dining_table/${t.id}`, { name: f.name.trim(), area: f.area.trim() || 'Trong nhà', seats: f.seats, shape: f.shape, w: f.w, h: f.h }), 'Đã lưu bàn');
    if (ok) onSaved();
  };
  const del = async () => {
    setAskDel(false);
    const ok = await run(() => apiDel(`/api/admin/t/dining_table/${t.id}`), 'Đã xoá bàn');
    if (ok) onSaved();
  };
  return (
    <Sheet onClose={onClose}>
      <h2>Sửa bàn</h2>
      <div className="col gap12 mt16">
        <Text label="Tên bàn" value={f.name} onChange={(v) => setF({ ...f, name: v })} placeholder="VD: Bàn 1, Sofa, Quầy 3" />
        {customArea
          ? <Text label="Khu vực mới" value={f.area} onChange={(v) => setF({ ...f, area: v })} />
          : <Select label="Khu vực" value={f.area} onChange={(v) => (v === '__new' ? (setCustomArea(true), setF({ ...f, area: '' })) : setF({ ...f, area: v }))} options={[...areas.map((a) => [a, a] as [string, string]), ['__new', '+ Khu vực khác…']]} />}
        <Num label="Số ghế" value={f.seats} onChange={(v) => setF({ ...f, seats: Math.max(1, Math.round(v)) })} />
        <div className="field"><span>Hình dạng</span>
          <Segmented value={f.shape} onChange={(v) => setF({ ...f, shape: v })} options={[['square', 'Vuông'], ['round', 'Tròn'], ['bar', 'Quầy']]} />
        </div>
        <div className="field"><span>Kích thước trên sơ đồ</span>
          <Segmented value={`${f.w}x${f.h}`} onChange={(v) => { const [w, h] = v.split('x').map(Number); setF({ ...f, w, h }); }} options={SIZES} />
        </div>
        <div className="row">
          <button className="btn danger" onClick={() => setAskDel(true)}><Icon name="trash" size={18} />Xoá</button>
          <button className="btn primary grow" disabled={!f.name.trim()} onClick={save}>Lưu</button>
        </div>
      </div>
      {askDel && <Confirm title={`Xoá ${t.name}?`} text="Bàn biến mất khỏi sơ đồ. Đơn cũ của bàn vẫn giữ trong báo cáo." okText="Xoá bàn" danger onCancel={() => setAskDel(false)} onOk={del} />}
    </Sheet>
  );
}

function BulkAdd({ area, start, onClose, onDone }: { area: string; start: number; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ area, prefix: 'Bàn', start: isNaN(start) ? 1 : start, count: 4, seats: 4 });
  const go = async () => { const ok = await run(() => post('/api/admin/tables/bulk', f), `Đã thêm ${f.count} bàn`); if (ok) onDone(); };
  return (
    <Sheet onClose={onClose}>
      <h2>Thêm nhiều bàn</h2>
      <div className="col gap12 mt16">
        <Text label="Khu vực" value={f.area} onChange={(v) => setF({ ...f, area: v })} />
        <div className="form-grid">
          <Text label="Tên bắt đầu bằng" value={f.prefix} onChange={(v) => setF({ ...f, prefix: v })} />
          <Num label="Số đầu tiên" value={f.start} onChange={(v) => setF({ ...f, start: Math.max(0, Math.round(v)) })} />
          <Num label="Số bàn" value={f.count} onChange={(v) => setF({ ...f, count: Math.max(1, Math.min(40, Math.round(v))) })} />
          <Num label="Ghế mỗi bàn" value={f.seats} onChange={(v) => setF({ ...f, seats: Math.max(1, Math.round(v)) })} />
        </div>
        <p className="small muted" style={{ margin: 0 }}>Sẽ tạo: {f.prefix} {f.start} … {f.prefix} {f.start + f.count - 1}. Bàn được xếp vào chỗ trống, kéo để chỉnh lại sau.</p>
        <button className="btn primary lg" onClick={go}>Thêm {f.count} bàn</button>
      </div>
    </Sheet>
  );
}

function RenameArea({ from, onClose, onDone }: { from: string; onClose: () => void; onDone: (to: string) => void }) {
  const [to, setTo] = useState(from);
  const go = async () => { const ok = await run(() => post('/api/admin/tables/area', { from, to: to.trim() }), 'Đã đổi tên khu vực'); if (ok) onDone(to.trim()); };
  return (
    <Sheet middle onClose={onClose}>
      <h2>Đổi tên khu vực</h2>
      <input className="input mt16" autoFocus value={to} onChange={(e) => setTo(e.target.value)} />
      <button className="btn primary block mt16" disabled={!to.trim() || to.trim() === from} onClick={go}>Lưu</button>
    </Sheet>
  );
}

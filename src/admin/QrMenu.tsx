// Menu QR tại bàn (owner): turn the guest menu on, print a QR card per table, change a table's code.
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import type { GuestMode } from '../../shared/types';
import { parseSettings } from '../../shared/util';
import { get, post, put } from '../lib/api';
import type { PLine } from '../lib/printer';
import { tryPrint } from '../lib/receipts';
import { toast, useStore } from '../lib/store';
import { Confirm, Icon, Segmented } from '../ui';
import { Loading, Page, run, useLoad } from './common';

interface Tbl { id: string; name: string; area: string; qr_token: string }

const linkOf = (token: string) => `${location.origin}/m/${token}`;

export default function QrMenu() {
  const outlet = useStore((s) => s.config!.outlet);
  const data = useLoad(() => get<{ mode: GuestMode; tables: Tbl[] }>('/api/admin/qr'));
  const [imgs, setImgs] = useState<Record<string, string>>({});
  const [reset, setReset] = useState<Tbl | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const tables = data.data?.tables ?? [];

  useEffect(() => {
    let alive = true;
    Promise.all(tables.map(async (t) => [t.id, await QRCode.toDataURL(linkOf(t.qr_token), { margin: 1, width: 360, errorCorrectionLevel: 'M' })] as const))
      .then((list) => { if (alive) setImgs(Object.fromEntries(list)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [data.data]); // eslint-disable-line

  const setMode = async (m: GuestMode) => {
    const o = await get<{ settings_json: string | null }>('/api/admin/outlet');
    const st = parseSettings<Record<string, unknown>>(o.settings_json);
    await run(() => put('/api/admin/outlet', { settings_json: JSON.stringify({ ...st, guest_order: m }) }), m === 'off' ? 'Đã tắt menu QR' : 'Đã bật menu QR');
    data.reload();
  };

  const printA4 = () => {
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const cards = tables.map((t) => `<div class="card"><div class="o">${esc(outlet.name.toUpperCase())}</div><div class="t">${esc(t.name)}</div>
      <img src="${imgs[t.id] ?? ''}"/><div class="en">Scan for the menu &amp; order</div><div class="vi">Quét mã để xem menu &amp; gọi món</div></div>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      @page{size:A4;margin:10mm}body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif}
      .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8mm}
      .card{border:1.5px dashed #999;border-radius:6mm;padding:7mm 5mm;text-align:center;break-inside:avoid}
      .o{font-weight:800;letter-spacing:.12em;font-size:13pt}.t{font-size:26pt;font-weight:800;margin:2mm 0 3mm}
      img{width:58mm;height:58mm;image-rendering:pixelated}.en{font-weight:700;font-size:12pt;margin-top:2mm}.vi{color:#555;font-size:11pt}
    </style></head><body><div class="grid">${cards}</div></body></html>`;
    const f = frame.current;
    if (!f) return;
    f.srcdoc = html;
    f.onload = () => { f.contentWindow?.focus(); f.contentWindow?.print(); };
  };

  const printOne = async (t: Tbl) => {
    const canvas = document.createElement('canvas');
    await QRCode.toCanvas(canvas, linkOf(t.qr_token), { margin: 2, scale: 1, errorCorrectionLevel: 'M' });
    const doc: PLine[] = [
      { t: 'text', text: outlet.name.toUpperCase(), align: 'center', size: 'md', bold: true },
      { t: 'text', text: t.name, align: 'center', size: 'xl', bold: true },
      { t: 'image', canvas, crisp: true },
      { t: 'text', text: 'Scan for the menu & order', align: 'center', size: 'md', bold: true },
      { t: 'text', text: 'Quét mã để xem menu & gọi món', align: 'center', size: 'sm' },
      { t: 'space', h: 60 },
    ];
    const err = await tryPrint(doc);
    toast(err ?? `Đã in QR ${t.name}`, !!err);
  };

  const mode = data.data?.mode ?? 'off';
  return (
    <Page title="Menu QR tại bàn" right={tables.length ? <button className="btn sm" onClick={printA4}><Icon name="print" size={16} />In tất cả (A4)</button> : undefined}>
      <div className="card col gap12">
        <Segmented value={mode} onChange={(v) => setMode(v as GuestMode)} options={[['off', 'Tắt'], ['menu', 'Chỉ xem menu'], ['order', 'Cho gọi món']]} />
        <span className="small muted">
          {mode === 'off' && 'Khách quét mã sẽ thấy "menu tạm thời không khả dụng".'}
          {mode === 'menu' && 'Khách xem menu có ảnh (tiếng Anh / tiếng Việt), gọi nhân viên và xin thanh toán. Gọi món vẫn qua nhân viên.'}
          {mode === 'order' && 'Khách xem menu, chọn món + tuỳ chọn rồi gửi. Đơn hiện trên máy bán hàng (có chuông) — nhân viên bấm Nhận thì mới vào đơn của bàn và in phiếu pha chế. Giá luôn lấy từ menu của quán.'}
        </span>
        <span className="tiny faint">Chỉ món bật "Hiện trên website" mới có trong menu QR. Món hết hàng hiện mờ. Mỗi bàn một mã riêng, khó đoán; đổi mã nếu ảnh QR bị chụp mang đi.</span>
      </div>
      <Loading error={data.error} loading={data.loading && !data.data} />
      {data.data && !tables.length && <div className="banner">Chưa có bàn. Thêm bàn trong Sơ đồ bàn trước.</div>}
      <div className="qrgrid">
        {tables.map((t) => (
          <div key={t.id} className="card col" style={{ alignItems: 'center', gap: 8, textAlign: 'center' }}>
            <b>{t.name}</b>
            <span className="tiny muted">{t.area}</span>
            {imgs[t.id] ? <img src={imgs[t.id]} alt={`QR ${t.name}`} style={{ width: 150, height: 150, imageRendering: 'pixelated', background: '#fff', borderRadius: 8, padding: 6 }} /> : <div style={{ width: 150, height: 150 }} />}
            <div className="row wrap" style={{ gap: 6, justifyContent: 'center' }}>
              <a className="btn sm" href={linkOf(t.qr_token)} target="_blank" rel="noreferrer">Mở thử</a>
              <button className="btn sm" onClick={() => printOne(t)}><Icon name="printer" size={14} />In</button>
              <button className="btn sm ghost" onClick={() => setReset(t)}>Đổi mã</button>
            </div>
          </div>
        ))}
      </div>
      <iframe ref={frame} title="In mã QR" style={{ position: 'fixed', width: 0, height: 0, border: 0, left: -9999 }} />
      {reset && <Confirm title={`Đổi mã QR ${reset.name}?`} okText="Đổi mã" danger onCancel={() => setReset(null)}
        onOk={async () => { const t = reset; setReset(null); await run(() => post(`/api/admin/tables/${t.id}/qr-reset`), 'Đã đổi mã — in lại QR cho bàn này'); data.reload(); }}
        text="Mã QR cũ của bàn này sẽ không dùng được nữa. Nhớ in và dán mã mới." />}
    </Page>
  );
}

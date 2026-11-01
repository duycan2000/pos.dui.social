// Quản trị › Sổ doanh thu (Mẫu S1a-HKD, Thông tư 152/2025/TT-BTC). Same layout as the official form:
// A4 landscape, the header repeated on every page, columns A (date) / B (description) / 1 (amount),
// "Tổng cộng" on the last page and the representative's signature block. Printed or saved as PDF from the browser.
import { useRef, useState } from 'react';
import type { TaxInfo } from '../../shared/types';
import { fmtDay } from '../../shared/util';
import { get } from '../lib/api';
import { navigate, today } from '../lib/store';
import { Icon, Segmented } from '../ui';
import { Loading, Page, useLoad } from './common';

interface Book { from: string; to: string; mode: 'order' | 'day'; outlet_name: string; info: TaxInfo; rows: { day: string; amount: number }[]; total: number }

const ROWS_PER_PAGE = 19;
const DOTS = '........................';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const num = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const p2 = (n: number) => String(n).padStart(2, '0');
function lastDay(y: number, m: number) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

export function periodLabel(mode: string, from: string, to: string) {
  if (mode === 'month') return `Tháng ${from.slice(5, 7)} năm ${from.slice(0, 4)}`;
  if (mode === 'quarter') return `Quý ${Math.ceil(Number(from.slice(5, 7)) / 3)} năm ${from.slice(0, 4)}`;
  if (mode === 'year') return `Năm ${from.slice(0, 4)}`;
  return `Từ ${fmtDay(from)} đến ${fmtDay(to)}`;
}

/** The whole book as a standalone HTML document (also used for the on-screen preview). */
export function bookHtml(b: Book, period: string, signDate: Date) {
  const i = b.info;
  const desc = esc(i.description?.trim() || `Bán hàng tại cửa hàng ${b.outlet_name}`);
  const header = `
    <div class="top">
      <div class="who">
        <div><b>Hộ cá nhân kinh doanh: ${esc(i.business_name?.trim() || DOTS)}</b></div>
        <div><b>Địa chỉ: ${esc(i.address?.trim() || DOTS)}</b></div>
        <div><b>Mã số thuế: ${esc(i.tax_code?.trim() || DOTS)}</b></div>
      </div>
      <div class="form">
        <div><b>Mẫu số S1a-HKD</b></div>
        <div>(Kèm theo Thông tư số 152/2025/TT-BTC ngày 31 tháng 12 năm 2025 của Bộ trưởng Bộ Tài chính)</div>
      </div>
    </div>
    <h1>SỔ DOANH THU BÁN HÀNG HÓA, DỊCH VỤ</h1>
    <div class="c">Địa điểm kinh doanh: ${esc(i.location?.trim() || i.address?.trim() || DOTS)}</div>
    <div class="c">Kỳ kê khai: ${esc(period)}</div>
    <div class="r">Đơn vị tính: ${esc(i.unit?.trim() || 'đồng')}</div>`;
  const thead = '<thead><tr><th style="width:30%">Ngày, tháng ghi sổ</th><th style="width:33.5%">Diễn giải</th><th>Số tiền</th></tr><tr><th>A</th><th>B</th><th>1</th></tr></thead>';
  const rows = b.rows.map((r) => `<tr><td class="c">${r.day.slice(8)}/${r.day.slice(5, 7)}</td><td class="c">${desc}</td><td class="n">${num(r.amount)}</td></tr>`);
  const pages: string[][] = [];
  for (let k = 0; k < Math.max(1, rows.length); k += ROWS_PER_PAGE) pages.push(rows.slice(k, k + ROWS_PER_PAGE));
  // Leave room for "Tổng cộng" and the signature on the last page.
  const last = pages[pages.length - 1];
  if (last.length > 13) pages.push(last.splice(13));
  const totalRow = `<tr><td></td><td class="c"><b>Tổng cộng</b></td><td class="n">${num(b.total)}</td></tr>`;
  const sign = `
    <div class="sign">
      <div>Ngày ${p2(signDate.getDate())} tháng ${p2(signDate.getMonth() + 1)} năm ${signDate.getFullYear()}</div>
      <div><b>NGƯỜI ĐẠI DIỆN HỘ KINH DOANH/CÁ NHÂN KINH DOANH</b></div>
      <div><i>(Ký, ghi rõ họ tên, đóng dấu (nếu có))</i></div>
      <div class="name">${esc(i.representative?.trim() || '')}</div>
    </div>`;
  const body = pages.map((pg, k) => `
    <section class="page">${header}
      <table>${thead}<tbody>${pg.join('')}${k === pages.length - 1 ? totalRow : ''}</tbody></table>
      ${k === pages.length - 1 ? sign : ''}
    </section>`).join('');
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>So doanh thu S1a-HKD ${esc(period)}</title>
<style>
  @page { size: A4 landscape; margin: 9mm 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'DejaVu Sans', Arial, 'Helvetica Neue', sans-serif; font-size: 10pt; color: #000; background: #e5e5e5; }
  .page { width: 277mm; min-height: 192mm; background: #fff; margin: 8mm auto; padding: 4mm 2mm; page-break-after: always; break-after: page; }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .top { display: flex; justify-content: space-between; gap: 12mm; margin: 2mm 2mm 0; }
  body { font-size: 10pt; }
  .who { line-height: 1.35; max-width: 52%; }
  .form { text-align: center; line-height: 1.35; max-width: 48%; }
  h1 { text-align: center; font-size: 14pt; margin: 5mm 0 2.5mm; }
  .c { text-align: center; } .r { text-align: right; } .n { text-align: right; }
  body > section > .c { margin: 1.5mm 0; font-size: 9.5pt; } body > section > .r { margin: 1.5mm 2mm 2.5mm; font-size: 9.5pt; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #000; padding: 0.6mm 1.6mm; font-size: 9pt; height: 6.1mm; }
  th { font-weight: 700; text-align: center; }
  .sign { width: 45%; margin: 5mm 0 0 auto; text-align: center; line-height: 1.4; font-size: 9.5pt; }
  .sign .name { margin-top: 16mm; font-weight: 700; }
  .sign { break-inside: avoid; }
  @media print { body { background: #fff; } .page { margin: 0; width: auto; min-height: 0; padding: 0; } }
</style></head><body>${body}</body></html>`;
}

export default function S1aBook() {
  const t = today();
  const [mode, setMode] = useState<'month' | 'quarter' | 'year'>('month');
  const [year, setYear] = useState(Number(t.slice(0, 4)));
  const [month, setMonth] = useState(Number(t.slice(5, 7)));
  const [q, setQ] = useState(Math.ceil(Number(t.slice(5, 7)) / 3));
  const [rowMode, setRowMode] = useState<'' | 'order' | 'day'>('');
  const [from, to] = mode === 'month' ? [`${year}-${p2(month)}-01`, `${year}-${p2(month)}-${lastDay(year, month)}`]
    : mode === 'quarter' ? [`${year}-${p2(q * 3 - 2)}-01`, `${year}-${p2(q * 3)}-${lastDay(year, q * 3)}`]
      : [`${year}-01-01`, `${year}-12-31`];
  const book = useLoad(() => get<Book>(`/api/reports/s1a?from=${from}&to=${to}${rowMode ? `&mode=${rowMode}` : ''}`), [from, to, rowMode]);
  const frame = useRef<HTMLIFrameElement>(null);
  const b = book.data;
  const period = periodLabel(mode, from, to);
  const html = b ? bookHtml(b, period, new Date()) : '';
  const missing = b && (!b.info.business_name || !b.info.address || !b.info.tax_code);

  const print = () => {
    const w = frame.current?.contentWindow;
    if (!w) return;
    w.focus();
    w.print();
  };
  const csv = () => {
    if (!b) return;
    const q2 = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const desc = b.info.description?.trim() || `Bán hàng tại cửa hàng ${b.outlet_name}`;
    const lines = [
      [`Hộ cá nhân kinh doanh: ${b.info.business_name ?? ''}`, '', 'Mẫu số S1a-HKD'],
      [`Địa chỉ: ${b.info.address ?? ''}`, '', '(Kèm theo Thông tư số 152/2025/TT-BTC ngày 31 tháng 12 năm 2025 của Bộ trưởng Bộ Tài chính)'],
      [`Mã số thuế: ${b.info.tax_code ?? ''}`],
      [], ['', 'SỔ DOANH THU BÁN HÀNG HÓA, DỊCH VỤ'],
      ['', `Địa điểm kinh doanh: ${b.info.location || b.info.address || ''}`], ['', `Kỳ kê khai: ${period}`], ['', '', `Đơn vị tính: ${b.info.unit || 'đồng'}`],
      ['Ngày, tháng ghi sổ', 'Diễn giải', 'Số tiền'], ['A', 'B', '1'],
      ...b.rows.map((r) => [`${r.day.slice(8)}/${r.day.slice(5, 7)}`, desc, r.amount]),
      ['', 'Tổng cộng', b.total],
    ];
    const blob = new Blob(['﻿' + lines.map((l) => l.map(q2).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `so-doanh-thu-S1a-HKD_${from}_${to}.csv`;
    a.click();
  };

  return (
    <Page title="Sổ doanh thu S1a-HKD" sub="Mẫu theo Thông tư 152/2025/TT-BTC">
      {missing && (
        <button className="banner danger" style={{ border: 0, width: '100%', textAlign: 'left' }} onClick={() => navigate('admin/settings')}>
          <Icon name="warn" size={18} /><span>Chưa điền đủ tên hộ kinh doanh, địa chỉ, mã số thuế. Chạm để điền ở Cài đặt › Thông tin hộ kinh doanh.</span>
        </button>
      )}
      <div className="chips" style={{ padding: 0 }}>
        {([['month', 'Tháng'], ['quarter', 'Quý'], ['year', 'Năm']] as const).map(([k, l]) => <button key={k} className={'chip' + (mode === k ? ' on' : '')} onClick={() => setMode(k)}>{l}</button>)}
      </div>
      <div className="row wrap">
        <select className="input" style={{ width: 120 }} value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[0, 1, 2].map((k) => Number(t.slice(0, 4)) - k).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        {mode === 'month' && <select className="input" style={{ width: 120 }} value={month} onChange={(e) => setMonth(Number(e.target.value))}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>Tháng {i + 1}</option>)}</select>}
        {mode === 'quarter' && <select className="input" style={{ width: 120 }} value={q} onChange={(e) => setQ(Number(e.target.value))}>{[1, 2, 3, 4].map((x) => <option key={x} value={x}>Quý {x}</option>)}</select>}
      </div>
      <Segmented value={rowMode || b?.mode || 'order'} onChange={(v) => setRowMode(v)} options={[['order', 'Mỗi đơn một dòng'], ['day', 'Gộp theo ngày']]} />
      <Loading error={book.error} loading={book.loading && !b} />
      {b && (
        <>
          <div className="row wrap between">
            <span className="small muted">{b.rows.length} dòng · {(() => { const n = Math.max(1, Math.ceil(b.rows.length / ROWS_PER_PAGE)); const lastN = b.rows.length - (n - 1) * ROWS_PER_PAGE; return lastN > 13 ? n + 1 : n; })()} trang · Tổng cộng <b className="mono" style={{ color: 'var(--text)' }}>{num(b.total)}</b> đồng</span>
            <div className="row">
              <button className="btn" onClick={csv}>Excel (CSV)</button>
              <button className="btn primary" onClick={print} disabled={!b.rows.length}><Icon name="printer" size={18} />In / Lưu PDF</button>
            </div>
          </div>
          <p className="tiny faint" style={{ margin: 0 }}>Số tiền là doanh thu thực thu của đơn đã thanh toán (sau mua 1 tặng 1, ly mời); không gồm tip và đơn huỷ. Khi in, chọn "Lưu dưới dạng PDF" và khổ A4 ngang. Đối chiếu với kế toán trước khi nộp.</p>
          <iframe ref={frame} title="Sổ doanh thu S1a-HKD" srcDoc={html} style={{ width: '100%', height: 640, border: '1px solid var(--border)', borderRadius: 12, background: '#e5e5e5' }} />
        </>
      )}
    </Page>
  );
}

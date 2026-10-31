// Revenue reports by month / quarter / year for the accountant, CSV export (opens in Excel), YTD vs threshold.
import { useState } from 'react';
import { fmtDay, vnd } from '../../shared/util';
import { get, getStaffSession } from '../lib/api';
import { kv } from '../lib/db';
import { today, toast } from '../lib/store';
import { Loading, Page, pct, useLoad } from './common';

function lastDay(y: number, m: number) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
const p2 = (n: number) => String(n).padStart(2, '0');

export default function Reports() {
  const t = today();
  const [mode, setMode] = useState<'month' | 'quarter' | 'year'>('month');
  const [year, setYear] = useState(Number(t.slice(0, 4)));
  const [month, setMonth] = useState(Number(t.slice(5, 7)));
  const [q, setQ] = useState(Math.ceil(Number(t.slice(5, 7)) / 3));
  const [from, to] = mode === 'month' ? [`${year}-${p2(month)}-01`, `${year}-${p2(month)}-${lastDay(year, month)}`]
    : mode === 'quarter' ? [`${year}-${p2(q * 3 - 2)}-01`, `${year}-${p2(q * 3)}-${lastDay(year, q * 3)}`]
      : [`${year}-01-01`, `${year}-12-31`];
  const rep = useLoad(() => get<{ rows: any[]; totals: any; voids: any[] }>(`/api/reports/revenue?from=${from}&to=${to}`), [from, to]);
  const ytd = useLoad(() => get<{ year: string; revenue: number; threshold: number; pct: number | null; projected_year: number; warn: boolean }>('/api/reports/ytd'));

  const download = async () => {
    const token = await kv.get<string>('deviceToken');
    const res = await fetch(`/api/reports/revenue?from=${from}&to=${to}&format=csv`, { headers: { authorization: 'Bearer ' + token, 'x-staff-session': getStaffSession() } });
    if (!res.ok) return toast('Xuất file thất bại', true);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `doanh-thu_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const tt = rep.data?.totals;

  return (
    <Page title="Báo cáo doanh thu" sub="Dùng cho kế toán — xác nhận số liệu thuế với kế toán">
      {ytd.data && (
        <div className="card col gap12">
          <div className="row between"><b>Doanh thu lũy kế {ytd.data.year}</b><b className="mono">{vnd(ytd.data.revenue)}</b></div>
          {ytd.data.threshold ? (
            <>
              <div className={'progress' + (ytd.data.warn ? ' danger' : '')}><div style={{ width: Math.min(100, ytd.data.pct ?? 0) + '%' }} /></div>
              <div className="small muted">{pct(ytd.data.pct)} của ngưỡng {vnd(ytd.data.threshold)} · dự kiến cả năm {vnd(ytd.data.projected_year)}</div>
              {ytd.data.warn && <div className="banner danger">Dự kiến sắp vượt ngưỡng đã cài. Hỏi kế toán về nghĩa vụ thuế và hoá đơn điện tử.</div>}
            </>
          ) : <div className="small muted">Chưa cài ngưỡng doanh thu năm (Cài đặt › Thuế).</div>}
        </div>
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
        <button className="btn" onClick={download}>Xuất Excel (CSV)</button>
        <button className="btn" onClick={() => window.print()}>In / PDF</button>
      </div>
      <Loading error={rep.error} loading={rep.loading && !rep.data} />
      {tt && (
        <div className="stats">
          <div className="stat"><div className="small muted">Doanh thu thuần</div><div className="v">{vnd(tt.net)}</div></div>
          <div className="stat"><div className="small muted">Số đơn</div><div className="v">{tt.orders}</div></div>
          <div className="stat"><div className="small muted">Khuyến mãi + giảm giá</div><div className="v">{vnd(tt.promo + tt.discount)}</div></div>
          <div className="stat"><div className="small muted">Đơn huỷ</div><div className="v">{tt.voids} · {vnd(tt.void_value, false)}</div></div>
        </div>
      )}
      {rep.data && (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Ngày</th><th className="num">Đơn</th><th className="num">Gộp</th><th className="num">KM</th><th className="num">Thuần</th><th className="num">Tiền mặt</th><th className="num">CK</th><th className="num">Thẻ</th><th className="num">Huỷ</th></tr></thead>
            <tbody>
              {rep.data.rows.map((r) => <tr key={r.day}><td>{fmtDay(r.day)}</td><td className="num">{r.orders}</td><td className="num">{vnd(r.gross, false)}</td><td className="num">{vnd(r.promo + r.discount, false)}</td><td className="num">{vnd(r.net, false)}</td><td className="num">{vnd(r.cash, false)}</td><td className="num">{vnd(r.vietqr, false)}</td><td className="num">{vnd(r.card, false)}</td><td className="num">{r.voids || ''}</td></tr>)}
              {tt && <tr><td><b>Tổng</b></td><td className="num"><b>{tt.orders}</b></td><td className="num"><b>{vnd(tt.gross, false)}</b></td><td className="num"><b>{vnd(tt.promo + tt.discount, false)}</b></td><td className="num"><b>{vnd(tt.net, false)}</b></td><td className="num"><b>{vnd(tt.cash, false)}</b></td><td className="num"><b>{vnd(tt.vietqr, false)}</b></td><td className="num"><b>{vnd(tt.card, false)}</b></td><td className="num"><b>{tt.voids}</b></td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {rep.data && rep.data.voids.length > 0 && (
        <>
          <div className="section-title">Đơn huỷ</div>
          <div className="list">{rep.data.voids.map((v: any) => <div key={v.short_code + v.business_day} className="li"><span className="grow">{fmtDay(v.business_day)} #{v.short_code} · {v.void_reason} <span className="small muted">({v.voided_by_name}, duyệt {v.approved_by_name})</span></span><span className="mono">{vnd(v.total, false)}</span></div>)}</div>
        </>
      )}
    </Page>
  );
}

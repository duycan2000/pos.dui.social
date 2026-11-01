// Quản trị › Phân tích: the week/month verdict (profit or loss, warning signs) followed by charts.
import { useState } from 'react';
import { addDays, fmtDay, vnd, vndShort } from '../../shared/util';
import { get } from '../lib/api';
import { navigate, today } from '../lib/store';
import { Icon, Segmented } from '../ui';
import { Bars, Heat, PairBars, Ranked, ShareBar } from './charts';
import { Loading, Page, useLoad } from './common';

type Level = 'good' | 'info' | 'warn' | 'alert';
interface Insights {
  period: 'week' | 'month'; from: string; to: string; end: string; partial: boolean; prev_from: string; prev_to: string;
  summary: { revenue: number; orders: number; aov: number; cogs: number; opex: number; labour_estimate: number; profit: number; margin: number; prev_revenue: number; prev_profit: number };
  findings: { level: Level; area: string; title: string; text: string; link?: string }[];
  counts: { alert: number; warn: number };
}
interface An {
  from: string; to: string; prev_from: string;
  daily: { day: string; revenue: number; orders: number; cogs: number }[];
  prev_daily: { day: string; revenue: number }[];
  months: { month: string; revenue: number; cogs: number; opex: number; profit: number; orders: number }[];
  heat: { dow: number; h: number; s: number; n: number }[];
  methods: { day: string; method: string; s: number }[];
  items: { name: string; qty: number; revenue: number; cost: number }[];
  staff: { name: string; orders: number; revenue: number }[];
}

const ICON: Record<Level, string> = { alert: '!', warn: '!', info: 'i', good: '✓' };
const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

function monthStartOf(d: string) { return d.slice(0, 8) + '01'; }
function weekStartOf(d: string) { const x = new Date(d + 'T00:00:00Z'); return addDays(d, -((x.getUTCDay() + 6) % 7)); }

export default function Analytics() {
  const t = today();
  const [period, setPeriod] = useState<'week' | 'month'>('month');
  const [anchor, setAnchor] = useState(t);
  const ins = useLoad(() => get<Insights>(`/api/fin/insights?period=${period}&date=${anchor}`), [period, anchor]);
  const d = ins.data;
  const an = useLoad(() => (d ? get<An>(`/api/fin/analytics?from=${d.from}&to=${d.to}`) : Promise.resolve(null)), [d?.from, d?.to]);
  const step = (dir: -1 | 1) => {
    if (period === 'week') setAnchor(addDays(weekStartOf(anchor), 7 * dir));
    else { const [y, m] = anchor.split('-').map(Number); setAnchor(new Date(Date.UTC(y, m - 1 + dir, 1)).toISOString().slice(0, 10)); }
  };
  const isCurrent = period === 'week' ? weekStartOf(anchor) === weekStartOf(t) : monthStartOf(anchor) === monthStartOf(t);
  const title = d ? (period === 'week' ? `Tuần ${fmtDay(d.from).slice(0, 5)} – ${fmtDay(d.end).slice(0, 5)}` : `Tháng ${d.from.slice(5, 7)}/${d.from.slice(0, 4)}`) : '';
  const s = d?.summary;
  const head = d?.findings[0];

  return (
    <Page title="Phân tích & cảnh báo" sub={title}>
      <div className="row wrap between">
        <Segmented value={period} onChange={(v) => { setPeriod(v); setAnchor(t); }} options={[['week', 'Tuần'], ['month', 'Tháng']]} />
        <div className="row">
          <button className="btn sm" onClick={() => step(-1)} aria-label="Kỳ trước"><Icon name="back" size={16} /></button>
          <b style={{ minWidth: 120, textAlign: 'center' }}>{title}</b>
          <button className="btn sm" onClick={() => step(1)} disabled={isCurrent} aria-label="Kỳ sau"><Icon name="chevron" size={16} /></button>
        </div>
      </div>
      <Loading error={ins.error} loading={ins.loading && !d} />
      {d && s && head && (
        <>
          <div className={'verdict ' + (s.revenue || s.opex ? (s.profit >= 0 ? 'good' : 'alert') : 'info')}>
            <span className="small muted">{d.partial ? `Tạm tính đến hôm nay (${fmtDay(d.to)})` : 'Kết quả cả kỳ'}</span>
            <span className="big" style={{ color: s.profit >= 0 ? 'var(--ok)' : 'var(--danger)' }}>{s.profit >= 0 ? 'Lãi ' : 'Lỗ '}{vnd(Math.abs(s.profit))}</span>
            <span className="small">{head.text}</span>
            <div className="stats" style={{ marginTop: 8 }}>
              <div className="stat"><div className="small muted">Doanh thu</div><div className="v">{vndShort(s.revenue)}</div><div className={'d ' + (s.revenue >= s.prev_revenue ? 'ok' : 'danger')}>{s.prev_revenue ? `${s.revenue >= s.prev_revenue ? '▲' : '▼'} ${Math.abs(Math.round(((s.revenue - s.prev_revenue) / s.prev_revenue) * 100))}% kỳ trước` : '—'}</div></div>
              <div className="stat"><div className="small muted">Đơn · TB/đơn</div><div className="v">{s.orders} · {vndShort(s.aov)}</div></div>
              <div className="stat"><div className="small muted">Giá vốn</div><div className="v">{vndShort(s.cogs)}</div></div>
              <div className="stat"><div className="small muted">Chi phí{s.labour_estimate ? ' + lương ước tính' : ''}</div><div className="v">{vndShort(s.opex + s.labour_estimate)}</div></div>
            </div>
          </div>

          <div className="section-title">Kết luận {period === 'week' ? 'tuần' : 'tháng'} {d.counts.alert ? `· ${d.counts.alert} cảnh báo` : ''}{d.counts.warn ? ` · ${d.counts.warn} cần chú ý` : ''}</div>
          <div className="list">
            {d.findings.slice(1).map((f, i) => (
              <button key={i} className={'finding ' + f.level} onClick={() => f.link && navigate(f.link)} style={{ cursor: f.link ? 'pointer' : 'default' }}>
                <span className="ic">{ICON[f.level]}</span>
                <span className="t"><span className="area">{f.area}</span>{f.title}</span>
                <span className="x">{f.text}</span>
              </button>
            ))}
          </div>
          <p className="tiny faint" style={{ margin: 0 }}>Cảnh báo là tín hiệu để kiểm tra, không phải kết luận ai gian lận. Ngưỡng dựa trên kinh nghiệm chung của quán bar; chỉnh mục tiêu giá vốn trong Cài đặt.</p>
        </>
      )}

      <Loading error={an.error} loading={!!d && an.loading && !an.data} />
      {an.data && <ChartsBlock a={an.data} />}
    </Page>
  );
}

function ChartsBlock({ a }: { a: An }) {
  // Fill missing days so the axis is continuous.
  const days: string[] = [];
  for (let x = a.from; x <= a.to; x = addDays(x, 1)) days.push(x);
  const byDay = new Map(a.daily.map((r) => [r.day, r]));
  const prevByDay = new Map(a.prev_daily.map((r) => [r.day, r.revenue]));
  const daily = days.map((day) => {
    const r = byDay.get(day);
    const dow = DOW[new Date(day + 'T00:00:00Z').getUTCDay()];
    return {
      key: day, label: day.slice(8), value: r?.revenue ?? 0,
      tip: <><b>{dow} {fmtDay(day)}</b><br />{vnd(r?.revenue ?? 0)} · {r?.orders ?? 0} đơn{r?.revenue && r.cogs ? <><br />Lãi gộp {vnd(r.revenue - r.cogs)}</> : null}</>,
    };
  });
  const compare = days.map((_, i) => prevByDay.get(addDays(a.prev_from, i)) ?? 0);
  // Average by weekday.
  const dowSum = [0, 0, 0, 0, 0, 0, 0];
  const dowCnt = [0, 0, 0, 0, 0, 0, 0];
  for (const day of days) { const w = new Date(day + 'T00:00:00Z').getUTCDay(); dowSum[w] += byDay.get(day)?.revenue ?? 0; dowCnt[w]++; }
  const dowBars = [1, 2, 3, 4, 5, 6, 0].map((w) => ({ key: String(w), label: DOW[w], value: dowCnt[w] ? Math.round(dowSum[w] / dowCnt[w]) : 0, tip: <><b>{DOW[w]}</b><br />Trung bình {vnd(dowCnt[w] ? dowSum[w] / dowCnt[w] : 0)}/ngày</> }));
  const methods = ['cash', 'vietqr', 'card'].map((m) => ({ name: m === 'cash' ? 'Tiền mặt' : m === 'vietqr' ? 'Chuyển khoản' : 'Thẻ', value: a.methods.filter((x) => x.method === m).reduce((s, x) => s + x.s, 0) }));
  return (
    <>
      <div className="section-title">Biểu đồ</div>
      <div className="chartgrid">
        <div className="chartcard wide">
          <h3>Doanh thu theo ngày</h3>
          <div className="sub">Chạm vào cột để xem chi tiết · nét đứt là cùng ngày kỳ trước</div>
          <Bars data={daily} compare={compare} compareLabel="Kỳ trước" />
        </div>
        <div className="chartcard wide">
          <h3>12 tháng gần nhất: doanh thu và lãi</h3>
          <div className="sub">Lãi = doanh thu − giá vốn − chi phí đã ghi (chưa gồm lương ước tính)</div>
          <PairBars names={['Doanh thu', 'Lãi']} data={a.months.map((m) => ({ key: m.month, label: m.month.slice(5) + '/' + m.month.slice(2, 4), a: m.revenue, b: m.profit }))} />
        </div>
        <div className="chartcard">
          <h3>Giờ đông khách</h3>
          <div className="sub">Doanh thu theo thứ và giờ trong kỳ</div>
          <Heat cells={a.heat} />
        </div>
        <div className="chartcard">
          <h3>Trung bình theo thứ</h3>
          <div className="sub">Doanh thu trung bình mỗi ngày</div>
          <Bars data={dowBars} height={180} labelEvery={1} />
        </div>
        <div className="chartcard">
          <h3>Cách khách trả tiền</h3>
          <ShareBar parts={methods} />
        </div>
        <div className="chartcard">
          <h3>Doanh thu theo nhân viên thu</h3>
          {a.staff.length ? <Ranked rows={a.staff.map((x) => ({ name: x.name, value: x.revenue, note: `${x.orders} đơn` }))} /> : <p className="small muted">Chưa có dữ liệu.</p>}
        </div>
        <div className="chartcard wide">
          <h3>Món mang lại nhiều doanh thu nhất</h3>
          {a.items.length ? <Ranked rows={a.items.map((x) => ({ name: x.name, value: x.revenue, note: `${x.qty} ly${x.revenue && x.cost ? ` · giá vốn ${Math.round((x.cost / x.revenue) * 100)}%` : ''}` }))} /> : <p className="small muted">Chưa có dữ liệu.</p>}
        </div>
      </div>
    </>
  );
}

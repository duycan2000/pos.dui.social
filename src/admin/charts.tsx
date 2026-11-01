// Small SVG charts for the back office (no chart library: keeps the app light and works offline).
// Dark surface, one amber hue for single-series magnitude, categorical slots blue / orange / aqua
// (validated dark steps), thin marks with rounded data-ends, recessive grid, tap/hover tooltips.
import { Fragment, type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { vnd, vndShort } from '../../shared/util';

export const SERIES = ['#3987e5', '#d95926', '#199e70'];
const ACCENT = 'var(--accent)';

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** Real pixel width of the chart box, so SVG text is never stretched. */
function useWidth(ref: RefObject<HTMLDivElement>) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, [ref]);
  return w || 360;
}

/** Tooltip that follows the hovered/tapped mark inside the chart box. */
function useTip() {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; body: ReactNode } | null>(null);
  const show = (e: { clientX: number; clientY: number }, body: ReactNode) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setTip({ x: e.clientX - r.left, y: e.clientY - r.top, body });
  };
  const el = tip && (
    <div className="ctip" style={{ left: Math.max(8, Math.min(tip.x, (box.current?.clientWidth ?? 300) - 8)), top: tip.y }}>{tip.body}</div>
  );
  return { box, show, hide: () => setTip(null), el };
}

export interface BarDatum { key: string; label: string; value: number; tip?: ReactNode; muted?: boolean }

/** Vertical bars on one VND axis; optional comparison line (e.g. same days last period) on the same axis. */
export function Bars({ data, compare, compareLabel, height = 220, color = ACCENT, labelEvery }: {
  data: BarDatum[]; compare?: (number | null)[]; compareLabel?: string; height?: number; color?: string; labelEvery?: number;
}) {
  const { box, show, hide, el } = useTip();
  const W = useWidth(box);
  const H = height;
  const pad = { l: 44, r: 8, t: 10, b: 26 };
  const vals = [...data.map((d) => d.value), ...(compare ?? []).map((v) => v ?? 0)];
  const min = Math.min(0, ...vals);
  const max = niceMax(Math.max(...vals, 1));
  const lo = min < 0 ? -niceMax(-min) : 0;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - (v - lo) / (max - lo));
  const n = Math.max(1, data.length);
  const bw = (W - pad.l - pad.r) / n;
  const barW = Math.max(2, Math.min(36, bw - 2));
  const every = labelEvery ?? Math.max(1, Math.ceil(n / Math.max(4, Math.floor(W / 52))));
  const ticks = [lo, lo + (max - lo) / 2, max].filter((v, i, a) => a.indexOf(v) === i);
  if (lo < 0 && !ticks.includes(0)) ticks.push(0);
  return (
    <div ref={box} className="chart" onPointerLeave={hide}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block' }} role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={t === 0 ? 1.5 : 1} />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="axis">{vndShort(Math.round(t))}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.l + i * bw + (bw - barW) / 2;
          const top = y(Math.max(0, d.value));
          const h = Math.max(d.value ? 1.5 : 0, Math.abs(y(d.value) - y(0)));
          const r = Math.min(4, barW / 2, h);
          const up = d.value >= 0;
          // Rounded data-end, square at the baseline.
          const path = up
            ? `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z`
            : `M${x},${y(0)} V${y(0) + h - r} Q${x},${y(0) + h} ${x + r},${y(0) + h} H${x + barW - r} Q${x + barW},${y(0) + h} ${x + barW},${y(0) + h - r} V${y(0)} Z`;
          return (
            <g key={d.key}>
              <rect x={pad.l + i * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent"
                onPointerMove={(e) => show(e, d.tip ?? <><b>{d.label}</b><br />{vnd(d.value)}</>)} onClick={(e) => show(e, d.tip ?? <><b>{d.label}</b><br />{vnd(d.value)}</>)} />
              <path d={path} fill={d.value < 0 ? 'var(--danger)' : color} opacity={d.muted ? 0.45 : 1} pointerEvents="none" />
              {i % every === 0 && <text x={pad.l + i * bw + bw / 2} y={H - 8} textAnchor="middle" className="axis">{d.label}</text>}
            </g>
          );
        })}
        {compare && compare.length > 1 && (
          <polyline fill="none" stroke="var(--text)" strokeOpacity={0.55} strokeWidth={2} strokeDasharray="5 4" pointerEvents="none"
            points={compare.map((v, i) => (v == null ? null : `${pad.l + i * bw + bw / 2},${y(v)}`)).filter(Boolean).join(' ')} />
        )}
      </svg>
      {compare && compareLabel && (
        <div className="legend-row"><span><i style={{ background: typeof color === 'string' ? color : ACCENT }} />Kỳ này</span><span><i className="dash" />{compareLabel}</span></div>
      )}
      {el}
    </div>
  );
}

/** Two series side by side per category (same VND axis): e.g. revenue and profit per month. */
export function PairBars({ data, names, height = 220 }: { data: { key: string; label: string; a: number; b: number }[]; names: [string, string]; height?: number }) {
  const { box, show, hide, el } = useTip();
  const W = useWidth(box);
  const H = height;
  const pad = { l: 44, r: 8, t: 10, b: 26 };
  const vals = data.flatMap((d) => [d.a, d.b]);
  const max = niceMax(Math.max(1, ...vals));
  const minV = Math.min(0, ...vals);
  const lo = minV < 0 ? -niceMax(-minV) : 0;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - (v - lo) / (max - lo));
  const n = Math.max(1, data.length);
  const bw = (W - pad.l - pad.r) / n;
  const barW = Math.max(3, Math.min(22, (bw - 8) / 2));
  const ticks = [...new Set([lo, 0, max / 2, max])];
  const bar = (x: number, v: number, fill: string) => {
    const top = y(Math.max(0, v));
    const h = Math.max(v ? 1.5 : 0, Math.abs(y(v) - y(0)));
    return <rect x={x} y={top} width={barW} height={h} rx={Math.min(3, barW / 2)} fill={v < 0 ? 'var(--danger)' : fill} pointerEvents="none" />;
  };
  return (
    <div ref={box} className="chart" onPointerLeave={hide}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block' }} role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={t === 0 ? 1.5 : 1} />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="axis">{vndShort(Math.round(t))}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = pad.l + i * bw + bw / 2;
          const tip = <><b>{d.label}</b><br />{names[0]}: {vnd(d.a)}<br />{names[1]}: {vnd(d.b)}</>;
          return (
            <g key={d.key}>
              <rect x={pad.l + i * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" onPointerMove={(e) => show(e, tip)} onClick={(e) => show(e, tip)} />
              {bar(cx - barW - 1, d.a, SERIES[0])}
              {bar(cx + 1, d.b, SERIES[2])}
              <text x={cx} y={H - 8} textAnchor="middle" className="axis">{d.label}</text>
            </g>
          );
        })}
      </svg>
      <div className="legend-row"><span><i style={{ background: SERIES[0] }} />{names[0]}</span><span><i style={{ background: SERIES[2] }} />{names[1]} (đỏ = lỗ)</span></div>
      {el}
    </div>
  );
}

/** Day-of-week × hour heat map, one hue light → dark by revenue. */
export function Heat({ cells }: { cells: { dow: number; h: number; s: number; n: number }[] }) {
  const { box, show, hide, el } = useTip();
  if (!cells.length) return <p className="small muted">Chưa có dữ liệu.</p>;
  // Order hours from the bar's opening (first hour with sales after 06:00) through the night.
  const hours = [...new Set(cells.map((c) => c.h))].sort((a, b) => ((a + 18) % 24) - ((b + 18) % 24));
  const span: number[] = [];
  const first = (hours[0] + 18) % 24;
  const last = (hours[hours.length - 1] + 18) % 24;
  for (let k = first; k <= last; k++) span.push((k + 6) % 24);
  const max = Math.max(...cells.map((c) => c.s), 1);
  const days = [1, 2, 3, 4, 5, 6, 0];
  const name = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  return (
    <div ref={box} className="chart heat" onPointerLeave={hide}>
      <div className="heatgrid" style={{ gridTemplateColumns: `32px repeat(${span.length}, minmax(18px, 1fr))` }}>
        <span />
        {span.map((h) => <span key={h} className="axis hd">{h}h</span>)}
        {days.map((d) => (
          <Fragment key={d}>
            <span className="axis">{name[d]}</span>
            {span.map((h) => {
              const c = cells.find((x) => x.dow === d && x.h === h);
              const v = c ? c.s / max : 0;
              const tip = <><b>{name[d]} {h}:00–{(h + 1) % 24}:00</b><br />{c ? `${vnd(c.s)} · ${c.n} đơn` : 'Không có đơn'}</>;
              return <span key={d + '-' + h} className="cell" style={{ background: v ? `rgba(245,165,36,${0.12 + v * 0.88})` : 'var(--surface)' }}
                onPointerMove={(e) => show(e, tip)} onClick={(e) => show(e, tip)} />;
            })}
          </Fragment>
        ))}
      </div>
      <div className="legend-row"><span>Ít</span><span className="ramp" /><span>Nhiều doanh thu</span></div>
      {el}
    </div>
  );
}

/** Share of a whole as one segmented bar, labelled. */
export function ShareBar({ parts }: { parts: { name: string; value: number }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return <p className="small muted">Chưa có dữ liệu.</p>;
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="sharebar">{parts.filter((p) => p.value > 0).map((p, i) => <span key={p.name} style={{ flex: p.value, background: SERIES[parts.indexOf(p) % 3] }} title={`${p.name}: ${vnd(p.value)}`} data-i={i} />)}</div>
      <div className="legend-row" style={{ justifyContent: 'flex-start' }}>
        {parts.map((p, i) => <span key={p.name}><i style={{ background: SERIES[i % 3] }} />{p.name} <b>{Math.round((p.value / total) * 100)}%</b> <span className="faint">{vndShort(p.value)}</span></span>)}
      </div>
    </div>
  );
}

/** Ranked horizontal bars (top items, staff). */
export function Ranked({ rows }: { rows: { name: string; value: number; note?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="ranked">
      {rows.map((r) => (
        <div key={r.name} className="rk">
          <span className="nm ellipsis">{r.name}</span>
          <span className="track"><span style={{ width: `${(r.value / max) * 100}%` }} /></span>
          <span className="v mono">{vndShort(r.value)}</span>
          {r.note && <span className="tiny faint note">{r.note}</span>}
        </div>
      ))}
    </div>
  );
}

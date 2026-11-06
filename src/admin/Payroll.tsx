// Lương tháng (owner only): hours × hourly rate + night premium + tips + allowances/bonus − advances/deductions.
// Numbers are live until the owner marks a person as paid; then the payslip is frozen and booked as a salary expense.
import { useState } from 'react';
import type { PayrollRow, TipMode } from '../../shared/payroll';
import { fmtMinutes } from '../../shared/timesheet';
import { parseSettings, vnd } from '../../shared/util';
import { del, get, post, put } from '../lib/api';
import type { PLine } from '../lib/printer';
import { tryPrint } from '../lib/receipts';
import { navigate, toast, useStore } from '../lib/store';
import { Confirm, Empty, Icon, MoneyInput, Segmented, Sheet } from '../ui';
import { Loading, Page, run, useLoad } from './common';

type Row = PayrollRow & { paid: { at: number; method: string | null; net: number } | null; live_net: number };
interface Adj { id: string; staff_id: string; kind: 'allowance' | 'bonus' | 'advance' | 'deduction'; amount: number; note: string | null; created_at: number }
interface Adv { id: string; for_staff_id: string; amount: number; note: string | null; business_day: string }
interface Data { month: string; from: string; to: string; tip_mode: TipMode; night_pct: number; rows: Row[]; adjustments: Adj[]; advances: Adv[] }

const KIND: Record<Adj['kind'], string> = { allowance: 'Phụ cấp', bonus: 'Thưởng', advance: 'Ứng lương', deduction: 'Khấu trừ' };
const METHOD: Record<string, string> = { owner: 'tiền mặt', bank: 'chuyển khoản' };

function thisMonth(tz: number) {
  return new Date(Date.now() + tz * 60000).toISOString().slice(0, 7);
}
function shift(month: string, n: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
const label = (month: string) => `Tháng ${Number(month.slice(5))}/${month.slice(0, 4)}`;

export default function Payroll() {
  const cfg = useStore((s) => s.config)!;
  const [month, setMonth] = useState(() => thisMonth(cfg.outlet.tz_offset_min));
  const data = useLoad(() => get<Data>(`/api/payroll?month=${month}`), [month]);
  const [adding, setAdding] = useState<{ row: Row; plus: boolean } | null>(null);
  const [paying, setPaying] = useState<Row | null>(null);
  const [unpay, setUnpay] = useState<Row | null>(null);
  const d = data.data;
  const rows = d?.rows ?? [];
  const total = rows.reduce((a, r) => a + r.net, 0);
  const paidTotal = rows.filter((r) => r.paid).reduce((a, r) => a + r.net, 0);

  const setTipMode = async (m: TipMode) => {
    const o = await get<{ settings_json: string | null }>('/api/admin/outlet');
    const st = parseSettings<Record<string, unknown>>(o.settings_json);
    await run(() => put('/api/admin/outlet', { settings_json: JSON.stringify({ ...st, payroll_tips: m }) }), 'Đã đổi cách tính tip');
    data.reload();
  };
  const csv = () => {
    const head = ['Nhân viên', 'Giờ làm', 'Giờ đêm', 'Lương giờ', 'Lương theo giờ', 'Phụ cấp đêm', 'Tip', 'Phụ cấp', 'Thưởng', 'Ứng', 'Khấu trừ', 'Thực nhận', 'Đã trả'];
    const lines = rows.map((r) => [r.name, (r.minutes / 60).toFixed(2), (r.night_minutes / 60).toFixed(2), r.rate, r.base, r.night_pay, r.tips, r.allowance, r.bonus, r.advance, r.deduction, r.net, r.paid ? new Date(r.paid.at).toLocaleDateString('vi-VN') : '']);
    const text = '﻿' + [head, ...lines].map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = `bang-luong-${month}.csv`;
    a.click();
  };

  return (
    <Page title="Lương tháng" sub={d ? `${d.from.slice(8)}/${d.from.slice(5, 7)} – ${d.to.slice(8)}/${d.to.slice(5, 7)}` : ''}
      right={rows.length ? <button className="btn sm" onClick={csv}>Xuất Excel</button> : undefined}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button className="iconbtn" aria-label="Tháng trước" onClick={() => setMonth(shift(month, -1))}><Icon name="back" /></button>
        <b>{label(month)}</b>
        <button className="iconbtn" aria-label="Tháng sau" disabled={month >= thisMonth(cfg.outlet.tz_offset_min)} onClick={() => setMonth(shift(month, 1))}><Icon name="chevron" /></button>
      </div>
      {d && (
        <div className="card col" style={{ gap: 8 }}>
          <div className="row between"><span className="muted small">Tổng thực nhận</span><b className="mono big">{vnd(total)}</b></div>
          <div className="row between small"><span className="muted">Đã trả</span><span className="mono ok">{vnd(paidTotal)}</span></div>
          <div className="row between small"><span className="muted">Còn phải trả</span><span className="mono">{vnd(total - paidTotal)}</span></div>
          <div className="col" style={{ gap: 6, marginTop: 4 }}>
            <span className="tiny muted">Tip của khách</span>
            <Segmented value={d.tip_mode} onChange={(v) => setTipMode(v as TipMode)} options={[['by_staff', 'Ai bán người đó'], ['pool_hours', 'Chia theo giờ làm'], ['none', 'Không tính']]} />
          </div>
          <span className="tiny faint">Lương giờ và phụ cấp ca đêm ({d.night_pct}%) chỉnh ở Nhân viên và Cài đặt › Giờ làm. Ứng lương lấy từ két (Thu/chi két › Ứng lương) tự trừ vào đây.</span>
        </div>
      )}
      <Loading error={data.error} loading={data.loading && !d} />
      {d && !rows.length && <Empty>Chưa có giờ công trong {label(month).toLowerCase()}.</Empty>}
      {rows.map((r) => {
        const adj = (d?.adjustments ?? []).filter((a) => a.staff_id === r.staff_id);
        const adv = (d?.advances ?? []).filter((a) => a.for_staff_id === r.staff_id);
        const line = (k: string, v: number, sign = '', cls = '') => v ? <div className="kv small"><span className="muted">{k}</span><span className={'mono ' + cls}>{sign}{vnd(v, false)}</span></div> : null;
        return (
          <div key={r.staff_id} className="card col" style={{ gap: 4 }}>
            <div className="row between">
              <b>{r.name}</b>
              {r.paid ? <span className="badge ok">Đã trả {new Date(r.paid.at).toLocaleDateString('vi-VN')}{r.paid.method ? ` · ${METHOD[r.paid.method] ?? r.paid.method}` : ''}</span> : <span className="badge muted">Chưa trả</span>}
            </div>
            <span className="small muted">{fmtMinutes(r.minutes)} · {r.shifts} ca{r.night_minutes ? ` · đêm ${fmtMinutes(r.night_minutes)}` : ''} · {r.rate ? `${vnd(r.rate)}/giờ` : 'chưa đặt lương giờ'}</span>
            {r.open_entries > 0 && (
              <button className="banner danger" style={{ border: 0, textAlign: 'left', marginTop: 4 }} onClick={() => navigate('admin/time')}>
                <Icon name="warn" size={16} /><span>{r.open_entries} ca chưa chấm ra — chưa tính. Chạm để sửa trong Giờ làm.</span>
              </button>
            )}
            <div className="col mt8" style={{ gap: 0 }}>
              {line('Lương theo giờ', r.base)}
              {line(`Phụ cấp ca đêm`, r.night_pay, '+')}
              {line('Tip', r.tips, '+')}
              {line('Phụ cấp', r.allowance, '+')}
              {line('Thưởng', r.bonus, '+')}
              {line('Ứng lương', r.advance, '−', 'danger')}
              {line('Khấu trừ', r.deduction, '−', 'danger')}
              <div className="kv total"><span>Thực nhận</span><span className="mono">{vnd(r.net)}</span></div>
              {r.paid && r.live_net !== r.net && <span className="tiny" style={{ color: 'var(--warn, #f59e0b)' }}>Giờ công đã thay đổi sau khi trả (hiện tính ra {vnd(r.live_net)}). Huỷ "đã trả" rồi trả lại nếu cần.</span>}
            </div>
            {(adj.length > 0 || adv.length > 0) && (
              <div className="col mt8" style={{ gap: 2 }}>
                {adj.map((a) => (
                  <div key={a.id} className="row between tiny">
                    <span className="muted">{KIND[a.kind]}{a.note ? ` · ${a.note}` : ''}</span>
                    <span className="row" style={{ gap: 4 }}>
                      <span className="mono">{a.kind === 'advance' || a.kind === 'deduction' ? '−' : '+'}{vnd(a.amount, false)}</span>
                      {!r.paid && <button className="iconbtn ghost" style={{ width: 26, height: 26 }} aria-label="Xoá" onClick={async () => { await run(() => del(`/api/payroll/adjust/${a.id}`)); data.reload(); }}><Icon name="close" size={12} /></button>}
                    </span>
                  </div>
                ))}
                {adv.map((a) => (
                  <div key={a.id} className="row between tiny"><span className="muted">Ứng từ két {a.business_day.slice(8)}/{a.business_day.slice(5, 7)}{a.note ? ` · ${a.note}` : ''}</span><span className="mono">−{vnd(a.amount, false)}</span></div>
                ))}
              </div>
            )}
            <div className="row wrap mt8" style={{ gap: 8 }}>
              {!r.paid && <button className="btn sm" onClick={() => setAdding({ row: r, plus: true })}>+ Phụ cấp / thưởng</button>}
              {!r.paid && <button className="btn sm" onClick={() => setAdding({ row: r, plus: false })}>− Ứng / khấu trừ</button>}
              <button className="btn sm" onClick={() => printSlip(cfg.outlet.name, month, r).then((e) => toast(e ?? 'Đã in phiếu lương', !!e))}><Icon name="printer" size={14} />In phiếu</button>
              {r.paid
                ? <button className="btn sm ghost danger-text" onClick={() => setUnpay(r)}>Huỷ đã trả</button>
                : <button className="btn sm primary" disabled={r.open_entries > 0} onClick={() => setPaying(r)}>Trả lương</button>}
            </div>
          </div>
        );
      })}

      {adding && <AdjSheet month={month} row={adding.row} plus={adding.plus} onClose={(ok) => { setAdding(null); if (ok) data.reload(); }} />}
      {paying && <PaySheet month={month} row={paying} onClose={(ok) => { setPaying(null); if (ok) data.reload(); }} />}
      {unpay && <Confirm title={`Huỷ "đã trả" của ${unpay.name}?`} okText="Huỷ đã trả" danger onCancel={() => setUnpay(null)}
        onOk={async () => { const r = unpay; setUnpay(null); await run(() => post('/api/payroll/unpay', { staff_id: r.staff_id, month }), 'Đã huỷ — khoản chi lương cũng được huỷ'); data.reload(); }}
        text="Phiếu lương và khoản chi lương trong sổ thu chi bị huỷ. Bảng lương tính lại theo giờ công hiện tại." />}
    </Page>
  );
}

function AdjSheet({ month, row, plus, onClose }: { month: string; row: Row; plus: boolean; onClose: (ok: boolean) => void }) {
  const [kind, setKind] = useState<Adj['kind']>(plus ? 'allowance' : 'advance');
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('');
  const save = async () => {
    if (await run(() => post('/api/payroll/adjust', { staff_id: row.staff_id, month, kind, amount, note }), 'Đã thêm')) onClose(true);
  };
  return (
    <Sheet onClose={() => onClose(false)}>
      <h2>{row.name} · {plus ? 'Cộng thêm' : 'Trừ bớt'}</h2>
      <div className="col gap12 mt16">
        <Segmented value={kind} onChange={(v) => setKind(v as Adj['kind'])} options={plus ? [['allowance', 'Phụ cấp'], ['bonus', 'Thưởng']] : [['advance', 'Ứng lương'], ['deduction', 'Khấu trừ']]} />
        <MoneyInput label="Số tiền" value={amount} onChange={setAmount} autoFocus />
        <label className="field"><span>Ghi chú</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)}
          placeholder={plus ? 'VD: xăng xe, chuyên cần, Tết' : kind === 'advance' ? 'VD: ứng chuyển khoản ngày 10' : 'VD: làm vỡ ly, đi trễ'} /></label>
        <button className="btn primary lg block" disabled={amount <= 0} onClick={save}>Thêm</button>
      </div>
    </Sheet>
  );
}

function PaySheet({ month, row, onClose }: { month: string; row: Row; onClose: (ok: boolean) => void }) {
  const [method, setMethod] = useState<'owner' | 'bank'>('bank');
  const save = async () => {
    if (await run(() => post('/api/payroll/pay', { staff_id: row.staff_id, month, method }), `Đã trả lương ${row.name}`)) onClose(true);
  };
  return (
    <Sheet onClose={() => onClose(false)}>
      <h2>Trả lương {row.name}</h2>
      <div className="amount-card mt16"><div className="label">{label(month)} · thực nhận</div><div className="value">{vnd(row.net)}</div></div>
      <div className="col gap12 mt16">
        <Segmented value={method} onChange={(v) => setMethod(v as 'owner' | 'bank')} options={[['bank', 'Chuyển khoản'], ['owner', 'Tiền mặt (của chủ)']]} />
        <p className="small muted" style={{ margin: 0 }}>Bảng lương của {row.name} được chốt lại và ghi một khoản chi "Lương" vào sổ thu chi (không lấy từ két bán hàng).</p>
        <button className="btn primary lg block" onClick={save}>Xác nhận đã trả {vnd(row.net)}</button>
      </div>
    </Sheet>
  );
}

/** Payslip on the receipt printer (Vietnamese, like the bar ticket). */
async function printSlip(outlet: string, month: string, r: Row): Promise<string | null> {
  const row = (left: string, v: number, sign = ''): PLine[] => (v ? [{ t: 'row', left, right: `${sign}${vnd(v, false)}` }] : []);
  const doc: PLine[] = [
    { t: 'text', text: outlet.toUpperCase(), align: 'center', size: 'md', bold: true },
    { t: 'text', text: 'PHIẾU LƯƠNG', align: 'center', size: 'lg', bold: true },
    { t: 'text', text: label(month), align: 'center', size: 'sm' },
    { t: 'hr', dashed: true },
    { t: 'field', label: 'Nhân viên', value: r.name },
    { t: 'field', label: 'Giờ làm', value: `${fmtMinutes(r.minutes)} (${r.shifts} ca)` },
    ...(r.night_minutes ? [{ t: 'field', label: 'Giờ đêm', value: fmtMinutes(r.night_minutes) } as PLine] : []),
    { t: 'field', label: 'Lương giờ', value: vnd(r.rate) },
    { t: 'hr', dashed: true },
    ...row('Lương theo giờ', r.base),
    ...row('Phụ cấp ca đêm', r.night_pay, '+'),
    ...row('Tip', r.tips, '+'),
    ...row('Phụ cấp', r.allowance, '+'),
    ...row('Thưởng', r.bonus, '+'),
    ...row('Ứng lương', r.advance, '-'),
    ...row('Khấu trừ', r.deduction, '-'),
    { t: 'hr', heavy: true },
    { t: 'row', left: 'THỰC NHẬN', right: vnd(r.net), size: 'lg', bold: true },
    ...(r.paid ? [{ t: 'text', text: `Đã trả ${new Date(r.paid.at).toLocaleDateString('vi-VN')}${r.paid.method ? ' · ' + (METHOD[r.paid.method] ?? r.paid.method) : ''}`, align: 'center', size: 'sm' } as PLine] : []),
    { t: 'space', h: 40 },
    { t: 'row', left: 'Người nhận', right: 'Chủ quán', size: 'sm' },
    { t: 'space', h: 70 },
  ];
  return tryPrint(doc);
}

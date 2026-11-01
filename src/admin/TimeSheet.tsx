// Quản trị › Giờ làm: timesheet (bảng công) with corrections, and the weekly schedule (lịch làm).
// Pay = hours × hourly rate (+ optional night premium). Only the owner sees rates and pay.
import { useMemo, useState } from 'react';
import { entryFlags, fmtMinutes, nightMinutes, shiftMinutes, summarize, weekStart, workedMinutes } from '../../shared/timesheet';
import type { TimeEntry, WorkShift } from '../../shared/types';
import { addDays, fmtDay, hhmm, localParts, vnd } from '../../shared/util';
import { del, get, post, put } from '../lib/api';
import { today } from '../lib/store';
import { Confirm, Icon, Segmented, Sheet } from '../ui';
import { Loading, Num, Page, run, Select, Text, useLoad } from './common';

interface SheetData {
  from: string; to: string; owner: boolean;
  staff: { id: string; name: string; role: string; active: number; hourly_rate?: number; deleted_at?: number | null }[];
  entries: (TimeEntry & { edited_by_name?: string | null })[];
  schedule: WorkShift[];
  tips: { staff_id: string; tips: number }[];
  settings: { tz: number; cutoff: string; night_premium_pct: number; late_grace_min: number };
}

const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const FLAG: Record<string, [string, string]> = { open: ['Đang làm', 'ok'], forgot: ['Quên ra ca', 'danger'], long: ['> 12 giờ', ''], late: ['Đi trễ', ''], edited: ['Đã sửa', 'muted'] };

function monthRange(day: string, back: number) {
  const [y, m] = day.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - back, 1));
  const from = d.toISOString().slice(0, 10);
  const to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  return { from, to };
}

export function toLocalInput(ms: number, tz: number) {
  const p = localParts(ms, tz);
  const z = (n: number) => String(n).padStart(2, '0');
  return `${p.y}-${z(p.mo)}-${z(p.d)}T${z(p.h)}:${z(p.mi)}`;
}
export function fromLocalInput(v: string, tz: number) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - tz * 60000;
}

export default function TimeSheet() {
  const [tab, setTab] = useState<'sheet' | 'schedule'>('sheet');
  return tab === 'sheet' ? <Timesheet tab={tab} setTab={setTab} /> : <Schedule tab={tab} setTab={setTab} />;
}

function Tabs({ tab, setTab }: { tab: 'sheet' | 'schedule'; setTab: (t: 'sheet' | 'schedule') => void }) {
  return <Segmented value={tab} onChange={setTab} options={[['sheet', 'Bảng công'], ['schedule', 'Lịch làm']]} />;
}

// ---------------- timesheet ----------------

function Timesheet({ tab, setTab }: { tab: 'sheet' | 'schedule'; setTab: (t: 'sheet' | 'schedule') => void }) {
  const day = today();
  const ranges: Record<string, { from: string; to: string }> = {
    week: { from: weekStart(day), to: addDays(weekStart(day), 6) },
    lastweek: { from: addDays(weekStart(day), -7), to: addDays(weekStart(day), -1) },
    month: monthRange(day, 0),
    lastmonth: monthRange(day, 1),
  };
  const [period, setPeriod] = useState('month');
  const r = ranges[period];
  const data = useLoad(() => get<SheetData>(`/api/time/sheet?from=${r.from}&to=${r.to}`), [r.from, r.to]);
  const [who, setWho] = useState<string | null>(null);
  const [edit, setEdit] = useState<(TimeEntry & { edited_by_name?: string | null }) | 'new' | null>(null);
  const d = data.data;
  const s = d?.settings;
  const totals = useMemo(() => {
    if (!d) return new Map();
    const rates = Object.fromEntries(d.staff.map((x) => [x.id, x.hourly_rate || 0]));
    return summarize(d.entries.filter((e) => e.business_day >= d.from), d.schedule, rates, { tz: d.settings.tz, cutoff: d.settings.cutoff, nightPct: d.settings.night_premium_pct, grace: d.settings.late_grace_min });
  }, [d]);
  const name = (id: string) => d?.staff.find((x) => x.id === id)?.name ?? '—';
  const tipOf = (id: string) => d?.tips.find((x) => x.staff_id === id)?.tips ?? 0;
  const people = d ? d.staff.filter((x) => totals.has(x.id) || (x.active && !x.deleted_at)) : [];
  const working = d ? d.entries.filter((e) => !e.clock_out) : [];
  const forgot = working.filter((e) => Date.now() - e.clock_in > 14 * 3600000);
  const entries = d ? d.entries.filter((e) => !who || e.staff_id === who).sort((a, b) => b.clock_in - a.clock_in) : [];
  const sum = [...totals.values()].reduce((a, t) => ({ minutes: a.minutes + t.minutes, pay: a.pay + t.pay }), { minutes: 0, pay: 0 });

  const csv = () => {
    if (!d || !s) return;
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Nhân viên', 'Ngày', 'Vào', 'Ra', 'Nghỉ (phút)', 'Giờ làm', 'Giờ đêm', 'Ghi chú'].map(q).join(',')];
    for (const e of [...d.entries].sort((a, b) => a.clock_in - b.clock_in)) {
      rows.push([name(e.staff_id), fmtDay(e.business_day), hhmm(e.clock_in, s.tz), e.clock_out ? hhmm(e.clock_out, s.tz) : '', e.break_min,
        (workedMinutes(e) / 60).toFixed(2), (nightMinutes(e, s.tz) / 60).toFixed(2), [e.note, e.edited_by_name ? `sửa bởi ${e.edited_by_name}` : ''].filter(Boolean).join('; ')].map(q).join(','));
    }
    rows.push('');
    rows.push(['Nhân viên', 'Số ca', 'Giờ làm', 'Giờ đêm', 'Lịch (giờ)', 'Đi trễ', ...(d.owner ? ['Lương giờ', 'Tạm tính lương'] : []), 'Tip'].map(q).join(','));
    for (const p of people) {
      const t = totals.get(p.id);
      if (!t) continue;
      rows.push([p.name, t.entries, (t.minutes / 60).toFixed(2), (t.night_minutes / 60).toFixed(2), (t.scheduled_minutes / 60).toFixed(2), t.late, ...(d.owner ? [p.hourly_rate || 0, t.pay] : []), tipOf(p.id)].map(q).join(','));
    }
    const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bang-cong_${d.from}_${d.to}.csv`;
    a.click();
  };

  return (
    <Page title="Giờ làm" sub={d ? `${fmtDay(d.from)} – ${fmtDay(d.to)}` : 'Bảng công'}
      right={<><button className="btn sm" onClick={csv} disabled={!d}>Xuất CSV</button><button className="btn sm primary" onClick={() => setEdit('new')} disabled={!d}>+ Công tay</button></>}>
      <Tabs tab={tab} setTab={setTab} />
      <Segmented value={period} onChange={setPeriod} options={[['week', 'Tuần này'], ['lastweek', 'Tuần trước'], ['month', 'Tháng này'], ['lastmonth', 'Tháng trước']]} />
      <Loading error={data.error} loading={data.loading && !d} />
      {d && s && (
        <>
          {forgot.length > 0 && <div className="banner danger"><Icon name="warn" size={18} />{forgot.length} lượt quên ra ca ({forgot.map((e) => name(e.staff_id)).join(', ')}). Chưa tính lương cho đến khi sửa giờ ra.</div>}
          {working.length > forgot.length && (
            <div className="card col" style={{ gap: 6 }}>
              <b className="small">Đang trong ca</b>
              {working.filter((e) => !forgot.includes(e)).map((e) => <div key={e.id} className="row between small"><span>{name(e.staff_id)}</span><span className="muted">từ {hhmm(e.clock_in, s.tz)} · {fmtMinutes(workedMinutes(e))}</span></div>)}
            </div>
          )}
          <div className="tablewrap">
            <table className="sheet-table">
              <thead><tr><th>Nhân viên</th><th className="num">Ca</th><th className="num">Giờ làm</th><th className="num">Giờ đêm</th><th className="num">Lịch</th><th className="num">Trễ</th>{d.owner && <th className="num">Lương giờ</th>}{d.owner && <th className="num">Tạm tính lương</th>}<th className="num">Tip</th></tr></thead>
              <tbody>
                {people.map((p) => {
                  const t = totals.get(p.id);
                  return (
                    <tr key={p.id} className={'click' + (who === p.id ? ' on' : '')} onClick={() => setWho(who === p.id ? null : p.id)} style={who === p.id ? { background: 'var(--accent-soft)' } : undefined}>
                      <td><b>{p.name}</b>{!p.active && <span className="tiny faint"> · {p.deleted_at ? 'đã xoá' : 'nghỉ'}</span>}</td>
                      <td className="num">{t?.entries ?? 0}</td>
                      <td className="num">{fmtMinutes(t?.minutes ?? 0)}</td>
                      <td className="num muted">{t?.night_minutes ? fmtMinutes(t.night_minutes) : '–'}</td>
                      <td className="num muted">{t?.scheduled_minutes ? fmtMinutes(t.scheduled_minutes) : '–'}</td>
                      <td className="num">{t?.late ? <span className="badge">{t.late}</span> : '–'}</td>
                      {d.owner && <td className="num muted">{p.hourly_rate ? vnd(p.hourly_rate, false) : <span className="faint">chưa đặt</span>}</td>}
                      {d.owner && <td className="num"><b>{t?.pay ? vnd(t.pay) : '–'}</b></td>}
                      <td className="num muted">{tipOf(p.id) ? vnd(tipOf(p.id), false) : '–'}</td>
                    </tr>
                  );
                })}
                <tr><td><b>Tổng</b></td><td /><td className="num"><b>{fmtMinutes(sum.minutes)}</b></td><td /><td /><td />{d.owner && <td />}{d.owner && <td className="num"><b>{vnd(sum.pay)}</b></td>}<td /></tr>
              </tbody>
            </table>
          </div>
          {d.owner && (
            <p className="tiny faint" style={{ margin: 0 }}>
              Lương tạm tính = giờ làm × lương giờ{s.night_premium_pct ? ` + ${s.night_premium_pct}% cho giờ 22:00–06:00` : ''}, làm tròn 1.000 ₫. Đặt lương giờ ở Nhân viên, phụ cấp đêm ở Cài đặt. Kiểm tra lại với quy định lương của quán trước khi trả.
            </p>
          )}

          <div className="section-title">{who ? `Chi tiết · ${name(who)}` : 'Tất cả lượt chấm công'}</div>
          <div className="tablewrap">
            <table className="sheet-table">
              <thead><tr><th>Ngày</th>{!who && <th>Nhân viên</th>}<th>Vào – ra</th><th className="num">Nghỉ</th><th className="num">Giờ</th><th /></tr></thead>
              <tbody>
                {entries.map((e) => {
                  const flags = entryFlags(e, d.schedule, s.tz, s.cutoff, s.late_grace_min);
                  const dow = new Date(e.business_day + 'T00:00:00Z').getUTCDay();
                  return (
                    <tr key={e.id} className="click" onClick={() => setEdit(e)}>
                      <td className="small">{DOW[dow]} {e.business_day.slice(8)}/{e.business_day.slice(5, 7)}</td>
                      {!who && <td>{name(e.staff_id)}</td>}
                      <td className="mono small">{hhmm(e.clock_in, s.tz)} – {e.clock_out ? hhmm(e.clock_out, s.tz) : '…'}</td>
                      <td className="num small muted">{e.break_min ? `${e.break_min}p` : ''}</td>
                      <td className="num">{flags.includes('forgot') ? '–' : fmtMinutes(workedMinutes(e))}</td>
                      <td>{flags.map((f) => <span key={f} className={'badge ' + FLAG[f][1]} style={{ marginRight: 4 }}>{FLAG[f][0]}</span>)}</td>
                    </tr>
                  );
                })}
                {!entries.length && <tr><td colSpan={6} className="muted small">Chưa có lượt chấm công trong khoảng này.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
      {edit && d && <EntrySheet entry={edit === 'new' ? null : edit} staff={d.staff.filter((x) => x.active)} tz={d.settings.tz} defaultStaff={who} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); data.reload(); }} />}
    </Page>
  );
}

function EntrySheet({ entry, staff, tz, defaultStaff, onClose, onSaved }: { entry: (TimeEntry & { edited_by_name?: string | null }) | null; staff: SheetData['staff']; tz: number; defaultStaff: string | null; onClose: () => void; onSaved: () => void }) {
  const now = Date.now();
  const [f, setF] = useState({
    staff_id: entry?.staff_id ?? defaultStaff ?? staff[0]?.id ?? '',
    clock_in: toLocalInput(entry?.clock_in ?? now - 8 * 3600000, tz),
    clock_out: entry ? (entry.clock_out ? toLocalInput(entry.clock_out, tz) : '') : toLocalInput(now, tz),
    break_min: entry?.break_min ?? 0,
    reason: '',
  });
  const [askDel, setAskDel] = useState(false);
  const cin = fromLocalInput(f.clock_in, tz);
  const cout = f.clock_out ? fromLocalInput(f.clock_out, tz) : null;
  const mins = cout && cout > cin ? Math.round((cout - cin) / 60000) - f.break_min : null;
  const save = async () => {
    const payload = { clock_in: cin, clock_out: cout, break_min: f.break_min };
    const ok = entry
      ? await run(() => put(`/api/time/entries/${entry.id}`, { ...payload, reason: f.reason }), 'Đã sửa giờ công')
      : await run(() => post('/api/time/entries', { ...payload, staff_id: f.staff_id, note: f.reason }), 'Đã thêm công');
    if (ok) onSaved();
  };
  const remove = async () => {
    setAskDel(false);
    const ok = await run(() => post(`/api/time/entries/${entry!.id}/delete`, { reason: f.reason }), 'Đã xoá lượt chấm công');
    if (ok) onSaved();
  };
  return (
    <Sheet onClose={onClose}>
      <h2>{entry ? 'Sửa giờ công' : 'Thêm công tay'}</h2>
      {entry && <p className="small muted" style={{ marginTop: 4 }}>{entry.source === 'admin' ? 'Thêm tay' : 'Chấm trên máy'}{entry.edited_by_name ? ` · đã sửa bởi ${entry.edited_by_name}` : ''}{entry.note ? ` · ${entry.note}` : ''}</p>}
      <div className="col gap12 mt16">
        {!entry && <Select label="Nhân viên" value={f.staff_id} onChange={(v) => setF({ ...f, staff_id: v })} options={staff.map((x) => [x.id, x.name])} />}
        <div className="form-grid">
          <Text label="Giờ vào" type="datetime-local" value={f.clock_in} onChange={(v) => setF({ ...f, clock_in: v })} />
          <Text label="Giờ ra (để trống nếu đang làm)" type="datetime-local" value={f.clock_out} onChange={(v) => setF({ ...f, clock_out: v })} />
        </div>
        <Num label="Nghỉ giữa ca (phút)" value={f.break_min} onChange={(v) => setF({ ...f, break_min: Math.max(0, Math.round(v)) })} />
        {mins != null && <div className="banner info">Tính công: {fmtMinutes(Math.max(0, mins))}</div>}
        <Text label={entry ? 'Lý do sửa (bắt buộc)' : 'Lý do thêm tay (bắt buộc)'} value={f.reason} onChange={(v) => setF({ ...f, reason: v })} placeholder="VD: Quên chấm ra, theo camera 01:40" />
        <div className="row">
          {entry && <button className="btn danger" disabled={!f.reason.trim()} onClick={() => setAskDel(true)}><Icon name="trash" size={18} />Xoá</button>}
          <button className="btn primary grow" disabled={!f.reason.trim() || isNaN(cin) || (cout != null && cout <= cin)} onClick={save}>Lưu</button>
        </div>
        <p className="tiny faint" style={{ margin: 0 }}>Mọi lần thêm, sửa, xoá đều ghi vào Nhật ký kèm giờ cũ và lý do.</p>
      </div>
      {askDel && <Confirm title="Xoá lượt chấm công?" text="Giờ công này sẽ không được tính. Thao tác được ghi nhật ký." okText="Xoá" danger onCancel={() => setAskDel(false)} onOk={remove} />}
    </Sheet>
  );
}

// ---------------- schedule ----------------

function Schedule({ tab, setTab }: { tab: 'sheet' | 'schedule'; setTab: (t: 'sheet' | 'schedule') => void }) {
  const day = today();
  const [monday, setMonday] = useState(weekStart(day));
  const sunday = addDays(monday, 6);
  const data = useLoad(() => get<SheetData>(`/api/time/sheet?from=${monday}&to=${sunday}`), [monday]);
  const [edit, setEdit] = useState<Partial<WorkShift> | null>(null);
  const [askCopy, setAskCopy] = useState<null | 'ask' | 'replace'>(null);
  const d = data.data;
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const staff = d ? d.staff.filter((x) => x.active) : [];
  const presets = useMemo(() => [...new Set((d?.schedule ?? []).map((x) => `${x.start}-${x.end}`))].slice(0, 4), [d]);

  const copy = async (replace: boolean) => {
    setAskCopy(null);
    try {
      await post('/api/time/schedule/copy', { from: addDays(monday, -7), to: monday, replace });
      data.reload();
    } catch (e) {
      const m = (e as Error).message;
      if (/đã có/.test(m) && !replace) setAskCopy('replace');
      else run(async () => { throw e; });
    }
  };

  return (
    <Page title="Giờ làm" sub={`Lịch tuần ${fmtDay(monday)} – ${fmtDay(sunday)}`}
      right={<button className="btn sm" onClick={() => setAskCopy('ask')}>Chép tuần trước</button>}>
      <Tabs tab={tab} setTab={setTab} />
      <div className="row between">
        <button className="btn sm" onClick={() => setMonday(addDays(monday, -7))}><Icon name="back" size={16} />Tuần trước</button>
        {monday !== weekStart(day) && <button className="btn sm ghost" onClick={() => setMonday(weekStart(day))}>Tuần này</button>}
        <button className="btn sm" onClick={() => setMonday(addDays(monday, 7))}>Tuần sau<Icon name="chevron" size={16} /></button>
      </div>
      <Loading error={data.error} loading={data.loading && !d} />
      {d && (
        <div className="tablewrap">
          <div className="week">
            <div className="hd">Nhân viên</div>
            {days.map((x) => <div key={x} className={'hd' + (x === day ? ' today' : '')}>{DOW[new Date(x + 'T00:00:00Z').getUTCDay()]} {x.slice(8)}/{x.slice(5, 7)}</div>)}
            {staff.map((p) => {
              const mine = d.schedule.filter((x) => x.staff_id === p.id);
              const total = mine.reduce((s, x) => s + shiftMinutes(x, d.settings.tz, d.settings.cutoff), 0);
              return [
                <div key={p.id} className="nm">{p.name}<span className="tiny muted">{total ? fmtMinutes(total) : 'chưa xếp'}</span></div>,
                ...days.map((x) => {
                  const here = mine.filter((s) => s.day === x);
                  return (
                    <div key={p.id + x} className="slot" onClick={() => setEdit({ staff_id: p.id, day: x })} role="button" tabIndex={0} aria-label={`Thêm ca ${p.name} ngày ${x}`}>
                      {here.map((s) => <span key={s.id} className="shift" onClick={(e) => { e.stopPropagation(); setEdit(s); }}>{s.start}–{s.end}{s.note ? ` · ${s.note}` : ''}</span>)}
                      {!here.length && <span className="add">+</span>}
                    </div>
                  );
                }),
              ];
            })}
          </div>
        </div>
      )}
      <p className="tiny faint" style={{ margin: 0 }}>Chạm ô để xếp ca, chạm ca để sửa. Ca qua nửa đêm: giờ ra nhỏ hơn giờ vào (VD 17:00–01:30). Nhân viên xem lịch của mình trên máy bán hàng ở mục Chấm công.</p>
      {edit && d && <ShiftSheet s={edit} staff={staff} presets={presets} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); data.reload(); }} />}
      {askCopy === 'ask' && <Confirm title="Chép lịch tuần trước?" text={`Các ca của tuần ${fmtDay(addDays(monday, -7))} sẽ được chép sang tuần này.`} okText="Chép" onCancel={() => setAskCopy(null)} onOk={() => copy(false)} />}
      {askCopy === 'replace' && <Confirm title="Tuần này đã có ca" text="Thay toàn bộ lịch tuần này bằng lịch tuần trước?" okText="Thay lịch" danger onCancel={() => setAskCopy(null)} onOk={() => copy(true)} />}
    </Page>
  );
}

function ShiftSheet({ s, staff, presets, onClose, onSaved }: { s: Partial<WorkShift>; staff: SheetData['staff']; presets: string[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ staff_id: s.staff_id ?? staff[0]?.id ?? '', day: s.day ?? today(), start: s.start ?? '17:00', end: s.end ?? '01:00', note: s.note ?? '' });
  const save = async () => {
    const ok = s.id ? await run(() => put(`/api/time/schedule/${s.id}`, f), 'Đã lưu ca') : await run(() => post('/api/time/schedule', f), 'Đã xếp ca');
    if (ok) onSaved();
  };
  const remove = async () => { const ok = await run(() => del(`/api/time/schedule/${s.id}`), 'Đã xoá ca'); if (ok) onSaved(); };
  return (
    <Sheet onClose={onClose}>
      <h2>{s.id ? 'Sửa ca' : 'Xếp ca'}</h2>
      <div className="col gap12 mt16">
        <Select label="Nhân viên" value={f.staff_id} onChange={(v) => setF({ ...f, staff_id: v })} options={staff.map((x) => [x.id, x.name])} />
        <Text label="Ngày" type="date" value={f.day} onChange={(v) => setF({ ...f, day: v })} />
        {presets.length > 0 && (
          <div className="row wrap" style={{ gap: 8 }}>
            {presets.map((p) => { const [a, b] = p.split('-'); return <button key={p} className={'opt' + (f.start === a && f.end === b ? ' on' : '')} onClick={() => setF({ ...f, start: a, end: b })}>{a}–{b}</button>; })}
          </div>
        )}
        <div className="form-grid">
          <Text label="Giờ vào" type="time" value={f.start} onChange={(v) => setF({ ...f, start: v })} />
          <Text label="Giờ ra" type="time" value={f.end} onChange={(v) => setF({ ...f, end: v })} />
        </div>
        <Text label="Ghi chú (vị trí, việc)" value={f.note} onChange={(v) => setF({ ...f, note: v })} placeholder="VD: Bar, phục vụ, mở quán" />
        <div className="row">
          {s.id && <button className="btn danger" onClick={remove}><Icon name="trash" size={18} />Xoá</button>}
          <button className="btn primary grow" disabled={!f.staff_id || !f.start || !f.end || f.start === f.end} onClick={save}>Lưu</button>
        </div>
      </div>
    </Sheet>
  );
}

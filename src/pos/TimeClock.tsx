// Chấm công. From the login screen anyone clocks in/out with their PIN (also staff who don't sell);
// from the menu the signed-in person sees their status, this week's schedule and hours.
import { useEffect, useState } from 'react';
import { verifyPin } from '../../shared/crypto';
import { fmtMinutes, shiftWindow, weekStart, workedMinutes } from '../../shared/timesheet';
import type { StaffPublic } from '../../shared/types';
import { addDays, fmtDay, hhmm } from '../../shared/util';
import { pugSay } from '../pug';
import { clockIn, clockOut, getState, navigate, openEntry, today, toast, useStore } from '../lib/store';
import { Icon, PinPad, TopBar } from '../ui';

const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const BREAKS = [0, 15, 30, 45, 60];

export default function TimeClock() {
  const cfg = useStore((s) => s.config)!;
  const me = useStore((s) => s.staff);
  const [who, setWho] = useState<StaffPublic | null>(me);
  const [verified, setVerified] = useState(!!me);
  const staff = cfg.staff.filter((s) => s.active);
  const back = () => navigate(me ? 'order' : 'login');

  if (!who || !verified) {
    return (
      <div className="screen">
        <TopBar title="Chấm công" sub="Vào ca / ra ca bằng PIN" onBack={back} />
        <div className="scroll pad">
          {!who ? (
            <>
              <p className="muted small" style={{ marginTop: 0 }}>Chọn tên của bạn</p>
              <div className="avatars">
                {staff.map((s) => (
                  <button key={s.id} className="avatar" onClick={() => setWho(s)}>
                    <span className="circle">{s.name.slice(0, 1).toUpperCase()}</span>
                    <span className="semibold small">{s.name}</span>
                    <span className="tiny muted">{openEntry(s.id) ? `Trong ca từ ${hhmm(openEntry(s.id)!.clock_in, cfg.outlet.tz_offset_min)}` : 'Chưa vào ca'}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="col" style={{ maxWidth: 340, margin: '0 auto', width: '100%' }}>
              <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setWho(null)}><Icon name="back" size={16} />Đổi người</button>
              <div className="col center" style={{ alignItems: 'center', gap: 6, marginTop: 8 }}>
                <b>{who.name}</b><span className="small muted">Nhập PIN để chấm công</span>
              </div>
              <PinPad key={who.id} onSubmit={async (pin) => { const ok = await verifyPin(pin, who.pin_salt, who.pin_hash); if (ok) setVerified(true); return ok; }} />
            </div>
          )}
        </div>
      </div>
    );
  }
  return <MyTime who={who} signedIn={!!me} onBack={back} />;
}

function MyTime({ who, signedIn, onBack }: { who: StaffPublic; signedIn: boolean; onBack: () => void }) {
  const cfg = useStore((s) => s.config)!;
  const entries = useStore((s) => s.timeEntries);
  const schedule = useStore((s) => s.schedule);
  const tz = cfg.outlet.tz_offset_min;
  const cutoff = cfg.outlet.business_day_cutoff;
  const [brk, setBrk] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t); }, []);
  // Someone clocking in from the login screen goes back there after a moment.
  const [doneAt, setDoneAt] = useState<number | null>(null);
  useEffect(() => { if (!doneAt || signedIn) return; const t = setTimeout(onBack, 2500); return () => clearTimeout(t); }, [doneAt]); // eslint-disable-line

  const open = entries.filter((e) => e.staff_id === who.id && !e.clock_out).sort((a, b) => b.clock_in - a.clock_in)[0];
  const day = today();
  const monday = weekStart(day);
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const mine = entries.filter((e) => e.staff_id === who.id);
  const weekMin = mine.filter((e) => e.business_day >= monday && e.business_day <= week[6]).reduce((s, e) => s + workedMinutes(e), 0);
  const todayShift = schedule.find((s) => s.staff_id === who.id && s.day === day);

  const doIn = async () => { await clockIn(who.id); toast(`${who.name} vào ca lúc ${hhmm(Date.now(), tz)}`); pugSay(`Chúc ${who.name} ca làm vui vẻ! 🐾`, 'wave'); setDoneAt(Date.now()); };
  const doOut = async () => {
    const e = await clockOut(who.id, brk);
    if (e) { toast(`${who.name} ra ca · ${fmtMinutes(workedMinutes(e))}`); pugSay(`Vất vả rồi ${who.name}! Về nghỉ ngơi nha 😴`, 'sleepy'); }
    setDoneAt(Date.now());
  };
  const late = todayShift && !open ? Math.round((Date.now() - shiftWindow(todayShift, tz, cutoff).start) / 60000) : 0;

  return (
    <div className="screen">
      <TopBar title="Chấm công" sub={who.name} onBack={onBack} />
      <div className="scroll pad col gap16">
        <div className="card col gap12" style={{ alignItems: 'center', textAlign: 'center', padding: 24 }}>
          {open ? (
            <>
              <span className="badge ok">Đang trong ca</span>
              <span className="huge mono">{fmtMinutes(workedMinutes(open))}</span>
              <span className="small muted">Vào lúc {hhmm(open.clock_in, tz)} · {fmtDay(open.business_day)}</span>
              <div className="col" style={{ width: '100%', gap: 6 }}>
                <span className="small muted">Nghỉ giữa ca (phút, không tính lương)</span>
                <div className="row wrap" style={{ justifyContent: 'center', gap: 8 }}>
                  {BREAKS.map((b) => <button key={b} className={'opt' + (brk === b ? ' on' : '')} onClick={() => setBrk(b)}>{b}</button>)}
                </div>
              </div>
              <button className="btn danger xl block" onClick={doOut}><Icon name="door" size={22} />Ra ca</button>
            </>
          ) : (
            <>
              <span className="badge muted">Chưa vào ca</span>
              <span className="huge mono">{hhmm(Date.now(), tz)}</span>
              {todayShift && <span className="small muted">Lịch hôm nay {todayShift.start}–{todayShift.end}{late > 10 ? ` · đang trễ ${late} phút` : ''}</span>}
              <button className="btn primary xl block" onClick={doIn}><Icon name="clock" size={22} />Vào ca</button>
            </>
          )}
          {doneAt && !signedIn && <span className="small muted">Đã lưu. Quay lại màn đăng nhập…</span>}
        </div>

        <div className="section-title" style={{ margin: '4px 0 0' }}>Lịch làm tuần này · đã làm {fmtMinutes(weekMin)}</div>
        <div className="list">
          {week.map((d) => {
            const plan = schedule.filter((s) => s.staff_id === who.id && s.day === d);
            const worked = mine.filter((e) => e.business_day === d);
            const dow = new Date(d + 'T00:00:00Z').getUTCDay();
            return (
              <div key={d} className={'li' + (d === day ? ' on' : '')} style={{ minHeight: 0, padding: '10px 14px' }}>
                <span style={{ width: 64 }} className={d === day ? 'accent bold' : 'muted'}>{DOW[dow]} {d.slice(8)}/{d.slice(5, 7)}</span>
                <span className="grow small">{plan.length ? plan.map((p) => `${p.start}–${p.end}`).join(', ') : <span className="faint">Nghỉ</span>}</span>
                <span className="small mono muted">{worked.length ? worked.map((e) => `${hhmm(e.clock_in, tz)}–${e.clock_out ? hhmm(e.clock_out, tz) : '…'}`).join(', ') : ''}</span>
              </div>
            );
          })}
        </div>
        <p className="tiny faint" style={{ margin: 0 }}>Quên chấm công hoặc chấm sai: báo quản lý sửa trong Quản trị › Giờ làm. Mọi chỉnh sửa đều được ghi nhật ký.</p>
        {getState().net.pending > 0 && <p className="tiny faint" style={{ margin: 0 }}>Máy đang offline: lượt chấm công được lưu trên máy và gửi khi có mạng.</p>}
      </div>
    </div>
  );
}

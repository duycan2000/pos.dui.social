// S01 — pick your name, enter PIN. Works offline with cached staff.
import { useState } from 'react';
import type { StaffPublic } from '../../shared/types';
import { login, navigate, useStore } from '../lib/store';
import { appVersion, Icon, PinPad } from '../ui';

const ROLE: Record<string, string> = { owner: 'Chủ quán', manager: 'Quản lý', staff: 'Nhân viên' };

export default function Login() {
  const cfg = useStore((s) => s.config);
  const net = useStore((s) => s.net);
  const [who, setWho] = useState<StaffPublic | null>(null);
  const staff = (cfg?.staff ?? []).filter((s) => s.active);
  if (!cfg) {
    return (
      <div className="screen center row pad col" style={{ textAlign: 'center' }}>
        <span className="spinner" />
        <p className="muted">Đang tải dữ liệu quán lần đầu…</p>
        {!net.online && <p className="danger">Không có mạng. Lần tải đầu tiên cần mạng.</p>}
      </div>
    );
  }
  return (
    <div className="login">
      <section className="login-brand">
        <div className="brand" style={{ fontSize: 28 }}>{cfg.outlet.name.toUpperCase()}</div>
        <p className="muted" style={{ margin: 0 }}>{cfg.device.name} · mã đơn {cfg.device.order_prefix}</p>
        <span className="small muted row"><span className={'dot' + (net.online ? '' : ' off')} />{net.online ? 'Đang kết nối' : 'Offline — vẫn bán được'}</span>
        <button className="btn sm" style={{ alignSelf: 'flex-start', marginTop: 8 }} onClick={() => navigate('clock')}><Icon name="clock" size={18} />Chấm công vào / ra ca</button>
        <span className="tiny faint" aria-label="Phiên bản app">Phiên bản {appVersion(true)}</span>
      </section>
      <section className="login-panel">
        {!who ? (
          <>
            <h2 style={{ margin: '0 0 4px' }}>Ai đang làm?</h2>
            <p className="muted small" style={{ marginTop: 0 }}>Chọn tên của bạn</p>
            <div className="avatars">
              {staff.map((s) => (
                <button key={s.id} className="avatar" onClick={() => setWho(s)}>
                  <span className="circle">{s.name.slice(0, 1).toUpperCase()}</span>
                  <span className="semibold small">{s.name}</span>
                  <span className="tiny muted">{ROLE[s.role]}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="col" style={{ maxWidth: 340, margin: '0 auto', width: '100%' }}>
            <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setWho(null)}><Icon name="back" size={16} />Đổi người</button>
            <div className="col center" style={{ alignItems: 'center', gap: 6, marginTop: 8 }}>
              <span className="avatar on" style={{ border: 0, padding: 0, background: 'none' }}><span className="circle">{who.name.slice(0, 1).toUpperCase()}</span></span>
              <b>{who.name}</b>
              <span className="small muted">Nhập PIN</span>
            </div>
            <PinPad key={who.id} onSubmit={(pin) => login(who, pin)} />
          </div>
        )}
      </section>
    </div>
  );
}

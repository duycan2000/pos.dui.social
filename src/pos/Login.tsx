// S01 — pick your name, enter PIN. Works offline with cached staff.
import { useState } from 'react';
import type { StaffPublic } from '../../shared/types';
import { login, useStore } from '../lib/store';
import { PinPad } from '../ui';

const ROLE: Record<string, string> = { owner: 'Chủ quán', manager: 'Quản lý', staff: 'Nhân viên' };

export default function Login() {
  const cfg = useStore((s) => s.config);
  const net = useStore((s) => s.net);
  const [who, setWho] = useState<StaffPublic | null>(null);
  const staff = (cfg?.staff ?? []).filter((s) => s.active);
  if (!cfg) {
    return (
      <div className="screen center row pad col" style={{ textAlign: 'center' }}>
        <p className="muted">Đang tải dữ liệu quán lần đầu…</p>
        {!net.online && <p className="danger">Không có mạng. Cần mạng cho lần tải đầu tiên.</p>}
      </div>
    );
  }
  return (
    <div className="screen">
      <div className="scroll pad col gap16">
        <div className="row between" style={{ paddingTop: 16 }}>
          <div className="big accent">{cfg.outlet.name.toUpperCase()}</div>
          <span className="small muted row"><span className={'dot' + (net.online ? '' : ' off')} />{net.online ? 'Online' : 'Offline'}</span>
        </div>
        <p className="muted small" style={{ margin: 0 }}>{cfg.device.name} · mã đơn {cfg.device.order_prefix}</p>
        <div className="avatars">
          {staff.map((s) => (
            <button key={s.id} className={'avatar' + (who?.id === s.id ? ' on' : '')} onClick={() => setWho(s)}>
              <span className="circle">{s.name.slice(0, 1).toUpperCase()}</span>
              <span className="bold small">{s.name}</span>
              <span className="tiny muted">{ROLE[s.role]}</span>
            </button>
          ))}
        </div>
        {who ? (
          <div className="card">
            <p className="center row" style={{ margin: 0 }}>PIN của <b>&nbsp;{who.name}</b></p>
            <PinPad key={who.id} onSubmit={(pin) => login(who, pin)} />
          </div>
        ) : (
          <p className="muted center row">Chọn tên của bạn</p>
        )}
      </div>
    </div>
  );
}

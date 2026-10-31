// First run: create the bar and the owner (Setup), or add this device to an existing bar (Register).
import { useState } from 'react';
import { validPin } from '../../shared/crypto';
import { api } from '../lib/api';
import { completeRegistration, toast } from '../lib/store';

export function Setup() {
  const [f, setF] = useState({ outletName: 'Dui Social', ownerName: '', ownerPin: '', pin2: '', deviceName: 'Máy A' });
  const [busy, setBusy] = useState(false);
  const ok = f.outletName.trim() && f.ownerName.trim() && validPin(f.ownerPin, 'owner') && f.ownerPin === f.pin2;
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api<{ deviceToken: string }>('POST', '/api/setup', f);
      await completeRegistration(r.deviceToken);
      toast('Đã thiết lập quán');
    } catch (e) {
      toast((e as Error).message, true);
    } finally { setBusy(false); }
  };
  return (
    <div className="screen">
      <div className="scroll pad col gap16" style={{ paddingTop: 32 }}>
        <div>
          <div className="huge accent">DUI SOCIAL</div>
          <p className="muted">Thiết lập lần đầu. Bạn sẽ là chủ quán (owner).</p>
        </div>
        <label className="field"><span>Tên quán</span><input className="input" value={f.outletName} onChange={(e) => setF({ ...f, outletName: e.target.value })} /></label>
        <label className="field"><span>Tên của bạn</span><input className="input" value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} placeholder="VD: Duy" /></label>
        <div className="row">
          <label className="field grow"><span>PIN (6 số)</span><input className="input" type="password" inputMode="numeric" maxLength={6} value={f.ownerPin} onChange={(e) => setF({ ...f, ownerPin: e.target.value.replace(/\D/g, '') })} /></label>
          <label className="field grow"><span>Nhập lại PIN</span><input className="input" type="password" inputMode="numeric" maxLength={6} value={f.pin2} onChange={(e) => setF({ ...f, pin2: e.target.value.replace(/\D/g, '') })} /></label>
        </div>
        <label className="field"><span>Tên thiết bị này</span><input className="input" value={f.deviceName} onChange={(e) => setF({ ...f, deviceName: e.target.value })} /></label>
        <button className="btn primary lg block" disabled={!ok || busy} onClick={submit}>{busy ? 'Đang tạo…' : 'Tạo quán'}</button>
      </div>
    </div>
  );
}

export function Register() {
  const [name, setName] = useState('Máy B');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api<{ deviceToken: string; device: { order_prefix: string } }>('POST', '/api/devices/register', { pin, deviceName: name });
      await completeRegistration(r.deviceToken);
      toast(`Đã đăng ký thiết bị. Mã đơn bắt đầu bằng ${r.device.order_prefix}`);
    } catch (e) {
      toast((e as Error).message, true);
    } finally { setBusy(false); }
  };
  return (
    <div className="screen">
      <div className="scroll pad col gap16" style={{ paddingTop: 32 }}>
        <div>
          <div className="huge accent">DUI SOCIAL</div>
          <p className="muted">Thiết bị này chưa được đăng ký. Chủ quán hoặc quản lý nhập PIN để thêm máy (điện thoại bán hàng hoặc laptop quản trị).</p>
        </div>
        <label className="field"><span>Tên thiết bị</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>PIN chủ quán / quản lý (6 số)</span><input className="input" type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} /></label>
        <button className="btn primary lg block" disabled={!validPin(pin, 'manager') || !name.trim() || busy} onClick={submit}>{busy ? 'Đang đăng ký…' : 'Đăng ký thiết bị'}</button>
      </div>
    </div>
  );
}

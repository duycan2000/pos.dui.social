// First run: create the bar and the owner (Setup), or add this device to an existing bar (Register).
// An unregistered device only ever sees a sign-in form: no staff names, no data.
import { useEffect, useState } from 'react';
import { passwordRule, validLogin, validPassword, validPin } from '../../shared/crypto';
import { api } from '../lib/api';
import { completeRegistration, toast } from '../lib/store';
import { appVersion } from '../ui';

function Brand({ sub }: { sub: string }) {
  return (
    <div>
      <div className="huge accent">DUI SOCIAL</div>
      <p className="muted" style={{ marginBottom: 0 }}>{sub}</p>
    </div>
  );
}

export function Setup() {
  const [f, setF] = useState({ outletName: 'Dui Social', ownerName: '', ownerLogin: '', ownerPassword: '', pw2: '', ownerPin: '', pin2: '', deviceName: 'Máy A' });
  const [busy, setBusy] = useState(false);
  const ok = f.outletName.trim() && f.ownerName.trim() && validLogin(f.ownerLogin) && validPassword(f.ownerPassword) && f.ownerPassword === f.pw2
    && validPin(f.ownerPin, 'owner') && f.ownerPin === f.pin2;
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
        <Brand sub="Thiết lập lần đầu. Bạn sẽ là chủ quán." />
        <label className="field"><span>Tên quán</span><input className="input" value={f.outletName} onChange={(e) => setF({ ...f, outletName: e.target.value })} /></label>
        <label className="field"><span>Tên của bạn</span><input className="input" value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} placeholder="VD: Duy" /></label>
        <div className="section-title" style={{ margin: '4px 0 0' }}>Tài khoản đăng nhập (để thêm máy mới, vào quản trị trên máy lạ)</div>
        <label className="field"><span>Email hoặc tên đăng nhập</span><input className="input" autoComplete="username" autoCapitalize="none" value={f.ownerLogin} onChange={(e) => setF({ ...f, ownerLogin: e.target.value.trim() })} placeholder="VD: duy@dui.social" /></label>
        <div className="row">
          <label className="field grow"><span>Mật khẩu</span><input className="input" type="password" autoComplete="new-password" value={f.ownerPassword} onChange={(e) => setF({ ...f, ownerPassword: e.target.value })} /></label>
          <label className="field grow"><span>Nhập lại mật khẩu</span><input className="input" type="password" autoComplete="new-password" value={f.pw2} onChange={(e) => setF({ ...f, pw2: e.target.value })} /></label>
        </div>
        <p className="tiny faint" style={{ margin: 0 }}>{passwordRule}.</p>
        <div className="section-title" style={{ margin: '4px 0 0' }}>PIN (đăng nhập nhanh trên máy bán hàng)</div>
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

/** Sign-in page for a device that is not registered yet. */
export function Register() {
  const [mode, setMode] = useState<'password' | 'pin' | null>(null);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ passwordLogin: boolean }>('GET', '/api/setup/status').then((r) => setMode(r.passwordLogin ? 'password' : 'pin')).catch(() => setMode('password'));
  }, []);
  const ready = name.trim() && (mode === 'password' ? login.trim() && password : validPin(pin, 'manager'));
  const submit = async () => {
    setBusy(true);
    try {
      const body = mode === 'password' ? { login, password, deviceName: name } : { pin, deviceName: name };
      const r = await api<{ deviceToken: string; device: { order_prefix: string } }>('POST', '/api/devices/register', body);
      await completeRegistration(r.deviceToken);
      toast(`Đã đăng nhập. Máy này dùng mã đơn ${r.device.order_prefix}`);
    } catch (e) {
      toast((e as Error).message, true);
      setPassword(''); setPin('');
    } finally { setBusy(false); }
  };
  return (
    <div className="screen">
      <form className="scroll pad col gap16" style={{ paddingTop: 48 }} onSubmit={(e) => { e.preventDefault(); if (ready && !busy) submit(); }}>
        <Brand sub="Đăng nhập để dùng thiết bị này." />
        {mode === 'password' && (
          <>
            <label className="field"><span>Email hoặc tên đăng nhập</span><input className="input" autoComplete="username" autoCapitalize="none" value={login} onChange={(e) => setLogin(e.target.value)} /></label>
            <label className="field"><span>Mật khẩu</span><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          </>
        )}
        {mode === 'pin' && (
          <label className="field"><span>PIN quản lý (6 số)</span><input className="input" type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} /></label>
        )}
        <label className="field"><span>Đặt tên cho thiết bị này</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Máy quầy, Laptop" /></label>
        <button type="submit" className="btn primary lg block" disabled={!ready || busy || !mode}>{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
        <p className="tiny faint" style={{ margin: 0 }}>Máy chỉ cần đăng nhập một lần. Sau đó nhân viên chọn tên và nhập PIN như bình thường.</p>
        <span className="tiny faint">{appVersion()}</span>
      </form>
    </div>
  );
}

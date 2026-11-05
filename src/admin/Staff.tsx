// S29 — staff, roles, PIN, login accounts, limits. Staff never see cost or edit prices.
// Anyone can get a login account (email/username + password). It signs a new device in; on a signed-in
// device everyone still picks their name and enters their PIN. Only owner/manager accounts open Quản trị.
import { useState } from 'react';
import { passwordRule, pinRule, validLogin, validPassword, validPin } from '../../shared/crypto';
import type { Role } from '../../shared/types';
import { vnd } from '../../shared/util';
import { del, get, post, put } from '../lib/api';
import { toast, useStore } from '../lib/store';
import { Confirm, Icon, Sheet } from '../ui';
import { Loading, Num, Page, run, Select, Text, Toggle, useLoad } from './common';

interface S { id?: string; name: string; role: Role; active: number; max_discount_pct: number; cash_out_limit: number; hourly_rate?: number; pin?: string; login?: string | null; has_password?: number; password?: string }
const ROLE: Record<Role, string> = { owner: 'Chủ quán', manager: 'Quản lý', staff: 'Nhân viên' };

/** "Nguyễn Thị Linh" → "linh"; owner can change it. */
function suggestLogin(name: string) {
  const parts = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().split(/\s+/);
  const last = parts[parts.length - 1] || '';
  return last.length >= 3 ? last : parts.join('.');
}

/** Easy to read out loud, not guessable: dui-kmpa-4821 (no 0/o/1/l). */
function randomPassword() {
  const letters = 'abcdefghijkmnpqrstuvwxyz';
  const r = new Uint32Array(8);
  crypto.getRandomValues(r);
  const l = Array.from(r.slice(0, 4), (x) => letters[x % letters.length]).join('');
  const d = Array.from(r.slice(4), (x) => '23456789'[x % 8]).join('');
  return `dui-${l}-${d}`;
}

export default function Staff() {
  const list = useLoad(() => get<S[]>('/api/admin/staff'));
  const [e, setE] = useState<S | null>(null);
  const [acct, setAcct] = useState(false); // account section open
  const [showPw, setShowPw] = useState(false);
  const [askDel, setAskDel] = useState(false);
  const [askUnlink, setAskUnlink] = useState(false);
  const [creds, setCreds] = useState<{ name: string; login: string; password: string } | null>(null);
  const me = useStore((st) => st.staff?.id);

  const open = (s: S, withAccount = false) => {
    const fresh = withAccount && !s.has_password;
    setE({ ...s, pin: '', password: fresh ? randomPassword() : '', login: s.login || (fresh ? suggestLogin(s.name) : '') });
    setAcct(withAccount || !!s.has_password);
    setShowPw(fresh);
  };
  const startAccount = () => {
    if (!e) return;
    setE({ ...e, login: e.login || suggestLogin(e.name), password: e.password || randomPassword() });
    setAcct(true); setShowPw(true);
  };

  const remove = async () => {
    setAskDel(false);
    const r = await run(() => del<{ archived: boolean }>(`/api/admin/staff/${e!.id}`));
    if (r) {
      run(async () => 1, r.archived ? `Đã xoá ${e!.name}. Tên vẫn giữ trên đơn và bảng công cũ.` : `Đã xoá ${e!.name}`);
      setE(null); list.reload();
    }
  };
  const unlink = async () => {
    setAskUnlink(false);
    const ok = await run(() => put(`/api/admin/staff/${e!.id}`, { login: null }), `Đã xoá tài khoản đăng nhập của ${e!.name}`);
    if (ok) { setE(null); list.reload(); }
  };

  const newAccount = !!e && acct && !e.has_password;
  const loginOk = !acct || (!!e?.login && validLogin(e.login));
  const pwOk = !acct || (e?.password ? validPassword(e.password) : !!e?.has_password);
  const save = async () => {
    if (!e?.name.trim()) return;
    if (e.pin && !validPin(e.pin, e.role)) return;
    const account = acct ? { login: (e.login || '').trim(), password: e.password || undefined } : {};
    const body = { name: e.name, role: e.role, active: e.active, max_discount_pct: e.max_discount_pct, cash_out_limit: e.cash_out_limit, hourly_rate: Math.round(e.hourly_rate || 0), pin: e.pin || undefined, ...account };
    const ok = await run(() => (e.id ? put(`/api/admin/staff/${e.id}`, body) : post('/api/admin/staff', body)), 'Đã lưu nhân viên');
    if (ok) {
      if (acct && e.password) setCreds({ name: e.name, login: (e.login || '').trim().toLowerCase(), password: e.password });
      setE(null); list.reload();
    }
  };

  const credText = creds ? `Tài khoản Dui POS của ${creds.name}\nĐăng nhập tại: ${location.origin} (hoặc app Android Dui POS)\nTên đăng nhập: ${creds.login}\nMật khẩu: ${creds.password}` : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(credText); toast('Đã chép thông tin đăng nhập'); } catch { toast('Không chép được — hãy chụp màn hình'); }
  };

  return (
    <Page title="Nhân viên & tài khoản" right={
      <button className="btn sm primary" onClick={() => open({ name: '', role: 'staff', active: 1, max_discount_pct: 0, cash_out_limit: 100000, hourly_rate: 0, pin: '' })}>+ Nhân viên</button>
    }>
      <Loading error={list.error} loading={list.loading && !list.data} />
      <div className="list">
        {(list.data ?? []).map((s) => (
          <div key={s.id} className="li" style={{ opacity: s.active ? 1 : 0.5, cursor: 'pointer' }} onClick={() => open(s)}>
            <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
              <b>{s.name}</b>
              <span className="small muted">{ROLE[s.role]}{s.hourly_rate ? ` · ${vnd(s.hourly_rate)}/giờ` : ''} · chi két tối đa {vnd(s.cash_out_limit)}{s.active ? '' : ' · đã khoá'}</span>
              {s.has_password ? <span className="tiny" style={{ color: 'var(--ok)' }}><Icon name="check" size={12} /> Tài khoản: <b>{s.login}</b></span> : null}
            </span>
            {!s.has_password && (
              <button className="btn sm soft" onClick={(ev) => { ev.stopPropagation(); open(s, true); }}>+ Tạo tài khoản</button>
            )}
          </div>
        ))}
      </div>
      <p className="tiny faint">
        Tài khoản đăng nhập (email/tên đăng nhập + mật khẩu) dùng để đăng nhập máy mới, điện thoại hoặc laptop. Trên máy đã đăng nhập,
        mọi người vẫn chọn tên và nhập PIN. Chỉ tài khoản Chủ quán / Quản lý mới vào được Quản trị. Xem và khoá máy ở Quản trị › Thiết bị.
      </p>
      <p className="tiny faint">Đổi PIN hoặc vai trò có hiệu lực trên máy bán hàng sau lần đồng bộ tiếp theo (tối đa 15 giây khi có mạng).</p>

      {e && (
        <Sheet onClose={() => setE(null)}>
          <h2>{e.id ? 'Sửa nhân viên' : 'Nhân viên mới'}</h2>
          <div className="col gap12">
            <Text label="Tên" value={e.name} onChange={(v) => setE({ ...e, name: v })} />
            <Select label="Vai trò" value={e.role} onChange={(v) => setE({ ...e, role: v as Role })} options={[['staff', 'Nhân viên'], ['manager', 'Quản lý'], ['owner', 'Chủ quán']]} />
            <Text label={(e.id ? 'PIN mới (để trống nếu giữ nguyên) · ' : '') + pinRule(e.role)} type="password" inputMode="numeric" value={e.pin} onChange={(v) => setE({ ...e, pin: v.replace(/\D/g, '').slice(0, 6) })} />

            {!acct ? (
              <button className="btn soft" onClick={startAccount}><Icon name="plus" size={18} />Tạo tài khoản đăng nhập</button>
            ) : (
              <div className="card col gap12">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <b className="small">{newAccount ? 'Tạo tài khoản đăng nhập' : 'Tài khoản đăng nhập'}</b>
                  {newAccount && <button className="btn ghost sm" onClick={() => setAcct(false)}>Bỏ</button>}
                </div>
                <span className="tiny muted" style={{ marginTop: -6 }}>
                  Để {e.name.trim() || 'người này'} tự đăng nhập máy mới.{e.role === 'staff' ? ' Vai trò Nhân viên: chỉ bán hàng, không vào Quản trị.' : ''}
                </span>
                <Text label="Email hoặc tên đăng nhập" value={e.login ?? ''} onChange={(v) => setE({ ...e, login: v.trim() })} placeholder="VD: linh hoặc linh@dui.social" />
                {!!e.login && !validLogin(e.login) && <span className="tiny" style={{ color: 'var(--danger)', marginTop: -6 }}>3–64 ký tự, không dấu, không khoảng trắng</span>}
                <label className="field">
                  <span>{(e.has_password ? 'Mật khẩu mới (để trống nếu giữ nguyên) · ' : 'Mật khẩu · ') + passwordRule}</span>
                  <div className="row" style={{ gap: 8 }}>
                    <input className="input grow" type={showPw ? 'text' : 'password'} value={e.password ?? ''} onChange={(ev) => setE({ ...e, password: ev.target.value })} autoComplete="new-password" />
                    <button className="btn sm" onClick={() => setShowPw(!showPw)}>{showPw ? 'Ẩn' : 'Hiện'}</button>
                  </div>
                </label>
                <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => { setE({ ...e, password: randomPassword() }); setShowPw(true); }}>
                  <Icon name="sync" size={16} />Tạo mật khẩu ngẫu nhiên
                </button>
                {!!e.has_password && e.id !== me && (
                  <button className="btn ghost sm danger-text" style={{ alignSelf: 'flex-start' }} onClick={() => setAskUnlink(true)}>
                    <Icon name="trash" size={16} />Xoá tài khoản (giữ PIN)
                  </button>
                )}
              </div>
            )}

            <Num label="Lương giờ (₫/giờ, chỉ chủ quán thấy)" value={e.hourly_rate ?? 0} onChange={(v) => setE({ ...e, hourly_rate: Math.round(v) })} />
            <Num label="Hạn mức chi két không cần duyệt (₫)" value={e.cash_out_limit} onChange={(v) => setE({ ...e, cash_out_limit: Math.round(v) })} />
            <Num label="Giảm giá tối đa % (dùng ở P2)" value={e.max_discount_pct} onChange={(v) => setE({ ...e, max_discount_pct: Math.round(v) })} />
            {e.id && <Toggle label="Đang làm" checked={!!e.active} onChange={(v) => setE({ ...e, active: v ? 1 : 0 })} />}
            <button className="btn primary lg" disabled={!e.name.trim() || (!e.id && !validPin(e.pin || '', e.role)) || (!!e.pin && !validPin(e.pin, e.role)) || !loginOk || !pwOk} onClick={save}>
              {newAccount ? 'Lưu và tạo tài khoản' : 'Lưu'}
            </button>
            {e.id && e.id !== me && (
              <button className="btn ghost danger-text" onClick={() => setAskDel(true)}><Icon name="trash" size={18} />Xoá nhân viên</button>
            )}
          </div>
        </Sheet>
      )}

      {creds && (
        <Sheet middle onClose={() => setCreds(null)}>
          <h2>Đã tạo tài khoản</h2>
          <p className="small muted" style={{ margin: '6px 0 14px' }}>Gửi thông tin này cho {creds.name}. Mật khẩu chỉ hiện một lần — sau này quên thì đặt mật khẩu mới.</p>
          <div className="card col" style={{ gap: 6 }}>
            <span className="small muted">Tên đăng nhập</span><b className="mono" style={{ fontSize: 18 }}>{creds.login}</b>
            <span className="small muted" style={{ marginTop: 6 }}>Mật khẩu</span><b className="mono" style={{ fontSize: 18 }}>{creds.password}</b>
          </div>
          <div className="row mt16">
            <button className="btn grow" onClick={() => setCreds(null)}>Xong</button>
            <button className="btn primary grow" onClick={copy}>Chép để gửi</button>
          </div>
        </Sheet>
      )}

      {askUnlink && e && (
        <Confirm title={`Xoá tài khoản của ${e.name}?`} danger okText="Xoá tài khoản" onCancel={() => setAskUnlink(false)} onOk={unlink}
          text={<>{e.name} không đăng nhập máy mới bằng tài khoản được nữa. Máy đã đăng nhập vẫn dùng bình thường; PIN giữ nguyên.</>} />
      )}
      {askDel && e && (
        <Confirm title={`Xoá ${e.name}?`} danger okText="Xoá nhân viên" onCancel={() => setAskDel(false)} onOk={remove}
          text={<>
            {e.name} không đăng nhập, chấm công hay xuất hiện trên máy bán hàng được nữa; lịch làm từ hôm nay bị xoá.
            Đơn, bảng công và nhật ký cũ vẫn giữ tên {e.name} để báo cáo đúng. Không hoàn tác được — muốn tạm nghỉ thì chỉ cần tắt "Đang làm".
          </>} />
      )}
    </Page>
  );
}

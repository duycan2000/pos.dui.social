// S29 — staff, roles, PIN reset, limits. Staff never see cost or edit prices.
import { useState } from 'react';
import { passwordRule, pinRule, validLogin, validPassword, validPin } from '../../shared/crypto';
import type { Role } from '../../shared/types';
import { vnd } from '../../shared/util';
import { del, get, post, put } from '../lib/api';
import { useStore } from '../lib/store';
import { Confirm, Icon, Sheet } from '../ui';
import { Loading, Num, Page, run, Select, Text, Toggle, useLoad } from './common';

interface S { id?: string; name: string; role: Role; active: number; max_discount_pct: number; cash_out_limit: number; hourly_rate?: number; pin?: string; login?: string | null; has_password?: number; password?: string }
const ROLE: Record<Role, string> = { owner: 'Chủ quán', manager: 'Quản lý', staff: 'Nhân viên' };

export default function Staff() {
  const list = useLoad(() => get<S[]>('/api/admin/staff'));
  const [e, setE] = useState<S | null>(null);
  const [askDel, setAskDel] = useState(false);
  const me = useStore((st) => st.staff?.id);
  const remove = async () => {
    setAskDel(false);
    const r = await run(() => del<{ archived: boolean }>(`/api/admin/staff/${e!.id}`));
    if (r) {
      run(async () => 1, r.archived ? `Đã xoá ${e!.name}. Tên vẫn giữ trên đơn và bảng công cũ.` : `Đã xoá ${e!.name}`);
      setE(null); list.reload();
    }
  };
  const save = async () => {
    if (!e?.name.trim()) return;
    if (e.pin && !validPin(e.pin, e.role)) return;
    const account = e.role !== 'staff' ? { login: (e.login || '').trim() || null, password: e.password || undefined } : {};
    const body = { name: e.name, role: e.role, active: e.active, max_discount_pct: e.max_discount_pct, cash_out_limit: e.cash_out_limit, hourly_rate: Math.round(e.hourly_rate || 0), pin: e.pin || undefined, ...account };
    const ok = await run(() => (e.id ? put(`/api/admin/staff/${e.id}`, body) : post('/api/admin/staff', body)), 'Đã lưu nhân viên');
    if (ok) { setE(null); list.reload(); }
  };
  return (
    <Page title="Nhân viên" right={<button className="btn sm primary" onClick={() => setE({ name: '', role: 'staff', active: 1, max_discount_pct: 0, cash_out_limit: 100000, hourly_rate: 0, pin: '' })}>+ Nhân viên</button>}>
      <Loading error={list.error} loading={list.loading && !list.data} />
      <div className="list">
        {(list.data ?? []).map((s) => (
          <button key={s.id} className="li" style={{ opacity: s.active ? 1 : 0.5 }} onClick={() => setE({ ...s, pin: '' })}>
            <span className="grow col" style={{ gap: 2 }}><b>{s.name}</b><span className="small muted">{ROLE[s.role]}{s.role !== 'staff' ? (s.has_password ? ` · ${s.login ?? 'có tài khoản'}` : ' · chưa có mật khẩu') : ''}{s.hourly_rate ? ` · ${vnd(s.hourly_rate)}/giờ` : ''} · chi két tối đa {vnd(s.cash_out_limit)}{s.active ? '' : ' · đã khoá'}</span></span>
          </button>
        ))}
      </div>
      <p className="tiny faint">Đổi PIN hoặc vai trò có hiệu lực trên máy bán hàng sau lần đồng bộ tiếp theo (tối đa 15 giây khi có mạng).</p>
      {e && (
        <Sheet onClose={() => setE(null)}>
          <h2>{e.id ? 'Sửa nhân viên' : 'Nhân viên mới'}</h2>
          <div className="col gap12">
            <Text label="Tên" value={e.name} onChange={(v) => setE({ ...e, name: v })} />
            <Select label="Vai trò" value={e.role} onChange={(v) => setE({ ...e, role: v as Role })} options={[['staff', 'Nhân viên'], ['manager', 'Quản lý'], ['owner', 'Chủ quán']]} />
            <Text label={(e.id ? 'PIN mới (để trống nếu giữ nguyên) · ' : '') + pinRule(e.role)} type="password" inputMode="numeric" value={e.pin} onChange={(v) => setE({ ...e, pin: v.replace(/\D/g, '').slice(0, 6) })} />
            {e.role !== 'staff' && (
              <div className="card col gap12">
                <b className="small">Tài khoản đăng nhập</b>
                <span className="tiny muted" style={{ marginTop: -6 }}>Dùng để đăng nhập máy mới hoặc laptop quản trị. Trên máy đã đăng nhập, vẫn chọn tên + PIN như thường.</span>
                <Text label="Email hoặc tên đăng nhập" value={e.login ?? ''} onChange={(v) => setE({ ...e, login: v.trim() })} placeholder="VD: linh@dui.social" />
                <Text label={(e.has_password ? 'Mật khẩu mới (để trống nếu giữ nguyên) · ' : 'Mật khẩu · ') + passwordRule} type="password" value={e.password ?? ''} onChange={(v) => setE({ ...e, password: v })} />
              </div>
            )}
            <Num label="Lương giờ (₫/giờ, chỉ chủ quán thấy)" value={e.hourly_rate ?? 0} onChange={(v) => setE({ ...e, hourly_rate: Math.round(v) })} />
            <Num label="Hạn mức chi két không cần duyệt (₫)" value={e.cash_out_limit} onChange={(v) => setE({ ...e, cash_out_limit: Math.round(v) })} />
            <Num label="Giảm giá tối đa % (dùng ở P2)" value={e.max_discount_pct} onChange={(v) => setE({ ...e, max_discount_pct: Math.round(v) })} />
            {e.id && <Toggle label="Đang làm" checked={!!e.active} onChange={(v) => setE({ ...e, active: v ? 1 : 0 })} />}
            <button className="btn primary lg" disabled={!e.name.trim() || (!e.id && !validPin(e.pin || '', e.role)) || (!!e.pin && !validPin(e.pin, e.role))
              || (e.role !== 'staff' && ((!!e.login && !validLogin(e.login)) || (!!e.password && (!validPassword(e.password) || !e.login))))} onClick={save}>Lưu</button>
            {e.id && e.id !== me && (
              <button className="btn ghost danger-text" onClick={() => setAskDel(true)}><Icon name="trash" size={18} />Xoá nhân viên</button>
            )}
          </div>
        </Sheet>
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

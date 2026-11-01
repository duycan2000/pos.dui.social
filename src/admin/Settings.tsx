// S31 — outlet settings (VietQR account, business-day cut-off, receipt text, tax thresholds) and devices.
import { useEffect, useState } from 'react';
import type { Outlet, OutletSettings } from '../../shared/types';
import { parseSettings } from '../../shared/util';
import { get, post, put } from '../lib/api';
import { runSync } from '../lib/sync';
import { Confirm } from '../ui';
import { useStore } from '../lib/store';
import { Loading, Num, Page, run, Select, Text, Toggle, useLoad } from './common';

// Common NAPAS BINs. Check yours on the bank's VietQR page if it is not listed.
const BANKS: [string, string][] = [
  ['', '— chọn ngân hàng —'], ['970436', 'Vietcombank'], ['970415', 'VietinBank'], ['970418', 'BIDV'], ['970405', 'Agribank'],
  ['970407', 'Techcombank'], ['970422', 'MB Bank'], ['970416', 'ACB'], ['970432', 'VPBank'], ['970423', 'TPBank'],
  ['970403', 'Sacombank'], ['970437', 'HDBank'], ['970441', 'VIB'], ['970443', 'SHB'], ['970448', 'OCB'], ['970426', 'MSB'],
];

export function Settings() {
  const o = useLoad(() => get<Outlet>('/api/admin/outlet'));
  const owner = useStore((s) => s.staff?.role === 'owner');
  const [f, setF] = useState<Outlet | null>(null);
  const [st, setSt] = useState<OutletSettings>({});
  useEffect(() => { if (o.data) { setF(o.data); setSt(parseSettings<OutletSettings>(o.data.settings_json)); } }, [o.data]);
  if (!f) return <Page title="Cài đặt"><Loading error={o.error} loading /></Page>;
  const save = async () => {
    const { id, ...rest } = f as Outlet & { created_at?: number; updated_at?: number };
    delete (rest as any).created_at; delete (rest as any).updated_at;
    await run(() => put('/api/admin/outlet', { ...rest, settings_json: JSON.stringify(st) }), 'Đã lưu cài đặt');
    o.reload();
  };
  const bin = BANKS.some(([b]) => b === f.vietqr_bank_bin) ? f.vietqr_bank_bin ?? '' : '';
  return (
    <Page title="Cài đặt" footer={owner ? <button className="btn primary lg block" onClick={save}>Lưu cài đặt</button> : undefined}>
      {!owner && <div className="banner">Chỉ chủ quán sửa được cài đặt.</div>}
      <div className="section-title">Quán</div>
      <div className="form-grid">
        <Text label="Tên quán" value={f.name} onChange={(v) => setF({ ...f, name: v })} />
        <Select label="Loại hình" value={f.business_type} onChange={(v) => setF({ ...f, business_type: v })} options={[['bar', 'Bar'], ['cafe', 'Cafe'], ['restaurant', 'Nhà hàng']]} />
        <Text label="Giờ chốt ngày kinh doanh (cut-off)" type="time" value={f.business_day_cutoff} onChange={(v) => setF({ ...f, business_day_cutoff: v })} />
        <Num label="Múi giờ (phút so với UTC, VN = 420)" value={f.tz_offset_min} onChange={(v) => setF({ ...f, tz_offset_min: Math.round(v) })} />
      </div>
      <p className="tiny faint" style={{ margin: 0 }}>Đơn trước giờ cut-off (VD 05:00) tính vào ngày hôm trước.</p>

      <div className="section-title">VietQR</div>
      <div className="form-grid">
        <Select label="Ngân hàng" value={bin} onChange={(v) => setF({ ...f, vietqr_bank_bin: v || null })} options={BANKS} />
        <Text label="Mã BIN (nếu ngân hàng không có trong danh sách)" inputMode="numeric" value={f.vietqr_bank_bin} onChange={(v) => setF({ ...f, vietqr_bank_bin: v.replace(/\D/g, '') || null })} />
        <Text label="Số tài khoản" inputMode="numeric" value={f.vietqr_account} onChange={(v) => setF({ ...f, vietqr_account: v.replace(/\s/g, '') || null })} />
        <Text label="Tên chủ tài khoản (hiện dưới mã QR)" value={f.vietqr_account_name} onChange={(v) => setF({ ...f, vietqr_account_name: v || null })} />
      </div>
      <p className="tiny faint" style={{ margin: 0 }}>Sau khi lưu, quét thử mã QR một đơn nhỏ bằng app ngân hàng để chắc chắn đúng tài khoản.</p>

      {owner && <><div className="section-title">Dữ liệu demo</div><DemoData /></>}

      <div className="section-title">Webhook ngân hàng (tự xác nhận chuyển khoản)</div>
      <WebhookHelp />

      <div className="section-title">Hoá đơn & màn bán</div>
      <div className="form-grid">
        <Text label="Dòng đầu bill (in dưới tên quán, nên viết tiếng Anh)" value={f.receipt_header} onChange={(v) => setF({ ...f, receipt_header: v || null })} />
        <Text label="Dòng cuối bill (mặc định: Thank you — see you again soon!)" value={f.receipt_footer} onChange={(v) => setF({ ...f, receipt_footer: v || null })} />
        <Num label="Tự quay về đơn mới sau (giây)" value={st.done_return_seconds ?? 5} onChange={(v) => setSt({ ...st, done_return_seconds: v })} />
        <Num label="Cảnh báo giá vốn khi vượt (%)" value={st.cost_alert_pct ?? 30} onChange={(v) => setSt({ ...st, cost_alert_pct: v })} />
      </div>

      <div className="section-title">Giờ làm</div>
      <div className="form-grid">
        <Num label="Phụ cấp giờ đêm 22:00–06:00 (% lương giờ, 0 = không)" value={st.night_premium_pct ?? 0} onChange={(v) => setSt({ ...st, night_premium_pct: Math.max(0, v) })} />
        <Num label="Cho phép trễ (phút) trước khi tính đi trễ" value={st.late_grace_min ?? 10} onChange={(v) => setSt({ ...st, late_grace_min: Math.max(0, Math.round(v)) })} />
      </div>
      <p className="tiny faint" style={{ margin: 0 }}>Bộ luật Lao động quy định làm đêm được trả thêm ít nhất 30% — áp dụng thế nào cho nhân viên part-time theo giờ, hãy hỏi kế toán. Để 0 nếu lương giờ đã gồm phụ cấp.</p>

      <div className="section-title">Thuế (chỉ để theo dõi — xác nhận với kế toán)</div>
      <div className="banner">Luật thuế hộ kinh doanh thay đổi từ 2026 và còn đang được hướng dẫn. Không có tỷ lệ nào được cài sẵn trong code; mọi ngưỡng nhập ở đây.</div>
      <div className="form-grid">
        <Num label="Ngưỡng doanh thu năm để cảnh báo (₫)" value={st.tax_threshold_year ?? 0} onChange={(v) => setSt({ ...st, tax_threshold_year: Math.round(v) })} />
        <Text label="Ghi chú phương pháp thuế" value={st.tax_note} onChange={(v) => setSt({ ...st, tax_note: v })} />
      </div>
    </Page>
  );
}

interface Device { id: string; name: string; order_prefix: string; active: number; last_seen_at: number | null; created_at: number }

export function Devices() {
  const list = useLoad(() => get<Device[]>('/api/admin/devices'));
  const me = useStore((s) => s.config?.device.id);
  return (
    <Page title="Thiết bị" sub="Thêm máy: mở app trên máy mới, chủ/quản lý nhập PIN để đăng ký">
      <Loading error={list.error} loading={list.loading && !list.data} />
      <div className="list">
        {(list.data ?? []).map((d) => (
          <div key={d.id} className="li">
            <span className="grow col" style={{ gap: 2 }}>
              <b>{d.name} {d.id === me ? '(máy này)' : ''}</b>
              <span className="small muted">Mã đơn {d.order_prefix} · lần cuối {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString('vi-VN') : '—'}</span>
            </span>
            <Toggle label={d.active ? 'Đang dùng' : 'Đã khoá'} checked={!!d.active} onChange={async (v) => { await run(() => put(`/api/admin/devices/${d.id}`, { active: v ? 1 : 0 }), v ? 'Đã mở khoá' : 'Đã khoá máy'); list.reload(); }} />
          </div>
        ))}
      </div>
      <p className="tiny faint">Máy mất hoặc bị đánh cắp: khoá ở đây, máy đó không đồng bộ được nữa.</p>
    </Page>
  );
}

function WebhookHelp() {
  const on = useStore((s) => !!s.config?.features?.bankWebhook);
  const url = `${location.origin}/api/webhooks/bank`;
  return (
    <div className="card col gap12">
      <div className="row gap12"><span className={'dot' + (on ? '' : ' off')} /><b>{on ? 'Đang bật' : 'Chưa bật'}</b></div>
      <ol className="small muted" style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <li>Cloudflare › Worker <b>dui-social-pos</b> › Settings › Variables and Secrets › thêm <b>Secret</b> tên <code>BANK_WEBHOOK_KEY</code>, giá trị là một chuỗi bí mật dài (VD 32 ký tự ngẫu nhiên).</li>
        <li><b>SePay</b>: Tích hợp Webhook › URL <code>{url}</code>, xác thực “API Key” = chuỗi bí mật ở trên.</li>
        <li><b>Casso</b>: Webhook › URL <code>{url}</code>, Security Key = chuỗi bí mật ở trên.</li>
        <li>Khách chuyển khoản với nội dung “DUI A012” (đã có sẵn trong mã QR). Tiền vào đủ thì đơn tự chuyển sang Đã thanh toán; chuyển dư được ghi là tip.</li>
      </ol>
      <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => navigator.clipboard?.writeText(url).then(() => run(async () => 1, 'Đã chép URL'))}>Chép URL webhook</button>
    </div>
  );
}

function DemoData() {
  const st = useLoad(() => get<{ seeded: boolean; items: number; orders: number; revenue: number; days: string[] }>('/api/admin/demo'));
  const [progress, setProgress] = useState<string | null>(null);
  const [askClear, setAskClear] = useState(false);
  const create = async () => {
    const days = st.data!.days;
    setProgress('Đang tạo menu, kho, nhân viên demo…');
    const ok = await run(() => post('/api/admin/demo/seed', { step: 'menu' }));
    if (!ok) { setProgress(null); return; }
    for (let i = 0; i < days.length; i++) {
      setProgress(`Đang tạo đơn ngày ${days[i].slice(8)}/${days[i].slice(5, 7)} (${i + 1}/${days.length})…`);
      const r = await run(() => post('/api/admin/demo/seed', { step: 'day', day: days[i] }));
      if (!r) break;
    }
    setProgress(null);
    await st.reload();
    runSync();
    run(async () => 1, 'Đã tạo dữ liệu demo');
  };
  const clear = async () => {
    setAskClear(false);
    setProgress('Đang xoá dữ liệu demo…');
    await run(() => post('/api/admin/demo/clear'), 'Đã xoá sạch dữ liệu demo');
    setProgress(null);
    await st.reload();
    runSync();
  };
  const d = st.data;
  const month = d ? `${d.days[0].slice(5, 7)}/${d.days[0].slice(0, 4)}` : '';
  return (
    <div className="card col gap12">
      {d?.seeded
        ? <div className="banner ok">Đang có dữ liệu demo: {d.items} món, {d.orders} đơn tháng {month}, doanh thu {d.revenue.toLocaleString('vi-VN')} ₫.</div>
        : <p className="small muted" style={{ margin: 0 }}>Tạo menu bar mẫu (17 món có công thức, nguyên liệu, nhà cung cấp, chi phí tháng), 2 nhân viên mẫu (Linh — quản lý, PIN 111111; Nam — nhân viên, PIN 2222) và 10–15 đơn mỗi ngày cho cả tháng {month}. Xem kết quả ở Tổng quan, Báo cáo, Giá vốn, Kho (chọn “Tháng trước”).</p>}
      {progress && <div className="banner info" style={{ alignItems: 'center' }}><span className="spinner" />{progress}</div>}
      <div className="row wrap">
        <button className="btn primary" disabled={!d || d.seeded || !!progress} onClick={create}>Tạo dữ liệu demo</button>
        <button className="btn danger" disabled={!d?.seeded || !!progress} onClick={() => setAskClear(true)}>Xoá sạch dữ liệu demo</button>
      </div>
      <p className="tiny faint" style={{ margin: 0 }}>Mọi thứ demo có mã bắt đầu bằng DEMO. Nút xoá chỉ xoá đúng các dữ liệu đó, không đụng tới món, đơn hay cài đặt thật của bạn. Nếu bạn sửa món demo, món đó vẫn bị xoá cùng.</p>
      {askClear && <Confirm title="Xoá sạch dữ liệu demo?" text="Món, nguyên liệu, nhân viên, đơn và chi phí demo sẽ bị xoá vĩnh viễn. Dữ liệu thật được giữ nguyên." okText="Xoá demo" danger onCancel={() => setAskClear(false)} onOk={clear} />}
    </div>
  );
}

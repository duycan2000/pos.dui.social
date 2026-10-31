// Printer setup on this phone: connection type, paper width, automatic printing, test print.
import { useEffect, useState } from 'react';
import type { Order } from '../../shared/types';
import { bleSupported, DEFAULT_PRINTER, kickDrawer, loadPrinter, pairBle, type PrinterSettings as P, printDoc, renderDoc, savePrinter } from '../lib/printer';
import { preBillDoc } from '../lib/receipts';
import { navigate, toast, useStore } from '../lib/store';
import { Icon, Segmented, Sheet, TopBar } from '../ui';

export default function PrinterSettings() {
  const cfg = useStore((s) => s.config)!;
  const [p, setP] = useState<P>(DEFAULT_PRINTER);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => { loadPrinter().then(setP); }, []);
  const update = async (patch: Partial<P>) => { const next = { ...p, ...patch }; setP(next); await savePrinter(next); };
  const pair = async () => {
    setBusy(true);
    try { const name = await pairBle(); await update({ mode: 'ble', deviceName: name }); toast(`Đã kết nối ${name}`); }
    catch (e) { const m = (e as Error).message; if (!/cancel/i.test(m)) toast(m, true); }
    finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true);
    try {
      await printDoc([
        { t: 'text', text: cfg.outlet.name.toUpperCase(), align: 'center', size: 'lg', bold: true },
        { t: 'text', text: 'In thử — tiếng Việt có dấu: ăn uống đầy đủ', align: 'center', size: 'sm' },
        { t: 'hr' },
        { t: 'row', left: '2 × Ginger Mule', right: '240.000' },
        { t: 'row', left: 'TỔNG', right: '240.000 ₫', size: 'lg', bold: true },
        { t: 'hr' },
        { t: 'text', text: `Khổ ${p.paper}mm · ${cfg.device.name}`, align: 'center', size: 'sm' },
      ]);
      toast('Đã gửi bản in thử');
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  };
  const showPreview = async () => {
    const sample = { id: 'x', outlet_id: '', device_id: '', short_code: `${cfg.device.order_prefix}-012`, business_day: new Date().toISOString().slice(0, 10), staff_id: cfg.staff[0]?.id ?? '',
      staff_shift_id: null, drawer_session_id: null, order_type: 'dine_in', customer_label: 'John', status: 'open', subtotal: 360000, promo_total: 120000, discount_total: 0, comp_total: 0, total: 240000,
      sent_at: null, paid_at: null, void_reason: null, voided_by: null, approved_by: null, voided_at: null, created_at: Date.now(), updated_at: Date.now(), adjustments: [], payments: [],
      lines: [
        { id: '1', item_id: '', item_name: 'Ginger Mule', unit_price: 120000, qty: 2, modifiers: [], line_total: 240000, note: 'ít đá', status: 'active', sort: 0 },
        { id: '2', item_id: '', item_name: 'Lychee Sour', unit_price: 120000, qty: 1, modifiers: [], line_total: 120000, note: null, status: 'active', sort: 1 },
      ] } as Order;
    setPreview(renderDoc(await preBillDoc(cfg, sample), p.paper).toDataURL());
  };
  return (
    <div className="screen">
      <TopBar title="Máy in" sub={`Cài riêng cho ${cfg.device.name}`} onBack={() => navigate('order')} />
      <div className="scroll pad col gap16">
        <div className="section-title" style={{ marginTop: 0 }}>Kết nối</div>
        <Segmented value={p.mode} onChange={(v) => update({ mode: v })} options={[['none', 'Không in'], ['ble', 'Bluetooth'], ['rawbt', 'Qua app RawBT']]} />
        <div className="banner info"><Icon name="printer" size={18} /><span>Máy in <b>DM01 (Bluetooth Mobile Thermal Printer, 58mm)</b>: thử <b>Bluetooth</b> trước. Nếu không thấy máy trong danh sách hoặc báo “không tìm thấy cổng in”, chọn <b>Qua app RawBT</b>.</span></div>
        {p.mode === 'ble' && (
          <div className="card col gap12">
            <div className="row gap12">
              <div className="iconbtn" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}><Icon name="bluetooth" /></div>
              <div className="col grow" style={{ gap: 2 }}><b>{p.deviceName || 'Chưa chọn máy in'}</b><span className="small muted">In trực tiếp từ Chrome, cho máy in hỗ trợ BLE</span></div>
            </div>
            {!bleSupported() && <div className="banner danger">Trình duyệt này không hỗ trợ Bluetooth. Dùng Chrome trên Android hoặc chọn “Qua app RawBT”.</div>}
            <button className="btn primary" disabled={busy || !bleSupported()} onClick={pair}><Icon name="bluetooth" size={20} />{p.deviceName ? 'Chọn lại máy in' : 'Tìm và kết nối máy in'}</button>
            <p className="tiny faint" style={{ margin: 0 }}>Bật máy in, để gần điện thoại. Nếu máy in không hiện hoặc kết nối báo lỗi, máy in có thể chỉ có Bluetooth thường — chọn “Qua app RawBT”. Sau khi mở lại app, lần in đầu có thể cần bấm kết nối lại.</p>
          </div>
        )}
        {p.mode === 'rawbt' && (
          <div className="card col gap12">
            <b>Dùng app RawBT</b>
            <ol className="small muted" style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <li>Cài “RawBT print service” từ Google Play.</li>
              <li>Ghép đôi máy in trong Cài đặt Bluetooth của Android, rồi chọn máy in trong RawBT.</li>
              <li>Bấm In thử bên dưới. Lần đầu Android hỏi mở bằng RawBT: chọn “Luôn luôn”.</li>
            </ol>
          </div>
        )}
        {p.mode !== 'none' && (
          <>
            <div className="section-title">Giấy</div>
            <Segmented value={String(p.paper) as '58' | '80'} onChange={(v) => update({ paper: v === '80' ? 80 : 58 })} options={[['58', 'Khổ 58mm'], ['80', 'Khổ 80mm']]} />
            <div className="section-title">Tự động</div>
            <div className="list">
              <label className="li check"><input type="checkbox" checked={p.autoReceipt} onChange={(e) => update({ autoReceipt: e.target.checked })} /><span className="grow">In hoá đơn sau mỗi lần thanh toán</span></label>
              <label className="li check"><input type="checkbox" checked={p.autoTicket} onChange={(e) => update({ autoTicket: e.target.checked })} /><span className="grow">In phiếu pha chế khi gửi đơn hoặc lượt tab mới</span></label>
              <label className="li check"><input type="checkbox" checked={p.slow !== false} onChange={(e) => update({ slow: e.target.checked })} /><span className="grow">Máy in mini cầm tay — gửi chậm cho ổn định <span className="small faint">(nên bật với DM01)</span></span></label>
              <label className="li check"><input type="checkbox" checked={p.openDrawer} onChange={(e) => update({ openDrawer: e.target.checked })} /><span className="grow">Mở két tiền khi thu tiền mặt <span className="small faint">(két cắm vào máy in)</span></span></label>
            </div>
            <div className="row">
              <button className="btn primary grow" disabled={busy} onClick={test}><Icon name="printer" size={20} />In thử</button>
              {p.openDrawer && <button className="btn" disabled={busy} onClick={() => kickDrawer().then(() => toast('Đã mở két')).catch((e) => toast(e.message, true))}>Mở két</button>}
            </div>
            <button className="btn outline" onClick={showPreview}>Xem trước bill mẫu</button>
            <p className="tiny faint" style={{ margin: 0 }}>Hoá đơn được in dạng ảnh nên luôn đúng dấu tiếng Việt, không cần chọn bảng mã.</p>
          </>
        )}
      </div>
      {preview && (
        <Sheet onClose={() => setPreview(null)}>
          <h2>Bill mẫu khổ {p.paper}mm</h2>
          <p className="small muted" style={{ marginTop: 4 }}>Đúng như máy in sẽ in ra.</p>
          <div style={{ background: '#fff', padding: 12, borderRadius: 12, display: 'flex', justifyContent: 'center' }}><img src={preview} alt="Bill mẫu" style={{ width: '100%', maxWidth: 320, imageRendering: 'pixelated' }} /></div>
        </Sheet>
      )}
    </div>
  );
}

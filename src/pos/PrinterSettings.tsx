// Printer setup on this phone: connection type, paper width, automatic printing, test print.
import { useEffect, useState } from 'react';
import type { Order } from '../../shared/types';
import { bleSupported, DEFAULT_PRINTER, kickDrawer, loadPrinter, pairBle, type PrinterSettings as P, printDoc, renderDoc, savePrinter } from '../lib/printer';
import { preBillDoc, qrBillDoc, receiptDoc } from '../lib/receipts';
import { navigate, toast, useStore } from '../lib/store';
import { Icon, Segmented, Sheet, TopBar } from '../ui';

export default function PrinterSettings() {
  const cfg = useStore((s) => s.config)!;
  const [p, setP] = useState<P>(DEFAULT_PRINTER);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ kind: 'bill' | 'receipt' | 'qr'; url: string } | null>(null);
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
  const showPreview = async (kind: 'bill' | 'receipt' | 'qr') => {
    // A realistic sample from this menu: two drinks of the first items (English names on paper).
    const [i1, i2] = cfg.items.filter((i) => i.active);
    const mk = (id: string, it: typeof i1 | undefined, qty: number, sort: number, note: string | null = null) => ({
      id, item_id: it?.id ?? '', item_name: it?.name_vi ?? 'Ginger Mule', unit_price: it?.price ?? 120000, qty, modifiers: [], line_total: (it?.price ?? 120000) * qty, note, status: 'active' as const, sort,
    });
    const lines = [mk('1', i1, 2, 0, 'less ice'), mk('2', i2 ?? i1, 1, 1)];
    const subtotal = lines.reduce((s, l) => s + l.line_total, 0);
    const promo = lines[0].unit_price;
    const total = subtotal - promo;
    const now = Date.now();
    const sample = {
      id: 'x', outlet_id: '', device_id: '', short_code: `${cfg.device.order_prefix}-012`, business_day: new Date().toISOString().slice(0, 10), staff_id: cfg.staff[0]?.id ?? '',
      staff_shift_id: null, drawer_session_id: null, order_type: 'dine_in', customer_label: null, status: kind === 'receipt' ? 'paid' : 'open', subtotal, promo_total: promo, discount_total: 0, comp_total: 0, total,
      table_id: cfg.tables?.[0]?.id ?? null, guests: 3, sent_at: null, paid_at: kind === 'receipt' ? now : null, void_reason: null, voided_by: null, approved_by: null, voided_at: null, created_at: now - 3600000, updated_at: now,
      adjustments: [], lines,
      payments: kind !== 'receipt' ? [] : [{ id: 'p', method: 'cash', amount: total, tip: 20000, tendered: Math.ceil((total + 20000) / 100000) * 100000, change_given: Math.ceil((total + 20000) / 100000) * 100000 - total - 20000, reference: null, status: 'confirmed', confirmed_by: null, confirmed_at: now, drawer_session_id: null, created_at: now }],
    } as Order;
    let doc;
    try { doc = kind === 'bill' ? await preBillDoc(cfg, sample) : kind === 'qr' ? await qrBillDoc(cfg, sample, total) : receiptDoc(cfg, sample); }
    catch (e) { toast((e as Error).message, true); return; }
    setPreview({ kind, url: renderDoc(doc, p.paper).toDataURL() });
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
              <label className="li check"><input type="checkbox" checked={p.autoQrBill !== false} onChange={(e) => update({ autoQrBill: e.target.checked })} /><span className="grow">In bill có mã QR khi khách chọn chuyển khoản</span></label>
              <label className="li check"><input type="checkbox" checked={p.autoTicket} onChange={(e) => update({ autoTicket: e.target.checked })} /><span className="grow">In phiếu pha chế khi gửi đơn hoặc lượt tab mới</span></label>
              <label className="li check"><input type="checkbox" checked={p.slow !== false} onChange={(e) => update({ slow: e.target.checked })} /><span className="grow">Máy in mini cầm tay — gửi chậm cho ổn định <span className="small faint">(nên bật với DM01)</span></span></label>
              <label className="li check"><input type="checkbox" checked={p.openDrawer} onChange={(e) => update({ openDrawer: e.target.checked })} /><span className="grow">Mở két tiền khi thu tiền mặt <span className="small faint">(két cắm vào máy in)</span></span></label>
            </div>
            <div className="row">
              <button className="btn primary grow" disabled={busy} onClick={test}><Icon name="printer" size={20} />In thử</button>
              {p.openDrawer && <button className="btn" disabled={busy} onClick={() => kickDrawer().then(() => toast('Đã mở két')).catch((e) => toast(e.message, true))}>Mở két</button>}
            </div>
            <button className="btn outline" onClick={() => showPreview('bill')}>Xem trước bill mẫu</button>
            <p className="tiny faint" style={{ margin: 0 }}>Hoá đơn được in dạng ảnh nên luôn đúng dấu tiếng Việt, không cần chọn bảng mã.</p>
          </>
        )}
      </div>
      {preview && (
        <Sheet onClose={() => setPreview(null)}>
          <h2>Bill mẫu khổ {p.paper}mm</h2>
          <p className="small muted" style={{ marginTop: 4 }}>Đúng như máy in sẽ in ra. Bill cho khách bằng tiếng Anh, tên món lấy theo tên tiếng Anh trong Menu.</p>
          <Segmented value={preview.kind} onChange={(v) => showPreview(v)} options={[['bill', 'Bill tạm tính'], ['qr', 'Bill có QR'], ['receipt', 'Hoá đơn đã trả']]} />
          <div className="mt16" style={{ background: '#fff', padding: 12, borderRadius: 12, display: 'flex', justifyContent: 'center' }}><img src={preview.url} alt="Bill mẫu" style={{ width: '100%', maxWidth: 320, imageRendering: 'pixelated' }} /></div>
        </Sheet>
      )}
    </div>
  );
}

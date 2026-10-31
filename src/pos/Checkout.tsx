// S10–S14 — choose payment method; cash with change, VietQR (local QR, manual confirm), card reference, mixed.
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { cashSuggestions } from '../../shared/pricing';
import type { Payment, PayMethod } from '../../shared/types';
import { vnd, vndShort } from '../../shared/util';
import { vietQrPayload } from '../../shared/vietqr';
import { cartTotals, finalizeCart, makePayment, navigate, peekShortCode, setState, toast, useStore } from '../lib/store';
import { Icon, MoneyInput, Sheet, TopBar } from '../ui';

type Step = 'methods' | 'cash' | 'vietqr' | 'card' | 'mixed';

export default function Checkout() {
  const cart = useStore((s) => s.cart);
  const [step, setStep] = useState<Step>('methods');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { peekShortCode().then(setCode); }, []);
  const due = cartTotals(cart.lines).total;
  useEffect(() => { if (!cart.lines.length) navigate('order'); }, [cart.lines.length]);

  const finish = async (status: 'paid' | 'awaiting_payment', payments: Payment[], change = 0) => {
    if (busy) return;
    setBusy(true);
    try {
      const order = await finalizeCart(status, payments);
      if (status === 'paid') {
        setState({ lastPaid: { order, change } });
        navigate('done');
      } else {
        toast(`Đã lưu #${order.short_code} — chờ xác nhận chuyển khoản`);
        navigate('order');
      }
    } finally { setBusy(false); }
  };

  const back = () => (step === 'methods' ? navigate('cart') : setStep('methods'));
  const title = { methods: `Thanh toán #${code}`, cash: 'Tiền mặt', vietqr: 'VietQR', card: 'Thẻ', mixed: 'Thanh toán kết hợp' }[step];

  return (
    <div className="screen">
      <TopBar title={title} onBack={back} />
      {step === 'methods' && (
        <div className="scroll pad col gap12">
          <div className="center row" style={{ padding: '16px 0' }}><span className="huge mono">{vnd(due)}</span></div>
          <button className="btn lg block" style={{ justifyContent: 'flex-start' }} onClick={() => setStep('cash')}><Icon name="cash" />Tiền mặt</button>
          <button className="btn lg block" style={{ justifyContent: 'flex-start' }} onClick={() => setStep('vietqr')}><Icon name="qr" />Chuyển khoản VietQR</button>
          <button className="btn lg block" style={{ justifyContent: 'flex-start' }} onClick={() => setStep('card')}><Icon name="card" />Thẻ (máy POS ngân hàng)</button>
          <button className="btn lg block" style={{ justifyContent: 'flex-start' }} onClick={() => setStep('mixed')}><Icon name="split" />Kết hợp nhiều cách</button>
        </div>
      )}
      {step === 'cash' && <CashPay due={due} busy={busy} onPay={(tendered) => finish('paid', [makePayment('cash', due, { tendered, change_given: tendered - due })], tendered - due)} />}
      {step === 'vietqr' && (
        <QrPay amount={due} code={code} busy={busy}
          onReceived={() => finish('paid', [makePayment('vietqr', due, { reference: 'DUI ' + code.replace('-', '') })])}
          onWait={() => finish('awaiting_payment', [makePayment('vietqr', due, { status: 'pending', reference: 'DUI ' + code.replace('-', '') })])}
          onCancel={() => setStep('methods')} />
      )}
      {step === 'card' && <CardPay due={due} busy={busy} onPay={(ref) => finish('paid', [makePayment('card', due, { reference: ref || null })])} />}
      {step === 'mixed' && <MixedPay due={due} code={code} busy={busy} onPay={(parts) => finish('paid', parts, parts.reduce((s, p) => s + p.change_given, 0))} />}
    </div>
  );
}

function CashPay({ due, onPay, busy }: { due: number; onPay: (tendered: number) => void; busy: boolean }) {
  const [got, setGot] = useState(0);
  const change = got - due;
  return (
    <>
      <div className="scroll pad col gap16">
        <div className="kv big"><span className="muted">Cần thu</span><span className="mono">{vnd(due)}</span></div>
        <MoneyInput label="Khách đưa" value={got} onChange={setGot} autoFocus />
        <div className="opts">
          {cashSuggestions(due).map((v) => <button key={v} className={'opt' + (got === v ? ' on' : '')} onClick={() => setGot(v)}>{v === due ? 'Vừa đủ' : vndShort(v)}</button>)}
        </div>
        <div className="card center row col" style={{ gap: 4 }}>
          <span className="muted">Tiền thối</span>
          <span className={'huge mono ' + (change < 0 ? 'danger' : 'accent')}>{got ? vnd(Math.max(0, change)) : '—'}</span>
          {got > 0 && change < 0 && <span className="danger small">Còn thiếu {vnd(-change)}</span>}
        </div>
      </div>
      <div className="cartbar"><button className="btn primary lg block" disabled={busy || got < due} onClick={() => onPay(got)}>Xác nhận đã thu</button></div>
    </>
  );
}

export function QrImage({ amount, code }: { amount: number; code: string }) {
  const outlet = useStore((s) => s.config!.outlet);
  const [src, setSrc] = useState('');
  const ready = !!(outlet.vietqr_bank_bin && outlet.vietqr_account);
  useEffect(() => {
    if (!ready) return;
    const payload = vietQrPayload({ bankBin: outlet.vietqr_bank_bin!, account: outlet.vietqr_account!, amount, purpose: 'DUI ' + code.replace('-', '') });
    QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 1, width: 520 }).then(setSrc).catch(() => setSrc(''));
  }, [amount, code, ready, outlet.vietqr_bank_bin, outlet.vietqr_account]);
  if (!ready) return <div className="banner danger">Chưa cài tài khoản VietQR. Vào Quản trị › Cài đặt để nhập mã ngân hàng (BIN) và số tài khoản.</div>;
  return (
    <div className="col center" style={{ alignItems: 'center' }}>
      <div className="qr">{src ? <img src={src} alt={`Mã VietQR ${vnd(amount)}`} /> : null}</div>
      <div className="small muted center row" style={{ textAlign: 'center' }}>{outlet.vietqr_account_name || ''} · {outlet.vietqr_account}<br />Nội dung: DUI {code.replace('-', '')}</div>
    </div>
  );
}

function QrPay({ amount, code, onReceived, onWait, onCancel, busy }: { amount: number; code: string; onReceived: () => void; onWait: () => void; onCancel: () => void; busy: boolean }) {
  return (
    <>
      <div className="scroll pad col gap12">
        <div className="center row"><span className="huge mono">{vnd(amount)}</span></div>
        <QrImage amount={amount} code={code} />
        <p className="small muted" style={{ textAlign: 'center' }}>Kiểm tra app ngân hàng, thấy tiền vào đúng số và nội dung thì bấm “Đã nhận tiền”. Khách chuyển chậm thì bấm “Chờ xác nhận” để bán tiếp.</p>
      </div>
      <div className="cartbar col">
        <button className="btn ok lg block" disabled={busy} onClick={onReceived}><Icon name="check" />Đã nhận tiền</button>
        <div className="row">
          <button className="btn grow" onClick={onCancel}>Huỷ</button>
          <button className="btn grow" disabled={busy} onClick={onWait}>Chờ xác nhận</button>
        </div>
      </div>
    </>
  );
}

function CardPay({ due, onPay, busy }: { due: number; onPay: (ref: string) => void; busy: boolean }) {
  const [ref, setRef] = useState('');
  return (
    <>
      <div className="scroll pad col gap16">
        <div className="center row"><span className="huge mono">{vnd(due)}</span></div>
        <p className="muted">Quẹt thẻ trên máy POS của ngân hàng, sau đó ghi nhận ở đây. Không lưu số thẻ.</p>
        <label className="field"><span>Mã chuẩn chi trên slip (không bắt buộc)</span><input className="input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="VD: 123456" /></label>
      </div>
      <div className="cartbar"><button className="btn primary lg block" disabled={busy} onClick={() => onPay(ref.trim())}>Đã thanh toán</button></div>
    </>
  );
}

function MixedPay({ due, code, onPay, busy }: { due: number; code: string; onPay: (p: Payment[]) => void; busy: boolean }) {
  const [parts, setParts] = useState<Payment[]>([]);
  const [adding, setAdding] = useState<PayMethod | null>(null);
  const paid = parts.reduce((s, p) => s + p.amount, 0);
  const remaining = due - paid;
  const names: Record<PayMethod, string> = { cash: 'Tiền mặt', vietqr: 'VietQR', card: 'Thẻ' };
  return (
    <>
      <div className="scroll pad col gap12">
        <div className="kv big"><span className="muted">Tổng</span><span className="mono">{vnd(due)}</span></div>
        <div className="list">
          {parts.map((p) => (
            <div key={p.id} className="li">
              <span className="grow">{names[p.method]}{p.method === 'cash' && p.change_given ? <span className="small muted"> · thối {vnd(p.change_given)}</span> : null}</span>
              <span className="mono">{vnd(p.amount)}</span>
              <button className="iconbtn ghost" aria-label="Bỏ phần này" onClick={() => setParts(parts.filter((x) => x.id !== p.id))}><Icon name="close" size={18} /></button>
            </div>
          ))}
        </div>
        <div className={'kv big ' + (remaining === 0 ? 'ok' : '')}><span>Còn lại</span><span className="mono">{vnd(remaining)}</span></div>
        {remaining > 0 && (
          <div className="row">
            <button className="btn grow" onClick={() => setAdding('cash')}><Icon name="cash" size={18} />Tiền mặt</button>
            <button className="btn grow" onClick={() => setAdding('vietqr')}><Icon name="qr" size={18} />VietQR</button>
            <button className="btn grow" onClick={() => setAdding('card')}><Icon name="card" size={18} />Thẻ</button>
          </div>
        )}
      </div>
      <div className="cartbar"><button className="btn primary lg block" disabled={busy || remaining !== 0 || !parts.length} onClick={() => onPay(parts)}>Hoàn tất</button></div>
      {adding && <PartSheet method={adding} max={remaining} code={code} onClose={() => setAdding(null)} onAdd={(p) => { setParts([...parts, p]); setAdding(null); }} />}
    </>
  );
}

function PartSheet({ method, max, code, onAdd, onClose }: { method: PayMethod; max: number; code: string; onAdd: (p: Payment) => void; onClose: () => void }) {
  const [amount, setAmount] = useState(max);
  const [tendered, setTendered] = useState(0);
  const [ref, setRef] = useState('');
  const [showQr, setShowQr] = useState(false);
  const valid = amount > 0 && amount <= max && (method !== 'cash' || !tendered || tendered >= amount);
  const add = () => {
    if (method === 'cash') onAdd(makePayment('cash', amount, { tendered: tendered || amount, change_given: tendered ? tendered - amount : 0 }));
    else if (method === 'vietqr') onAdd(makePayment('vietqr', amount, { reference: 'DUI ' + code.replace('-', '') }));
    else onAdd(makePayment('card', amount, { reference: ref || null }));
  };
  return (
    <Sheet onClose={onClose}>
      <h2>{method === 'cash' ? 'Phần tiền mặt' : method === 'vietqr' ? 'Phần chuyển khoản' : 'Phần thẻ'}</h2>
      <div className="col gap12">
        <MoneyInput label={`Số tiền (tối đa ${vnd(max)})`} value={amount} onChange={setAmount} />
        {method === 'cash' && <MoneyInput label="Khách đưa (để trống nếu vừa đủ)" value={tendered} onChange={setTendered} />}
        {method === 'cash' && tendered > amount && <div className="kv"><span className="muted">Tiền thối</span><span className="mono accent bold">{vnd(tendered - amount)}</span></div>}
        {method === 'card' && <label className="field"><span>Mã chuẩn chi (không bắt buộc)</span><input className="input" value={ref} onChange={(e) => setRef(e.target.value)} /></label>}
        {method === 'vietqr' && (showQr ? <QrImage amount={amount} code={code} /> : <button className="btn" disabled={!valid} onClick={() => setShowQr(true)}><Icon name="qr" />Hiện mã QR</button>)}
        <button className="btn primary lg block" disabled={!valid} onClick={add}>{method === 'vietqr' ? 'Đã nhận tiền' : 'Thêm'}</button>
      </div>
    </Sheet>
  );
}

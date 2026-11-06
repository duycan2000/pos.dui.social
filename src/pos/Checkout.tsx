// S10–S14 — payment (Toast-style): big amount, tip, method cards, cash keypad with change,
// VietQR with automatic bank confirmation, card reference, mixed payments.
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { cashSuggestions } from '../../shared/pricing';
import type { Payment, PayMethod } from '../../shared/types';
import { vnd, vndShort } from '../../shared/util';
import { vietQrPayload } from '../../shared/vietqr';
import { api } from '../lib/api';
import { kickDrawer, printerSettings } from '../lib/printer';
import { preBillDoc, qrBillDoc, tryPrint } from '../lib/receipts';
import { cartAsOrder, cartCount, cartTotals, finalizeCart, makePayment, navigate, optionLabel, peekShortCode, setState, toast, useStore } from '../lib/store';
import { runSync } from '../lib/sync';
import { Icon, Keypad, MoneyInput, Sheet, TopBar } from '../ui';

type Step = 'methods' | 'cash' | 'vietqr' | 'card' | 'mixed' | 'even';

export default function Checkout() {
  const cart = useStore((s) => s.cart);
  const cfg = useStore((s) => s.config)!;
  const [step, setStep] = useState<Step>('methods');
  const [code, setCode] = useState('');
  const [tip, setTip] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => { peekShortCode().then(setCode); }, [cart.id]);
  // A tab may have rounds added on the other device: refresh before taking money.
  useEffect(() => { if (cart.tabCode && navigator.onLine) runSync(); }, []); // eslint-disable-line
  const t = cartTotals(cart.lines);
  const due = t.total;
  useEffect(() => { if (!cart.lines.some((l) => l.status === 'active')) navigate('order'); }, [cart.lines]);

  const finish = async (status: 'paid' | 'awaiting_payment', payments: Payment[], change = 0) => {
    if (busy) return;
    setBusy(true);
    try {
      const order = await finalizeCart(status, payments);
      if (status === 'paid') {
        if (payments.some((p) => p.method === 'cash') && printerSettings().openDrawer && printerSettings().mode !== 'none') kickDrawer().catch(() => {});
        setState({ lastPaid: { order, change } });
        navigate('done');
      } else {
        toast(`Đã lưu #${order.short_code} — chờ chuyển khoản`);
        navigate('order');
      }
    } finally { setBusy(false); }
  };
  const back = () => (step === 'methods' ? navigate(window.matchMedia('(min-width: 980px)').matches ? 'order' : 'cart') : setStep('methods'));
  const title = { methods: 'Thanh toán', cash: 'Tiền mặt', vietqr: 'Chuyển khoản VietQR', card: 'Thẻ', mixed: 'Kết hợp nhiều cách', even: 'Chia đều' }[step];
  const ref = 'DUI ' + code.replace('-', '');

  return (
    <div className="screen wide">
      <TopBar title={title} sub={`#${code}${cart.customer_label ? ' · ' + cart.customer_label : ''}`} onBack={back} />
      <div className="scroll">
        <div className="checkout">
          <section className="checkout-summary card">
            <div className="card-title">Đơn #{code}</div>
            {cart.lines.filter((l) => l.status === 'active').map((l) => (
              <div key={l.id} className="kv small">
                <span>{l.qty}× {l.item_name}{optionLabel(l.modifiers) ? <span className="muted"> · {optionLabel(l.modifiers)}</span> : null}</span>
                <span className="mono">{l.comp ? <span style={{ color: 'var(--violet)' }}>Mời</span> : vnd(l.unit_price * l.qty, false)}</span>
              </div>
            ))}
            <hr className="sep" />
            {t.promo_total > 0 && <div className="kv small accent"><span>Mua 1 tặng 1</span><span className="mono">−{vnd(t.promo_total)}</span></div>}
            {t.comp_total > 0 && <div className="kv small" style={{ color: 'var(--violet)' }}><span>Mời</span><span className="mono">−{vnd(t.comp_total)}</span></div>}
            <div className="kv total"><span>Tổng</span><span className="mono">{vnd(due)}</span></div>
          </section>

          <section className="checkout-pay">
            {step === 'methods' && (
              <div className="col gap16">
                <div className="amount-card">
                  <div className="label">Cần thu</div>
                  <div className="value">{vnd(due + tip)}</div>
                  {tip > 0 && <div className="small muted">gồm tip {vnd(tip)}</div>}
                </div>
                <button className="btn outline" onClick={async () => { const err = await tryPrint(await preBillDoc(cfg, await cartAsOrder())); toast(err ?? 'Đã in bill cho khách', !!err); }}>
                  <Icon name="printer" size={20} />In bill cho khách
                </button>
                <TipPicker due={due} tip={tip} onChange={setTip} />
                <div className="methods">
                  <button className="method" onClick={() => setStep('cash')}><span className="ico"><Icon name="cash" /></span><span>Tiền mặt<br /><small>Tính tiền thối · tip từ tiền thối</small></span></button>
                  <button className="method" onClick={() => setStep('vietqr')}><span className="ico" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}><Icon name="qr" /></span><span>VietQR<br /><small>Mã QR có sẵn số tiền</small></span></button>
                  <button className="method" onClick={() => setStep('card')}><span className="ico" style={{ background: 'var(--ok-soft)', color: 'var(--ok)' }}><Icon name="card" /></span><span>Thẻ<br /><small>Quẹt trên máy POS ngân hàng</small></span></button>
                  <button className="method" onClick={() => setStep('even')}><span className="ico" style={{ background: 'var(--accent-soft)', color: 'var(--accent-fg)' }}><Icon name="users" /></span><span>Chia đều<br /><small>Mỗi người trả một phần bằng nhau</small></span></button>
                  {cart.tabCode && cartCount(cart.lines) > 1 && <button className="method" onClick={() => navigate('split')}><span className="ico" style={{ background: 'var(--accent-soft)', color: 'var(--accent-fg)' }}><Icon name="list" /></span><span>Tách theo món<br /><small>Ai gọi gì trả nấy</small></span></button>}
                  <button className="method" onClick={() => setStep('mixed')}><span className="ico" style={{ background: 'var(--violet-soft)', color: 'var(--violet)' }}><Icon name="split" /></span><span>Kết hợp<br /><small>Một phần tiền mặt, một phần CK</small></span></button>
                </div>
              </div>
            )}
            {step === 'cash' && <CashPay due={due} busy={busy} onPay={(tendered, cashTip) => finish('paid', [makePayment('cash', due, { tendered, tip: cashTip, change_given: tendered - due - cashTip })], tendered - due - cashTip)} />}
            {step === 'vietqr' && (
              <QrPay due={due} tip={tip} code={code} busy={busy}
                onReceived={(extra) => finish('paid', [makePayment('vietqr', due, { tip: extra?.tip ?? tip, reference: ref, bank_txn_id: extra?.txnId ?? null })])}
                onWait={() => finish('awaiting_payment', [makePayment('vietqr', due, { status: 'pending', reference: ref })])} />
            )}
            {step === 'card' && <CardPay total={due + tip} busy={busy} onPay={(r) => finish('paid', [makePayment('card', due, { tip, reference: r || null })])} />}
            {step === 'even' && <EvenPay due={due} code={code} busy={busy} guests={cart.guests ?? null} onPay={(parts) => finish('paid', parts, parts.reduce((s, p) => s + p.change_given, 0))} />}
            {step === 'mixed' && <MixedPay due={due} code={code} busy={busy} onPay={(parts) => finish('paid', parts, parts.reduce((s, p) => s + p.change_given, 0))} />}
          </section>
        </div>
      </div>
    </div>
  );
}

function TipPicker({ due, tip, onChange }: { due: number; tip: number; onChange: (v: number) => void }) {
  const [custom, setCustom] = useState(false);
  const opts = [0, 0.05, 0.1, 0.15].map((p) => ({ p, v: Math.round((due * p) / 1000) * 1000 }));
  return (
    <div className="col" style={{ gap: 8 }}>
      <span className="small muted"><Icon name="heart" size={14} /> Tip (cho thẻ và chuyển khoản; tiền mặt chọn ở bước sau)</span>
      <div className="opts">
        {opts.map(({ p, v }) => (
          <button key={p} className={'opt' + (!custom && tip === v ? ' on' : '')} onClick={() => { setCustom(false); onChange(v); }}>{p === 0 ? 'Không tip' : `${p * 100}% · ${vndShort(v)}`}</button>
        ))}
        <button className={'opt' + (custom ? ' on' : '')} onClick={() => setCustom(true)}>Khác</button>
      </div>
      {custom && <MoneyInput value={tip} onChange={onChange} placeholder="Số tiền tip" autoFocus />}
    </div>
  );
}

function CashPay({ due, onPay, busy }: { due: number; onPay: (tendered: number, tip: number) => void; busy: boolean }) {
  const [got, setGot] = useState(0);
  const [keepTip, setKeepTip] = useState(false);
  const change = got - due;
  const tip = keepTip && change > 0 ? change : 0;
  return (
    <div className="col gap16">
      <div className="row gap12">
        <div className="card grow col" style={{ gap: 2 }}><span className="small muted">Cần thu</span><span className="big mono">{vnd(due)}</span></div>
        <div className="card grow col" style={{ gap: 2 }}><span className="small muted">Khách đưa</span><span className="big mono accent">{got ? vnd(got) : '—'}</span></div>
      </div>
      <div className="opts">
        {cashSuggestions(due).map((v) => <button key={v} className={'opt' + (got === v ? ' on' : '')} onClick={() => setGot(v)}>{v === due ? 'Vừa đủ' : vndShort(v)}</button>)}
      </div>
      <Keypad value={got} onChange={setGot} />
      <div className="card col center" style={{ alignItems: 'center', gap: 4 }}>
        <span className="muted small">{tip ? 'Tiền thối giữ làm tip' : 'Tiền thối'}</span>
        <span className={'huge mono ' + (change < 0 ? 'danger' : tip ? 'ok' : 'accent')}>{got ? vnd(Math.max(0, change - tip)) : '—'}</span>
        {got > 0 && change < 0 && <span className="danger small">Còn thiếu {vnd(-change)}</span>}
        {change > 0 && (
          <label className="check small"><input type="checkbox" checked={keepTip} onChange={(e) => setKeepTip(e.target.checked)} /> Khách để lại tiền thối làm tip ({vnd(change)})</label>
        )}
      </div>
      <button className="btn primary xl block" disabled={busy || got < due} onClick={() => onPay(got, tip)}>Xác nhận đã thu {got >= due ? vnd(got) : ''}</button>
    </div>
  );
}

export function QrImage({ amount, code }: { amount: number; code: string }) {
  const outlet = useStore((s) => s.config!.outlet);
  const [src, setSrc] = useState('');
  const ready = !!(outlet.vietqr_bank_bin && outlet.vietqr_account);
  useEffect(() => {
    if (!ready) return;
    const payload = vietQrPayload({ bankBin: outlet.vietqr_bank_bin!, account: outlet.vietqr_account!, amount, purpose: 'DUI ' + code.replace('-', '') });
    QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 1, width: 540 }).then(setSrc).catch(() => setSrc(''));
  }, [amount, code, ready, outlet.vietqr_bank_bin, outlet.vietqr_account]);
  if (!ready) return <div className="banner danger"><Icon name="warn" size={18} />Chưa cài tài khoản VietQR. Vào Quản trị › Cài đặt để nhập ngân hàng và số tài khoản.</div>;
  return (
    <div className="col center" style={{ alignItems: 'center', gap: 10 }}>
      <div className="qr">{src ? <img src={src} alt={`Mã VietQR ${vnd(amount)}`} /> : null}</div>
      <div className="small muted" style={{ textAlign: 'center' }}>{outlet.vietqr_account_name || ''} · {outlet.vietqr_account}<br />Nội dung chuyển khoản: <b style={{ color: 'var(--text)' }}>DUI {code.replace('-', '')}</b></div>
    </div>
  );
}

function QrPay({ due, tip, code, onReceived, onWait, busy }: { due: number; tip: number; code: string; onReceived: (extra?: { tip: number; txnId: string }) => void; onWait: () => void; busy: boolean }) {
  const cfg = useStore((s) => s.config)!;
  const online = useStore((s) => s.net.online);
  const auto = !!cfg.features?.bankWebhook && online;
  const done = useRef(false);
  const [printing, setPrinting] = useState(false);
  const printQr = async (silent = false) => {
    setPrinting(true);
    try {
      const err = await tryPrint(await qrBillDoc(cfg, await cartAsOrder(), due + tip));
      if (err && !silent) toast(err, true);
      if (!err) toast('Đã in bill có mã QR — khách quét trên giấy được');
    } catch (e) { if (!silent) toast((e as Error).message, true); } finally { setPrinting(false); }
  };
  // Choosing transfer prints the bill with its QR straight away (when a printer is set up).
  const printed = useRef(false);
  useEffect(() => {
    const p = printerSettings();
    if (!code || printed.current || p.mode === 'none' || p.autoQrBill === false || !cfg.outlet.vietqr_account) return;
    printed.current = true;
    printQr(true);
  }, [code]); // eslint-disable-line
  useEffect(() => {
    if (!auto || !code) return;
    const timer = setInterval(async () => {
      if (done.current) return;
      try {
        const r = await api<{ found: boolean; txn?: { id: string; amount: number } }>('GET', `/api/bank/check?code=${encodeURIComponent(code)}&amount=${due}`);
        if (r.found && r.txn && !done.current) {
          done.current = true;
          toast(`Đã nhận ${vnd(r.txn.amount)} qua ngân hàng`);
          onReceived({ tip: Math.max(0, r.txn.amount - due), txnId: r.txn.id });
        }
      } catch { /* keep polling */ }
    }, 3000);
    return () => clearInterval(timer);
  }, [auto, code, due]); // eslint-disable-line
  return (
    <div className="col gap16">
      <div className="amount-card" style={{ paddingBottom: 0 }}>
        <div className="label">Quét để chuyển khoản</div>
        <div className="value">{vnd(due + tip)}</div>
      </div>
      <QrImage amount={due + tip} code={code} />
      <button className="btn outline" disabled={printing} onClick={() => printQr()}><Icon name="printer" size={20} />{printing ? 'Đang in…' : 'In bill có mã QR cho khách'}</button>
      {auto
        ? <div className="banner info" style={{ alignItems: 'center' }}><span className="spinner" /> Đang chờ tiền vào tài khoản — tự xác nhận khi ngân hàng báo.</div>
        : <p className="small muted" style={{ textAlign: 'center', margin: 0 }}>Kiểm tra app ngân hàng: đúng số tiền và nội dung thì bấm “Đã nhận tiền”.</p>}
      <button className="btn ok xl block" disabled={busy} onClick={() => { done.current = true; onReceived(); }}><Icon name="check" />Đã nhận tiền</button>
      <button className="btn block" disabled={busy} onClick={() => { done.current = true; onWait(); }}>Khách chuyển sau — lưu đơn chờ</button>
    </div>
  );
}

function CardPay({ total, onPay, busy }: { total: number; onPay: (ref: string) => void; busy: boolean }) {
  const [ref, setRef] = useState('');
  return (
    <div className="col gap16">
      <div className="amount-card"><div className="label">Nhập trên máy POS ngân hàng</div><div className="value">{vnd(total)}</div></div>
      <p className="muted small" style={{ margin: 0 }}>Quẹt thẻ trên máy POS của ngân hàng rồi ghi nhận ở đây. App không lưu số thẻ.</p>
      <label className="field"><span>Mã chuẩn chi trên slip (không bắt buộc)</span><input className="input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="VD: 123456" inputMode="numeric" /></label>
      <button className="btn primary xl block" disabled={busy} onClick={() => onPay(ref.trim())}>Đã thanh toán</button>
    </div>
  );
}

function MixedPay({ due, code, onPay, busy }: { due: number; code: string; onPay: (p: Payment[]) => void; busy: boolean }) {
  const [parts, setParts] = useState<Payment[]>([]);
  const [adding, setAdding] = useState<PayMethod | null>(null);
  const paid = parts.reduce((s, p) => s + p.amount, 0);
  const remaining = due - paid;
  const names: Record<PayMethod, string> = { cash: 'Tiền mặt', vietqr: 'VietQR', card: 'Thẻ' };
  return (
    <div className="col gap16">
      <div className="amount-card"><div className="label">Còn lại</div><div className={'value ' + (remaining === 0 ? 'ok' : '')}>{vnd(remaining)}</div><div className="small muted">trên tổng {vnd(due)}</div></div>
      {parts.length > 0 && (
        <div className="list">
          {parts.map((p) => (
            <div key={p.id} className="li">
              <span className="grow">{names[p.method]}{p.method === 'cash' && p.change_given ? <span className="small muted"> · thối {vnd(p.change_given)}</span> : null}</span>
              <span className="mono semibold">{vnd(p.amount)}</span>
              <button className="iconbtn ghost" aria-label="Bỏ phần này" onClick={() => setParts(parts.filter((x) => x.id !== p.id))}><Icon name="close" size={18} /></button>
            </div>
          ))}
        </div>
      )}
      {remaining > 0 && (
        <div className="methods" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          <button className="method" style={{ minHeight: 84 }} onClick={() => setAdding('cash')}><span className="ico"><Icon name="cash" /></span>Tiền mặt</button>
          <button className="method" style={{ minHeight: 84 }} onClick={() => setAdding('vietqr')}><span className="ico" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}><Icon name="qr" /></span>VietQR</button>
          <button className="method" style={{ minHeight: 84 }} onClick={() => setAdding('card')}><span className="ico" style={{ background: 'var(--ok-soft)', color: 'var(--ok)' }}><Icon name="card" /></span>Thẻ</button>
        </div>
      )}
      <button className="btn primary xl block" disabled={busy || remaining !== 0 || !parts.length} onClick={() => onPay(parts)}>Hoàn tất</button>
      {adding && <PartSheet method={adding} max={remaining} code={code} onClose={() => setAdding(null)} onAdd={(p) => { setParts([...parts, p]); setAdding(null); }} />}
    </div>
  );
}

/** Even split: N people, each pays a share (rounded to 1.000đ; the last share takes the rest), any method each. */
function EvenPay({ due, code, guests, onPay, busy }: { due: number; code: string; guests: number | null; onPay: (p: Payment[]) => void; busy: boolean }) {
  const [n, setN] = useState(Math.min(10, Math.max(2, guests || 2)));
  const [paid, setPaid] = useState<(Payment | null)[]>([]);
  const [adding, setAdding] = useState<{ i: number; method: PayMethod } | null>(null);
  const base = Math.floor(due / n / 1000) * 1000;
  const shares = Array.from({ length: n }, (_, i) => (i === n - 1 ? due - base * (n - 1) : base));
  const parts = shares.map((_, i) => paid[i] ?? null);
  const done = parts.filter(Boolean) as Payment[];
  const started = done.length > 0;
  const names: Record<PayMethod, string> = { cash: 'Tiền mặt', vietqr: 'VietQR', card: 'Thẻ' };
  return (
    <div className="col gap16">
      <div className="amount-card">
        <div className="label">Mỗi người</div>
        <div className="value">{vnd(base)}</div>
        <div className="small muted">{n} người · tổng {vnd(due)}{shares[n - 1] !== base ? ` · người cuối ${vnd(shares[n - 1])}` : ''}</div>
      </div>
      <div className="row" style={{ justifyContent: 'center', gap: 12 }}>
        <span className="stepper">
          <button aria-label="Bớt người" disabled={started || n <= 2} onClick={() => setN(n - 1)}><Icon name="minus" size={16} /></button>
          <span>{n}</span>
          <button aria-label="Thêm người" disabled={started || n >= 20} onClick={() => setN(n + 1)}><Icon name="plus" size={16} /></button>
        </span>
        <span className="small muted">người</span>
      </div>
      <div className="list">
        {shares.map((amt, i) => {
          const p = parts[i];
          return (
            <div key={i} className="li" style={{ minHeight: 0, padding: '10px 12px', gap: 8 }}>
              <span className="grow col" style={{ gap: 1 }}>
                <b className="small">Người {i + 1}</b>
                <span className="mono small">{vnd(amt)}</span>
              </span>
              {p ? (
                <>
                  <span className="badge ok">{names[p.method]}{p.method === 'cash' && p.change_given ? ` · thối ${vndShort(p.change_given)}` : ''}</span>
                  <button className="iconbtn ghost" aria-label="Bỏ phần này" onClick={() => { const c = [...paid]; c[i] = null; setPaid(c); }}><Icon name="close" size={16} /></button>
                </>
              ) : (
                <span className="row" style={{ gap: 6 }}>
                  <button className="btn sm" onClick={() => setAdding({ i, method: 'cash' })}><Icon name="cash" size={16} /></button>
                  <button className="btn sm" onClick={() => setAdding({ i, method: 'vietqr' })}><Icon name="qr" size={16} /></button>
                  <button className="btn sm" onClick={() => setAdding({ i, method: 'card' })}><Icon name="card" size={16} /></button>
                </span>
              )}
            </div>
          );
        })}
      </div>
      <button className="btn primary xl block" disabled={busy || done.length !== n} onClick={() => onPay(done)}>
        {done.length === n ? 'Hoàn tất' : `Đã thu ${done.length}/${n} người`}
      </button>
      {adding && <PartSheet method={adding.method} max={shares[adding.i]} fixed code={code} title={`Người ${adding.i + 1}`} onClose={() => setAdding(null)}
        onAdd={(p) => { const c = [...paid]; c[adding.i] = p; setPaid(c); setAdding(null); }} />}
    </div>
  );
}

function PartSheet({ method, max, code, onAdd, onClose, fixed, title }: { method: PayMethod; max: number; code: string; onAdd: (p: Payment) => void; onClose: () => void; fixed?: boolean; title?: string }) {
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
      <h2>{title ? `${title} · ` : ''}{method === 'cash' ? 'Tiền mặt' : method === 'vietqr' ? 'Chuyển khoản' : 'Thẻ'}</h2>
      <div className="col gap12 mt16">
        {fixed ? <div className="amount-card" style={{ padding: 12 }}><div className="label">Cần thu</div><div className="value">{vnd(amount)}</div></div>
          : <MoneyInput label={`Số tiền (tối đa ${vnd(max)})`} value={amount} onChange={setAmount} />}
        {method === 'cash' && <MoneyInput label="Khách đưa (để trống nếu vừa đủ)" value={tendered} onChange={setTendered} />}
        {method === 'cash' && tendered > amount && <div className="kv"><span className="muted">Tiền thối</span><span className="mono accent bold">{vnd(tendered - amount)}</span></div>}
        {method === 'card' && <label className="field"><span>Mã chuẩn chi (không bắt buộc)</span><input className="input" value={ref} onChange={(e) => setRef(e.target.value)} /></label>}
        {method === 'vietqr' && (showQr ? <QrImage amount={amount} code={code} /> : <button className="btn" disabled={!valid} onClick={() => setShowQr(true)}><Icon name="qr" />Hiện mã QR</button>)}
        <button className="btn primary lg block" disabled={!valid} onClick={add}>{method === 'vietqr' ? 'Đã nhận tiền' : 'Thêm'}</button>
      </div>
    </Sheet>
  );
}


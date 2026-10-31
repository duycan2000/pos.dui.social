// Shared UI pieces: icons, PIN pad, sheets, money input, manager approval dialog (S18), toast.
import { type ReactNode, useEffect, useState } from 'react';
import { verifyPin } from '../shared/crypto';
import type { StaffPublic } from '../shared/types';
import { parseVnd, vnd } from '../shared/util';
import { getState, isManager, useStore } from './lib/store';

const paths: Record<string, ReactNode> = {
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  back: <path d="M15 18l-6-6 6-6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  sync: <><path d="M20 11a8 8 0 0 0-14.9-3M4 13a8 8 0 0 0 14.9 3" /><path d="M5 4v4h4M19 20v-4h-4" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  list: <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>,
  cash: <><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></>,
  qr: <><rect x="4" y="4" width="6" height="6" /><rect x="14" y="4" width="6" height="6" /><rect x="4" y="14" width="6" height="6" /><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" /></>,
  card: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /></>,
  split: <path d="M12 3v18M5 8h4M15 16h4M5 16h4M15 8h4" />,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  door: <><path d="M14 4h5v16h-5" /><path d="M10 12h9M7 9l-3 3 3 3" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" /></>,
  check: <path d="M5 12l5 5L20 7" />,
  wallet: <><path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4z" /><path d="M4 7l11-3v3M16 13h2" /></>,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  edit: <path d="M4 20h4L19 9l-4-4L4 16v4z" />,
  warn: <><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.5" /></>,
};

export function Icon({ name, size = 22 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

export function TopBar({ title, sub, onBack, right }: { title: ReactNode; sub?: ReactNode; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className="topbar">
      {onBack && <button className="iconbtn" aria-label="Quay lại" onClick={onBack}><Icon name="back" /></button>}
      <div className="grow col" style={{ gap: 0 }}>
        <h1>{title}</h1>
        {sub && <span className="tiny muted">{sub}</span>}
      </div>
      {right}
    </header>
  );
}

export function Sheet({ children, onClose, middle }: { children: ReactNode; onClose: () => void; middle?: boolean }) {
  return (
    <div className={'overlay' + (middle ? ' middle' : '')} onClick={onClose}>
      <div className={middle ? 'dialog' : 'sheet'} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">{children}</div>
    </div>
  );
}

export function PinPad({ length = 6, onSubmit, busy }: { length?: number; onSubmit: (pin: string) => Promise<boolean> | boolean; busy?: boolean }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(false);
  const press = async (k: string) => {
    if (busy) return;
    setErr(false);
    if (k === 'del') return setPin((p) => p.slice(0, -1));
    if (k === 'ok') {
      if (pin.length < 4) return;
      const ok = await onSubmit(pin);
      if (!ok) { setErr(true); setPin(''); }
      return;
    }
    if (pin.length < length) setPin(pin + k);
  };
  return (
    <div>
      <div className="pindots" aria-label={`Đã nhập ${pin.length} số`}>
        {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => <span key={i} className={i < pin.length ? 'on' : ''} />)}
      </div>
      {err && <p className="danger center row small" style={{ marginTop: -8 }}>Sai PIN, thử lại</p>}
      <div className="pinpad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].map((k) => (
          <button key={k} onClick={() => press(k)} aria-label={k === 'del' ? 'Xoá' : k === 'ok' ? 'Xác nhận' : k} style={k === 'ok' ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : undefined}>
            {k === 'del' ? '⌫' : k === 'ok' ? 'OK' : k}
          </button>
        ))}
      </div>
    </div>
  );
}

export function MoneyInput({ value, onChange, label, autoFocus, placeholder }: { value: number; onChange: (v: number) => void; label?: string; autoFocus?: boolean; placeholder?: string }) {
  const [text, setText] = useState(value ? vnd(value, false) : '');
  useEffect(() => { if (parseVnd(text) !== value) setText(value ? vnd(value, false) : ''); }, [value]); // eslint-disable-line
  const input = (
    <input className="input mono" inputMode="numeric" autoFocus={autoFocus} placeholder={placeholder ?? '0'} value={text}
      onChange={(e) => { const v = parseVnd(e.target.value); setText(v ? vnd(v, false) : e.target.value.replace(/[^\d]/g, '')); onChange(v); }} />
  );
  return label ? <label className="field"><span>{label}</span>{input}</label> : input;
}

export function Money({ v, className }: { v: number; className?: string }) {
  return <span className={'mono ' + (className ?? '')}>{vnd(v)}</span>;
}

export function Toast() {
  const t = useStore((s) => s.toast);
  if (!t) return null;
  return <div className={'toast' + (t.error ? ' error' : '')} role="status">{t.msg}</div>;
}

/** S18 — shared manager approval. If the logged-in user is a manager, only the reason is asked. */
export function ApprovalDialog() {
  const a = useStore((s) => s.approval);
  const staff = useStore((s) => s.staff);
  const cfg = useStore((s) => s.config);
  const [reason, setReason] = useState('');
  const [step, setStep] = useState<'reason' | 'pin'>('reason');
  useEffect(() => { setReason(''); setStep('reason'); }, [a]);
  if (!a) return null;
  const selfApprove = isManager(staff) && !a.forcePin;
  const managers = (cfg?.staff ?? []).filter((s) => s.role !== 'staff' && s.active);
  const finish = async (pin: string): Promise<boolean> => {
    for (const m of managers) {
      if (await verifyPin(pin, m.pin_salt, m.pin_hash)) { a.resolve({ approver: m, pin, reason: reason.trim() }); return true; }
    }
    return false;
  };
  const next = () => {
    if (a.reasonRequired && !reason.trim()) return;
    if (selfApprove) { a.resolve({ approver: getState().staff as StaffPublic, pin: '', reason: reason.trim() }); return; }
    setStep('pin');
  };
  return (
    <Sheet middle onClose={() => a.resolve(null)}>
      <h2>{selfApprove ? 'Xác nhận' : 'Quản lý duyệt'}</h2>
      <p className="muted small" style={{ marginTop: -6 }}>{a.title}</p>
      {step === 'reason' ? (
        <div className="col gap12">
          {a.reasons && (
            <div className="opts">
              {a.reasons.map((r) => <button key={r} className={'opt' + (reason === r ? ' on' : '')} onClick={() => setReason(r)}>{r}</button>)}
            </div>
          )}
          <label className="field"><span>Lý do {a.reasonRequired ? '(bắt buộc)' : ''}</span>
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Nhập lý do" />
          </label>
          <div className="row">
            <button className="btn grow" onClick={() => a.resolve(null)}>Huỷ</button>
            <button className="btn primary grow" disabled={a.reasonRequired && !reason.trim()} onClick={next}>{selfApprove ? 'Xác nhận' : 'Tiếp'}</button>
          </div>
        </div>
      ) : (
        <>
          <p className="small">Lý do: <b>{reason || '—'}</b></p>
          <PinPad onSubmit={finish} />
          <button className="btn block mt8" onClick={() => a.resolve(null)}>Huỷ</button>
        </>
      )}
    </Sheet>
  );
}

export function Confirm({ title, text, okText = 'Đồng ý', danger, onOk, onCancel }: { title: string; text?: ReactNode; okText?: string; danger?: boolean; onOk: () => void; onCancel: () => void }) {
  return (
    <Sheet middle onClose={onCancel}>
      <h2>{title}</h2>
      {text && <div className="muted" style={{ marginBottom: 16 }}>{text}</div>}
      <div className="row">
        <button className="btn grow" onClick={onCancel}>Không</button>
        <button className={'btn grow ' + (danger ? 'danger' : 'primary')} onClick={onOk}>{okText}</button>
      </div>
    </Sheet>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="pad center row muted" style={{ minHeight: 120, textAlign: 'center' }}>{children}</div>;
}

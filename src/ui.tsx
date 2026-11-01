// Shared UI: icons, top bar, sheets, PIN pad, amount keypad, segmented control, approval dialog (S18), toast.
import { APK_URL, inAndroidApp, isAndroid } from './lib/platform';
import { resolvedTheme, setTheme, useTheme } from './lib/theme';
import { type ReactNode, useEffect, useState } from 'react';
import { verifyPin } from '../shared/crypto';
import type { StaffPublic } from '../shared/types';
import { parseVnd, vnd } from '../shared/util';
import { getState, isManager, useStore } from './lib/store';

const paths: Record<string, ReactNode> = {
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  back: <path d="M15 18l-6-6 6-6" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  sync: <><path d="M20 11a8 8 0 0 0-14.9-3M4 13a8 8 0 0 0 14.9 3" /><path d="M5 4v4h4M19 20v-4h-4" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  list: <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>,
  cash: <><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 9v.01M18 15v.01" /></>,
  qr: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" /></>,
  card: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18M7 15h3" /></>,
  split: <><path d="M12 3v18" /><rect x="3" y="7" width="7" height="10" rx="2" /><rect x="14" y="7" width="7" height="10" rx="2" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  door: <><path d="M14 4h5v16h-5" /><path d="M10 12h9M7 9l-3 3 3 3" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" /></>,
  check: <path d="M5 12l5 5L20 7" />,
  wallet: <><path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4z" /><path d="M4 7l11-3v3M16 13h2" /></>,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  edit: <path d="M4 20h4L19 9l-4-4L4 16v4z" />,
  warn: <><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.5" /></>,
  tab: <><path d="M5 4h14v16l-3-2-2 2-2-2-2 2-2-2-3 2z" /><path d="M9 9h6M9 13h4" /></>,
  printer: <><path d="M7 9V4h10v5" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M7 14h10v6H7z" /></>,
  gift: <><rect x="3" y="8" width="18" height="5" rx="1" /><path d="M5 13v8h14v-8M12 8v13M12 8S9 3 7 5s3 3 5 3c2 0 7-1 5-3s-5 3-5 3" /></>,
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  bank: <><path d="M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18" /></>,
  home: <><path d="M4 11l8-7 8 7" /><path d="M6 10v10h12V10" /></>,
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  box: <><path d="M3 7l9-4 9 4-9 4z" /><path d="M3 7v10l9 4 9-4V7M12 11v10" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2 20c.5-4 3.5-6 7-6s6.5 2 7 6M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2 .7 3.5 2.5 4 6" /></>,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  tag: <><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1.5" /></>,
  sliders: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  phone: <><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></>,
  bluetooth: <path d="M7 7l10 10-5 4V3l5 4L7 17" />,
  table: <><rect x="3" y="4" width="7" height="7" rx="1.5" /><rect x="14" y="4" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><circle cx="17.5" cy="17.5" r="3.5" /></>,
  move: <><path d="M5 12h14M15 8l4 4-4 4" /><path d="M9 4H5v16h4" /></>,
  merge: <><path d="M6 4v5a5 5 0 0 0 5 5h7" /><path d="M6 20v-2a4 4 0 0 1 4-4" /><path d="M15 11l3 3-3 3" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  download: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 20h14" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  grid: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 12h16M12 4v16" /></>,
};

export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  // "i i-<name>" lets styles.css give each icon its own small motion (spinning sync, ringing printer…).
  return (
    <svg aria-hidden="true" className={'i i-' + name} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

export function TopBar({ title, sub, onBack, right, left }: { title: ReactNode; sub?: ReactNode; onBack?: () => void; right?: ReactNode; left?: ReactNode }) {
  return (
    <header className="topbar">
      {onBack && <button className="iconbtn" aria-label="Quay lại" onClick={onBack}><Icon name="back" /></button>}
      {left}
      <div className="grow col" style={{ gap: 0 }}>
        <h1 className="ellipsis">{title}</h1>
        {sub && <span className="sub ellipsis">{sub}</span>}
      </div>
      {right}
    </header>
  );
}

export function Sheet({ children, onClose, middle }: { children: ReactNode; onClose: () => void; middle?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className={'overlay' + (middle ? ' middle' : '')} onClick={onClose}>
      <div className={middle ? 'dialog' : 'sheet'} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">{children}</div>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map(([v, l]) => <button key={v} role="tab" aria-selected={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

export function PinPad({ length = 6, onSubmit, busy }: { length?: number; onSubmit: (pin: string) => Promise<boolean> | boolean; busy?: boolean }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(false);
  const submit = async (p: string) => {
    if (p.length < 4) return;
    const ok = await onSubmit(p);
    if (!ok) { setErr(true); setPin(''); navigator.vibrate?.(80); }
  };
  const press = async (k: string) => {
    if (busy) return;
    setErr(false);
    if (k === 'del') return setPin((p) => p.slice(0, -1));
    if (k === 'ok') return submit(pin);
    if (pin.length >= length) return;
    const next = pin + k;
    setPin(next);
    if (next.length === length) submit(next); // auto-submit at 6 digits
  };
  return (
    <div>
      <div className={'pindots' + (err ? ' shake' : '')} aria-label={`Đã nhập ${pin.length} số`}>
        {Array.from({ length: Math.max(4, Math.min(length, Math.max(pin.length, 6))) }).map((_, i) => <span key={i} className={i < pin.length ? 'on' : ''} />)}
      </div>
      <p className="danger small" style={{ textAlign: 'center', marginTop: -10, minHeight: 18 }}>{err ? 'Sai PIN, thử lại' : ''}</p>
      <div className="pinpad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].map((k) => (
          <button key={k} onClick={() => press(k)} aria-label={k === 'del' ? 'Xoá' : k === 'ok' ? 'Xác nhận' : k}
            style={k === 'ok' ? { background: 'var(--accent)', color: 'var(--accent-ink)', fontSize: 17 } : undefined}>
            {k === 'del' ? '⌫' : k === 'ok' ? 'OK' : k}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Large amount keypad (Toast-style): digits, 000, backspace. Value in VND. */
export function Keypad({ value, onChange, max = 999_999_999 }: { value: number; onChange: (v: number) => void; max?: number }) {
  const press = (k: string) => {
    let s = String(value || '');
    if (k === 'del') s = s.slice(0, -1);
    else if (k === 'C') s = '';
    else s = s + k;
    const v = Math.min(max, parseInt(s || '0', 10) || 0);
    onChange(v);
  };
  return (
    <div className="keypad">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', 'del'].map((k) => (
        <button key={k} className={k === 'del' || k === '000' ? 'fn' : ''} onClick={() => press(k)} aria-label={k === 'del' ? 'Xoá số' : k}>{k === 'del' ? '⌫' : k}</button>
      ))}
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

/** S18 — shared manager approval. A logged-in manager only gives the reason (unless a PIN is forced). */
export function ApprovalDialog() {
  const a = useStore((s) => s.approval);
  const staff = useStore((s) => s.staff);
  const cfg = useStore((s) => s.config);
  const [reason, setReason] = useState('');
  const [step, setStep] = useState<'reason' | 'pin'>('reason');
  useEffect(() => { setReason(''); setStep(a && !a.reasonRequired && !a.reasons && a.forcePin ? 'pin' : 'reason'); }, [a]);
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
      <div className="row gap12" style={{ marginBottom: 14 }}>
        <div className="iconbtn" style={{ background: 'var(--accent-soft)', color: 'var(--accent-fg)' }}><Icon name="lock" /></div>
        <div className="col" style={{ gap: 2 }}>
          <h2>{selfApprove ? 'Xác nhận' : 'Quản lý duyệt'}</h2>
          <span className="small muted">{a.title}</span>
        </div>
      </div>
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
          <div className="row mt8">
            <button className="btn grow" onClick={() => a.resolve(null)}>Huỷ</button>
            <button className="btn primary grow" disabled={a.reasonRequired && !reason.trim()} onClick={next}>{selfApprove ? 'Xác nhận' : 'Tiếp tục'}</button>
          </div>
        </div>
      ) : (
        <>
          {reason && <p className="small muted" style={{ margin: 0 }}>Lý do: <b style={{ color: 'var(--text)' }}>{reason}</b></p>}
          <PinPad onSubmit={finish} />
          <button className="btn block ghost mt8" onClick={() => a.resolve(null)}>Huỷ</button>
        </>
      )}
    </Sheet>
  );
}

export function Confirm({ title, text, okText = 'Đồng ý', danger, onOk, onCancel }: { title: string; text?: ReactNode; okText?: string; danger?: boolean; onOk: () => void; onCancel: () => void }) {
  return (
    <Sheet middle onClose={onCancel}>
      <h2>{title}</h2>
      {text && <div className="muted" style={{ margin: '8px 0 20px' }}>{text}</div>}
      <div className="row">
        <button className="btn grow" onClick={onCancel}>Không</button>
        <button className={'btn grow ' + (danger ? 'danger' : 'primary')} onClick={onOk}>{okText}</button>
      </div>
    </Sheet>
  );
}

export function Empty({ children, icon = 'receipt' }: { children: ReactNode; icon?: string }) {
  return <div className="empty"><div className="ico"><Icon name={icon} size={26} /></div><div>{children}</div></div>;
}

/** Category accent colours for tiles and chips, by category order. */
export const CAT_COLORS = ['#f5a524', '#f472b6', '#34d399', '#60a5fa', '#a78bfa', '#fb923c', '#22d3ee', '#a3e635'];

/** "v0.7.0 · 01/11 11:20" — app version and build time, shown on the login screen and in the menu. */
export function appVersion(withTime = false) {
  const v = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
  if (!withTime || typeof __BUILD_TIME__ !== 'string') return 'v' + v;
  const d = new Date(__BUILD_TIME__);
  return `v${v} · build ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Light / dark switch: one tap toggles; used on the login screen and in the menu. */
export function ThemeToggle({ withLabel = false }: { withLabel?: boolean }) {
  useTheme();
  const t = resolvedTheme();
  const next = t === 'dark' ? 'light' : 'dark';
  const label = t === 'dark' ? 'Chuyển sang nền sáng' : 'Chuyển sang nền tối';
  return withLabel
    ? <button className="navitem" onClick={() => setTheme(next)}><Icon name={t === 'dark' ? 'sun' : 'moon'} />{t === 'dark' ? 'Giao diện sáng' : 'Giao diện tối'}</button>
    : <button className="iconbtn" aria-label={label} title={label} onClick={() => setTheme(next)}><Icon name={t === 'dark' ? 'sun' : 'moon'} /></button>;
}

/** Count up to a number when it first appears (≈0.6 s, one requestAnimationFrame loop, skipped for reduced motion). */
export function useCountUp(target: number, ms = 650) {
  const [v, setV] = useState(target);
  useEffect(() => {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) { setV(target); return; }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      setV(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** "Tải app Android" link (latest APK on GitHub). Hidden when already inside the Android app or on iPhone/iPad. */
export function ApkLink() {
  if (inAndroidApp() || /iPhone|iPad|iPod/i.test(navigator.userAgent)) return null;
  return (
    <a className="apklink" href={APK_URL} target="_blank" rel="noopener">
      <Icon name="download" size={18} />
      <span className="col" style={{ gap: 0 }}><b>Tải app Android</b><span className="tiny muted">{isAndroid() ? 'File APK · mở file để cài' : 'Mở link này trên điện thoại Android'}</span></span>
    </a>
  );
}

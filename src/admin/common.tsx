// Shared bits for back-office pages.
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { mediaUrl, uploadPhoto } from '../lib/api';
import { navigate, toast } from '../lib/store';
import { Icon, TopBar } from '../ui';

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try { setData(await fn()); setError(null); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, deps); // eslint-disable-line
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

export function Page({ title, sub, back = 'admin', right, children, footer }: { title: string; sub?: ReactNode; back?: string; right?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="screen wide">
      <TopBar title={title} sub={sub} onBack={() => navigate(back)} right={right} />
      <div className="scroll pad col gap12" style={{ paddingTop: 0 }}>{children}</div>
      {footer && <div className="cartbar">{footer}</div>}
    </div>
  );
}

export function Loading({ error, loading }: { error: string | null; loading: boolean }) {
  if (error) return <div className="banner danger">{error}</div>;
  if (loading) return <p className="muted">Đang tải…</p>;
  return null;
}

export async function run<T>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    toast((e as Error).message, true);
    return undefined;
  }
}

export function Text({ label, value, onChange, placeholder, type = 'text', inputMode }: { label: string; value: string | number | null | undefined; onChange: (v: string) => void; placeholder?: string; type?: string; inputMode?: 'numeric' | 'decimal' | 'text' }) {
  return (
    <label className="field"><span>{label}</span>
      <input className="input" type={type} inputMode={inputMode} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function Num({ label, value, onChange, step }: { label: string; value: number | null | undefined; onChange: (v: number) => void; step?: string }) {
  return (
    <label className="field"><span>{label}</span>
      <input className="input mono" type="number" inputMode="decimal" step={step ?? 'any'} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} />
    </label>
  );
}

export function Select({ label, value, onChange, options }: { label: string; value: string | null | undefined; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="field"><span>{label}</span>
      <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="check"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{label}</label>;
}

export function PhotoPicker({ value, onChange, label = 'Ảnh' }: { value: string | null; onChange: (key: string | null) => void; label?: string }) {
  const [busy, setBusy] = useState(false);
  const pick = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    const key = await run(() => uploadPhoto(f), 'Đã tải ảnh');
    if (key) onChange(key);
    setBusy(false);
  };
  return (
    <div className="row gap12">
      {value ? <img className="thumb" src={mediaUrl(value)} alt="" /> : <div className="thumb">{label}</div>}
      <div className="col">
        <label className="btn sm"><Icon name="camera" size={16} />{busy ? 'Đang tải…' : value ? 'Đổi ảnh' : 'Chọn ảnh'}
          <input type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        {value && <button className="btn sm ghost" onClick={() => onChange(null)}>Bỏ ảnh</button>}
      </div>
    </div>
  );
}

export const pct = (v: number | null | undefined, d = 1) => (v == null ? '—' : v.toFixed(d).replace('.', ',') + '%');
export const qty = (v: number, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('vi-VN');

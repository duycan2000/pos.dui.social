// S19 — cash in / out of the shared drawer (ice, fruit, supplies…). Above the staff limit needs a manager.
import { useState } from 'react';
import { hhmm, vnd } from '../../shared/util';
import { uploadPhoto } from '../lib/api';
import { addCashMove, can, navigate, requestApproval, staffName, toast, useStore } from '../lib/store';
import { Icon, MoneyInput, TopBar } from '../ui';

const REASONS: [string, string][] = [['ice', 'Đá'], ['fruit', 'Trái cây'], ['supplies', 'Vật tư'], ['change', 'Đổi tiền lẻ'], ['advance', 'Ứng lương'], ['other', 'Khác']];
export const REASON_LABEL: Record<string, string> = Object.fromEntries([...REASONS, ['purchase', 'Nhập hàng']]);

export default function CashMove() {
  const staff = useStore((s) => s.staff)!;
  const drawer = useStore((s) => s.drawer);
  const allMoves = useStore((s) => s.cashMoves);
  const moves = allMoves.filter((m) => m.drawer_session_id === drawer?.id);
  const tz = useStore((s) => s.config!.outlet.tz_offset_min);
  const [dir, setDir] = useState<'out' | 'in'>('out');
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState('ice');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [forStaff, setForStaff] = useState<string | null>(null);
  const allStaff = useStore((s) => s.config!.staff);
  const people = allStaff.filter((x) => x.active);
  const advance = dir === 'out' && reason === 'advance';
  const [busy, setBusy] = useState(false);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try { setPhoto(await uploadPhoto(f)); toast('Đã tải ảnh'); } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  };
  const save = async () => {
    let approvedBy: string | null = null;
    if (advance && !can('approve', staff)) {
      const r = await requestApproval({ title: `Ứng lương ${vnd(amount)} cho ${staffName(forStaff)}`, reasonRequired: false });
      if (!r) return;
      approvedBy = r.approver.id;
    } else if (dir === 'out' && !can('approve', staff) && amount > staff.cash_out_limit) {
      const r = await requestApproval({ title: `Chi ${vnd(amount)} từ két (vượt hạn mức ${vnd(staff.cash_out_limit)})`, reasonRequired: false });
      if (!r) return;
      approvedBy = r.approver.id;
    }
    setBusy(true);
    try {
      await addCashMove(dir, amount, reason, note.trim() || null, photo, approvedBy, advance ? forStaff : null);
      toast(dir === 'out' ? `Đã ghi chi ${vnd(amount)}` : `Đã ghi thu ${vnd(amount)}`);
      setAmount(0); setNote(''); setPhoto(null); setForStaff(null);
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  };

  return (
    <div className="screen">
      <TopBar title="Thu / chi két" onBack={() => navigate('order')} />
      <div className="scroll pad col gap12" style={{ paddingTop: 0 }}>
        {!drawer && <div className="banner danger">Chưa mở két.</div>}
        <div className="opts">
          <button className={'opt' + (dir === 'out' ? ' on' : '')} onClick={() => setDir('out')}>Chi ra</button>
          <button className={'opt' + (dir === 'in' ? ' on' : '')} onClick={() => setDir('in')}>Thu vào</button>
        </div>
        <MoneyInput label="Số tiền" value={amount} onChange={setAmount} />
        <div className="field"><span className="small muted">Lý do</span>
          <div className="opts">{REASONS.filter(([k]) => dir === 'out' || k !== 'advance').map(([k, l]) => <button key={k} className={'opt' + (reason === k ? ' on' : '')} onClick={() => setReason(k)}>{l}</button>)}</div>
        </div>
        {advance && (
          <div className="field"><span className="small muted">Ứng cho ai (tự trừ vào lương tháng)</span>
            <div className="opts">{people.map((p) => <button key={p.id} className={'opt' + (forStaff === p.id ? ' on' : '')} onClick={() => setForStaff(p.id)}>{p.name}</button>)}</div>
          </div>
        )}
        <label className="field"><span>Ghi chú</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <label className="btn" style={{ alignSelf: 'flex-start' }}>
          <Icon name="camera" size={18} />{photo ? 'Đã có ảnh hoá đơn' : 'Chụp ảnh hoá đơn'}
          <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        <p className="tiny faint" style={{ margin: 0 }}>Chụp ảnh cần mạng. Khoản chi vẫn lưu được khi offline.</p>
        <button className="btn primary lg block" disabled={!drawer || amount <= 0 || busy || (advance && !forStaff)} onClick={save}>Lưu</button>
        <div className="section-title">Trong phiên két này</div>
        <div className="list">
          {moves.sort((a, b) => b.created_at - a.created_at).map((m) => (
            <div key={m.id} className="li">
              <span className="grow col" style={{ gap: 2 }}>
                <span>{REASON_LABEL[m.reason] ?? m.reason}{m.for_staff_id ? ` · ${staffName(m.for_staff_id)}` : ''}{m.note ? ` · ${m.note}` : ''}</span>
                <span className="small muted">{hhmm(m.created_at, tz)} · {staffName(m.staff_id)}{m.approved_by ? ` · duyệt ${staffName(m.approved_by)}` : ''}</span>
              </span>
              <span className={'mono bold ' + (m.direction === 'out' ? 'danger' : 'ok')}>{m.direction === 'out' ? '−' : '+'}{vnd(m.amount, false)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

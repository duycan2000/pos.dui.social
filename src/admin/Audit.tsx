// S30 — audit log. Read-only; cannot be edited or deleted.
import { useState } from 'react';
import { get } from '../lib/api';
import { Empty } from '../ui';
import { Loading, Page, useLoad } from './common';

const ACTIONS: [string, string][] = [['', 'Tất cả'], ['void', 'Huỷ đơn'], ['price_change', 'Đổi giá'], ['cash_out', 'Chi két'], ['cash_in', 'Thu két'], ['drawer_close', 'Đóng két'], ['purchase', 'Nhập hàng'], ['stocktake', 'Kiểm kê'], ['recipe_change', 'Công thức'], ['settings', 'Cài đặt'], ['staff_update', 'Nhân viên']];
const LABEL: Record<string, string> = Object.fromEntries(ACTIONS.filter((a) => a[0]));

interface Row { id: string; at: number; action: string; entity: string | null; entity_id: string | null; actor_name: string | null; approver_name: string | null; reason: string | null; before_json: string | null; after_json: string | null }

function short(json: string | null) {
  if (!json) return '';
  const s = json.length > 120 ? json.slice(0, 117) + '…' : json;
  return s.replace(/[{}"]/g, '').replace(/,/g, ', ');
}

export default function Audit() {
  const [action, setAction] = useState('');
  const rows = useLoad(() => get<Row[]>('/api/admin/audit?limit=300' + (action ? '&action=' + action : '')), [action]);
  return (
    <Page title="Nhật ký" sub="Chỉ đọc">
      <div className="chips" style={{ padding: 0 }}>
        {ACTIONS.map(([k, l]) => <button key={k} className={'chip' + (action === k ? ' on' : '')} onClick={() => setAction(k)}>{l}</button>)}
      </div>
      <Loading error={rows.error} loading={rows.loading && !rows.data} />
      {rows.data && !rows.data.length && <Empty>Chưa có mục nào</Empty>}
      <div className="list">
        {(rows.data ?? []).map((r) => (
          <div key={r.id} className="li" style={{ alignItems: 'flex-start' }}>
            <span className="small muted mono" style={{ width: 92 }}>{new Date(r.at).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
            <span className="grow col" style={{ gap: 2 }}>
              <b>{LABEL[r.action] ?? r.action} {r.entity ? <span className="small muted">· {r.entity}</span> : null}</b>
              <span className="small">{r.actor_name ?? '—'}{r.approver_name && r.approver_name !== r.actor_name ? ` · duyệt ${r.approver_name}` : ''}{r.reason ? ` · “${r.reason}”` : ''}</span>
              {(r.before_json || r.after_json) && <span className="tiny faint">{r.before_json ? short(r.before_json) + ' → ' : ''}{short(r.after_json)}</span>}
            </span>
          </div>
        ))}
      </div>
    </Page>
  );
}

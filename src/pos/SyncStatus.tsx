// S20 — sync status. Selling never waits for this screen.
import { useEffect, useState } from 'react';
import { type OutboxRow, outbox } from '../lib/db';
import { navigate, useStore } from '../lib/store';
import { runSync } from '../lib/sync';
import { Empty, Icon, TopBar } from '../ui';

const TYPE: Record<string, string> = { order: 'Đơn', drawer_session: 'Két', staff_shift: 'Ca', cash_movement: 'Thu/chi', audit_log: 'Nhật ký' };

export default function SyncStatus() {
  const net = useStore((s) => s.net);
  const [rows, setRows] = useState<OutboxRow[]>([]);
  useEffect(() => { outbox.all().then(setRows); }, [net.pending, net.busy]);
  return (
    <div className="screen">
      <TopBar title="Đồng bộ" onBack={() => navigate('order')} />
      <div className="scroll pad col gap12" style={{ paddingTop: 0 }}>
        <div className="card col" style={{ gap: 0 }}>
          <div className="kv"><span className="muted">Trạng thái</span><span className="row"><span className={'dot' + (!net.online ? ' off' : net.busy ? ' busy' : '')} />{!net.online ? 'Offline' : net.busy ? 'Đang đồng bộ' : 'Online'}</span></div>
          <div className="kv"><span className="muted">Chờ gửi</span><span className="bold">{net.pending}</span></div>
          <div className="kv"><span className="muted">Lần cuối</span><span>{net.lastSync ? new Date(net.lastSync).toLocaleTimeString('vi-VN') : '—'}</span></div>
          {net.lastError && <div className="kv"><span className="muted">Lỗi</span><span className="danger small">{net.lastError}</span></div>}
        </div>
        <p className="small muted" style={{ margin: 0 }}>Mất mạng vẫn bán được bình thường. Dữ liệu nằm trên máy và tự gửi khi có mạng lại. Đóng két cần có mạng.</p>
        {!rows.length ? <Empty>Không có gì chờ gửi</Empty> : (
          <div className="list">
            {rows.map((r) => (
              <div key={r.seq} className="li">
                <span className="grow col" style={{ gap: 2 }}>
                  <span>{TYPE[r.type] ?? r.type} {(r.data as { short_code?: string }).short_code ? '#' + (r.data as { short_code?: string }).short_code : ''}</span>
                  <span className="small muted">{new Date(r.at).toLocaleTimeString('vi-VN')}</span>
                  {r.error && <span className="small danger">{r.error}</span>}
                </span>
                <span className="badge muted">chờ</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="cartbar"><button className="btn primary lg block" disabled={net.busy} onClick={() => runSync()}><Icon name="sync" />Thử lại ngay</button></div>
    </div>
  );
}

// S24 — back office: Shopify-style sidebar on laptop, grouped list on phone. Needs network.
import { useEffect } from 'react';
import { setStaffSession } from '../lib/api';
import { can, getManagerSession, isManager, navigate, useStore } from '../lib/store';
import { permsOf, presetName, type Perm } from '../../shared/perms';
import { runSync } from '../lib/sync';
import { get } from '../lib/api';
import { Icon, TopBar } from '../ui';
import { useLoad } from './common';
import Audit from './Audit';
import BankTxns from './BankTxns';
import Costing from './Costing';
import { Dashboard, Ledger } from './Finance';
import { IngredientEdit, Inventory, PurchaseNew, Purchases, ShoppingList, StocktakeNew, Stocktakes } from './Inventory';
import ItemEdit from './ItemEdit';
import Menu from './Menu';
import Modifiers from './Modifiers';
import Promotions from './Promotions';
import Reports from './Reports';
import { Devices, Settings } from './Settings';
import Staff from './Staff';
import Analytics from './Analytics';
import S1aBook from './S1aBook';
import FloorEditor from './FloorEditor';
import TimeSheet from './TimeSheet';

type Role = 'owner' | 'manager';
const NAV: { group: string; items: [route: string, title: string, sub: string, icon: string, need: Perm | 'owner'][] }[] = [
  { group: 'Bán hàng', items: [
    ['admin/menu', 'Menu & món', 'Danh mục, giá, ảnh, hết hàng', 'tag', 'menu'],
    ['admin/modifiers', 'Tuỳ chọn món', 'Đường, đá, mocktail, thêm shot', 'sliders', 'menu'],
    ['admin/promotions', 'Khuyến mãi', 'Mua 1 tặng 1, khung giờ', 'gift', 'owner'],
    ['admin/tables', 'Sơ đồ bàn', 'Thêm bàn, khu vực, số ghế', 'table', 'owner'],
  ] },
  { group: 'Nhân sự', items: [
    ['admin/staff', 'Nhân viên & tài khoản', 'Thêm người, PIN, tài khoản đăng nhập, vai trò', 'users', 'owner'],
    ['admin/time', 'Giờ làm', 'Chấm công, lịch làm, lương giờ', 'calendar', 'time'],
  ] },
  { group: 'Kho', items: [
    ['admin/inventory', 'Tồn kho', 'Tồn, sắp hết, cần mua', 'box', 'inventory'],
    ['admin/purchase', 'Nhập hàng', 'Phiếu nhập, ảnh hoá đơn', 'receipt', 'inventory'],
    ['admin/stocktake', 'Kiểm kê', 'Đếm chai, hao hụt', 'list', 'inventory'],
    ['admin/costing', 'Giá vốn', 'Cost %, lãi thật sau BOGO', 'chart', 'costing'],
  ] },
  { group: 'Tài chính', items: [
    ['admin/analytics', 'Phân tích & cảnh báo', 'Lãi lỗ tuần/tháng, dấu hiệu thất thoát, biểu đồ', 'chart', 'revenue'],
    ['admin/finance', 'Tổng quan', 'Doanh thu, dòng tiền, lãi lỗ, tip', 'wallet', 'revenue'],
    ['admin/ledger', 'Sổ thu chi', 'Lương, mặt bằng, điện nước', 'wallet', 'ledger'],
    ['admin/bank', 'Giao dịch ngân hàng', 'Chuyển khoản tự xác nhận', 'bank', 'ledger'],
    ['admin/s1a', 'Sổ doanh thu S1a-HKD', 'Mẫu sổ thuế, in / PDF', 'receipt', 'revenue'],
    ['admin/reports', 'Báo cáo doanh thu', 'Tháng / quý / năm, Excel', 'list', 'revenue'],
  ] },
  { group: 'Hệ thống', items: [
    ['admin/devices', 'Thiết bị', 'Máy bán hàng, laptop', 'phone', 'owner'],
    ['admin/settings', 'Cài đặt', 'VietQR, webhook, cut-off, thuế', 'settings', 'owner'],
    ['admin/audit', 'Nhật ký', 'Huỷ, mời, đổi giá, thu chi', 'clock', 'audit'],
  ] },
];

/** Sub-pages that are not in the menu, and which permission they need. */
const PAGE_NEED: Record<string, Perm | 'owner'> = {
  item: 'menu', ingredient: 'inventory', purchases: 'inventory', shopping: 'inventory', stocktakes: 'inventory',
  ...Object.fromEntries(NAV.flatMap((g) => g.items.map((i) => [i[0].slice(6), i[4]]))),
};
const allowed = (need: Perm | 'owner', role: Role) => (need === 'owner' ? role === 'owner' : can(need));

export default function AdminApp({ route }: { route: string }) {
  const staff = useStore((s) => s.staff)!;
  const session = useStore((s) => s.adminSession);
  const online = useStore((s) => s.net.online);
  useEffect(() => {
    if (!isManager(staff)) { navigate('order'); return; }
    if (session) setStaffSession(session);
    else if (online) getManagerSession('Quản trị cần nhập lại PIN').then((r) => { if (!r) navigate('order'); });
  }, [session, online]); // eslint-disable-line
  useEffect(() => () => { runSync(); }, []); // back in the till: pull fresh menu/config

  if (!isManager(staff)) return null;
  if (!online && !session) {
    return <div className="screen"><TopBar title="Quản trị" onBack={() => navigate('order')} /><div className="pad"><div className="banner danger">Quản trị cần có mạng.</div></div></div>;
  }
  if (!session) return <div className="screen center row muted"><span className="spinner" />&nbsp; Đang đăng nhập quản trị…</div>;

  const role = staff.role as Role;
  const [, page, id] = route.split('/');
  const current = 'admin/' + (page ?? '');
  return (
    <div className="admin">
      <aside className="admin-side" aria-label="Quản trị">
        <button className="navitem" onClick={() => navigate('order')}><Icon name="back" />Về màn bán hàng</button>
        {NAV.map((g) => {
          const items = g.items.filter((i) => allowed(i[4], role));
          if (!items.length) return null;
          return (
            <div key={g.group} className="col" style={{ gap: 2 }}>
              <div className="group">{g.group}</div>
              {items.map(([r, title, , icon]) => (
                <button key={r} className={'navitem' + (current.startsWith(r) || (r === 'admin/inventory' && /admin\/(ingredient|purchases|shopping|stocktakes)/.test(current)) ? ' on' : '')} onClick={() => navigate(r)}>
                  <Icon name={icon} size={20} />{title}
                </button>
              ))}
            </div>
          );
        })}
      </aside>
      <div className="admin-main">{page && PAGE_NEED[page] && !allowed(PAGE_NEED[page], role) ? <NoAccess /> : renderPage(page, id, role)}</div>
    </div>
  );
}

function renderPage(page: string | undefined, id: string | undefined, role: Role) {
  switch (page) {
    case 'menu': return <Menu />;
    case 'item': return <ItemEdit id={id ?? ''} />;
    case 'modifiers': return <Modifiers />;
    case 'promotions': return <Promotions />;
    case 'inventory': return <Inventory />;
    case 'ingredient': return <IngredientEdit id={id ?? ''} />;
    case 'purchase': return <PurchaseNew />;
    case 'purchases': return <Purchases />;
    case 'shopping': return <ShoppingList />;
    case 'stocktake': return <StocktakeNew />;
    case 'stocktakes': return <Stocktakes id={id} />;
    case 'costing': return <Costing />;
    case 'finance': return <Dashboard />;
    case 'analytics': return <Analytics />;
    case 's1a': return <S1aBook />;
    case 'ledger': return <Ledger />;
    case 'bank': return <BankTxns />;
    case 'reports': return <Reports />;
    case 'staff': return <Staff />;
    case 'tables': return <FloorEditor />;
    case 'time': return <TimeSheet />;
    case 'audit': return <Audit />;
    case 'settings': return <Settings />;
    case 'devices': return <Devices />;
  }
  return <Home role={role} />;
}

function NoAccess() {
  return (
    <>
      <TopBar title="Chưa có quyền" onBack={() => navigate('admin')} />
      <div className="content"><div className="content-inner">
        <div className="banner danger"><Icon name="lock" size={18} /><span>Bạn chưa được cấp quyền xem trang này. Nhờ chủ quán cấp trong Quản trị › Nhân viên & tài khoản › Phân quyền.</span></div>
      </div></div>
    </>
  );
}

function Home({ role }: { role: Role }) {
  const staff = useStore((s) => s.staff)!;
  const me = useStore((s) => s.config?.staff.find((x) => x.id === s.staff?.id));
  const people = useLoad(() => get<{ id: string; has_password: number }[]>('/api/admin/staff'));
  const noPassword = people.data && !people.data.find((p) => p.id === staff.id)?.has_password;
  return (
    <>
      <TopBar title="Quản trị" sub={`${staff.name} · ${role === 'owner' ? 'Chủ quán' : presetName(role, permsOf(me ?? staff))}`} onBack={() => navigate('order')} />
      <div className="content">
        <div className="content-inner">
          {noPassword && role === 'owner' && (
            <button className="banner danger" style={{ border: 0, textAlign: 'left', width: '100%' }} onClick={() => navigate('admin/staff')}>
              <Icon name="lock" size={18} /><span><b>Bảo mật:</b> bạn chưa có tài khoản + mật khẩu. Máy lạ vẫn đăng ký được chỉ bằng PIN quản lý. Chạm để đặt email/tên đăng nhập và mật khẩu cho mình (Nhân viên › tên bạn).</span>
            </button>
          )}
          {NAV.map((g) => {
            const items = g.items.filter((i) => allowed(i[4], role));
            if (!items.length) return null;
            return (
              <div key={g.group}>
                <div className="section-title">{g.group}</div>
                <div className="list">
                  {items.map(([r, title, sub, icon]) => (
                    <button key={r} className="li" onClick={() => navigate(r)}>
                      <span className="iconbtn" style={{ background: 'var(--surface-2)', width: 40, height: 40 }}><Icon name={icon} size={20} /></span>
                      <span className="grow col" style={{ gap: 2 }}><b>{title}</b><span className="small muted">{sub}</span></span>
                      <span className="faint"><Icon name="chevron" size={18} /></span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

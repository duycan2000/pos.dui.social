// S24 — back office home + router. Works on the phone and in a laptop browser. Needs network.
import { useEffect } from 'react';
import { setStaffSession } from '../lib/api';
import { getManagerSession, isManager, navigate, useStore } from '../lib/store';
import { runSync } from '../lib/sync';
import { TopBar } from '../ui';
import Audit from './Audit';
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

const TILES: [string, string, string, ('owner' | 'manager')[]][] = [
  ['admin/menu', 'Menu & món', 'Danh mục, giá, ảnh, hết hàng', ['owner', 'manager']],
  ['admin/modifiers', 'Tuỳ chọn món', 'Đường, đá, bản mocktail, thêm shot', ['owner', 'manager']],
  ['admin/promotions', 'Khuyến mãi', 'Mua 1 tặng 1', ['owner']],
  ['admin/inventory', 'Kho', 'Tồn kho, cảnh báo sắp hết', ['owner', 'manager']],
  ['admin/purchase', 'Nhập hàng', 'Phiếu nhập, ảnh hoá đơn', ['owner', 'manager']],
  ['admin/stocktake', 'Kiểm kê', 'Đếm chai, hao hụt', ['owner', 'manager']],
  ['admin/costing', 'Giá vốn', 'Cost %, lãi thật sau BOGO', ['owner', 'manager']],
  ['admin/finance', 'Tổng quan', 'Doanh thu, dòng tiền, lãi lỗ', ['owner', 'manager']],
  ['admin/ledger', 'Sổ thu chi', 'Lương, mặt bằng, điện nước…', ['owner', 'manager']],
  ['admin/reports', 'Báo cáo thuế', 'Tháng / quý / năm, xuất Excel', ['owner', 'manager']],
  ['admin/staff', 'Nhân viên', 'PIN, vai trò, hạn mức', ['owner']],
  ['admin/audit', 'Nhật ký', 'Huỷ đơn, đổi giá, thu chi', ['owner', 'manager']],
  ['admin/settings', 'Cài đặt', 'VietQR, giờ cut-off, thuế', ['owner']],
  ['admin/devices', 'Thiết bị', 'Máy bán hàng, laptop', ['owner']],
];

export default function AdminApp({ route }: { route: string }) {
  const staff = useStore((s) => s.staff)!;
  const session = useStore((s) => s.adminSession);
  const online = useStore((s) => s.net.online);
  useEffect(() => {
    if (!isManager(staff)) { navigate('order'); return; }
    if (session) setStaffSession(session);
    else if (online) getManagerSession('Quản trị cần nhập lại PIN').then((r) => { if (!r) navigate('order'); });
  }, [session, online]); // eslint-disable-line
  // Back in the till, pull fresh menu/config.
  useEffect(() => () => { runSync(); }, []);

  if (!isManager(staff)) return null;
  if (!online && !session) {
    return (
      <div className="screen"><TopBar title="Quản trị" onBack={() => navigate('order')} />
        <div className="pad"><div className="banner danger">Quản trị cần có mạng.</div></div></div>
    );
  }
  if (!session) return <div className="screen center row muted">Đang đăng nhập quản trị…</div>;

  const [, page, id] = route.split('/');
  switch (page) {
    case 'menu': return <Menu />;
    case 'item': return <ItemEdit id={id} />;
    case 'modifiers': return <Modifiers />;
    case 'promotions': return <Promotions />;
    case 'inventory': return <Inventory />;
    case 'ingredient': return <IngredientEdit id={id} />;
    case 'purchase': return <PurchaseNew />;
    case 'purchases': return <Purchases />;
    case 'shopping': return <ShoppingList />;
    case 'stocktake': return <StocktakeNew />;
    case 'stocktakes': return <Stocktakes id={id} />;
    case 'costing': return <Costing />;
    case 'finance': return <Dashboard />;
    case 'ledger': return <Ledger />;
    case 'reports': return <Reports />;
    case 'staff': return <Staff />;
    case 'audit': return <Audit />;
    case 'settings': return <Settings />;
    case 'devices': return <Devices />;
  }
  return (
    <div className="screen wide">
      <TopBar title="Quản trị" sub={staff.name} onBack={() => navigate('order')} />
      <div className="scroll pad">
        <div className="admin-nav">
          {TILES.filter((t) => t[3].includes(staff.role as 'owner' | 'manager')).map(([r, title, sub]) => (
            <button key={r} className="admin-tile" onClick={() => navigate(r)}><b>{title}</b><span className="small muted">{sub}</span></button>
          ))}
        </div>
      </div>
    </div>
  );
}

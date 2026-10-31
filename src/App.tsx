import { useEffect } from 'react';
import AdminApp from './admin/AdminApp';
import { boot, navigate, useStore } from './lib/store';
import { startSync } from './lib/sync';
import Cart from './pos/Cart';
import CashMove from './pos/CashMove';
import Checkout from './pos/Checkout';
import CloseShift from './pos/CloseShift';
import Done from './pos/Done';
import Login from './pos/Login';
import OpenShift from './pos/OpenShift';
import OrderDetail from './pos/OrderDetail';
import OrderScreen from './pos/OrderScreen';
import Orders from './pos/Orders';
import { Register, Setup } from './pos/Setup';
import SyncStatus from './pos/SyncStatus';
import { ApprovalDialog, Toast } from './ui';

let started = false;

export default function App() {
  const bootState = useStore((s) => s.boot);
  const route = useStore((s) => s.route);
  const staff = useStore((s) => s.staff);

  useEffect(() => {
    if (started) return;
    started = true;
    boot().then(() => startSync());
    const onHash = () => { const r = location.hash.slice(1); if (r && r !== route) navigate(r); };
    window.addEventListener('hashchange', onHash);
  }, []); // eslint-disable-line

  let view: JSX.Element;
  if (bootState === 'loading') view = <div className="screen center row muted">Đang tải…</div>;
  else if (bootState === 'setup') view = <Setup />;
  else if (bootState === 'register') view = <Register />;
  else if (!staff || route === 'login') view = <Login />;
  else view = pick(route);

  return (
    <>
      {view}
      <ApprovalDialog />
      <Toast />
    </>
  );
}

function pick(route: string): JSX.Element {
  if (route.startsWith('admin')) return <AdminApp route={route} />;
  if (route.startsWith('order/')) return <OrderDetail id={route.slice(6)} />;
  switch (route) {
    case 'open-shift': return <OpenShift />;
    case 'cart': return <Cart />;
    case 'checkout': return <Checkout />;
    case 'done': return <Done />;
    case 'orders': return <Orders />;
    case 'cashmove': return <CashMove />;
    case 'sync': return <SyncStatus />;
    case 'close': return <CloseShift />;
    default: return <OrderScreen />;
  }
}

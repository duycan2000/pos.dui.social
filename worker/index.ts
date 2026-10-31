// Dui Social POS — Cloudflare Worker entry: API routes + static app from ./dist.
import * as admin from './admin';
import { needsSetup, registerDevice, resolveDevice, resolveStaff, setup, staffLogin } from './auth';
import * as fin from './finance';
import { type Ctx, type Env, HttpError, json, Router } from './http';
import * as inv from './inventory';
import { closeDrawer, getZReport, pull, push } from './sync';

const r = new Router()
  .add('GET', '/api/health', 'none', () => json({ ok: true }))
  .add('GET', '/api/setup/status', 'none', async (c) => json({ needsSetup: await needsSetup(c.env) }))
  .add('POST', '/api/setup', 'none', setup)
  .add('POST', '/api/devices/register', 'none', registerDevice)
  .add('GET', '/api/public/menu', 'none', admin.publicMenu)
  .add('GET', '/media/:a/:b', 'none', admin.serveMedia)

  // selling devices
  .add('GET', '/api/sync/pull', 'device', pull)
  .add('POST', '/api/sync/push', 'device', push)
  .add('POST', '/api/auth/staff', 'device', staffLogin)
  .add('POST', '/api/media', 'device', admin.uploadMedia)
  .add('GET', '/api/drawer/:id/zreport', 'device', getZReport)
  .add('POST', '/api/drawer/:id/close', 'staff', closeDrawer)

  // back office
  .add('GET', '/api/admin/staff', 'staff', admin.listStaff)
  .add('POST', '/api/admin/staff', 'staff', admin.saveStaff)
  .add('PUT', '/api/admin/staff/:id', 'staff', admin.saveStaff)
  .add('GET', '/api/admin/outlet', 'staff', admin.getOutlet)
  .add('PUT', '/api/admin/outlet', 'staff', admin.saveOutlet)
  .add('GET', '/api/admin/devices', 'staff', admin.listDevices)
  .add('PUT', '/api/admin/devices/:id', 'staff', admin.setDeviceActive)
  .add('GET', '/api/admin/audit', 'staff', admin.listAudit)
  .add('GET', '/api/admin/item/:id/groups', 'staff', admin.getItemGroups)
  .add('PUT', '/api/admin/item/:id/groups', 'staff', admin.setItemGroups)
  .add('GET', '/api/admin/promotion/:id/items', 'staff', admin.getPromoItems)
  .add('PUT', '/api/admin/promotion/:id/items', 'staff', admin.setPromoItems)
  .add('GET', '/api/admin/t/:table', 'staff', admin.list)
  .add('POST', '/api/admin/t/:table', 'staff', admin.create)
  .add('PUT', '/api/admin/t/:table/:id', 'staff', admin.update)
  .add('DELETE', '/api/admin/t/:table/:id', 'staff', admin.remove)

  // inventory & recipes
  .add('GET', '/api/inv/ingredients', 'staff', inv.listIngredients)
  .add('GET', '/api/inv/recipe/:type/:id', 'staff', inv.getRecipe)
  .add('PUT', '/api/inv/recipe/:type/:id', 'staff', inv.setRecipe)
  .add('GET', '/api/inv/purchases', 'staff', inv.listPurchases)
  .add('POST', '/api/inv/purchases', 'staff', inv.createPurchase)
  .add('GET', '/api/inv/shopping-list', 'staff', inv.shoppingList)
  .add('GET', '/api/inv/stocktakes', 'staff', inv.listStocktakes)
  .add('POST', '/api/inv/stocktakes', 'staff', inv.createStocktake)
  .add('GET', '/api/inv/stocktakes/:id', 'staff', inv.getStocktake)
  .add('POST', '/api/inv/batch', 'staff', inv.produceBatch)
  .add('GET', '/api/inv/costing', 'staff', inv.costing)
  .add('POST', '/api/inv/simulate', 'staff', inv.simulate)

  // finance & reports
  .add('GET', '/api/fin/dashboard', 'staff', fin.dashboard)
  .add('GET', '/api/fin/ledger', 'staff', fin.listLedger)
  .add('POST', '/api/fin/ledger', 'staff', fin.addLedger)
  .add('POST', '/api/fin/ledger/:id/void', 'staff', fin.voidLedger)
  .add('GET', '/api/reports/revenue', 'staff', fin.revenueReport)
  .add('GET', '/api/reports/ytd', 'staff', fin.ytd);

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/media/')) {
      return env.ASSETS.fetch(req);
    }
    const m = r.match(req.method, url.pathname);
    if (!m) return json({ error: 'Không tìm thấy' }, 404);
    const c: Ctx = { env, req, url, params: m.params };
    try {
      if (m.route.auth !== 'none') await resolveDevice(c);
      if (m.route.auth === 'staff') await resolveStaff(c);
      return await m.route.handler(c);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Lỗi máy chủ: ' + (e as Error).message }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

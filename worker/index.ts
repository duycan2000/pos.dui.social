// Dui Social POS — Cloudflare Worker entry: API routes + static app from ./dist.
import * as admin from './admin';
import * as an from './analytics';
import * as bank from './bank';
import * as backup from './backup';
import * as demo from './demo';
import { registerDevice, resolveDevice, resolveStaff, setup, setupStatus, staffLogin } from './auth';
import * as fin from './finance';
import { type Ctx, type Env, HttpError, json, Router } from './http';
import * as inv from './inventory';
import * as time from './time';
import * as payroll from './payroll';
import { closeDrawer, getZReport, pull, push } from './sync';

const r = new Router()
  .add('GET', '/api/health', 'none', () => json({ ok: true }))
  .add('GET', '/api/setup/status', 'none', setupStatus)
  .add('POST', '/api/setup', 'none', setup)
  .add('POST', '/api/devices/register', 'none', registerDevice)
  .add('GET', '/api/public/menu', 'none', admin.publicMenu)
  .add('GET', '/media/:a/:b', 'none', admin.serveMedia)
  .add('POST', '/api/webhooks/bank', 'none', bank.webhook)

  // selling devices
  .add('GET', '/api/sync/pull', 'device', pull)
  .add('POST', '/api/sync/push', 'device', push)
  .add('POST', '/api/auth/staff', 'device', staffLogin)
  .add('POST', '/api/media', 'device', admin.uploadMedia)
  .add('GET', '/api/drawer/:id/zreport', 'device', getZReport)
  .add('GET', '/api/bank/check', 'device', bank.check)
  .add('POST', '/api/drawer/:id/close', 'staff', closeDrawer)

  // back office
  .add('GET', '/api/admin/staff', 'staff', admin.listStaff)
  .add('POST', '/api/admin/staff', 'staff', admin.saveStaff)
  .add('PUT', '/api/admin/staff/:id', 'staff', admin.saveStaff)
  .add('DELETE', '/api/admin/staff/:id', 'staff', admin.deleteStaff)
  .add('GET', '/api/admin/outlet', 'staff', admin.getOutlet)
  .add('PUT', '/api/admin/outlet', 'staff', admin.saveOutlet)
  .add('GET', '/api/admin/devices', 'staff', admin.listDevices)
  .add('PUT', '/api/admin/devices/:id', 'staff', admin.setDeviceActive)
  .add('POST', '/api/admin/devices/revoke-others', 'staff', admin.revokeOtherDevices)
  .add('GET', '/api/admin/audit', 'staff', admin.listAudit)
  .add('GET', '/api/admin/demo', 'staff', demo.status)
  .add('POST', '/api/admin/demo/seed', 'staff', demo.seed)
  .add('POST', '/api/admin/demo/clear', 'staff', demo.clear)
  .add('GET', '/api/admin/backups', 'staff', backup.list)
  .add('POST', '/api/admin/backups/run', 'staff', backup.run)
  .add('GET', '/api/admin/backups/:name', 'staff', backup.download)
  .add('DELETE', '/api/admin/backups/:name', 'staff', backup.remove)
  .add('GET', '/api/admin/bank-txns', 'staff', bank.listTxns)
  .add('POST', '/api/admin/bank-txns/:id/ignore', 'staff', bank.ignoreTxn)
  .add('POST', '/api/admin/bank-txns/:id/match', 'staff', bank.matchTxn)
  .add('GET', '/api/admin/item/:id/groups', 'staff', admin.getItemGroups)
  .add('PUT', '/api/admin/item/:id/groups', 'staff', admin.setItemGroups)
  .add('GET', '/api/admin/promotion/:id/items', 'staff', admin.getPromoItems)
  .add('PUT', '/api/admin/promotion/:id/items', 'staff', admin.setPromoItems)
  .add('POST', '/api/admin/tables/bulk', 'staff', admin.bulkTables)
  .add('POST', '/api/admin/tables/area', 'staff', admin.renameArea)
  .add('GET', '/api/admin/t/:table', 'staff', admin.list)
  .add('POST', '/api/admin/t/:table', 'staff', admin.create)
  .add('PUT', '/api/admin/t/:table/:id', 'staff', admin.update)
  .add('DELETE', '/api/admin/t/:table/:id', 'staff', admin.remove)

  // time clock & schedule
  .add('GET', '/api/time/sheet', 'staff', time.sheet)
  .add('POST', '/api/time/entries', 'staff', time.addEntry)
  .add('PUT', '/api/time/entries/:id', 'staff', time.editEntry)
  .add('POST', '/api/time/entries/:id/delete', 'staff', time.deleteEntry)
  .add('POST', '/api/time/schedule', 'staff', time.addShift)
  .add('POST', '/api/time/schedule/copy', 'staff', time.copyWeek)
  .add('PUT', '/api/time/schedule/:id', 'staff', time.editShift)
  .add('DELETE', '/api/time/schedule/:id', 'staff', time.deleteShift)

  // payroll (owner)
  .add('GET', '/api/payroll', 'staff', payroll.getPayroll)
  .add('POST', '/api/payroll/adjust', 'staff', payroll.addAdjustment)
  .add('DELETE', '/api/payroll/adjust/:id', 'staff', payroll.deleteAdjustment)
  .add('POST', '/api/payroll/pay', 'staff', payroll.pay)
  .add('POST', '/api/payroll/unpay', 'staff', payroll.unpay)

  // inventory & recipes
  .add('GET', '/api/inv/ingredients', 'staff', inv.listIngredients)
  .add('GET', '/api/inv/recipe/:type/:id', 'staff', inv.getRecipe)
  .add('PUT', '/api/inv/recipe/:type/:id', 'staff', inv.setRecipe)
  .add('GET', '/api/inv/purchases', 'staff', inv.listPurchases)
  .add('POST', '/api/inv/purchases', 'staff', inv.createPurchase)
  .add('GET', '/api/inv/shopping-list', 'staff', inv.shoppingList)
  .add('POST', '/api/inv/suggest-min', 'staff', inv.suggestMin)
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
  .add('GET', '/api/reports/ytd', 'staff', fin.ytd)
  .add('GET', '/api/reports/s1a', 'staff', an.s1a)
  .add('GET', '/api/fin/analytics', 'staff', an.analytics)
  .add('GET', '/api/fin/insights', 'staff', an.insights);

/**
 * Digital Asset Links for the Android app (android/, a Trusted Web Activity). When this matches the app's
 * signing key, Android opens the POS full screen in Chrome without an address bar.
 */
export const ANDROID_PACKAGE = 'social.dui.pos';
export const ANDROID_SHA256 = 'B9:42:89:A5:BA:CF:8A:F5:8F:60:D3:B7:C1:F5:CC:B0:7E:D0:FD:C9:9E:8D:6E:FC:53:38:2A:2C:5A:1A:71:00';
function noindex(res: Response) {
  const r = new Response(res.body, res);
  r.headers.set('x-robots-tag', 'noindex, nofollow');
  return r;
}

function assetLinks() {
  return new Response(JSON.stringify([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: [ANDROID_SHA256] },
  }]), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/.well-known/assetlinks.json') return assetLinks();
    // Keep the POS out of Google and other search engines.
    if (url.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain', 'x-robots-tag': 'noindex, nofollow' } });
    if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/media/')) {
      return noindex(await env.ASSETS.fetch(req));
    }
    const m = r.match(req.method, url.pathname);
    if (!m) return json({ error: 'Không tìm thấy' }, 404);
    const c: Ctx = { env, req, url, params: m.params };
    try {
      if (m.route.auth !== 'none') await resolveDevice(c);
      if (m.route.auth === 'staff') await resolveStaff(c);
      return noindex(await m.route.handler(c));
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Lỗi máy chủ: ' + (e as Error).message }, 500);
    }
  },
  /** Cron (wrangler.jsonc triggers): nightly backup to R2, a few steps per firing. */
  async scheduled(_ev: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(backup.nightly(env).catch((e) => console.error('backup', e)));
  },
} satisfies ExportedHandler<Env>;

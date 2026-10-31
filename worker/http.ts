// Minimal router and helpers (no framework, so the Worker has zero runtime dependencies).
import type { Role } from '../shared/types';

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  /** Secret shared with SePay/Casso for bank-transfer webhooks (optional). */
  BANK_WEBHOOK_KEY?: string;
}

export interface Ctx {
  env: Env;
  req: Request;
  url: URL;
  params: Record<string, string>;
  device?: { id: string; outlet_id: string; order_prefix: string; name: string };
  staff?: { id: string; name: string; role: Role };
}

export type Handler = (c: Ctx) => Promise<Response> | Response;

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function body<T = any>(c: Ctx): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw new HttpError(400, 'Dữ liệu gửi lên không hợp lệ');
  }
}

export function need(cond: unknown, status: number, message: string): asserts cond {
  if (!cond) throw new HttpError(status, message);
}

export function requireRole(c: Ctx, ...roles: Role[]) {
  need(c.staff, 401, 'Cần đăng nhập quản trị');
  need(roles.includes(c.staff.role), 403, 'Bạn không có quyền thực hiện thao tác này');
}

type Route = { method: string; parts: string[]; handler: Handler; auth: 'none' | 'device' | 'staff' };

export class Router {
  routes: Route[] = [];
  add(method: string, path: string, auth: Route['auth'], handler: Handler) {
    this.routes.push({ method, parts: path.split('/').filter(Boolean), handler, auth });
    return this;
  }
  match(method: string, pathname: string) {
    const segs = pathname.split('/').filter(Boolean);
    for (const r of this.routes) {
      if (r.method !== method || r.parts.length !== segs.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < segs.length; i++) {
        const p = r.parts[i];
        if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segs[i]);
        else if (p !== segs[i]) { ok = false; break; }
      }
      if (ok) return { route: r, params };
    }
    return null;
  }
}

export const now = () => Date.now();

/** Run many statements atomically. D1 batch is a transaction. */
export async function batch(env: Env, stmts: D1PreparedStatement[]) {
  if (stmts.length) await env.DB.batch(stmts);
}

export async function all<T = any>(env: Env, sql: string, ...args: unknown[]): Promise<T[]> {
  const r = await env.DB.prepare(sql).bind(...args).all<T>();
  return r.results as T[];
}

export async function first<T = any>(env: Env, sql: string, ...args: unknown[]): Promise<T | null> {
  return (await env.DB.prepare(sql).bind(...args).first<T>()) ?? null;
}

export function stmt(env: Env, sql: string, ...args: unknown[]): D1PreparedStatement {
  return env.DB.prepare(sql).bind(...args.map((a) => (a === undefined ? null : a)));
}

/** INSERT OR REPLACE a row from an object, limited to known columns. */
export function upsertStmt(env: Env, table: string, row: Record<string, unknown>, cols: string[]): D1PreparedStatement {
  const used = cols.filter((k) => k in row);
  const sql = `INSERT OR REPLACE INTO ${table} (${used.join(',')}) VALUES (${used.map(() => '?').join(',')})`;
  return stmt(env, sql, ...used.map((k) => normalize(row[k])));
}

function normalize(v: unknown) {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === undefined) return null;
  return v;
}

export function auditStmt(
  env: Env,
  e: { action: string; entity?: string; entity_id?: string; actor_id?: string | null; approver_id?: string | null; before?: unknown; after?: unknown; reason?: string | null; device_id?: string | null; outlet_id?: string | null },
  id: string,
): D1PreparedStatement {
  return stmt(
    env,
    'INSERT INTO audit_log (id,outlet_id,device_id,at,actor_id,approver_id,action,entity,entity_id,before_json,after_json,reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    id, e.outlet_id ?? null, e.device_id ?? null, now(), e.actor_id ?? null, e.approver_id ?? null, e.action,
    e.entity ?? null, e.entity_id ?? null,
    e.before === undefined ? null : JSON.stringify(e.before),
    e.after === undefined ? null : JSON.stringify(e.after),
    e.reason ?? null,
  );
}

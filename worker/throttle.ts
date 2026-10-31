// Lock a PIN after repeated wrong tries. This is what makes a light PIN hash acceptable on the server.
import { type Env, first, HttpError, now } from './http';

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

export async function assertNotLocked(env: Env, key: string) {
  const row = await first<{ locked_until: number }>(env, 'SELECT locked_until FROM auth_throttle WHERE key=?', key);
  if (row && row.locked_until > now()) {
    const mins = Math.ceil((row.locked_until - now()) / 60000);
    throw new HttpError(429, `Nhập sai PIN quá nhiều lần. Thử lại sau ${mins} phút.`);
  }
}

export async function recordFail(env: Env, key: string) {
  const t = now();
  const row = await first<{ fails: number; locked_until: number }>(env, 'SELECT fails, locked_until FROM auth_throttle WHERE key=?', key);
  const fails = (row?.fails ?? 0) + 1; // reset to 0 whenever a lock is set
  const lockedUntil = fails >= MAX_FAILS ? t + LOCK_MS : 0;
  await env.DB.prepare('INSERT OR REPLACE INTO auth_throttle (key, fails, locked_until, updated_at) VALUES (?,?,?,?)')
    .bind(key, lockedUntil ? 0 : fails, lockedUntil, t).run();
}

export async function recordSuccess(env: Env, key: string) {
  await env.DB.prepare('DELETE FROM auth_throttle WHERE key=?').bind(key).run();
}

export function clientKey(req: Request) {
  return req.headers.get('cf-connecting-ip') || 'unknown';
}

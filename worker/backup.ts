// Nightly backup of the whole D1 database into R2 (bucket MEDIA, prefix backups/).
//
// Workers Free gives a request ~10 ms of CPU and 50 D1 queries, so a backup is done in small steps: each step
// copies one page (≤ 2000 rows) of one table into its own R2 object as NDJSON lines {"t":table,"r":row}.
// Progress lives in backups/<name>/_state.json. The cron (every 5 minutes, 02:00–02:55 Vietnam time) runs a few
// steps per firing; "Sao lưu ngay" in Cài đặt calls /api/admin/backups/run repeatedly until done.
// The 30 most recent backups are kept. Download = all pages concatenated (one NDJSON file);
// scripts/restore-backup.mjs turns that file into SQL for `wrangler d1 execute`.
import { addDays, businessDay } from '../shared/util';
import { all, type Ctx, type Env, first, json, need, now, requireRole } from './http';

const PREFIX = 'backups/';
const PAGE = 2000;
const KEEP = 30;
/** Sessions and login throttling are short-lived; everything else is copied. */
const SKIP = new Set(['d1_migrations', 'auth_throttle', 'staff_session', '_cf_KV', 'sqlite_sequence']);

interface State { name: string; tables: string[]; i: number; page: number; rows: Record<string, number>; bytes: number; started_at: number; done?: number; trigger: 'cron' | 'manual' }

async function readState(env: Env, name: string): Promise<State | null> {
  const o = await env.MEDIA.get(`${PREFIX}${name}/_state.json`);
  return o ? (JSON.parse(await o.text()) as State) : null;
}
const writeState = (env: Env, s: State) => env.MEDIA.put(`${PREFIX}${s.name}/_state.json`, JSON.stringify(s), { httpMetadata: { contentType: 'application/json' } });

async function startState(env: Env, name: string, trigger: State['trigger']): Promise<State> {
  const tables = (await all<{ name: string }>(env, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"))
    .map((t) => t.name).filter((t) => !SKIP.has(t));
  const s: State = { name, tables, i: 0, page: 0, rows: {}, bytes: 0, started_at: now(), trigger };
  await writeState(env, s);
  return s;
}

/** Copy one page of one table. Returns the updated state. */
async function step(env: Env, s: State): Promise<State> {
  if (s.done) return s;
  const t = s.tables[s.i];
  if (t) {
    // Table names come from sqlite_master, never from the request.
    const rows = await all<Record<string, unknown>>(env, `SELECT * FROM "${t.replace(/"/g, '')}" ORDER BY rowid LIMIT ? OFFSET ?`, PAGE, s.page * PAGE);
    if (rows.length) {
      const text = rows.map((r) => JSON.stringify({ t, r })).join('\n') + '\n';
      await env.MEDIA.put(`${PREFIX}${s.name}/${String(s.i).padStart(3, '0')}-${t}.${String(s.page).padStart(4, '0')}.ndjson`, text, { httpMetadata: { contentType: 'application/x-ndjson' } });
      s.bytes += text.length;
      s.rows[t] = (s.rows[t] ?? 0) + rows.length;
    } else s.rows[t] = s.rows[t] ?? 0;
    if (rows.length === PAGE) s.page++;
    else { s.i++; s.page = 0; }
  }
  if (s.i >= s.tables.length) {
    s.done = now();
    await prune(env, s.name);
  }
  await writeState(env, s);
  return s;
}

async function listNames(env: Env): Promise<string[]> {
  const names: string[] = [];
  let cursor: string | undefined;
  do {
    const r = await env.MEDIA.list({ prefix: PREFIX, delimiter: '/', cursor });
    for (const p of r.delimitedPrefixes) names.push(p.slice(PREFIX.length, -1));
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
  return names.sort();
}

async function deleteBackup(env: Env, name: string) {
  let cursor: string | undefined;
  do {
    const r = await env.MEDIA.list({ prefix: `${PREFIX}${name}/`, cursor });
    if (r.objects.length) await env.MEDIA.delete(r.objects.map((o) => o.key));
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
}

/** Keep the newest KEEP backups (names sort by date). */
async function prune(env: Env, keep: string) {
  const names = (await listNames(env)).filter((n) => n !== keep);
  const extra = names.length + 1 - KEEP;
  for (const n of names.slice(0, Math.max(0, extra))) await deleteBackup(env, n);
}

/** Cron: tonight's backup, a few steps per firing. Name = the business day that just ended. */
export async function nightly(env: Env) {
  const o = await first<{ tz_offset_min: number; business_day_cutoff: string }>(env, 'SELECT tz_offset_min, business_day_cutoff FROM outlet LIMIT 1');
  if (!o) return;
  const name = addDays(businessDay(now(), o.tz_offset_min, o.business_day_cutoff), -1);
  let s = (await readState(env, name)) ?? (await startState(env, name, 'cron'));
  for (let k = 0; k < 8 && !s.done; k++) s = await step(env, s);
}

// ---------- owner API ----------

export async function list(c: Ctx) {
  requireRole(c, 'owner');
  const names = (await listNames(c.env)).reverse();
  const out: unknown[] = [];
  for (const n of names) {
    const s = await readState(c.env, n);
    if (s) out.push({ name: n, done: s.done ?? null, started_at: s.started_at, trigger: s.trigger, rows: Object.values(s.rows).reduce((a, b) => a + b, 0), tables: s.tables.length, progress: s.tables.length ? Math.min(1, s.i / s.tables.length) : 1, bytes: s.bytes });
  }
  return json(out);
}

/** "Sao lưu ngay": start (or continue) a manual backup; the app calls this until `done`. */
export async function run(c: Ctx) {
  requireRole(c, 'owner');
  const b = (await c.req.json().catch(() => ({}))) as { name?: string };
  let s: State | null = b.name ? await readState(c.env, b.name) : null;
  if (!s) {
    const o = await first<{ tz_offset_min: number }>(c.env, 'SELECT tz_offset_min FROM outlet LIMIT 1');
    const local = new Date(now() + (o?.tz_offset_min ?? 420) * 60000).toISOString(); // 2026-11-07T15:30:12
    s = await startState(c.env, `${local.slice(0, 10)}-${local.slice(11, 13)}${local.slice(14, 16)}${local.slice(17, 19)}`, 'manual');
  }
  for (let k = 0; k < 6 && !s.done; k++) s = await step(c.env, s);
  return json({ name: s.name, done: !!s.done, progress: s.tables.length ? s.i / s.tables.length : 1, rows: Object.values(s.rows).reduce((a, b) => a + b, 0) });
}

/** One NDJSON file: every page of the backup in table order. */
export async function download(c: Ctx) {
  requireRole(c, 'owner');
  const name = c.params.name;
  need(/^[\w-]{6,40}$/.test(name), 400, 'Tên bản sao lưu không hợp lệ');
  const s = await readState(c.env, name);
  need(s?.done, 404, 'Bản sao lưu chưa xong hoặc không còn');
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const r = await c.env.MEDIA.list({ prefix: `${PREFIX}${name}/`, cursor });
    for (const o of r.objects) if (o.key.endsWith('.ndjson')) keys.push(o.key);
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
  keys.sort();
  const env = c.env;
  const header = JSON.stringify({ t: '_backup', r: { name, done: s!.done, tables: s!.tables, rows: s!.rows, format: 1 } }) + '\n';
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      ctrl.enqueue(new TextEncoder().encode(header));
      for (const k of keys) {
        const o = await env.MEDIA.get(k);
        if (o) ctrl.enqueue(new Uint8Array(await o.arrayBuffer()));
      }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson', 'content-disposition': `attachment; filename="dui-pos-backup-${name}.ndjson"`, 'cache-control': 'no-store' } });
}

export async function remove(c: Ctx) {
  requireRole(c, 'owner');
  const name = c.params.name;
  need(/^[\w-]{6,40}$/.test(name), 400, 'Tên bản sao lưu không hợp lệ');
  await deleteBackup(c.env, name);
  return json({ ok: true });
}

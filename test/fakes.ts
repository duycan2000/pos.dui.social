// In-memory stand-ins for D1 and R2 so the Worker can be tested in Node (node:sqlite, Node 22+).
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

class Stmt {
  args: unknown[] = [];
  constructor(private db: DatabaseSync, public sql: string) {}
  bind(...args: unknown[]) {
    const s = new Stmt(this.db, this.sql);
    s.args = args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? (a ? 1 : 0) : a));
    return s;
  }
  private prep() { return this.db.prepare(this.sql); }
  async first<T>() { return ((this.prep().get(...(this.args as any[])) as T) ?? null); }
  async all<T>() { return { results: this.prep().all(...(this.args as any[])) as T[], success: true }; }
  async run() { const r = this.prep().run(...(this.args as any[])); return { success: true, meta: { changes: r.changes } }; }
  runSync() { return this.prep().run(...(this.args as any[])); }
}

export function makeD1(migrationsDir: string) {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) db.exec(readFileSync(`${migrationsDir}/${f}`, 'utf8'));
  return {
    raw: db,
    prepare: (sql: string) => new Stmt(db, sql),
    async batch(stmts: Stmt[]) {
      db.exec('BEGIN');
      try {
        for (const s of stmts) s.runSync();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      return [];
    },
  };
}

export function makeR2() {
  const store = new Map<string, { body: Uint8Array; type: string }>();
  return {
    async put(key: string, body: ReadableStream | ArrayBuffer | null, opts?: { httpMetadata?: { contentType?: string } }) {
      const buf = body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(await new Response(body as any).arrayBuffer());
      store.set(key, { body: buf, type: opts?.httpMetadata?.contentType || 'application/octet-stream' });
    },
    async get(key: string) {
      const o = store.get(key);
      if (!o) return null;
      return { body: o.body, writeHttpMetadata: (h: Headers) => h.set('content-type', o.type) };
    },
  };
}

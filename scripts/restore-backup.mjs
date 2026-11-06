#!/usr/bin/env node
// Turn a backup downloaded from Quản trị › Cài đặt › Sao lưu (dui-pos-backup-*.ndjson) into SQL.
//
//   node scripts/restore-backup.mjs dui-pos-backup-2026-11-06.ndjson > restore.sql
//   npx wrangler d1 execute dui-pos --remote --file restore.sql
//
// The SQL empties every table that is in the backup and inserts the saved rows. Run it on a fresh database
// (or after `wrangler d1 time-travel` if you only need the last 7 days). It does not touch tables that are
// not in the backup (logins/sessions), so everyone signs in again afterwards.
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/restore-backup.mjs <backup.ndjson> > restore.sql'); process.exit(1); }

const q = (v) => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const out = (s) => process.stdout.write(s + '\n');
const seen = new Set();
out('PRAGMA defer_foreign_keys = true;');
const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
let header = null;
for await (const line of rl) {
  if (!line.trim()) continue;
  const { t, r } = JSON.parse(line);
  if (t === '_backup') {
    header = r;
    for (const table of r.tables) out(`DELETE FROM "${table}";`);
    continue;
  }
  if (!seen.has(t)) { seen.add(t); if (!header) out(`DELETE FROM "${t}";`); }
  const cols = Object.keys(r);
  out(`INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map((c) => q(r[c])).join(',')});`);
}
console.error(`OK: ${seen.size} tables${header ? `, backup ${header.name}` : ''}`);

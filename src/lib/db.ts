// Tiny IndexedDB wrapper. Everything the till needs to keep selling offline lives here.
//   kv      — device token, config snapshot, sync cursor, counters, open shift/drawer
//   orders  — orders of the last few business days (this device + pulled from others)
//   cash    — cash in/out of the drawer
//   outbox  — records waiting to be pushed to the server, in order

const DB_NAME = 'dui-pos';
const VERSION = 1;
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('orders')) db.createObjectStore('orders', { keyPath: 'id' }).createIndex('day', 'business_day');
      if (!db.objectStoreNames.contains('cash')) db.createObjectStore('cash', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name: string, mode: IDBTransactionMode = 'readonly') {
  return (await open()).transaction(name, mode).objectStore(name);
}

export const kv = {
  async get<T>(key: string): Promise<T | undefined> { return wrap((await store('kv')).get(key)) as Promise<T | undefined>; },
  async set(key: string, value: unknown) { await wrap((await store('kv', 'readwrite')).put(value, key)); },
  async del(key: string) { await wrap((await store('kv', 'readwrite')).delete(key)); },
};

export const table = <T extends { id: string }>(name: 'orders' | 'cash') => ({
  async all(): Promise<T[]> { return wrap((await store(name)).getAll()) as Promise<T[]>; },
  async get(id: string): Promise<T | undefined> { return wrap((await store(name)).get(id)) as Promise<T | undefined>; },
  async put(row: T) { await wrap((await store(name, 'readwrite')).put(row)); },
  async putMany(rows: T[]) {
    if (!rows.length) return;
    const s = await store(name, 'readwrite');
    await Promise.all(rows.map((r) => wrap(s.put(r))));
  },
  async del(id: string) { await wrap((await store(name, 'readwrite')).delete(id)); },
});

export interface OutboxRow { seq?: number; type: string; id: string; data: unknown; at: number; error?: string }

export const outbox = {
  async add(type: string, data: { id: string }) {
    await wrap((await store('outbox', 'readwrite')).add({ type, id: data.id, data, at: Date.now() } as OutboxRow));
  },
  async all(): Promise<OutboxRow[]> { return wrap((await store('outbox')).getAll()) as Promise<OutboxRow[]>; },
  async remove(seqs: number[]) {
    const s = await store('outbox', 'readwrite');
    await Promise.all(seqs.map((q) => wrap(s.delete(q))));
  },
  async markError(seq: number, error: string) {
    const s = await store('outbox', 'readwrite');
    const row = (await wrap(s.get(seq))) as OutboxRow | undefined;
    if (row) await wrap(s.put({ ...row, error }));
  },
  async count(): Promise<number> { return wrap((await store('outbox')).count()); },
};

/** Wipe this device (used when re-registering). */
export async function resetDevice() {
  const db = await open();
  db.close();
  dbp = null;
  await new Promise((r) => { const req = indexedDB.deleteDatabase(DB_NAME); req.onsuccess = req.onerror = req.onblocked = () => r(null); });
}

// Shared IndexedDB database for plaza snapshots (`kv`) and custom block images/GIFs (`custom`).
const DB = 'plaza';
const VERSION = 2;

export const KV_STORE = 'kv';
export const CUSTOM_STORE = 'custom';

let dbPromise: Promise<IDBDatabase> | undefined;

export function openPlazaDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((done, fail) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
      if (!db.objectStoreNames.contains(CUSTOM_STORE)) db.createObjectStore(CUSTOM_STORE);
    };
    req.onsuccess = () => done(req.result);
    req.onerror = () => fail(req.error);
  });
  dbPromise.catch(() => {
    dbPromise = undefined;
  });
  return dbPromise;
}

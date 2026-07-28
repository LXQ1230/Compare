/**
 * IndexedDB wrapper for persistent segment and context storage.
 *
 * Used by the compare flow to cache large results locally.
 */

const DB_NAME = 'compare-cache';
const DB_VERSION = 1;

interface StoreSchema {
  segments: { id: string; index: number; data: unknown[] };
  contexts: { id: string; index: number; data: unknown[] };
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('segments')) {
        db.createObjectStore('segments', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('contexts')) {
        db.createObjectStore('contexts', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const indexedDB = {
  async open(): Promise<IDBDatabase> {
    return openDB();
  },

  async putAll(
    storeName: 'segments' | 'contexts',
    items: { id: string; index: number; data: unknown[] }[],
  ): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    for (const item of items) {
      store.put(item);
    }
    return promisify(tx as unknown as IDBRequest<void>);
  },

  async getAll(storeName: 'segments' | 'contexts'): Promise<StoreSchema[typeof storeName][]> {
    const db = await openDB();
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    return promisify(store.getAll());
  },

  async clear(storeName: 'segments' | 'contexts'): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).clear();
    return promisify(tx as unknown as IDBRequest<void>);
  },

  async clearAll(): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(['segments', 'contexts'], 'readwrite');
    tx.objectStore('segments').clear();
    tx.objectStore('contexts').clear();
    return promisify(tx as unknown as IDBRequest<void>);
  },
};

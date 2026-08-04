/**
 * IndexedDB wrapper for persistent segment and context storage.
 *
 * Used by the compare flow to cache large results locally.
 */

const DB_NAME = 'compare-cache';
const DB_VERSION = 2;

interface StoreSchema {
  segments: { id: string; index: number; data: unknown[] };
  contexts: { id: string; index: number; data: unknown[] };
  /** 编辑草稿（方案 L5/P4）：百万字 editText 无法容纳于 localStorage 5MB 配额 */
  drafts: { key: string; value: unknown };
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
      if (!db.objectStoreNames.contains('drafts')) {
        db.createObjectStore('drafts', { keyPath: 'key' });
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

/**
 * 事务 promise 化（rev. 三期 A 组 P0 修复）。
 * IDBTransaction 的事件是 oncomplete/onerror/onabort——给 tx 挂
 * onsuccess/onerror 是无效的（promise 永久 pending）。此前 put/putAll/
 * delete/clear/clearAll 全部挂起但被 fire-and-forget 掩盖；一旦被
 * await（如 clearSegments）即阻塞主流程。
 */
function promisifyTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IDB transaction aborted'));
  });
}

export const indexedDB = {
  async open(): Promise<IDBDatabase> {
    return openDB();
  },

  async put(
    storeName: 'segments' | 'contexts' | 'drafts',
    item: { id?: string; key?: string; index?: number; data?: unknown[]; value?: unknown },
  ): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(item);
    return promisifyTx(tx);
  },

  async putAll(
    storeName: 'segments' | 'contexts' | 'drafts',
    items: { id: string; index: number; data: unknown[] }[],
  ): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    for (const item of items) {
      store.put(item);
    }
    return promisifyTx(tx);
  },

  async getAll<S extends keyof StoreSchema>(storeName: S): Promise<StoreSchema[S][]> {
    const db = await openDB();
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    return promisify(store.getAll() as IDBRequest<StoreSchema[S][]>);
  },

  async get<S extends keyof StoreSchema>(storeName: S, key: string): Promise<StoreSchema[S] | undefined> {
    const db = await openDB();
    const tx = db.transaction(storeName, 'readonly');
    return promisify(tx.objectStore(storeName).get(key) as IDBRequest<StoreSchema[S] | undefined>);
  },

  async delete(storeName: 'segments' | 'contexts' | 'drafts', key: string): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    return promisifyTx(tx);
  },

  async clear(storeName: 'segments' | 'contexts' | 'drafts'): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).clear();
    return promisifyTx(tx);
  },

  async clearAll(): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(['segments', 'contexts', 'drafts'], 'readwrite');
    tx.objectStore('segments').clear();
    tx.objectStore('contexts').clear();
    tx.objectStore('drafts').clear();
    return promisifyTx(tx);
  },
};

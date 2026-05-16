import type { PerformanceMetric, SSEMetric } from './types';

const DB_NAME = 'sky-monitor';
const DB_VERSION = 1;
const STORE_NAME = 'metrics';

let dbCache: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbCache) return Promise.resolve(dbCache);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('type', 'type', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    request.onsuccess = () => {
      dbCache = request.result;
      dbCache.onclose = () => { dbCache = null; };
      dbCache.onversionchange = () => {
        dbCache?.close();
        dbCache = null;
      };
      resolve(dbCache);
    };

    request.onerror = () => {
      console.error('IndexedDB open failed:', request.error);
      reject(request.error);
    };
  });
}

async function withDB<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T | null> {
  try {
    const db = await openDB();
    return await fn(db);
  } catch (e) {
    console.error('IndexedDB operation failed:', e);
    return null;
  }
}

export async function addToQueue(metric: PerformanceMetric | SSEMetric): Promise<void> {
  await withDB((db) => {
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.add(metric);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  });
}

export async function getQueue(): Promise<PerformanceMetric[]> {
  const result = await withDB((db) => {
    return new Promise<PerformanceMetric[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  });
  return result ?? [];
}

export async function clearQueue(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await withDB((db) => {
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const id of ids) {
        store.delete(id);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  });
}

export async function getQueueCount(): Promise<number> {
  const result = await withDB((db) => {
    return new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  });
  return result ?? 0;
}

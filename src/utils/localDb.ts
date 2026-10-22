import { DiaryEntry } from '../types';
import { sortDiariesDescending } from './storage';

export interface SyncQueueItem {
  id: string; // Diary ID
  action: 'save' | 'delete';
  entry?: DiaryEntry;
  timestamp: number;
  retryCount: number;
  maxRetries: number;
  status: 'pending' | 'uploading' | 'failed' | 'completed';
  errorMessage?: string;
  lastAttempt?: number;
}

const DB_NAME = 'hills_travel_local_db_v1';
const DB_VERSION = 1;
const STORE_DIARIES = 'diaries';
const STORE_SYNC_QUEUE = 'sync_queue';

let dbInstancePromise: Promise<IDBDatabase> | null = null;

/**
 * Initializes and opens the IndexedDB database.
 * Supports hundreds of megabytes of offline diary entries and 3MB+ photos.
 */
export function getLocalDb(): Promise<IDBDatabase> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.reject(new Error('IndexedDB is not supported in this environment.'));
  }

  if (dbInstancePromise) {
    return dbInstancePromise;
  }

  dbInstancePromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // 1. Store for full diary entries
      if (!db.objectStoreNames.contains(STORE_DIARIES)) {
        const diaryStore = db.createObjectStore(STORE_DIARIES, { keyPath: 'id' });
        diaryStore.createIndex('date', 'date', { unique: false });
        diaryStore.createIndex('createdAt', 'createdAt', { unique: false });
        diaryStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      // 2. Store for background synchronization retry queue
      if (!db.objectStoreNames.contains(STORE_SYNC_QUEUE)) {
        const queueStore = db.createObjectStore(STORE_SYNC_QUEUE, { keyPath: 'id' });
        queueStore.createIndex('status', 'status', { unique: false });
        queueStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      dbInstancePromise = null;
      reject(request.error || new Error('Failed to open local IndexedDB'));
    };
  });

  return dbInstancePromise;
}

/**
 * Loads all diaries stored in the local IndexedDB, sorted descending.
 */
export async function getAllLocalDiaries(): Promise<DiaryEntry[]> {
  try {
    const db = await getLocalDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DIARIES, 'readonly');
      const store = tx.objectStore(STORE_DIARIES);
      const request = store.getAll();

      request.onsuccess = () => {
        const results = (request.result || []) as DiaryEntry[];
        resolve(sortDiariesDescending(results));
      };

      request.onerror = () => {
        reject(request.error || new Error('Failed to read diaries from IndexedDB'));
      };
    });
  } catch (err) {
    console.warn('getAllLocalDiaries error, fallback to empty array:', err);
    return [];
  }
}

/**
 * Gets a single diary from local IndexedDB by ID.
 */
export async function getLocalDiaryById(id: string): Promise<DiaryEntry | null> {
  try {
    const db = await getLocalDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DIARIES, 'readonly');
      const store = tx.objectStore(STORE_DIARIES);
      const request = store.get(id);

      request.onsuccess = () => {
        resolve((request.result as DiaryEntry) || null);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  } catch (err) {
    console.warn(`getLocalDiaryById(${id}) error:`, err);
    return null;
  }
}

/**
 * Saves or updates a diary entry in local IndexedDB.
 */
export async function saveLocalDiary(entry: DiaryEntry): Promise<void> {
  try {
    const db = await getLocalDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DIARIES, 'readwrite');
      const store = tx.objectStore(STORE_DIARIES);
      const request = store.put(entry);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error(`Failed to save diary ${entry.id} in local DB`));
    });
  } catch (err) {
    console.error('saveLocalDiary error:', err);
    throw err;
  }
}

/**
 * Batch saves multiple diaries into local IndexedDB (e.g. from server fetch).
 */
export async function saveMultipleLocalDiaries(entries: DiaryEntry[]): Promise<void> {
  if (!entries || entries.length === 0) return;
  try {
    const db = await getLocalDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DIARIES, 'readwrite');
      const store = tx.objectStore(STORE_DIARIES);

      for (const entry of entries) {
        store.put(entry);
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Failed to batch save diaries in local DB'));
    });
  } catch (err) {
    console.error('saveMultipleLocalDiaries error:', err);
  }
}

/**
 * Deletes a diary from local IndexedDB.
 */
export async function deleteLocalDiary(id: string): Promise<void> {
  try {
    const db = await getLocalDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DIARIES, 'readwrite');
      const store = tx.objectStore(STORE_DIARIES);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error(`deleteLocalDiary(${id}) error:`, err);
    throw err;
  }
}

// ==========================================
// SYNC QUEUE OPERATIONS (IndexedDB)
// ==========================================

/**
 * Retrieves all items in the background sync retry queue.
 */
export async function getLocalSyncQueue(): Promise<SyncQueueItem[]> {
  try {
    const db = await getLocalDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SYNC_QUEUE, 'readonly');
      const store = tx.objectStore(STORE_SYNC_QUEUE);
      const request = store.getAll();

      request.onsuccess = () => {
        const items = (request.result || []) as SyncQueueItem[];
        // Sort chronologically by timestamp
        resolve(items.sort((a, b) => a.timestamp - b.timestamp));
      };

      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn('getLocalSyncQueue error:', err);
    return [];
  }
}

/**
 * Enqueues or updates an item in the background sync retry queue.
 */
export async function enqueueLocalSyncItem(
  action: 'save' | 'delete',
  id: string,
  entry?: DiaryEntry
): Promise<SyncQueueItem> {
  try {
    const db = await getLocalDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SYNC_QUEUE, 'readwrite');
      const store = tx.objectStore(STORE_SYNC_QUEUE);

      const existingReq = store.get(id);

      existingReq.onsuccess = () => {
        const existing = existingReq.result as SyncQueueItem | undefined;
        const newItem: SyncQueueItem = {
          id,
          action,
          entry: entry || existing?.entry,
          timestamp: Date.now(),
          retryCount: existing ? existing.retryCount : 0,
          maxRetries: 5,
          status: 'pending',
          errorMessage: undefined,
          lastAttempt: undefined,
        };

        const putReq = store.put(newItem);
        putReq.onsuccess = () => resolve(newItem);
        putReq.onerror = () => reject(putReq.error);
      };

      existingReq.onerror = () => reject(existingReq.error);
    });
  } catch (err) {
    console.error('enqueueLocalSyncItem error:', err);
    throw err;
  }
}

/**
 * Updates the state (e.g., status, retryCount, errorMessage) of a queue item.
 */
export async function updateLocalSyncItem(item: SyncQueueItem): Promise<void> {
  try {
    const db = await getLocalDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SYNC_QUEUE, 'readwrite');
      const store = tx.objectStore(STORE_SYNC_QUEUE);
      const request = store.put(item);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('updateLocalSyncItem error:', err);
  }
}

/**
 * Removes a completed item from the sync queue.
 */
export async function dequeueLocalSyncItem(id: string): Promise<void> {
  try {
    const db = await getLocalDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SYNC_QUEUE, 'readwrite');
      const store = tx.objectStore(STORE_SYNC_QUEUE);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error(`dequeueLocalSyncItem(${id}) error:`, err);
  }
}

/**
 * Gets the total number of pending or failed sync operations.
 */
export async function getLocalSyncQueueCount(): Promise<number> {
  try {
    const queue = await getLocalSyncQueue();
    return queue.filter((item) => item.status !== 'completed').length;
  } catch {
    return 0;
  }
}

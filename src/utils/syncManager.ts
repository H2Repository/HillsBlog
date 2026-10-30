import { DiaryEntry } from '../types';
import { 
  getLocalSyncQueue, 
  enqueueLocalSyncItem, 
  updateLocalSyncItem, 
  dequeueLocalSyncItem, 
  getLocalSyncQueueCount,
  saveLocalDiary,
  deleteLocalDiary,
  getLocalDiaryById
} from './localDb';
import { 
  saveDiaryToSQLite, 
  deleteDiaryFromSQLite 
} from '../services/diarySQLite';

export interface SyncStatus {
  pendingCount: number;
  isSyncing: boolean;
  lastSuccessTime: number | null;
  lastError: string | null;
}

let pendingSyncIds = new Set<string>();

/**
 * Checks whether a specific diary is pending sync in the offline/retry queue.
 */
export function isDiaryPendingSync(diaryId: string): boolean {
  return pendingSyncIds.has(diaryId);
}

export function getPendingSyncIds(): string[] {
  return Array.from(pendingSyncIds);
}

export async function refreshPendingSyncIds(): Promise<Set<string>> {
  try {
    const queue = await getLocalSyncQueue();
    const active = queue.filter((item) => item.status !== 'completed').map((item) => item.id);
    pendingSyncIds = new Set(active);
  } catch {
    pendingSyncIds = new Set();
  }
  return pendingSyncIds;
}

type SyncListener = (status: SyncStatus) => void;
const syncListeners = new Set<SyncListener>();

let currentStatus: SyncStatus = {
  pendingCount: 0,
  isSyncing: false,
  lastSuccessTime: null,
  lastError: null,
};

function notifySyncListeners() {
  refreshPendingSyncIds().catch(() => {});
  syncListeners.forEach((listener) => {
    try {
      listener({ ...currentStatus });
    } catch (e) {
      console.warn('Sync listener error:', e);
    }
  });
}

/**
 * Subscribes to real-time sync manager status updates.
 */
export function subscribeSyncStatus(listener: SyncListener): () => void {
  syncListeners.add(listener);
  refreshPendingSyncIds().then((ids) => {
    currentStatus.pendingCount = ids.size;
    listener({ ...currentStatus });
  }).catch(() => {
    listener({ ...currentStatus });
  });

  return () => {
    syncListeners.delete(listener);
  };
}

let isProcessing = false;

// Global state for quota limit (subtle indicator)
let serverQuotaLimitExceeded = false;
export const isServerQuotaExceeded = () => serverQuotaLimitExceeded;
export const setServerQuotaExceeded = (val: boolean) => {
  serverQuotaLimitExceeded = val;
  notifySyncListeners();
};

/**
 * Processes the background upload retry queue targeting SQLite API.
 */
export async function processSyncQueue(
  onProgress?: (completed: number, remaining: number) => void
): Promise<{ successCount: number; failedCount: number }> {
  const isAdmin = localStorage.getItem('isAdminLoggedIn') === 'true';
  if (!isAdmin) {
    currentStatus.isSyncing = false;
    notifySyncListeners();
    return { successCount: 0, failedCount: 0 };
  }

  if (isProcessing) return { successCount: 0, failedCount: 0 };

  const queue = await getLocalSyncQueue();
  const actionableItems = queue.filter((item) => item.status !== 'completed');

  if (actionableItems.length === 0) {
    currentStatus.pendingCount = 0;
    currentStatus.isSyncing = false;
    currentStatus.lastError = null;
    notifySyncListeners();
    return { successCount: 0, failedCount: 0 };
  }

  isProcessing = true;
  currentStatus.isSyncing = true;
  currentStatus.pendingCount = actionableItems.length;
  notifySyncListeners();

  let successCount = 0;
  let failedCount = 0;

  try {
    for (const item of actionableItems) {
      if (!isProcessing) break;
      await updateLocalSyncItem({ ...item, status: 'uploading', lastAttempt: Date.now() });

      try {
        if (item.action === 'save') {
          const entryToSave = item.entry || (await getLocalDiaryById(item.id));
          if (entryToSave) await saveDiaryToSQLite(entryToSave);
          await dequeueLocalSyncItem(item.id);
          successCount++;
        } else if (item.action === 'delete') {
          await deleteDiaryFromSQLite(item.id);
          await dequeueLocalSyncItem(item.id);
          successCount++;
        }
        currentStatus.lastSuccessTime = Date.now();
        currentStatus.lastError = null;
      } catch (err: any) {
        failedCount++;
        const errorMsg = err.message || String(err);
        if (errorMsg.includes('fetch') || errorMsg.includes('network')) {
          currentStatus.lastError = 'offline';
          break;
        }
        await updateLocalSyncItem({
          ...item,
          status: 'failed',
          retryCount: (item.retryCount || 0) + 1,
          lastAttempt: Date.now(),
          errorMessage: errorMsg,
        });
        currentStatus.lastError = errorMsg;
        break;
      }
      const remaining = await getLocalSyncQueueCount();
      currentStatus.pendingCount = remaining;
      notifySyncListeners();
      if (onProgress) onProgress(successCount, remaining);
    }
  } finally {
    isProcessing = false;
    currentStatus.isSyncing = false;
    currentStatus.pendingCount = await getLocalSyncQueueCount();
    notifySyncListeners();
  }
  return { successCount, failedCount };
}

export async function cleanAndHealSyncQueue(): Promise<void> {
  try {
    const queue = await getLocalSyncQueue();
    // Remove duplicates or invalid items if any
    const seen = new Set<string>();
    for (const item of queue) {
      if (seen.has(item.id)) {
        await dequeueLocalSyncItem(item.id);
      } else {
        seen.add(item.id);
      }
    }
  } catch (err) {
    console.warn('cleanAndHealSyncQueue error:', err);
  }
}

/**
 * Saves diary entry locally then enqueues for SQLite sync.
 */
export async function saveDiaryOfflineFirst(entry: DiaryEntry): Promise<void> {
  await saveLocalDiary(entry);
  await enqueueLocalSyncItem('save', entry.id, entry);
  currentStatus.pendingCount = await getLocalSyncQueueCount();
  notifySyncListeners();
  processSyncQueue().catch(console.warn);
}

/**
 * Deletes diary entry locally then enqueues for SQLite sync.
 */
export async function deleteDiaryOfflineFirst(diaryId: string): Promise<void> {
  await deleteLocalDiary(diaryId);
  await enqueueLocalSyncItem('delete', diaryId);
  currentStatus.pendingCount = await getLocalSyncQueueCount();
  notifySyncListeners();
  processSyncQueue().catch(console.warn);
}

export function stopSyncQueue(): void {
  isProcessing = false;
  currentStatus.isSyncing = false;
  notifySyncListeners();
}


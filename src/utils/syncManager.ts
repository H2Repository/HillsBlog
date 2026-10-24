import { DiaryEntry } from '../types';
import { 
  getLocalSyncQueue, 
  enqueueLocalSyncItem, 
  updateLocalSyncItem, 
  dequeueLocalSyncItem, 
  getLocalSyncQueueCount,
  saveLocalDiary,
  deleteLocalDiary,
  getLocalDiaryById,
  SyncQueueItem
} from './localDb';
import { 
  saveDiaryToFirestoreInternal, 
  deleteDiaryFromFirestoreInternal, 
  activateOnlineSession 
} from '../services/diaryFirestore';

export interface SyncStatus {
  pendingCount: number;
  isSyncing: boolean;
  lastSuccessTime: number | null;
  lastError: string | null;
}

let pendingSyncIds = new Set<string>();

/**
 * Checks whether a specific diary is pending sync in the offline/retry queue.
 * Returns true if the diary has unsynced local changes.
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
 * Subscribes to real-time sync manager status updates (pending count, syncing state, errors).
 */
export function subscribeSyncStatus(listener: SyncListener): () => void {
  syncListeners.add(listener);
  // Initial immediate notification
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

/**
 * Processes the background upload retry queue.
 * - Iterates through pending/failed items in chronological order.
 * - If an item fails due to network or connection loss, pauses and retains item for next retry.
 * - Successfully uploaded items are dequeued after full cloud server acknowledgment.
 */
export async function processSyncQueue(
  onProgress?: (completed: number, remaining: number) => void
): Promise<{ successCount: number; failedCount: number }> {
  if (isProcessing) {
    return { successCount: 0, failedCount: 0 };
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    currentStatus.isSyncing = false;
    notifySyncListeners();
    return { successCount: 0, failedCount: 0 };
  }

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

  // Ensure Firestore is connected online during queue processing
  await activateOnlineSession().catch(() => {});

  let successCount = 0;
  let failedCount = 0;

  try {
    for (const item of actionableItems) {
      // Check network connectivity before each attempt
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        currentStatus.lastError = '오프라인 상태입니다. 네트워크 연결 시 자동으로 재개됩니다.';
        break;
      }

      // Mark as uploading
      await updateLocalSyncItem({
        ...item,
        status: 'uploading',
        lastAttempt: Date.now(),
      });

      try {
        if (item.action === 'save') {
          // Ensure we have the freshest full entry (fallback to local IndexedDB if entry missing in queue)
          let entryToSave = item.entry;
          if (!entryToSave) {
            entryToSave = (await getLocalDiaryById(item.id)) || undefined;
          }

          if (entryToSave) {
            await saveDiaryToFirestoreInternal(entryToSave);
          } else {
            console.warn(`Sync queue item ${item.id} has no diary content, skipping.`);
          }

          await dequeueLocalSyncItem(item.id);
          successCount++;
          currentStatus.lastSuccessTime = Date.now();
          currentStatus.lastError = null;
        } else if (item.action === 'delete') {
          await deleteDiaryFromFirestoreInternal(item.id);
          await dequeueLocalSyncItem(item.id);
          successCount++;
          currentStatus.lastSuccessTime = Date.now();
          currentStatus.lastError = null;
        }

        const remaining = await getLocalSyncQueueCount();
        currentStatus.pendingCount = remaining;
        notifySyncListeners();

        if (onProgress) {
          onProgress(successCount, remaining);
        }
      } catch (err: unknown) {
        failedCount++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.warn(`Sync failed for item ${item.id} (${item.action}):`, errorMsg);

        // Mark item as failed with attempt timestamp and message for automatic retry
        await updateLocalSyncItem({
          ...item,
          status: 'failed',
          retryCount: item.retryCount + 1,
          lastAttempt: Date.now(),
          errorMessage: errorMsg,
        });

        currentStatus.lastError = errorMsg;
        notifySyncListeners();

        // If network error, pause queue to resume when connection stabilizes
        if (
          errorMsg.includes('offline') ||
          errorMsg.includes('network') ||
          errorMsg.includes('Failed to fetch') ||
          errorMsg.includes('the client is offline') ||
          (typeof navigator !== 'undefined' && !navigator.onLine)
        ) {
          break;
        }
      }
    }
  } finally {
    isProcessing = false;
    currentStatus.isSyncing = false;
    currentStatus.pendingCount = await getLocalSyncQueueCount();
    notifySyncListeners();
  }

  return { successCount, failedCount };
}

/**
 * 1. Saves diary entry locally into IndexedDB first (0ms latency, handles 3MB+ photos).
 * 2. Enqueues entry into the background retry queue.
 * 3. Triggers background sync to cloud server if online.
 */
export async function saveDiaryOfflineFirst(entry: DiaryEntry): Promise<void> {
  // 1. Immediately store in local IndexedDB
  await saveLocalDiary(entry);

  // 2. Enqueue into background sync retry queue
  await enqueueLocalSyncItem('save', entry.id, entry);

  currentStatus.pendingCount = await getLocalSyncQueueCount();
  notifySyncListeners();

  // 3. If online, activate online session and initiate background sync immediately
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    activateOnlineSession()
      .then(() => processSyncQueue())
      .catch((err) => {
        console.warn('Background sync trigger note:', err);
      });
  }
}

/**
 * 1. Deletes diary entry from local IndexedDB immediately.
 * 2. Enqueues delete action in background sync retry queue.
 * 3. Triggers background sync if online.
 */
export async function deleteDiaryOfflineFirst(diaryId: string): Promise<void> {
  // 1. Delete from local IndexedDB
  await deleteLocalDiary(diaryId);

  // 2. Enqueue deletion into retry queue
  await enqueueLocalSyncItem('delete', diaryId);

  currentStatus.pendingCount = await getLocalSyncQueueCount();
  notifySyncListeners();

  // 3. If online, activate online session and trigger background delete
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    activateOnlineSession()
      .then(() => processSyncQueue())
      .catch((err) => {
        console.warn('Background delete trigger note:', err);
      });
  }
}

// ==========================================
// AUTO-SYNC LIFECYCLE LISTENERS
// ==========================================

if (typeof window !== 'undefined') {
  // Re-attempt sync when internet connection is restored
  window.addEventListener('online', () => {
    console.log('[SyncManager] Network online detected. Resuming background upload queue...');
    activateOnlineSession()
      .then(() => processSyncQueue())
      .catch(console.warn);
  });

  // Re-attempt sync when user switches back to this browser tab
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      processSyncQueue().catch(console.warn);
    }
  });

  // Periodic heartbeat: check every 25s if pending items exist
  setInterval(() => {
    if (navigator.onLine && !isProcessing) {
      getLocalSyncQueueCount().then((count) => {
        if (count > 0) {
          processSyncQueue().catch(console.warn);
        }
      }).catch(() => {});
    }
  }, 25000);
}

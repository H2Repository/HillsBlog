import { DiaryEntry } from '../types';
import { saveDiaryToFirestore, deleteDiaryFromFirestore } from '../services/diaryFirestore';
import { sortDiariesDescending } from './storage';

export type SyncActionType = 'save' | 'delete';

export interface PendingSyncItem {
  id: string;
  action: SyncActionType;
  entry?: DiaryEntry;
  timestamp: number;
}

const STORAGE_KEY_PENDING_QUEUE = 'hills_blog_offline_pending_queue_v1';

// Listeners for sync queue count updates
type QueueChangeListener = (count: number) => void;
const listeners = new Set<QueueChangeListener>();

function notifyListeners() {
  const count = getPendingSyncCount();
  listeners.forEach((listener) => {
    try {
      listener(count);
    } catch (e) {
      console.warn('Queue listener error:', e);
    }
  });
}

export function subscribeSyncQueueChange(listener: QueueChangeListener): () => void {
  listeners.add(listener);
  listener(getPendingSyncCount());
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Gets all pending synchronization items from localStorage
 */
export function getPendingSyncQueue(): PendingSyncItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PENDING_QUEUE);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Failed to parse offline sync queue:', err);
    return [];
  }
}

/**
 * Saves pending queue to localStorage
 */
export function savePendingSyncQueue(queue: PendingSyncItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_PENDING_QUEUE, JSON.stringify(queue));
    notifyListeners();
  } catch (err) {
    console.error('Failed to save offline sync queue:', err);
  }
}

/**
 * Returns the number of operations currently pending offline sync
 */
export function getPendingSyncCount(): number {
  return getPendingSyncQueue().length;
}

/**
 * Checks if a specific diary ID is marked to be deleted
 */
export function isDiaryPendingDelete(id: string): boolean {
  const queue = getPendingSyncQueue();
  return queue.some((item) => item.id === id && item.action === 'delete');
}

/**
 * Gets the locally saved diary entry if pending save
 */
export function getPendingSavedDiary(id: string): DiaryEntry | undefined {
  const queue = getPendingSyncQueue();
  const found = queue.find((item) => item.id === id && item.action === 'save');
  return found?.entry;
}

/**
 * Enqueue a diary to be saved/updated when online
 */
export function enqueuePendingSave(entry: DiaryEntry): void {
  const queue = getPendingSyncQueue();
  const existingIdx = queue.findIndex((item) => item.id === entry.id);

  const newItem: PendingSyncItem = {
    id: entry.id,
    action: 'save',
    entry,
    timestamp: Date.now(),
  };

  if (existingIdx >= 0) {
    // Replace existing pending action (whether it was delete or save)
    queue[existingIdx] = newItem;
  } else {
    queue.push(newItem);
  }

  savePendingSyncQueue(queue);
}

/**
 * Enqueue a diary deletion to be synced when online
 */
export function enqueuePendingDelete(diaryId: string): void {
  const queue = getPendingSyncQueue();
  const filtered = queue.filter((item) => item.id !== diaryId);

  const newItem: PendingSyncItem = {
    id: diaryId,
    action: 'delete',
    timestamp: Date.now(),
  };

  filtered.push(newItem);
  savePendingSyncQueue(filtered);
}

/**
 * Remove an item from the queue by ID
 */
export function dequeuePendingItem(id: string): void {
  const queue = getPendingSyncQueue();
  const nextQueue = queue.filter((item) => item.id !== id);
  if (nextQueue.length !== queue.length) {
    savePendingSyncQueue(nextQueue);
  }
}

/**
 * Clears the entire offline sync queue
 */
export function clearPendingQueue(): void {
  savePendingSyncQueue([]);
}

/**
 * Merges a remote list of diaries from Firestore with any local pending offline modifications.
 * - Filters out diaries scheduled for deletion
 * - Replaces remote items with newer pending saved items
 * - Prepends newly created offline diaries
 * - Strictly sorts result newest travel date/time first
 */
export function mergeRemoteWithPendingQueue(remoteList: DiaryEntry[]): DiaryEntry[] {
  const queue = getPendingSyncQueue();
  if (queue.length === 0) {
    return sortDiariesDescending(remoteList);
  }

  const deleteIds = new Set(
    queue.filter((item) => item.action === 'delete').map((item) => item.id)
  );

  const saveMap = new Map<string, DiaryEntry>();
  queue
    .filter((item) => item.action === 'save' && item.entry)
    .forEach((item) => {
      saveMap.set(item.id, item.entry!);
    });

  // 1. Filter out deleted diaries and apply pending updates to existing remote entries
  const merged: DiaryEntry[] = [];
  const processedSaveIds = new Set<string>();

  for (const remoteEntry of remoteList) {
    if (deleteIds.has(remoteEntry.id)) {
      continue; // Skip, deleted offline
    }

    if (saveMap.has(remoteEntry.id)) {
      const localUpdated = saveMap.get(remoteEntry.id)!;
      merged.push(localUpdated);
      processedSaveIds.add(remoteEntry.id);
    } else {
      merged.push(remoteEntry);
    }
  }

  // 2. Prepend brand new diaries that were created offline (not yet in remoteList)
  saveMap.forEach((entry, id) => {
    if (!processedSaveIds.has(id)) {
      merged.push(entry);
    }
  });

  // 3. Sort strictly by newest date/time descending
  return sortDiariesDescending(merged);
}

let isSyncing = false;

/**
 * Processes all queued offline sync items sequentially.
 * Only runs if the device is currently online.
 */
export async function processPendingSyncQueue(
  onProgress?: (synced: number, remaining: number) => void
): Promise<{ successCount: number; failedCount: number }> {
  if (isSyncing) {
    return { successCount: 0, failedCount: 0 };
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { successCount: 0, failedCount: 0 };
  }

  const queue = getPendingSyncQueue();
  if (queue.length === 0) {
    return { successCount: 0, failedCount: 0 };
  }

  isSyncing = true;
  let successCount = 0;
  let failedCount = 0;

  try {
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];

      // Double-check connection before each operation
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        break;
      }

      try {
        if (item.action === 'save' && item.entry) {
          await saveDiaryToFirestore(item.entry);
          dequeuePendingItem(item.id);
          successCount++;
        } else if (item.action === 'delete') {
          await deleteDiaryFromFirestore(item.id);
          dequeuePendingItem(item.id);
          successCount++;
        }

        if (onProgress) {
          onProgress(successCount, getPendingSyncCount());
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.warn(`Sync failed for item ${item.id} (${item.action}):`, errorMsg);

        // If network / offline error, pause and retry later
        if (
          errorMsg.includes('offline') || 
          errorMsg.includes('network') || 
          errorMsg.includes('Failed to fetch') ||
          (typeof navigator !== 'undefined' && !navigator.onLine)
        ) {
          failedCount++;
          break; // Stop loop, resume when connection restores
        }

        // If error is permission or structural validation, log and keep in queue or handle
        failedCount++;
      }
    }
  } finally {
    isSyncing = false;
  }

  return { successCount, failedCount };
}

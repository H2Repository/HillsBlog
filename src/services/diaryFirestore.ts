import { 
  collection, 
  doc, 
  getDoc,
  getDocs,
  getDocFromServer,
  getDocsFromServer,
  setDoc, 
  updateDoc,
  increment,
  deleteDoc, 
  enableNetwork,
  disableNetwork,
  waitForPendingWrites
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { DiaryEntry, TravelPhoto } from '../types';
import { 
  getStoredDiaries, 
  saveDiaries as saveToLocalCache, 
  sortDiariesDescending,
  deduplicateDiaries,
  isDiaryDuplicate,
  pickBetterDiary,
  normalizeTitle
} from '../utils/storage';
import { mergeRemoteWithPendingQueue } from '../utils/offlineSync';
import { createThumbnail } from '../utils/imageCompressor';
import { 
  saveMultipleLocalDiaries, 
  saveLocalDiary, 
  deleteLocalDiary,
  getAllLocalDiaries, 
  getLocalSyncQueue, 
  getLocalDiaryById,
  dequeueLocalSyncItem,
  enqueueLocalSyncItem,
  recordServerChangeLogs,
  ServerChangeLog
} from '../utils/localDb';

const DIARIES_COLLECTION = 'diaries';
const MAX_SINGLE_DOC_BYTES = 700000; // 700KB safety margin below Firestore's 1MiB limit
const PHOTO_CHUNK_SIZE = 500000; // 500KB chunks for photos exceeding single doc limit
const MAX_DIARY_TOTAL_BYTES = 10 * 1024 * 1024; // 10MB total diary limit

export const AUTO_OFFLINE_DELAY_MS = 120 * 1000; // 2 minutes (120,000ms)

export interface FirestoreConnectionState {
  isOnline: boolean;
  remainingSeconds: number;
  autoOfflineExpiresAt: number;
}

let activeOnlineRequests = 0;
let isFirestoreOnline = true; // Initially online during app boot
let autoOfflineTimer: ReturnType<typeof setTimeout> | null = null;
let autoOfflineExpiresAt = 0;
let countdownInterval: ReturnType<typeof setInterval> | null = null;

type ConnectionStateListener = (state: FirestoreConnectionState) => void;
const connectionListeners = new Set<ConnectionStateListener>();

function notifyConnectionListeners() {
  const remainingSeconds = autoOfflineExpiresAt > 0 
    ? Math.max(0, Math.ceil((autoOfflineExpiresAt - Date.now()) / 1000))
    : 0;
  const state: FirestoreConnectionState = {
    isOnline: isFirestoreOnline,
    remainingSeconds,
    autoOfflineExpiresAt,
  };
  connectionListeners.forEach((listener) => {
    try {
      listener(state);
    } catch (e) {
      console.warn('Connection listener error:', e);
    }
  });
}

function startCountdownTicker() {
  if (countdownInterval) return;
  countdownInterval = setInterval(() => {
    if (autoOfflineExpiresAt > 0) {
      notifyConnectionListeners();
    } else {
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
    }
  }, 1000);
}

function stopCountdownTicker() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

/**
 * Schedules or refreshes the 2-minute auto-offline timer.
 * Automatically severs the Firestore connection (disableNetwork) after 2 minutes of idle time.
 */
export function scheduleAutoOfflineTimer(delayMs: number = AUTO_OFFLINE_DELAY_MS): void {
  if (autoOfflineTimer) {
    clearTimeout(autoOfflineTimer);
    autoOfflineTimer = null;
  }
  autoOfflineExpiresAt = Date.now() + delayMs;
  startCountdownTicker();
  notifyConnectionListeners();

  autoOfflineTimer = setTimeout(async () => {
    autoOfflineTimer = null;
    autoOfflineExpiresAt = 0;
    stopCountdownTicker();

    // Only transition to offline if no requests are actively executing
    if (activeOnlineRequests <= 0) {
      try {
        await disableNetwork(db);
        isFirestoreOnline = false;
        console.log('[Firestore] 2분 무작업 경과: Firestore 오프라인(절전 모드)으로 전환되었습니다.');
      } catch (err) {
        console.warn('disableNetwork auto-sleep note:', err);
      } finally {
        notifyConnectionListeners();
      }
    }
  }, delayMs);
}

/**
 * Enables Firestore network connection and cancels any pending auto-sleep
 */
export async function enableFirestoreNetwork(): Promise<void> {
  if (autoOfflineTimer) {
    clearTimeout(autoOfflineTimer);
    autoOfflineTimer = null;
  }
  autoOfflineExpiresAt = 0;
  stopCountdownTicker();

  if (!isFirestoreOnline) {
    try {
      await enableNetwork(db);
      isFirestoreOnline = true;
      console.log('[Firestore] Firestore 네트워크 온라인 활성화됨');
    } catch (err) {
      console.warn('enableNetwork note:', err);
    } finally {
      notifyConnectionListeners();
    }
  }
}

/**
 * Disables Firestore network connection, putting client in offline mode immediately
 */
export async function disableFirestoreNetwork(): Promise<void> {
  if (autoOfflineTimer) {
    clearTimeout(autoOfflineTimer);
    autoOfflineTimer = null;
  }
  autoOfflineExpiresAt = 0;
  stopCountdownTicker();

  try {
    await disableNetwork(db);
    isFirestoreOnline = false;
  } catch (err) {
    console.warn('disableNetwork note:', err);
  } finally {
    notifyConnectionListeners();
  }
}

/**
 * Activates an online session on user demand (app open, refresh, save, edit, delete)
 * and keeps it alive for 2 minutes after completion.
 */
export async function activateOnlineSession(): Promise<void> {
  await enableFirestoreNetwork();
  scheduleAutoOfflineTimer(AUTO_OFFLINE_DELAY_MS);
}

/**
 * Subscribes to real-time Firestore connection status and countdown seconds.
 */
export function subscribeFirestoreConnection(listener: ConnectionStateListener): () => void {
  connectionListeners.add(listener);
  const remainingSeconds = autoOfflineExpiresAt > 0 
    ? Math.max(0, Math.ceil((autoOfflineExpiresAt - Date.now()) / 1000))
    : 0;
  listener({
    isOnline: isFirestoreOnline,
    remainingSeconds,
    autoOfflineExpiresAt,
  });
  return () => {
    connectionListeners.delete(listener);
  };
}

export function getFirestoreConnectionState(): FirestoreConnectionState {
  const remainingSeconds = autoOfflineExpiresAt > 0 
    ? Math.max(0, Math.ceil((autoOfflineExpiresAt - Date.now()) / 1000))
    : 0;
  return {
    isOnline: isFirestoreOnline,
    remainingSeconds,
    autoOfflineExpiresAt,
  };
}

/**
 * Executes a transactional DB task online and keeps connection alive for 2 minutes.
 * Guarantees all pending writes are acknowledged by Firestore backend before scheduling sleep timer.
 */
export async function executeOnline<T>(action: () => Promise<T>): Promise<T> {
  activeOnlineRequests++;
  await enableFirestoreNetwork();
  try {
    const result = await action();
    // Guarantee that pending writes are flushed to the cloud server (with 3-second timeout protection)
    try {
      await Promise.race([
        waitForPendingWrites(db),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('waitForPendingWrites timeout')), 3000)
        )
      ]);
    } catch (wErr) {
      console.warn('waitForPendingWrites warning:', wErr);
    }
    return result;
  } finally {
    activeOnlineRequests = Math.max(0, activeOnlineRequests - 1);
    // User Requirement: Keep online for 2 minutes after successful completion, then auto switch to offline!
    scheduleAutoOfflineTimer(AUTO_OFFLINE_DELAY_MS);
  }
}

/**
 * Normalizes a DiaryEntry to strictly comply with Firestore security rules (firestore.rules)
 * - id: string matching ^[a-zA-Z0-9_\-]+$
 * - title: string <= 1000
 * - content: string <= 100000
 * - date: string <= 50
 * - time: string <= 50
 * - location: map with lat, lng, address, region, includeInDistance
 * - rating: number between 0 and 5
 * - views: number >= 0
 * - photos: array of TravelPhoto with valid photo IDs
 */
export function normalizeDiaryEntryForFirestore(entry: any, fallbackId?: string): DiaryEntry {
  const sanitizeId = (rawId: any, fallback: string): string => {
    if (typeof rawId === 'string' && rawId.trim().length > 0) {
      const clean = rawId.trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
      if (clean.length > 0) return clean.slice(0, 128);
    }
    return fallback;
  };

  const id = sanitizeId(entry?.id || fallbackId, `diary_${Date.now()}`);
  const title = typeof entry?.title === 'string' && entry.title.trim().length > 0
    ? entry.title.slice(0, 1000)
    : '무제';
  const content = typeof entry?.content === 'string' ? entry.content.slice(0, 100000) : '';
  const date = typeof entry?.date === 'string' && entry.date ? entry.date.slice(0, 50) : new Date().toISOString().slice(0, 10);
  const time = typeof entry?.time === 'string' && entry.time ? entry.time.slice(0, 50) : '12:00';

  const rawLoc = entry?.location || {};
  const lat = typeof rawLoc.lat === 'number' && !isNaN(rawLoc.lat) ? rawLoc.lat : 21.0285;
  const lng = typeof rawLoc.lng === 'number' && !isNaN(rawLoc.lng) ? rawLoc.lng : 105.8542;
  const address = typeof rawLoc.address === 'string' ? rawLoc.address.slice(0, 500) : '';
  const region = typeof rawLoc.region === 'string' ? rawLoc.region.slice(0, 200) : '위치 미지정';
  const includeInDistance = rawLoc.includeInDistance !== false && entry?.includeInDistance !== false;

  let rating = typeof entry?.rating === 'number' && !isNaN(entry.rating) ? entry.rating : 5;
  if (rating < 0) rating = 0;
  if (rating > 5) rating = 5;

  const views = typeof entry?.views === 'number' && !isNaN(entry.views) && entry.views >= 0 ? entry.views : 0;
  const createdAt = typeof entry?.createdAt === 'number' ? entry.createdAt : Date.now();
  const updatedAt = typeof entry?.updatedAt === 'number' ? entry.updatedAt : Date.now();

  const rawPhotos = Array.isArray(entry?.photos) ? entry.photos : [];
  const photos: TravelPhoto[] = rawPhotos.map((p: any, idx: number) => {
    const photoId = sanitizeId(p?.id, `photo_${id}_${idx}`);
    return {
      id: photoId,
      url: typeof p?.url === 'string' ? p.url : '',
      thumbnailUrl: typeof p?.thumbnailUrl === 'string' ? p.thumbnailUrl : undefined,
      caption: typeof p?.caption === 'string' ? p.caption.slice(0, 500) : '',
      timestamp: typeof p?.timestamp === 'string' ? p.timestamp : new Date().toISOString(),
      isCover: !!p?.isCover,
    };
  });

  return {
    id,
    title,
    content,
    date,
    time,
    location: {
      lat,
      lng,
      address,
      region,
      includeInDistance,
    },
    photos,
    weather: entry?.weather || 'sunny',
    moodTags: Array.isArray(entry?.moodTags) ? entry.moodTags : [],
    localInsights: entry?.localInsights || { recommendedForSolo: '' },
    rating,
    views,
    hasSubcollectionPhotos: !!entry?.hasSubcollectionPhotos,
    totalPhotosCount: Math.max(typeof entry?.totalPhotosCount === 'number' ? entry.totalPhotosCount : 0, photos.length),
    includeInDistance,
    createdAt,
    updatedAt,
  };
}

/**
 * Strips undefined properties recursively so Firestore does not throw an error
 */
function sanitizeForFirestore<T>(data: T): T {
  return JSON.parse(JSON.stringify(data));
}

/**
 * Check if the current user has permission to write/delete diaries
 */
export function checkAdminPermission(): boolean {
  if (auth.currentUser) return true;
  try {
    const saved = localStorage.getItem('hills_blog_admin_session');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.isAdmin) return true;
    }
  } catch {}
  return false;
}

/**
 * Internal helper to fetch & reassemble full photos for a diary while network is already active
 */
async function fetchDiaryFullPhotosInternal(diaryId: string): Promise<TravelPhoto[]> {
  try {
    const photosSubcolRef = collection(db, DIARIES_COLLECTION, diaryId, 'photos');
    const snap = await getDocs(photosSubcolRef);
    if (!snap.empty) {
      const list: TravelPhoto[] = [];
      for (const d of snap.docs) {
        const rawPhoto = d.data() as TravelPhoto & { isChunked?: boolean; chunkCount?: number };
        if (rawPhoto.isChunked && rawPhoto.chunkCount && rawPhoto.chunkCount > 0) {
          try {
            const chunksColRef = collection(db, DIARIES_COLLECTION, diaryId, 'photos', rawPhoto.id, 'chunks');
            const chunkSnap = await getDocs(chunksColRef);
            const chunkMap: { [idx: number]: string } = {};
            chunkSnap.forEach((cd) => {
              const c = cd.data();
              chunkMap[c.index] = c.data || '';
            });
            let fullUrl = '';
            for (let i = 0; i < rawPhoto.chunkCount; i++) {
              fullUrl += (chunkMap[i] || '');
            }
            list.push({
              ...rawPhoto,
              url: fullUrl || rawPhoto.url,
            });
          } catch (chunkErr) {
            console.warn(`Error reassembling chunks for photo ${rawPhoto.id}:`, chunkErr);
            list.push(rawPhoto);
          }
        } else {
          list.push(rawPhoto);
        }
      }
      // Sort so cover photo is first, and photos retain order
      list.sort((a, b) => {
        if (a.isCover && !b.isCover) return -1;
        if (!a.isCover && b.isCover) return 1;
        return (a.timestamp || '').localeCompare(b.timestamp || '');
      });
      return list;
    }
  } catch (err) {
    console.warn(`Could not fetch subcollection photos for ${diaryId}:`, err);
  }
  return [];
}

/**
 * Loads full attached photos for a diary (supports up to 3MB per photo with chunk reassembly).
 * Connects online to retrieve and immediately switches back to offline.
 */
export async function fetchDiaryFullPhotos(diaryId: string): Promise<TravelPhoto[]> {
  return await executeOnline(async () => {
    return await fetchDiaryFullPhotosInternal(diaryId);
  });
}

export interface InitialSyncResult {
  diaries: DiaryEntry[];
  addedToServerCount: number;
  serverAddedCount: number;
  serverUpdatedCount: number;
  serverDeletedCount: number;
  changeLogs: ServerChangeLog[];
}

/**
 * 1. App Open & Online Reconnect: Connects online to Firestore, retrieves all diaries and subcollection photos,
 * compares with local DB, records server additions, edits, and deletions,
 * updates the local DB with the freshest server state, uploads any local offline items,
 * and schedules the 2-minute auto-offline timer.
 */
export async function syncInitialDiariesOnline(
  onProgress?: (message: string) => void
): Promise<InitialSyncResult> {
  // Pulling server data for everyone; upload/delete logic is guarded by isAdminUser below
  const isAdminUser = checkAdminPermission();

  try {
    return await executeOnline(async () => {
      if (onProgress) onProgress('서버 데이터와 로컬 DB를 비교 중입니다...');

      const diariesCol = collection(db, DIARIES_COLLECTION);
      let snap;
      try {
        // ALWAYS fetch directly from Firestore cloud server first to bypass local persistent cache
        snap = await getDocsFromServer(diariesCol);
      } catch (srvErr) {
        console.warn('getDocsFromServer note, falling back to cached getDocs:', srvErr);
        snap = await getDocs(diariesCol);
      }

      const remoteMap = new Map<string, DiaryEntry>();

      if (!snap.empty) {
        for (const docSnap of snap.docs) {
          try {
            const raw = docSnap.data();
            if (raw && (raw.id || docSnap.id)) {
              const data: DiaryEntry = {
                id: raw.id || docSnap.id,
                title: raw.title || '제목 없음',
                content: typeof raw.content === 'string' ? raw.content : '',
                date: raw.date || '',
                time: raw.time || '',
                location: raw.location ? {
                  ...raw.location,
                  includeInDistance: raw.location.includeInDistance !== false && raw.includeInDistance !== false,
                } : { lat: 21.0285, lng: 105.8542, address: '', region: '위치 미지정', includeInDistance: true },
                photos: Array.isArray(raw.photos) ? raw.photos : [],
                weather: raw.weather || 'sunny',
                moodTags: Array.isArray(raw.moodTags) ? raw.moodTags : [],
                localInsights: raw.localInsights || { recommendedForSolo: '' },
                rating: typeof raw.rating === 'number' ? raw.rating : 5,
                views: typeof raw.views === 'number' ? raw.views : 0,
                hasSubcollectionPhotos: !!raw.hasSubcollectionPhotos,
                totalPhotosCount: raw.totalPhotosCount,
                includeInDistance: raw.location?.includeInDistance !== false && raw.includeInDistance !== false,
                createdAt: raw.createdAt || Date.now(),
                updatedAt: raw.updatedAt || raw.createdAt || Date.now(),
              };

              // Ensure full photos are preserved and loaded properly
              const localEntry = await getLocalDiaryById(data.id).catch(() => null);
              const isLocalAsFresh = localEntry && (localEntry.updatedAt || 0) >= (data.updatedAt || 0);
              const expectedCount = Math.max(
                data.totalPhotosCount || 0,
                data.photos.length,
                localEntry?.photos?.length || 0
              );

              // 1. If local DB already has all full photos with valid urls and is at least as fresh, use them
              if (
                isLocalAsFresh &&
                localEntry &&
                localEntry.photos &&
                localEntry.photos.length >= expectedCount &&
                localEntry.photos.every((p) => p.url && p.url.length > 0)
              ) {
                data.photos = localEntry.photos;
              } else if (
                data.hasSubcollectionPhotos ||
                (data.totalPhotosCount && data.totalPhotosCount > data.photos.length) ||
                data.photos.length === 0 ||
                data.photos.some((p) => !p.url || p.isChunked)
              ) {
                // 2. Fetch full photos from Firestore subcollection if needed
                try {
                  const subPhotos = await fetchDiaryFullPhotosInternal(data.id);
                  if (subPhotos.length > 0) {
                    data.photos = subPhotos;
                  } else if (localEntry && localEntry.photos && localEntry.photos.length > 0) {
                    data.photos = localEntry.photos;
                  }
                } catch (subErr) {
                  if (localEntry && localEntry.photos && localEntry.photos.length > 0) {
                    data.photos = localEntry.photos;
                  }
                }
              }

              // Keep totalPhotosCount in sync with the maximum known photo count
              data.totalPhotosCount = Math.max(data.totalPhotosCount || 0, data.photos.length);
              remoteMap.set(data.id, data);
            }
          } catch (err) {
            console.error('Error parsing diary document:', docSnap.id, err);
          }
        }
      }

      // Merge with any pending unsynced changes from local IndexedDB queue
      const queue = await getLocalSyncQueue().catch(() => []);
      const pendingDeleteIds = new Set(
        queue.filter((q) => q.status !== 'completed' && q.action === 'delete').map((q) => q.id)
      );
      const pendingSaveMap = new Map<string, DiaryEntry>();
      for (const q of queue) {
        if (q.status !== 'completed' && q.action === 'save') {
          if (q.entry) {
            pendingSaveMap.set(q.id, q.entry);
          } else {
            const local = await getLocalDiaryById(q.id).catch(() => null);
            if (local) pendingSaveMap.set(q.id, local);
          }
        }
      }

      // Read current local diaries from IndexedDB
      const localDiaries = await getAllLocalDiaries().catch(() => []);
      const localMap = new Map<string, DiaryEntry>();
      for (const d of localDiaries) {
        localMap.set(d.id, d);
      }
      const cachedDiaries = getStoredDiaries();
      for (const item of cachedDiaries) {
        if (!localMap.has(item.id)) localMap.set(item.id, item);
      }

      // Clean up any sync queue items that are already synchronized on the server or ghost items
      for (const q of queue) {
        if (q.status !== 'completed' && q.action === 'save') {
          const remoteDoc = remoteMap.get(q.id);
          const localDoc = localMap.get(q.id);
          const candidate = q.entry || localDoc;
          if (!candidate) {
            // Ghost item with no diary entry anywhere
            console.log(`[AutoSync] Dequeuing ghost item: ${q.id}`);
            await dequeueLocalSyncItem(q.id).catch(() => {});
            pendingSaveMap.delete(q.id);
          } else if (remoteDoc && (remoteDoc.updatedAt || 0) >= (candidate.updatedAt || 0)) {
            // Already present on remote server with same or newer timestamp
            console.log(`[AutoSync] Dequeuing already-synced item: ${q.id}`);
            await dequeueLocalSyncItem(q.id).catch(() => {});
            pendingSaveMap.delete(q.id);
          }
        } else if (q.status !== 'completed' && q.action === 'delete') {
          if (!remoteMap.has(q.id)) {
            console.log(`[AutoSync] Dequeuing already-deleted item: ${q.id}`);
            await dequeueLocalSyncItem(q.id).catch(() => {});
          }
        }
      }


      const changeLogs: ServerChangeLog[] = [];
      let addedToServerCount = 0;
      let serverAddedCount = 0;
      let serverUpdatedCount = 0;
      let serverDeletedCount = 0;
      const mergedMap = new Map<string, DiaryEntry>();

      // Pre-step: Deduplicate remote diaries from server (fixes duplicate documents already on server)
      const remoteList = Array.from(remoteMap.values());
      const { deduplicated: cleanRemoteList, removedIds: remoteRemovedIds } = deduplicateDiaries(remoteList);
      const cleanRemoteMap = new Map<string, DiaryEntry>();
      cleanRemoteList.forEach((d) => cleanRemoteMap.set(d.id, d));

      if (isAdminUser && remoteRemovedIds.length > 0) {
        console.log(`[AutoSync] Found and cleaning ${remoteRemovedIds.length} duplicate server documents:`, remoteRemovedIds);
        for (const dupId of remoteRemovedIds) {
          try {
            await deleteDiaryFromFirestoreInternal(dupId);
            await deleteLocalDiary(dupId).catch(() => {});
            await dequeueLocalSyncItem(dupId).catch(() => {});
          } catch (cleanErr) {
            console.warn(`Error cleaning duplicate server diary ${dupId}:`, cleanErr);
          }
        }
      }

      // 1. Process pending offline deletions from this device (Admin only)
      if (isAdminUser) {
        for (const delId of pendingDeleteIds) {
          if (cleanRemoteMap.has(delId) || remoteMap.has(delId)) {
            console.log(`[AutoSync] Deleting on server from pending queue: ${delId}`);
            try {
              await deleteDiaryFromFirestoreInternal(delId);
              await dequeueLocalSyncItem(delId).catch(() => {});
            } catch (delErr) {
              console.warn(`Pending delete server error for ${delId}:`, delErr);
            }
          } else {
            await dequeueLocalSyncItem(delId).catch(() => {});
          }
          await deleteLocalDiary(delId).catch(() => {});
        }
      }

      // 2. Process all clean remote diaries from Firestore
      for (const [id, remoteDiary] of cleanRemoteMap.entries()) {
        if (isAdminUser && pendingDeleteIds.has(id)) {
          continue;
        }

        const local = localMap.get(id);
        const pendingSave = pendingSaveMap.get(id);

        if (pendingSave) {
          const normalizedPending = normalizeDiaryEntryForFirestore(pendingSave, id);
          if ((remoteDiary.updatedAt || 0) >= (normalizedPending.updatedAt || 0)) {
            // Remote is at least as fresh: dequeue pending queue item
            await dequeueLocalSyncItem(id).catch(() => {});
            mergedMap.set(id, remoteDiary);
          } else if (isAdminUser) {
            // This device has an offline edit or create for this diary:
            // Upload to server ONLY when in Admin mode!
            if (onProgress) onProgress(`서버에 수정/등록된 일기 동기화 중... (${normalizedPending.title})`);
            try {
              await saveDiaryToFirestoreInternal(normalizedPending);
              await dequeueLocalSyncItem(id).catch(() => {});
              addedToServerCount++;
              mergedMap.set(id, normalizedPending);
              await saveLocalDiary(normalizedPending).catch(() => {});
            } catch (upErr) {
              console.warn(`Pending save upload error for ${id}:`, upErr);
              mergedMap.set(id, normalizedPending);
            }
          } else {
            // Non-admin mode: keep remote diary
            mergedMap.set(id, remoteDiary);
          }
        } else if (!local) {
          // New diary added on server from another device!
          serverAddedCount++;
          changeLogs.push({
            id: remoteDiary.id,
            title: remoteDiary.title,
            action: 'added',
            timestamp: Date.now(),
            serverUpdatedAt: remoteDiary.updatedAt,
            details: '서버에서 새로 추가된 일기입니다.',
          });
          mergedMap.set(id, remoteDiary);
        } else if ((local.updatedAt || 0) > (remoteDiary.updatedAt || 0)) {
          // This device has a newer local edit than the server!
          if (isAdminUser) {
            console.log(`[AutoSync] Local edit is newer for ${id} (${local.title}), uploading to server...`);
            if (onProgress) onProgress(`서버에 최신 수정 내용 반영 중... (${local.title})`);
            try {
              await saveDiaryToFirestoreInternal(local);
              addedToServerCount++;
              mergedMap.set(id, local);
            } catch (upErr) {
              console.warn(`Upload newer local edit error for ${id}:`, upErr);
              mergedMap.set(id, local);
            }
          } else {
            // Non-admin mode: use remote authoritative data
            mergedMap.set(id, remoteDiary);
          }
        } else if ((remoteDiary.updatedAt || 0) > (local.updatedAt || 0)) {
          // Server has a newer edit from another device (e.g. phone edited)!
          // Update local DB with this fresh server data
          serverUpdatedCount++;
          changeLogs.push({
            id: remoteDiary.id,
            title: remoteDiary.title,
            action: 'updated',
            timestamp: Date.now(),
            serverUpdatedAt: remoteDiary.updatedAt,
            details: '서버에서 수정된 최신 내용으로 로컬 DB에 업데이트되었습니다.',
          });
          mergedMap.set(id, remoteDiary);
        } else {
          // In sync
          mergedMap.set(id, remoteDiary);
        }
      }

      // 3. Process local diaries that do not exist on the server
      for (const [id, localDiary] of localMap.entries()) {
        if (cleanRemoteMap.has(id) || pendingDeleteIds.has(id) || mergedMap.has(id)) {
          continue;
        }

        // Check if mergedMap already has an entry on the same date with matching normalized title!
        let duplicateInMergedId: string | null = null;
        for (const [mId, mDiary] of mergedMap.entries()) {
          if (isDiaryDuplicate(mDiary, localDiary)) {
            duplicateInMergedId = mId;
            break;
          }
        }

        if (duplicateInMergedId) {
          // A duplicate exists already in mergedMap: consolidate into the better diary
          const existingInMerged = mergedMap.get(duplicateInMergedId)!;
          const { winner } = pickBetterDiary(existingInMerged, localDiary);

          // Re-use the existing server ID so no duplicate document is created
          const consolidated: DiaryEntry = { ...winner, id: duplicateInMergedId };
          mergedMap.set(duplicateInMergedId, consolidated);

          // Clean up the obsolete local ID from local DB and queue
          if (localDiary.id !== duplicateInMergedId) {
            await deleteLocalDiary(localDiary.id).catch(() => {});
            await dequeueLocalSyncItem(localDiary.id).catch(() => {});
          }

          // If the local edit was newer or richer, upload consolidated winner to server
          if (isAdminUser && winner === localDiary) {
            if (onProgress) onProgress(`서버에 최신 수정 내용 반영 중... (${consolidated.title})`);
            try {
              await saveDiaryToFirestoreInternal(consolidated);
              addedToServerCount++;
            } catch (upErr) {
              console.warn(`Failed to upload merged winner for ${duplicateInMergedId}:`, upErr);
            }
          }
          continue;
        }

        // CRITICAL: Always keep local diaries in mergedMap so they NEVER disappear!
        mergedMap.set(id, localDiary);

        // If in Admin mode, upload offline local diaries to server
        if (isAdminUser) {
          if (onProgress) onProgress(`서버에 로컬 일기 업로드 중... (${localDiary.title})`);
          try {
            await saveDiaryToFirestoreInternal(localDiary);
            await dequeueLocalSyncItem(id).catch(() => {});
            addedToServerCount++;
          } catch (upErr) {
            console.warn(`Auto-upload of offline local diary note for ${id}:`, upErr);
            // Ensure queued for future retry
            await enqueueLocalSyncItem('save', id, localDiary).catch(() => {});
          }
        } else {
          // In non-admin mode, ensure diary is in sync queue so it will upload when admin logs in
          await enqueueLocalSyncItem('save', id, localDiary).catch(() => {});
        }
      }

      // 4. Record server change logs if any server changes were found
      if (changeLogs.length > 0) {
        recordServerChangeLogs(changeLogs);
        console.log(`[ServerSync] Recorded ${changeLogs.length} server change logs:`, changeLogs);
      }

      // 5. Final deduplication pass and save into local IndexedDB and localStorage
      const { deduplicated: finalMerged, removedIds: finalRemovedIds } = deduplicateDiaries(Array.from(mergedMap.values()));
      for (const remId of finalRemovedIds) {
        await deleteLocalDiary(remId).catch(() => {});
        await dequeueLocalSyncItem(remId).catch(() => {});
        if (isAdminUser) {
          try {
            await deleteDiaryFromFirestoreInternal(remId);
          } catch {}
        }
      }

      saveToLocalCache(finalMerged);
      await saveMultipleLocalDiaries(finalMerged).catch((dbErr) => {
        console.warn('saveMultipleLocalDiaries note:', dbErr);
      });

      return {
        diaries: finalMerged,
        addedToServerCount,
        serverAddedCount,
        serverUpdatedCount,
        serverDeletedCount,
        changeLogs,
      };
    });
  } catch (err) {
    console.warn('Initial online sync skipped/offline, reading from local DB:', err);
    await disableFirestoreNetwork().catch(() => {});
    const localDbItems = await getAllLocalDiaries().catch(() => []);
    const fallback = (localDbItems && localDbItems.length > 0) ? localDbItems : getStoredDiaries();
    return {
      diaries: fallback,
      addedToServerCount: 0,
      serverAddedCount: 0,
      serverUpdatedCount: 0,
      serverDeletedCount: 0,
      changeLogs: [],
    };
  }
}

/**
 * 2. Click Diary: Connects online, retrieves freshest diary data & full photos from Firestore,
 * writes to local IndexedDB, and immediately switches back to offline mode.
 */
export async function fetchSingleDiaryOnline(diaryId: string): Promise<DiaryEntry | null> {
  try {
    return await executeOnline(async () => {
      const docRef = doc(db, DIARIES_COLLECTION, diaryId);
      let snap;
      try {
        snap = await getDocFromServer(docRef);
      } catch {
        snap = await getDoc(docRef);
      }

      if (!snap.exists()) {
        return null;
      }

      const raw = snap.data();
      const entry: DiaryEntry = {
        id: raw.id || snap.id,
        title: raw.title || '제목 없음',
        content: typeof raw.content === 'string' ? raw.content : '',
        date: raw.date || '',
        time: raw.time || '',
        location: raw.location ? {
          ...raw.location,
          includeInDistance: raw.location.includeInDistance !== false && raw.includeInDistance !== false,
        } : { lat: 21.0285, lng: 105.8542, address: '', region: '위치 미지정', includeInDistance: true },
        photos: Array.isArray(raw.photos) ? raw.photos : [],
        weather: raw.weather || 'sunny',
        moodTags: Array.isArray(raw.moodTags) ? raw.moodTags : [],
        localInsights: raw.localInsights || { recommendedForSolo: '' },
        rating: typeof raw.rating === 'number' ? raw.rating : 5,
        views: typeof raw.views === 'number' ? raw.views : 0,
        hasSubcollectionPhotos: !!raw.hasSubcollectionPhotos,
        totalPhotosCount: raw.totalPhotosCount,
        includeInDistance: raw.location?.includeInDistance !== false && raw.includeInDistance !== false,
        createdAt: raw.createdAt || Date.now(),
        updatedAt: raw.updatedAt || Date.now(),
      };

      if (
        entry.hasSubcollectionPhotos ||
        (entry.totalPhotosCount && entry.totalPhotosCount > entry.photos.length) ||
        entry.photos.some((p) => !p.url || p.isChunked)
      ) {
        try {
          const subPhotos = await fetchDiaryFullPhotosInternal(entry.id);
          if (subPhotos.length > 0) {
            entry.photos = subPhotos;
          }
        } catch (subErr) {
          console.warn(`Subcollection load error for ${entry.id}:`, subErr);
        }
      }

      entry.totalPhotosCount = Math.max(entry.totalPhotosCount || 0, entry.photos.length);

      // Requirement 1: Save read diary & full photos to local IndexedDB
      await saveLocalDiary(entry).catch((err) => {
        console.warn('saveLocalDiary in fetchSingleDiaryOnline note:', err);
      });

      return entry;
    });
  } catch (err) {
    console.warn('Single diary online fetch note, checking local IndexedDB:', err);
    await disableFirestoreNetwork().catch(() => {});
    // Fall back to local IndexedDB first, then localStorage
    const localEntry = await getLocalDiaryById(diaryId).catch(() => null);
    if (localEntry) {
      return localEntry;
    }
    const cached = getStoredDiaries();
    return cached.find((d) => d.id === diaryId) || null;
  }
}

/**
 * Internal worker to save or update a diary entry in Firestore with subcollection photo chunking.
 * Used by admin save operations and background sync without requiring interactive admin prompt.
 */
export async function saveDiaryToFirestoreInternal(entry: DiaryEntry): Promise<void> {
  const normalized = normalizeDiaryEntryForFirestore(entry);
  const sanitized = sanitizeForFirestore(normalized);
  
  // Guard against total diary payload limit (10MB)
  const jsonSize = new TextEncoder().encode(JSON.stringify(sanitized)).length;
  if (jsonSize > MAX_DIARY_TOTAL_BYTES) {
    throw new Error(`일기 데이터 전체 용량(${Math.round(jsonSize / (1024 * 1024))}MB)이 최대 허용 용량인 10MB를 초과했습니다. 첨부된 사진 수를 줄여주세요.`);
  }

  const allPhotos = sanitized.photos || [];
  const hasLargePhoto = allPhotos.some(p => p.url && p.url.length > MAX_SINGLE_DOC_BYTES);

  return await executeOnline(async () => {
    const docRef = doc(db, DIARIES_COLLECTION, sanitized.id);

    try {
      // If entire diary payload is comfortably under single-doc limit (< 700KB) and no photo is huge,
      // store all photos directly in the main document.
      if (jsonSize <= MAX_SINGLE_DOC_BYTES && !hasLargePhoto) {
        await setDoc(docRef, { 
          ...sanitized, 
          hasSubcollectionPhotos: false,
          totalPhotosCount: allPhotos.length,
        });
        return;
      }

      // Otherwise, store full photos in subcollection /diaries/{entry.id}/photos/{photo.id}
      // and chunk any photo whose data exceeds 700KB to strictly comply with Firestore 1MiB limit.
      const photosSubcolRef = collection(db, DIARIES_COLLECTION, sanitized.id, 'photos');
      
      for (const p of allPhotos) {
        const photoDocRef = doc(photosSubcolRef, p.id);

        if (p.url && p.url.length > MAX_SINGLE_DOC_BYTES) {
          // Photo exceeds 700KB: split base64 url into 500KB chunks
          const chunks: string[] = [];
          for (let offset = 0; offset < p.url.length; offset += PHOTO_CHUNK_SIZE) {
            chunks.push(p.url.slice(offset, offset + PHOTO_CHUNK_SIZE));
          }

          // 1. Write the photo metadata document with isChunked: true and empty url
          await setDoc(photoDocRef, {
            id: p.id,
            caption: p.caption || '',
            timestamp: p.timestamp || new Date().toISOString(),
            isCover: !!p.isCover,
            isChunked: true,
            chunkCount: chunks.length,
            totalLength: p.url.length,
            url: '',
          });

          // 2. Write each chunk into subcollection /diaries/{sanitized.id}/photos/{p.id}/chunks/{idx}
          const chunksColRef = collection(db, DIARIES_COLLECTION, sanitized.id, 'photos', p.id, 'chunks');
          for (let idx = 0; idx < chunks.length; idx++) {
            await setDoc(doc(chunksColRef, String(idx)), {
              index: idx,
              data: chunks[idx],
            });
          }
        } else {
          // Fits comfortably inside single Firestore doc
          await setDoc(photoDocRef, {
            ...p,
            isChunked: false,
          });
        }
      }

      // For the main document: keep lightweight thumbnails for ALL attached photos!
      // This ensures that all photos are immediately visible on all devices,
      // the photo count is 100% accurate, and document size stays safely < 350KB.
      const feedPhotos: TravelPhoto[] = [];
      for (const p of allPhotos) {
        if (p.url && p.url.length > 150000) {
          const thumbUrl = await createThumbnail(p.url, 480, 0.72);
          feedPhotos.push({
            ...p,
            url: thumbUrl || p.url,
            thumbnailUrl: thumbUrl || p.thumbnailUrl,
          });
        } else {
          feedPhotos.push(p);
        }
      }

      const mainDocData = {
        ...sanitized,
        photos: feedPhotos,
        hasSubcollectionPhotos: true,
        totalPhotosCount: allPhotos.length,
      };
      await setDoc(docRef, mainDocData);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `${DIARIES_COLLECTION}/${entry.id}`);
    }
  });
}

/**
 * 3. Admin Mode: Save or update a diary entry in Firestore.
 * Requires admin permission, writes documents & photo chunks online, and keeps connection alive for 2 minutes.
 */
export async function saveDiaryToFirestore(entry: DiaryEntry): Promise<void> {
  if (!checkAdminPermission()) {
    throw new Error('일반 사용자는 일기 추가 및 수정 권한이 없습니다. 관리자로 로그인해주세요.');
  }
  return await saveDiaryToFirestoreInternal(entry);
}

/**
 * Internal worker to delete a diary and its photo chunks from Firestore.
 */
export async function deleteDiaryFromFirestoreInternal(diaryId: string): Promise<void> {
  return await executeOnline(async () => {
    const docRef = doc(db, DIARIES_COLLECTION, diaryId);
    try {
      // Clean up any photos and their chunks in the subcollection
      try {
        const photosSubcolRef = collection(db, DIARIES_COLLECTION, diaryId, 'photos');
        const snap = await getDocs(photosSubcolRef);
        if (!snap.empty) {
          for (const pDoc of snap.docs) {
            try {
              const chunksColRef = collection(db, DIARIES_COLLECTION, diaryId, 'photos', pDoc.id, 'chunks');
              const chunkSnap = await getDocs(chunksColRef);
              if (!chunkSnap.empty) {
                await Promise.all(chunkSnap.docs.map((cd) => deleteDoc(cd.ref)));
              }
            } catch {}
            await deleteDoc(pDoc.ref);
          }
        }
      } catch (e) {
        console.warn('Subcollection cleanup note:', e);
      }

      await deleteDoc(docRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `${DIARIES_COLLECTION}/${diaryId}`);
    }
  });
}

/**
 * 3. Admin Mode: Delete a diary entry from Firestore across all devices.
 * Requires admin permission and keeps connection alive for 2 minutes.
 */
export async function deleteDiaryFromFirestore(diaryId: string): Promise<void> {
  if (!checkAdminPermission()) {
    throw new Error('일반 사용자는 일기 삭제 권한이 없습니다. 관리자로 로그인해주세요.');
  }
  return await deleteDiaryFromFirestoreInternal(diaryId);
}

/**
 * Increments the visitor reading counter for a diary entry online.
 * Prevents rapid double counting in the same browser session using sessionStorage.
 */
export async function incrementDiaryViews(diaryId: string): Promise<boolean> {
  if (!diaryId) return false;

  // 관리자 모드로 들어가는 경우 방문자 카운터는 하지 않는다
  if (checkAdminPermission()) {
    return false;
  }

  const sessionKey = `visited_diary_${diaryId}`;
  try {
    if (sessionStorage.getItem(sessionKey)) {
      return false; // Already counted in this session
    }
    sessionStorage.setItem(sessionKey, String(Date.now()));
  } catch {
    // sessionStorage unavailable
  }

  return await executeOnline(async () => {
    const docRef = doc(db, DIARIES_COLLECTION, diaryId);
    try {
      await updateDoc(docRef, {
        views: increment(1)
      });
      return true;
    } catch (error) {
      console.warn(`Could not increment views for diary ${diaryId}:`, error);
      return false;
    }
  });
}

/**
 * Resets visitor counts (views) for all diaries back to 0 online. (Admin operation)
 */
export async function resetAllDiaryViews(): Promise<void> {
  if (!checkAdminPermission()) {
    throw new Error('방문자 카운터 초기화는 관리자만 가능합니다.');
  }

  return await executeOnline(async () => {
    const snap = await getDocs(collection(db, DIARIES_COLLECTION));
    const updates = snap.docs.map((docSnap) => 
      updateDoc(doc(db, DIARIES_COLLECTION, docSnap.id), { views: 0 })
    );
    await Promise.all(updates);
  });
}

/**
 * Updates a diary entry with optimized photos in Firestore online.
 */
export async function updateOptimizedDiaryToFirestore(entry: DiaryEntry): Promise<void> {
  try {
    await saveDiaryToFirestore(entry);
  } catch (error) {
    console.warn(`Failed to update optimized diary in Firestore: ${entry.id}`, error);
  }
}

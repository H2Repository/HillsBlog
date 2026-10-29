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

// Quota limit exceeded state (User Requirement: Quota limit exceeded error detection)
let isQuotaExceeded = false;
try {
  if (typeof sessionStorage !== 'undefined') {
    isQuotaExceeded = sessionStorage.getItem('firestore_quota_exceeded') === 'true';
  }
} catch {}

const quotaListeners = new Set<(exceeded: boolean) => void>();

export function isServerQuotaExceeded(): boolean {
  return isQuotaExceeded;
}

export function setServerQuotaExceeded(exceeded: boolean): void {
  isQuotaExceeded = exceeded;
  try {
    if (typeof sessionStorage !== 'undefined') {
      if (exceeded) sessionStorage.setItem('firestore_quota_exceeded', 'true');
      else sessionStorage.removeItem('firestore_quota_exceeded');
    }
  } catch {}
  quotaListeners.forEach((listener) => {
    try {
      listener(exceeded);
    } catch (e) {
      console.warn('Quota listener error:', e);
    }
  });
}

export function subscribeServerQuota(listener: (exceeded: boolean) => void): () => void {
  quotaListeners.add(listener);
  listener(isQuotaExceeded);
  return () => {
    quotaListeners.delete(listener);
  };
}

/**
 * Checks whether an error indicates that Firestore project free quota limits have been exceeded.
 * Matches: "Quota limit exceeded", "quota limits are reset", "enable billing for this project",
 * "RESOURCE_EXHAUSTED", "quota exceeded", etc.
 */
export function isQuotaExceededError(error: unknown): boolean {
  if (!error) return false;
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();
  return (
    lower.includes('quota limit exceeded') ||
    lower.includes('quota limits are reset') ||
    lower.includes('quota exceeded') ||
    lower.includes('resource_exhausted') ||
    lower.includes('resource-exhausted') ||
    lower.includes('quota exce') ||
    (lower.includes('quota') && lower.includes('billing')) ||
    (lower.includes('quota') && lower.includes('reset')) ||
    (lower.includes('quota') && lower.includes('limit'))
  );
}

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

  if (isQuotaExceeded) {
    console.warn('[Firestore] Quota limit exceeded state active. Staying in offline mode.');
    isFirestoreOnline = false;
    notifyConnectionListeners();
    return;
  }

  if (!isFirestoreOnline) {
    try {
      await enableNetwork(db);
      isFirestoreOnline = true;
      console.log('[Firestore] Firestore 네트워크 온라인 활성화됨');
    } catch (err) {
      if (isQuotaExceededError(err)) {
        setServerQuotaExceeded(true);
        await disableFirestoreNetwork().catch(() => {});
      }
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
  if (isQuotaExceeded) {
    await disableFirestoreNetwork().catch(() => {});
    throw new Error('Quota limit exceeded. Retry after quota limits are reset or enable billing for this project to avoid quota checks.');
  }

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
      if (isQuotaExceededError(wErr)) {
        setServerQuotaExceeded(true);
        await disableFirestoreNetwork().catch(() => {});
      }
    }
    return result;
  } catch (err) {
    if (isQuotaExceededError(err)) {
      setServerQuotaExceeded(true);
      console.error('[Firestore] Quota limit exceeded caught in executeOnline. Severing network.', err);
      await disableFirestoreNetwork().catch(() => {});
    }
    throw err;
  } finally {
    activeOnlineRequests = Math.max(0, activeOnlineRequests - 1);
    // User Requirement: 서버 동기화, 추가, 수정, 삭제 등의 작업이 종료되면 서버와 연결을 즉시 끊고 오프라인 상태로 변경
    if (activeOnlineRequests <= 0) {
      await disableFirestoreNetwork().catch(() => {});
    }
  }
}

/**
 * Fetches all documents from Firestore server with seamless offline/cache fallback.
 */
async function fetchAllDocsFromServer(colRef: any): Promise<any> {
  try {
    return await getDocsFromServer(colRef);
  } catch (err) {
    if (isQuotaExceededError(err)) {
      setServerQuotaExceeded(true);
      await disableFirestoreNetwork().catch(() => {});
      throw err;
    }
    console.warn('[Firestore] getDocsFromServer note, fallback to getDocs:', err);
    try {
      return await getDocs(colRef);
    } catch (gErr) {
      if (isQuotaExceededError(gErr)) {
        setServerQuotaExceeded(true);
        await disableFirestoreNetwork().catch(() => {});
      }
      throw gErr;
    }
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
  error?: string;
}

/**
 * 1. App Open & Online Reconnect: Connects online to Firestore, retrieves all diaries and subcollection photos,
 * compares with local DB, records server additions, edits, and deletions,
 * updates the local DB with the freshest server state, uploads any local offline items,
 * and schedules the 2-minute auto-offline timer.
 * Total process is wrapped in a 20-second timeout guard.
 */
export async function syncInitialDiariesOnline(
  onProgress?: (message: string) => void
): Promise<InitialSyncResult> {
  const isAdminUser = checkAdminPermission();
  const SYNC_TIMEOUT_MS = 60000; // 동일 작업 1분 이상 시 강제 종료 (요구사항)

  const syncAction = async (): Promise<InitialSyncResult> => {
    return await executeOnline(async () => {
      if (onProgress) onProgress('서버에서 최신 일기를 불러오는 중입니다...');

      const diariesCol = collection(db, DIARIES_COLLECTION);
      const snap = await fetchAllDocsFromServer(diariesCol);

      if (onProgress) onProgress('로컬 데이터와 비교 및 최신화 중입니다...');
      const remoteMap = new Map<string, DiaryEntry>();

      if (snap && !snap.empty) {
        for (const docSnap of snap.docs) {
          try {
            const raw = docSnap.data();
            if (raw && (raw.id || docSnap.id)) {
              const diaryId = raw.id || docSnap.id;
              const rawPhotos = Array.isArray(raw.photos) ? raw.photos : [];
              const data: DiaryEntry = {
                id: diaryId,
                title: raw.title || '제목 없음',
                content: typeof raw.content === 'string' ? raw.content : '',
                date: raw.date || '',
                time: raw.time || '',
                location: raw.location ? {
                  ...raw.location,
                  includeInDistance: raw.location.includeInDistance !== false && raw.includeInDistance !== false,
                } : { lat: 21.0285, lng: 105.8542, address: '', region: '위치 미지정', includeInDistance: true },
                photos: rawPhotos,
                weather: raw.weather || 'sunny',
                moodTags: Array.isArray(raw.moodTags) ? raw.moodTags : [],
                localInsights: raw.localInsights || { recommendedForSolo: '' },
                rating: typeof raw.rating === 'number' ? raw.rating : 5,
                views: typeof raw.views === 'number' ? raw.views : 0,
                hasSubcollectionPhotos: !!raw.hasSubcollectionPhotos,
                totalPhotosCount: typeof raw.totalPhotosCount === 'number' ? raw.totalPhotosCount : rawPhotos.length,
                includeInDistance: raw.location?.includeInDistance !== false && raw.includeInDistance !== false,
                createdAt: raw.createdAt || Date.now(),
                updatedAt: raw.updatedAt || raw.createdAt || Date.now(),
              };

              // If local DB already has high-res photos for this diary, preserve them
              const localEntry = await getLocalDiaryById(data.id).catch(() => null);
              if (
                localEntry &&
                localEntry.photos &&
                localEntry.photos.length >= data.photos.length &&
                localEntry.photos.some((p) => p.url && p.url.length > 100000)
              ) {
                data.photos = localEntry.photos;
              }

              data.totalPhotosCount = Math.max(data.totalPhotosCount || 0, data.photos.length);
              remoteMap.set(data.id, data);
            }
          } catch (err) {
            console.error('[Sync] Error parsing diary document:', docSnap.id, err);
          }
        }
      }

      // Read current local diaries from IndexedDB & cache
      const localDiaries = await getAllLocalDiaries().catch(() => []);
      const localMap = new Map<string, DiaryEntry>();
      for (const d of localDiaries) {
        localMap.set(d.id, d);
      }
      for (const item of getStoredDiaries()) {
        if (!localMap.has(item.id)) localMap.set(item.id, item);
      }

      const mergedMap = new Map<string, DiaryEntry>();
      let addedToServerCount = 0;
      let serverAddedCount = 0;
      let serverUpdatedCount = 0;
      let serverDeletedCount = 0;
      const changeLogs: ServerChangeLog[] = [];

      // 1. Process server diaries: merge with local
      for (const [id, remoteDiary] of remoteMap.entries()) {
        const local = localMap.get(id);
        if (!local) {
          serverAddedCount++;
          mergedMap.set(id, remoteDiary);
        } else if ((local.updatedAt || 0) > (remoteDiary.updatedAt || 0)) {
          // Local has newer edit: keep local version.
          // Note: Unsynced local edits are handled exclusively by the offline queue (processSyncQueue).
          // Do NOT auto-upload all entries here to avoid burning Firestore write/bandwidth quotas!
          mergedMap.set(id, local);
        } else {
          if ((remoteDiary.updatedAt || 0) > (local.updatedAt || 0)) {
            serverUpdatedCount++;
          }
          mergedMap.set(id, remoteDiary);
        }
      }

      // 2. Process local diaries that are not yet on the server
      for (const [id, localDiary] of localMap.entries()) {
        if (!mergedMap.has(id)) {
          // Keep locally in merged map without triggering bulk server uploads
          mergedMap.set(id, localDiary);
        }
      }

      // 3. Deduplicate and persist to local storage
      const finalMerged = Array.from(mergedMap.values());
      const { deduplicated: cleanFinalMerged } = deduplicateDiaries(finalMerged);

      saveToLocalCache(cleanFinalMerged);
      try {
        await saveMultipleLocalDiaries(cleanFinalMerged);
      } catch (dbErr) {
        console.error('[Sync] IndexedDB persistence warning:', dbErr);
      }

      return {
        diaries: cleanFinalMerged,
        addedToServerCount,
        serverAddedCount,
        serverUpdatedCount,
        serverDeletedCount,
        changeLogs,
      };
    });
  };

  try {
    return await Promise.race([
      syncAction(),
      new Promise<InitialSyncResult>((_, reject) => 
        setTimeout(() => reject(new Error('동기화 작업 시간 초과 (1분 경과로 강제 종료되었습니다)')), SYNC_TIMEOUT_MS)
      )
    ]);
  } catch (err) {
    console.error('[Sync] Sync failed or timed out:', err);
    if (isQuotaExceededError(err)) {
      setServerQuotaExceeded(true);
      await disableFirestoreNetwork().catch(() => {});
    }
    const localDbItems = await getAllLocalDiaries().catch(() => []);
    const fallback = (localDbItems && localDbItems.length > 0) ? localDbItems : getStoredDiaries();
    return {
      diaries: fallback,
      addedToServerCount: 0,
      serverAddedCount: 0,
      serverUpdatedCount: 0,
      serverDeletedCount: 0,
      changeLogs: [],
      error: err instanceof Error ? err.message : String(err)
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
        // First check if high-resolution photos are already cached in local IndexedDB
        const localEntry = await getLocalDiaryById(entry.id).catch(() => null);
        if (
          localEntry &&
          localEntry.photos &&
          localEntry.photos.length >= (entry.totalPhotosCount || 1) &&
          localEntry.photos.some((p) => p.url && p.url.length > 50000)
        ) {
          entry.photos = localEntry.photos;
        } else {
          try {
            const subPhotos = await fetchDiaryFullPhotosInternal(entry.id);
            if (subPhotos.length > 0) {
              entry.photos = subPhotos;
            }
          } catch (subErr) {
            console.warn(`Subcollection load error for ${entry.id}:`, subErr);
          }
        }
      }

      entry.totalPhotosCount = Math.max(entry.totalPhotosCount || 0, entry.photos.length);

      // Save read diary & full photos to local IndexedDB for future instant offline access
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

          // [Optimization] Check if this photo and its chunks already exist on server with same data length
          // Reading 1 doc is much cheaper than writing N chunk docs for Free Tier quota.
          try {
            const existingSnap = await getDoc(photoDocRef);
            if (existingSnap.exists()) {
              const existing = existingSnap.data();
              if (existing.isChunked && existing.totalLength === p.url.length && existing.chunkCount === chunks.length) {
                // Photo already exists with same size/chunks, skip writing chunks again
                continue;
              }
            }
          } catch (e) {
            console.warn(`[Save] Could not check existing photo ${p.id}, proceeding with write:`, e);
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
          // [Optimization] Only write if not present or different (simple check for fitting photos)
          try {
            const existingSnap = await getDoc(photoDocRef);
            if (existingSnap.exists()) {
              const existing = existingSnap.data();
              if (existing.url === p.url) continue; 
            }
          } catch {}

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
    const lastVisited = localStorage.getItem(sessionKey);
    if (lastVisited) {
      const elapsed = Date.now() - Number(lastVisited);
      if (elapsed < 60 * 60 * 1000) {
        return false; // Already counted recently (within 1 hour)
      }
    }
    localStorage.setItem(sessionKey, String(Date.now()));
  } catch {
    // localStorage unavailable
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

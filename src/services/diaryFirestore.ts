import { 
  collection, 
  doc, 
  getDoc,
  getDocs,
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
import { getStoredDiaries, saveDiaries as saveToLocalCache, sortDiariesDescending } from '../utils/storage';
import { mergeRemoteWithPendingQueue } from '../utils/offlineSync';
import { createThumbnail } from '../utils/imageCompressor';
import { saveMultipleLocalDiaries, saveLocalDiary, getAllLocalDiaries, getLocalSyncQueue, getLocalDiaryById } from '../utils/localDb';

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
    // Guarantee that pending writes are flushed to the cloud server
    try {
      await waitForPendingWrites(db);
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
}

/**
 * 1. App Open: Connects online to Firestore, retrieves all diaries and subcollection photos,
 * compares with local DB, adds any missing local diaries to server,
 * saves to local cache, and schedules 2-minute auto-offline timer.
 */
export async function syncInitialDiariesOnline(
  onProgress?: (message: string) => void
): Promise<InitialSyncResult> {
  try {
    return await executeOnline(async () => {
      if (onProgress) onProgress('서버 데이터와 로컬 DB를 비교 중입니다...');

      const diariesCol = collection(db, DIARIES_COLLECTION);
      const snap = await getDocs(diariesCol);
      const list: DiaryEntry[] = [];

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
                updatedAt: raw.updatedAt || Date.now(),
              };

              // Ensure full photos are preserved and loaded properly
              const localEntry = await getLocalDiaryById(data.id).catch(() => null);
              const expectedCount = Math.max(
                data.totalPhotosCount || 0,
                data.photos.length,
                localEntry?.photos?.length || 0
              );

              // 1. If local DB already has all full photos with valid urls, use them
              if (
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
              list.push(data);
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

      // Requirement 1: Upload any locally stored diary that is missing on the server
      const remoteIds = new Set(snap.docs.map((d) => d.id));
      const localDiaries = await getAllLocalDiaries().catch(() => []);
      const cachedDiaries = getStoredDiaries();
      const allKnownLocal = new Map<string, DiaryEntry>();
      for (const item of localDiaries) allKnownLocal.set(item.id, item);
      for (const item of cachedDiaries) {
        if (!allKnownLocal.has(item.id)) allKnownLocal.set(item.id, item);
      }

      let addedToServerCount = 0;
      for (const [id, localDiary] of allKnownLocal.entries()) {
        if (!remoteIds.has(id) && !pendingDeleteIds.has(id)) {
          if (onProgress) {
            onProgress(`서버에 로컬 일기 추가 작업 중... (${localDiary.title})`);
          }
          console.log(`[AutoSync] Uploading missing local diary to server: ${id} (${localDiary.title})`);
          try {
            await saveDiaryToFirestoreInternal(localDiary);
            list.push(localDiary);
            addedToServerCount++;
          } catch (upErr) {
            console.warn(`Auto-upload of missing local diary note for ${id}:`, upErr);
          }
        }
      }

      const mergedMap = new Map<string, DiaryEntry>();
      for (const item of list) {
        if (!pendingDeleteIds.has(item.id)) {
          if (pendingSaveMap.has(item.id)) {
            mergedMap.set(item.id, pendingSaveMap.get(item.id)!);
          } else {
            mergedMap.set(item.id, item);
          }
        }
      }
      pendingSaveMap.forEach((entry, id) => {
        if (!pendingDeleteIds.has(id) && !mergedMap.has(id)) {
          mergedMap.set(id, entry);
        }
      });

      const merged = sortDiariesDescending(Array.from(mergedMap.values()));
      saveToLocalCache(merged);
      // Requirement 1: Save data read from server into local IndexedDB
      await saveMultipleLocalDiaries(merged).catch((dbErr) => {
        console.warn('saveMultipleLocalDiaries note:', dbErr);
      });

      return {
        diaries: merged,
        addedToServerCount,
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
      const snap = await getDoc(docRef);

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
  const sanitized = sanitizeForFirestore(entry);
  
  // Guard against total diary payload limit (10MB)
  const jsonSize = new TextEncoder().encode(JSON.stringify(sanitized)).length;
  if (jsonSize > MAX_DIARY_TOTAL_BYTES) {
    throw new Error(`일기 데이터 전체 용량(${Math.round(jsonSize / (1024 * 1024))}MB)이 최대 허용 용량인 10MB를 초과했습니다. 첨부된 사진 수를 줄여주세요.`);
  }

  const allPhotos = sanitized.photos || [];
  const hasLargePhoto = allPhotos.some(p => p.url && p.url.length > MAX_SINGLE_DOC_BYTES);

  return await executeOnline(async () => {
    const docRef = doc(db, DIARIES_COLLECTION, entry.id);

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
      const photosSubcolRef = collection(db, DIARIES_COLLECTION, entry.id, 'photos');
      
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

          // 2. Write each chunk into subcollection /diaries/{entry.id}/photos/{p.id}/chunks/{idx}
          const chunksColRef = collection(db, DIARIES_COLLECTION, entry.id, 'photos', p.id, 'chunks');
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

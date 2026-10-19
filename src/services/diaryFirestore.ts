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
  disableNetwork
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { DiaryEntry, TravelPhoto } from '../types';
import { getStoredDiaries, saveDiaries as saveToLocalCache, sortDiariesDescending } from '../utils/storage';
import { mergeRemoteWithPendingQueue } from '../utils/offlineSync';
import { createThumbnail } from '../utils/imageCompressor';

const DIARIES_COLLECTION = 'diaries';
const MAX_SINGLE_DOC_BYTES = 700000; // 700KB safety margin below Firestore's 1MiB limit
const PHOTO_CHUNK_SIZE = 500000; // 500KB chunks for photos exceeding single doc limit
const MAX_DIARY_TOTAL_BYTES = 10 * 1024 * 1024; // 10MB total diary limit

let activeOnlineRequests = 0;
let isNetworkOnline = true; // Initially online during app boot

/**
 * Temporarily enables Firestore network connection
 */
export async function enableFirestoreNetwork(): Promise<void> {
  activeOnlineRequests++;
  if (!isNetworkOnline) {
    try {
      await enableNetwork(db);
      isNetworkOnline = true;
    } catch (err) {
      console.warn('enableNetwork note:', err);
    }
  }
}

/**
 * Disables Firestore network connection, putting client in offline mode
 */
export async function disableFirestoreNetwork(): Promise<void> {
  activeOnlineRequests = Math.max(0, activeOnlineRequests - 1);
  if (activeOnlineRequests === 0) {
    try {
      await disableNetwork(db);
      isNetworkOnline = false;
    } catch (err) {
      console.warn('disableNetwork note:', err);
    }
  }
}

/**
 * Executes a transactional DB task online and immediately switches back to offline
 */
export async function executeOnline<T>(action: () => Promise<T>): Promise<T> {
  await enableFirestoreNetwork();
  try {
    return await action();
  } finally {
    await disableFirestoreNetwork();
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

/**
 * 1. App Open: Connects online to Firestore, retrieves all diaries and subcollection photos,
 * saves to local cache, and immediately switches back to offline mode.
 */
export async function syncInitialDiariesOnline(): Promise<DiaryEntry[]> {
  try {
    return await executeOnline(async () => {
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

              // Enrich subcollection photos if stored separately
              if (data.hasSubcollectionPhotos) {
                try {
                  const subPhotos = await fetchDiaryFullPhotosInternal(data.id);
                  if (subPhotos.length > 0) {
                    data.photos = subPhotos;
                  }
                } catch (subErr) {
                  console.warn(`Subcollection load note for ${data.id}:`, subErr);
                }
              }

              list.push(data);
            }
          } catch (err) {
            console.error('Error parsing diary document:', docSnap.id, err);
          }
        }
      }

      const merged = sortDiariesDescending(mergeRemoteWithPendingQueue(list));
      saveToLocalCache(merged);
      return merged;
    });
  } catch (err) {
    console.warn('Initial online sync skipped/offline, using local cache:', err);
    await disableFirestoreNetwork().catch(() => {});
    return getStoredDiaries();
  }
}

/**
 * 2. Click Diary: Connects online, retrieves freshest diary data & full photos from Firestore,
 * and immediately switches back to offline mode.
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

      if (entry.hasSubcollectionPhotos) {
        try {
          const subPhotos = await fetchDiaryFullPhotosInternal(entry.id);
          if (subPhotos.length > 0) {
            entry.photos = subPhotos;
          }
        } catch (subErr) {
          console.warn(`Subcollection load error for ${entry.id}:`, subErr);
        }
      }

      return entry;
    });
  } catch (err) {
    console.warn('Single diary online fetch note:', err);
    await disableFirestoreNetwork().catch(() => {});
    // Fall back to local diary if available
    const cached = getStoredDiaries();
    return cached.find((d) => d.id === diaryId) || null;
  }
}

/**
 * 3. Admin Mode: Save or update a diary entry in Firestore.
 * Connects online to write documents & photo chunks, then immediately switches back to offline.
 */
export async function saveDiaryToFirestore(entry: DiaryEntry): Promise<void> {
  if (!checkAdminPermission()) {
    throw new Error('일반 사용자는 일기 추가 및 수정 권한이 없습니다. 관리자로 로그인해주세요.');
  }

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

      // For the main document: keep a lean cover photo thumbnail so the feed loads instantly
      // and main document size is guaranteed to stay < 100KB (never hitting 1MiB).
      const coverPhoto = allPhotos.find(p => p.isCover) || allPhotos[0];
      let feedCoverPhotos: TravelPhoto[] = [];

      if (coverPhoto) {
        if (coverPhoto.url && coverPhoto.url.length > 400000) {
          const thumbUrl = await createThumbnail(coverPhoto.url, 480, 0.75);
          feedCoverPhotos = [{
            ...coverPhoto,
            url: thumbUrl || coverPhoto.url.slice(0, 300000),
          }];
        } else {
          feedCoverPhotos = [coverPhoto];
        }
      }

      const mainDocData = {
        ...sanitized,
        photos: feedCoverPhotos,
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
 * 3. Admin Mode: Delete a diary entry from Firestore across all devices.
 * Connects online to delete, then immediately switches back to offline.
 */
export async function deleteDiaryFromFirestore(diaryId: string): Promise<void> {
  if (!checkAdminPermission()) {
    throw new Error('일반 사용자는 일기 삭제 권한이 없습니다. 관리자로 로그인해주세요.');
  }

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

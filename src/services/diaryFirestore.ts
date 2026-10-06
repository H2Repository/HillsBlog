import { 
  collection, 
  doc, 
  setDoc, 
  updateDoc,
  increment,
  deleteDoc, 
  onSnapshot,
  getDocs
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { DiaryEntry, TravelPhoto } from '../types';
import { getStoredDiaries, saveDiaries as saveToLocalCache, sortDiariesDescending } from '../utils/storage';
import { mergeRemoteWithPendingQueue } from '../utils/offlineSync';

const DIARIES_COLLECTION = 'diaries';

/**
 * Strips undefined properties recursively so Firestore does not throw an error
 */
function sanitizeForFirestore<T>(data: T): T {
  return JSON.parse(JSON.stringify(data));
}

/**
 * Subscribes to real-time diary updates from Firestore.
 * Automatically synchronizes with local storage, keeps pending offline edits/deletions intact, and falls back gracefully.
 * No sample data is injected: only user-created diaries will appear.
 */
export function subscribeDiaries(
  onUpdate: (diaries: DiaryEntry[], isInitialSync: boolean) => void,
  onError?: (error: Error) => void
): () => void {
  // First, supply existing local cache immediately for instant render
  const cached = getStoredDiaries();
  if (cached.length > 0) {
    onUpdate(sortDiariesDescending(mergeRemoteWithPendingQueue(cached)), false);
  }

  const diariesCol = collection(db, DIARIES_COLLECTION);

  const unsubscribe = onSnapshot(
    diariesCol,
    (snapshot) => {
      const list: DiaryEntry[] = [];
      if (!snapshot.empty) {
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as DiaryEntry;
          if (data && data.id && data.title) {
            list.push(data);
          }
        });
      }

      // Merge with any offline changes that are pending sync and sort newest first
      const finalList = sortDiariesDescending(mergeRemoteWithPendingQueue(list));

      // Update local storage cache for offline/instant resume on refresh
      saveToLocalCache(finalList);

      onUpdate(finalList, true);
    },
    (error) => {
      console.error('Firestore snapshot listener error:', error);
      if (onError) {
        onError(error);
      }
      try {
        handleFirestoreError(error, OperationType.LIST, DIARIES_COLLECTION);
      } catch {
        // Logged
      }
    }
  );

  return unsubscribe;
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
 * Save or update a diary entry in Firestore.
 * Supports diaries up to 2MB (with HD attached photos).
 * Changes are instantly mirrored to all active devices in real-time.
 */
export async function saveDiaryToFirestore(entry: DiaryEntry): Promise<void> {
  if (!checkAdminPermission()) {
    throw new Error('일반 사용자는 일기 추가 및 수정 권한이 없습니다. 관리자로 로그인해주세요.');
  }

  const docRef = doc(db, DIARIES_COLLECTION, entry.id);
  const sanitized = sanitizeForFirestore(entry);
  
  // Guard against 2MB max diary creation limit
  const jsonSize = new TextEncoder().encode(JSON.stringify(sanitized)).length;
  if (jsonSize > 2097152) {
    throw new Error(`일기 데이터 전체 용량(${Math.round(jsonSize / 1024)}KB)이 최대 허용 용량인 2MB를 초과했습니다. 첨부된 사진 수를 줄여주세요.`);
  }

  try {
    // If within standard single-doc limit (< 950KB), store all photos directly in the main document
    if (jsonSize <= 950000) {
      await setDoc(docRef, { ...sanitized, hasSubcollectionPhotos: false });
    } else {
      // For large diaries up to 2MB with multiple HD photos:
      // Store all individual photos into subcollection /diaries/{entry.id}/photos/{photo.id}
      const allPhotos = sanitized.photos || [];
      const photosSubcolRef = collection(db, DIARIES_COLLECTION, entry.id, 'photos');
      
      for (const p of allPhotos) {
        await setDoc(doc(photosSubcolRef, p.id), p);
      }

      // In the main document, keep cover photo for instant feed display and mark hasSubcollectionPhotos
      const coverPhoto = allPhotos.find(p => p.isCover) || allPhotos[0];
      const mainDocData = {
        ...sanitized,
        photos: coverPhoto ? [coverPhoto] : [],
        hasSubcollectionPhotos: true,
      };
      await setDoc(docRef, mainDocData);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${DIARIES_COLLECTION}/${entry.id}`);
  }
}

/**
 * Loads full attached photos for a diary if stored in subcollection (for up to 2MB diaries)
 */
export async function fetchDiaryFullPhotos(diaryId: string): Promise<TravelPhoto[]> {
  try {
    const photosSubcolRef = collection(db, DIARIES_COLLECTION, diaryId, 'photos');
    const snap = await getDocs(photosSubcolRef);
    if (!snap.empty) {
      const list: TravelPhoto[] = [];
      snap.forEach((d) => list.push(d.data() as TravelPhoto));
      return list;
    }
  } catch (err) {
    console.warn(`Could not fetch subcollection photos for ${diaryId}:`, err);
  }
  return [];
}

/**
 * Updates a diary entry with optimized photos in Firestore.
 */
export async function updateOptimizedDiaryToFirestore(entry: DiaryEntry): Promise<void> {
  const docRef = doc(db, DIARIES_COLLECTION, entry.id);
  const sanitized = sanitizeForFirestore(entry);
  try {
    await setDoc(docRef, sanitized);
  } catch (error) {
    console.warn(`Failed to update optimized diary in Firestore: ${entry.id}`, error);
  }
}

/**
 * Increments the visitor reading counter for a diary entry.
 * Prevents rapid double counting in the same browser session using sessionStorage.
 * If user is in admin mode (관리자 모드), visitor view count is NOT incremented.
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
}

/**
 * Resets visitor counts (views) for all diaries back to 0. (Admin operation)
 */
export async function resetAllDiaryViews(): Promise<void> {
  if (!checkAdminPermission()) {
    throw new Error('방문자 카운터 초기화는 관리자만 가능합니다.');
  }

  const snap = await getDocs(collection(db, DIARIES_COLLECTION));
  const updates = snap.docs.map((docSnap) => 
    updateDoc(doc(db, DIARIES_COLLECTION, docSnap.id), { views: 0 })
  );
  await Promise.all(updates);
}

/**
 * Delete a diary entry from Firestore across all devices.
 */
export async function deleteDiaryFromFirestore(diaryId: string): Promise<void> {
  if (!checkAdminPermission()) {
    throw new Error('일반 사용자는 일기 삭제 권한이 없습니다. 관리자로 로그인해주세요.');
  }

  const docRef = doc(db, DIARIES_COLLECTION, diaryId);
  try {
    // Clean up any photos in the subcollection
    try {
      const photosSubcolRef = collection(db, DIARIES_COLLECTION, diaryId, 'photos');
      const snap = await getDocs(photosSubcolRef);
      if (!snap.empty) {
        const subDeletions = snap.docs.map((d) => deleteDoc(doc(photosSubcolRef, d.id)));
        await Promise.all(subDeletions);
      }
    } catch {}

    await deleteDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${DIARIES_COLLECTION}/${diaryId}`);
  }
}

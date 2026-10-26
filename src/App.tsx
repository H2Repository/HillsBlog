/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { DiaryEntry, TravelPhoto, ViewMode, VisitorLog } from './types';
import { 
  getStoredDiaries, 
  saveDiaries, 
  exportDiariesToJson, 
  sortDiariesDescending,
  deduplicateDiaries,
  isDiaryDuplicate,
  pickBetterDiary,
  normalizeTitle
} from './utils/storage';
import { 
  syncInitialDiariesOnline,
  fetchSingleDiaryOnline,
  saveDiaryToFirestore, 
  deleteDiaryFromFirestore,
  incrementDiaryViews,
  resetAllDiaryViews,
  fetchDiaryFullPhotos,
  updateOptimizedDiaryToFirestore,
  disableFirestoreNetwork
} from './services/diaryFirestore';
import { recordVisitorLocation, subscribeVisitorLogs } from './services/visitorService';
import { optimizeAllDiaries } from './utils/imageCompressor';
import { calculateDistanceKm } from './utils/geo';
import { Navbar } from './components/Navbar';
import { BlogFeedView } from './components/BlogFeedView';
import { TravelMapView } from './components/TravelMapView';
import { VisitorLocationModal } from './components/VisitorLocationModal';
import { DiaryEditorModal } from './components/DiaryEditorModal';
import { DiaryDetailModal } from './components/DiaryDetailModal';
import { PhotoLightbox } from './components/PhotoLightbox';
import { ConfirmModal } from './components/ConfirmModal';
import { FlutterCodeModal } from './components/FlutterCodeModal';
import { FlutterIcon } from './components/FlutterIcon';
import { LoginModal } from './components/LoginModal';
import { downloadFlutterProjectZip } from './utils/flutterDownload';
import { useLanguage } from './context/LanguageContext';
import { useAuth } from './context/AuthContext';
import { getCachedDiaryTranslation, hasKorean, translateDiaryAsync } from './utils/translationService';
import { 
  getAllLocalDiaries, 
  saveLocalDiary,
  deleteLocalDiary,
  getLocalSyncQueueCount,
  enqueueLocalSyncItem,
  dequeueLocalSyncItem
} from './utils/localDb';
import { 
  saveDiaryOfflineFirst, 
  deleteDiaryOfflineFirst, 
  processSyncQueue, 
  subscribeSyncStatus,
  isDiaryPendingSync,
  cleanAndHealSyncQueue,
  stopSyncQueue
} from './utils/syncManager';
import { 
  Plus, 
  Compass, 
  MapPin, 
  Download,
  CheckCircle2,
  AlertTriangle,
  Route,
  CloudOff,
  Loader2
} from 'lucide-react';

export default function App() {
  const { t, language } = useLanguage();
  const { isAdmin, openLoginModal, autoLogoutNotice, clearAutoLogoutNotice } = useAuth();
  const [diaries, setDiaries] = useState<DiaryEntry[]>(() => getStoredDiaries());
  const [viewMode, setViewMode] = useState<ViewMode>('blog');
  const [cloudSyncStatus, setCloudSyncStatus] = useState<'syncing' | 'connected' | 'offline'>('syncing');
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [visitorLogs, setVisitorLogs] = useState<VisitorLog[]>([]);
  const [isVisitorModalOpen, setIsVisitorModalOpen] = useState(false);

  // Subscribe to real-time visitor logs when admin is logged in
  useEffect(() => {
    if (isAdmin) {
      const unsubscribe = subscribeVisitorLogs(setVisitorLogs);
      return () => unsubscribe();
    }
  }, [isAdmin]);

  // Subscribe to offline sync queue and status changes from syncManager
  useEffect(() => {
    const unsubscribe = subscribeSyncStatus((status) => {
      setPendingSyncCount(status.pendingCount);
      if (status.isSyncing) {
        setCloudSyncStatus('syncing');
      } else {
        setCloudSyncStatus(typeof navigator !== 'undefined' && navigator.onLine ? 'connected' : 'offline');
      }
    });
    return () => unsubscribe();
  }, []);

  // When sync transitions from >0 to 0 while online, show 2-second completion message
  const prevPendingCountRef = useRef(pendingSyncCount);
  useEffect(() => {
    if (prevPendingCountRef.current > 0 && pendingSyncCount === 0 && (typeof navigator === 'undefined' || navigator.onLine)) {
      setToastMessage({
        text: '동기화 완료: 모든 일기와 사진이 서버에 안전하게 저장되었습니다.',
        type: 'success',
      });
      const timer = setTimeout(() => {
        setToastMessage((cur) => (cur?.text.includes('동기화 완료') ? null : cur));
      }, 2000);
      return () => clearTimeout(timer);
    }
    prevPendingCountRef.current = pendingSyncCount;
  }, [pendingSyncCount]);

  // Show notice when automatically logged out due to inactivity
  useEffect(() => {
    if (autoLogoutNotice) {
      setToastMessage({ text: autoLogoutNotice, type: 'error' });
      clearAutoLogoutNotice();
      const timer = setTimeout(() => setToastMessage(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [autoLogoutNotice, clearAutoLogoutNotice]);

  // 1. On App Open: Immediately render from high-capacity Local IndexedDB, connect online to receive latest data, then switch to offline.
  useEffect(() => {
    // 1-1. Immediate display from high-capacity local IndexedDB (with localStorage fallback)
    getAllLocalDiaries().then(async (cached) => {
      if (cached && cached.length > 0) {
        const { deduplicated, removedIds } = deduplicateDiaries(cached);
        for (const remId of removedIds) {
          await deleteLocalDiary(remId).catch(() => {});
        }
        setDiaries(deduplicated);
      } else {
        const fallback = getStoredDiaries();
        if (fallback.length > 0) {
          setDiaries(fallback);
        }
      }
    }).catch(() => {
      const fallback = getStoredDiaries();
      if (fallback.length > 0) {
        setDiaries(fallback);
      }
    });

    // 1-2. Connect online to server, retrieve fresh data, save to local DB, and switch back to offline
    let isMounted = true;
    const runInitialSync = async () => {
      // Stop all synchronization and online refresh when admin is not logged in
      if (!isAdmin) {
        setCloudSyncStatus(typeof navigator !== 'undefined' && navigator.onLine ? 'connected' : 'offline');
        return;
      }
      setCloudSyncStatus('syncing');
      setToastMessage({
        text: '서버 데이터와 로컬 DB를 비교 중입니다...',
        type: 'info',
      });
      try {
        if (isAdmin) {
          await cleanAndHealSyncQueue();
        }
        const {
          diaries: freshDiaries,
          addedToServerCount,
          serverAddedCount,
          serverUpdatedCount,
          serverDeletedCount,
        } = await syncInitialDiariesOnline((msg) => {
          if (isMounted && isAdmin) {
            setToastMessage({ text: msg, type: 'info' });
          }
        });
        if (isMounted) {
          if (freshDiaries && freshDiaries.length > 0) {
            setDiaries(sortDiariesDescending(freshDiaries));
          }
          if (isAdmin) {
            const freshQueueCount = await getLocalSyncQueueCount().catch(() => 0);
            setPendingSyncCount(freshQueueCount);
          }
          setCloudSyncStatus(typeof navigator !== 'undefined' && navigator.onLine ? 'connected' : 'offline');
          
          if (isAdmin) {
            let toastText = '추가 완료: 서버와 로컬 DB가 최신 상태로 동기화되었습니다.';
            const serverChangesTotal = (serverAddedCount || 0) + (serverUpdatedCount || 0) + (serverDeletedCount || 0);
            if (serverChangesTotal > 0 || (addedToServerCount || 0) > 0) {
              const parts: string[] = [];
              if (addedToServerCount > 0) parts.push(`서버에 ${addedToServerCount}건 추가`);
              if (serverAddedCount > 0) parts.push(`로컬에 ${serverAddedCount}건 추가`);
              if (serverUpdatedCount > 0) parts.push(`로컬에 ${serverUpdatedCount}건 업데이트`);
              if (serverDeletedCount > 0) parts.push(`로컬에서 ${serverDeletedCount}건 삭제`);
              toastText = `추가 완료: ${parts.join(', ')} 되었습니다.`;
            }
            setToastMessage({
              text: toastText,
              type: 'success',
            });
            setTimeout(() => {
              if (isMounted) setToastMessage(null);
            }, 2000);
          }
        }
      } catch (err) {
        console.warn('Initial online sync error:', err);
        if (isMounted) {
          setCloudSyncStatus('offline');
          if (isAdmin) setToastMessage(null);
        }
      }
    };

    runInitialSync();

    return () => {
      isMounted = false;
    };
  }, []);

  // Manual trigger for background upload retry queue & server sync (Admin Only)
  const handleTriggerSync = async () => {
    if (!isAdmin) {
      setToastMessage({
        text: '클라우드 동기화는 관리자 모드에서만 실행할 수 있습니다.',
        type: 'error',
      });
      setTimeout(() => setToastMessage(null), 2500);
      return;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setToastMessage({
        text: '현재 오프라인 상태입니다. 인터넷에 연결되면 자동 동기화됩니다.',
        type: 'error',
      });
      setTimeout(() => setToastMessage(null), 2000);
      return;
    }

    setCloudSyncStatus('syncing');
    setToastMessage({
      text: '서버 데이터와 로컬 DB를 비교 및 동기화 중입니다...',
      type: 'info',
    });

    try {
      await cleanAndHealSyncQueue();
      const currentQueue = await getLocalSyncQueueCount().catch(() => 0);
      let uploadSuccess = 0;
      if (currentQueue > 0) {
        const { successCount } = await processSyncQueue();
        uploadSuccess = successCount;
      }

      // Check server changes, record logs, and update local DB
      const {
        diaries: freshDiaries,
        addedToServerCount,
        serverAddedCount,
        serverUpdatedCount,
        serverDeletedCount,
      } = await syncInitialDiariesOnline();

      if (freshDiaries && freshDiaries.length > 0) {
        setDiaries(sortDiariesDescending(freshDiaries));
      }
      const finalQueue = await getLocalSyncQueueCount().catch(() => 0);
      setPendingSyncCount(finalQueue);
      setCloudSyncStatus('connected');

      const serverChanges = (serverAddedCount || 0) + (serverUpdatedCount || 0) + (serverDeletedCount || 0);
      let msg = '추가 완료: 서버와 로컬 DB가 최신 상태로 동기화되었습니다.';
      if (uploadSuccess > 0 || (addedToServerCount || 0) > 0 || serverChanges > 0) {
        const parts: string[] = [];
        if (uploadSuccess > 0 || addedToServerCount > 0) {
          parts.push(`서버 저장 ${uploadSuccess + (addedToServerCount || 0)}건`);
        }
        if (serverAddedCount > 0) parts.push(`로컬 추가 ${serverAddedCount}건`);
        if (serverUpdatedCount > 0) parts.push(`로컬 업데이트 ${serverUpdatedCount}건`);
        if (serverDeletedCount > 0) parts.push(`로컬 삭제 ${serverDeletedCount}건`);
        msg = `동기화 완료: ${parts.join(', ')} 반영되었습니다.`;
      }

      setToastMessage({
        text: msg,
        type: 'success',
      });
      setTimeout(() => setToastMessage(null), 2000);
    } catch (err) {
      console.warn('handleTriggerSync error:', err);
      setCloudSyncStatus('offline');
      setToastMessage({
        text: '동기화 중 오류가 발생했습니다. 잠시 후 자동 재시도됩니다.',
        type: 'error',
      });
      setTimeout(() => setToastMessage(null), 2000);
    }
  };

  const isAdminRef = useRef(isAdmin);
  useEffect(() => {
    isAdminRef.current = isAdmin;
  }, [isAdmin]);

  // Automatically handle admin login and logout transitions
  const prevIsAdminRef = useRef(isAdmin);
  useEffect(() => {
    if (!prevIsAdminRef.current && isAdmin) {
      // Admin logged in: trigger sync
      handleTriggerSync();
    } else if (prevIsAdminRef.current && !isAdmin) {
      // Admin logged out: immediately stop all sync and refresh
      console.log('[Auth] Admin logged out: stopping all sync and refresh operations.');
      stopSyncQueue();
      disableFirestoreNetwork().catch(() => {});
      setCloudSyncStatus(typeof navigator !== 'undefined' && navigator.onLine ? 'connected' : 'offline');
      setToastMessage((cur) => {
        if (cur && (cur.text.includes('동기화') || cur.text.includes('비교') || cur.text.includes('작업 중'))) {
          return null;
        }
        return cur;
      });
    }
    prevIsAdminRef.current = isAdmin;
  }, [isAdmin]);

  // Toast notifications and auto-sync on network status changes (Admin Only)
  useEffect(() => {
    const handleOnline = async () => {
      // Only perform cloud sync operations in Admin mode!
      if (!isAdminRef.current) {
        setCloudSyncStatus('connected');
        return;
      }

      setCloudSyncStatus('syncing');
      setToastMessage({
        text: '네트워크 연결됨: 서버 데이터와 로컬 DB 동기화 작업 중...',
        type: 'info',
      });

      try {
        await cleanAndHealSyncQueue();
        const queueCount = await getLocalSyncQueueCount().catch(() => 0);
        let uploadSuccess = 0;
        if (queueCount > 0) {
          const { successCount } = await processSyncQueue();
          uploadSuccess = successCount;
        }

        // Pull server changes, record logs, and update local DB
        const {
          diaries: freshDiaries,
          addedToServerCount,
          serverAddedCount,
          serverUpdatedCount,
          serverDeletedCount,
        } = await syncInitialDiariesOnline();

        if (freshDiaries && freshDiaries.length > 0) {
          setDiaries(sortDiariesDescending(freshDiaries));
        }
        const finalQueue = await getLocalSyncQueueCount().catch(() => 0);
        setPendingSyncCount(finalQueue);
        setCloudSyncStatus('connected');

        const serverChanges = (serverAddedCount || 0) + (serverUpdatedCount || 0) + (serverDeletedCount || 0);
        let msg = '추가 완료: 서버와 로컬 DB가 최신 상태로 동기화되었습니다.';
        if (uploadSuccess > 0 || (addedToServerCount || 0) > 0 || serverChanges > 0) {
          const parts: string[] = [];
          if (uploadSuccess > 0 || addedToServerCount > 0) {
            parts.push(`서버 저장 ${uploadSuccess + (addedToServerCount || 0)}건`);
          }
          if (serverAddedCount > 0) parts.push(`로컬 추가 ${serverAddedCount}건`);
          if (serverUpdatedCount > 0) parts.push(`로컬 업데이트 ${serverUpdatedCount}건`);
          if (serverDeletedCount > 0) parts.push(`로컬 삭제 ${serverDeletedCount}건`);
          msg = `동기화 완료: ${parts.join(', ')} 되었습니다.`;
        }

        setToastMessage({
          text: msg,
          type: 'success',
        });
        setTimeout(() => setToastMessage(null), 2000);
      } catch (syncErr) {
        console.warn('Process sync queue on online error:', syncErr);
        setCloudSyncStatus('connected');
        setToastMessage({
          text: '네트워크 연결됨: 서버와 연결되었습니다.',
          type: 'success',
        });
        setTimeout(() => setToastMessage(null), 2000);
      }
    };

    const handleOffline = () => {
      setCloudSyncStatus('offline');
      setToastMessage({
        text: '오프라인 모드: 수정 및 삭제는 로컬에 기록되며 온라인 연결 시 서버에 동기화됩니다.',
        type: 'info',
      });
      setTimeout(() => setToastMessage(null), 2500);
    };

    const handleVisibilityOrFocus = async () => {
      // Stop all background sync and refresh when admin is logged out!
      if (!isAdminRef.current) return;

      if (typeof document !== 'undefined' && document.visibilityState === 'visible' && navigator.onLine) {
        try {
          const { diaries: freshDiaries, serverUpdatedCount, serverAddedCount, serverDeletedCount } = await syncInitialDiariesOnline();
          if (freshDiaries && freshDiaries.length > 0) {
            setDiaries(sortDiariesDescending(freshDiaries));
          }
          if ((serverUpdatedCount || 0) + (serverAddedCount || 0) + (serverDeletedCount || 0) > 0) {
            setToastMessage({
              text: '서버의 최신 수정 내용이 로컬 기기에 동기화되었습니다.',
              type: 'success',
            });
            setTimeout(() => setToastMessage(null), 2000);
          }
        } catch {}
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
    };
  }, []);

  
  // Modals state
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingDiary, setEditingDiary] = useState<DiaryEntry | null>(null);
  const [selectedDiary, setSelectedDiary] = useState<DiaryEntry | null>(null);
  const [focusedMapDiaryId, setFocusedMapDiaryId] = useState<string | null>(null);

  // Background auto-translate for all diaries when viewing in another language
  useEffect(() => {
    if (language === 'ko') return;

    let isSubscribed = true;

    const translateEntries = async () => {
      for (const diary of diaries) {
        if (!isSubscribed) break;
        const cached = getCachedDiaryTranslation(diary.id, language);
        if (cached) continue;

        const needsTranslation = 
          hasKorean(diary.title) ||
          hasKorean(diary.content) ||
          hasKorean(diary.localInsights.recommendedForSolo);

        if (needsTranslation) {
          try {
            await translateDiaryAsync(diary, language);
          } catch {
            // ignore network errors
          }
        }
      }
    };

    translateEntries();

    return () => {
      isSubscribed = false;
    };
  }, [diaries, language]);

  // Flutter source download & modal state
  const [isDownloadingFlutter, setIsDownloadingFlutter] = useState(false);
  const [isFlutterCodeOpen, setIsFlutterCodeOpen] = useState(false);
  const [downloadNotification, setDownloadNotification] = useState<string | null>(null);

  // Photo Lightbox state
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [lightboxPhotos, setLightboxPhotos] = useState<TravelPhoto[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  // In-app Confirmation Modals state
  const [deleteTarget, setDeleteTarget] = useState<DiaryEntry | null>(null);

  // Save to localStorage whenever diaries changes
  useEffect(() => {
    saveDiaries(diaries);
  }, [diaries]);

  // Handler: Add or Update Diary (Supports duplicate prevention, online immediate sync and offline queueing)
  const handleSaveDiary = async (entry: DiaryEntry) => {
    if (!isAdmin) {
      openLoginModal('일기 추가 및 수정은 관리자만 가능합니다. 로그인해주세요.');
      return;
    }

    // Check by ID or matching date + normalized title
    const existingMatch = diaries.find((d) => isDiaryDuplicate(d, entry));
    const isExisting = Boolean(existingMatch);

    let targetEntry: DiaryEntry = { ...entry };
    let obsoleteIdToDelete: string | null = null;

    if (existingMatch) {
      // Re-use the existing entry's ID so Firestore document isn't duplicated
      targetEntry.id = existingMatch.id;
      targetEntry.views = Math.max(existingMatch.views || 0, entry.views || 0);
      targetEntry.createdAt = existingMatch.createdAt || entry.createdAt;

      // If the incoming entry had a different temp ID (e.g. from "새 일기 쓰기"), note the obsolete ID
      if (entry.id !== existingMatch.id) {
        obsoleteIdToDelete = entry.id;
      }
    }

    // 1. Immediately update in-memory state so UI updates instantly and strips duplicates
    setDiaries((prev) => {
      const filtered = prev.filter(
        (d) =>
          d.id !== targetEntry.id &&
          !(obsoleteIdToDelete && d.id === obsoleteIdToDelete) &&
          !isDiaryDuplicate(d, targetEntry)
      );
      return sortDiariesDescending([targetEntry, ...filtered]);
    });

    if (selectedDiary && (selectedDiary.id === targetEntry.id || (obsoleteIdToDelete && selectedDiary.id === obsoleteIdToDelete))) {
      setSelectedDiary(targetEntry);
    }

    // Clean up any obsolete temporary ID locally
    if (obsoleteIdToDelete) {
      await deleteLocalDiary(obsoleteIdToDelete).catch(() => {});
      await dequeueLocalSyncItem(obsoleteIdToDelete).catch(() => {});
    }

    // 2. Always record to local DB and offline sync queue log
    try {
      await saveLocalDiary(targetEntry);
      await enqueueLocalSyncItem('save', targetEntry.id, targetEntry);
      setPendingSyncCount(await getLocalSyncQueueCount());
    } catch (dbErr) {
      console.warn('Local save error:', dbErr);
    }

    // 3. If online, perform save/update directly on the server
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      setCloudSyncStatus('syncing');
      setToastMessage({
        text: isExisting ? '서버에 수정 작업 진행 중...' : '서버에 추가 작업 진행 중...',
        type: 'info',
      });

      try {
        if (obsoleteIdToDelete) {
          await deleteDiaryFromFirestore(obsoleteIdToDelete).catch(() => {});
        }
        await saveDiaryToFirestore(targetEntry);
        await dequeueLocalSyncItem(targetEntry.id);
        setPendingSyncCount(await getLocalSyncQueueCount());
        setCloudSyncStatus('connected');
        setToastMessage({
          text: isExisting ? '수정 완료: 일기가 서버에 정상 업데이트되었습니다.' : '추가 완료: 새 일기가 서버에 정상 등록되었습니다.',
          type: 'success',
        });
        setTimeout(() => setToastMessage(null), 2000);
      } catch (err: unknown) {
        console.warn('Server save error, retained in sync queue:', err);
        setCloudSyncStatus('offline');
        setToastMessage({
          text: '오프라인 기록 완료: 일기가 로컬에 저장되었으며 온라인 연결 시 서버에 동기화됩니다.',
          type: 'info',
        });
        setTimeout(() => setToastMessage(null), 2000);
      }
    } else {
      // Offline mode: Logged and ready for sync when online
      setCloudSyncStatus('offline');
      setToastMessage({
        text: isExisting 
          ? '오프라인 수정 기록 완료: 인터넷 연결 시 서버와 동기화됩니다.' 
          : '오프라인 추가 기록 완료: 인터넷 연결 시 서버와 동기화됩니다.',
        type: 'info',
      });
      setTimeout(() => setToastMessage(null), 2000);
    }
  };

  // Handler: Delete Diary
  const handleDeleteDiary = (id: string) => {
    setDiaries((prev) => prev.filter((d) => d.id !== id));
    if (selectedDiary && selectedDiary.id === id) {
      setSelectedDiary(null);
    }
  };

  const handleRequestDelete = (diary: DiaryEntry) => {
    if (!isAdmin) {
      openLoginModal('일기 삭제는 관리자만 가능합니다. 로그인해주세요.');
      return;
    }
    // Deletion allowed offline and online!
    setDeleteTarget(diary);
  };

  const handleConfirmDelete = async () => {
    if (!isAdmin) {
      openLoginModal('일기 삭제는 관리자만 가능합니다. 로그인해주세요.');
      setDeleteTarget(null);
      return;
    }
    if (!deleteTarget) return;

    const targetId = deleteTarget.id;
    setDeleteTarget(null);

    // 1. Immediately remove from UI and local IndexedDB
    handleDeleteDiary(targetId);
    try {
      await deleteLocalDiary(targetId);
      await enqueueLocalSyncItem('delete', targetId);
      setPendingSyncCount(await getLocalSyncQueueCount());
    } catch (dbErr) {
      console.warn('Local delete error:', dbErr);
    }

    // 2. If online, delete directly on server
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      setCloudSyncStatus('syncing');
      setToastMessage({
        text: '서버에 삭제 작업 진행 중...',
        type: 'info',
      });

      try {
        await deleteDiaryFromFirestore(targetId);
        await dequeueLocalSyncItem(targetId);
        setPendingSyncCount(await getLocalSyncQueueCount());
        setCloudSyncStatus('connected');
        setToastMessage({
          text: '삭제 완료: 서버와 로컬 DB에서 안전하게 삭제되었습니다.',
          type: 'success',
        });
        setTimeout(() => setToastMessage(null), 2000);
      } catch (err: unknown) {
        console.warn('Server delete error, retained in sync queue:', err);
        setCloudSyncStatus('offline');
        setToastMessage({
          text: '오프라인 삭제 기록 완료: 네트워크 연결 시 서버에서 삭제됩니다.',
          type: 'info',
        });
        setTimeout(() => setToastMessage(null), 2000);
      }
    } else {
      // Offline mode
      setCloudSyncStatus('offline');
      setToastMessage({
        text: '오프라인 삭제 기록 완료: 인터넷 연결 시 서버와 동기화됩니다.',
        type: 'info',
      });
      setTimeout(() => setToastMessage(null), 2000);
    }
  };

  // Handler: View on Map
  const handleViewOnMap = (diary: DiaryEntry) => {
    setFocusedMapDiaryId(diary.id);
    setViewMode('map');
  };

  // Total visitor reads count across all diaries
  const totalViewsCount = useMemo(() => {
    return diaries.reduce((acc, d) => acc + (d.views || 0), 0);
  }, [diaries]);

  // Navigation: Next and Previous Diary in detail modal
  const selectedDiaryIndex = useMemo(() => {
    if (!selectedDiary) return -1;
    return diaries.findIndex((d) => d.id === selectedDiary.id);
  }, [diaries, selectedDiary]);

  const handleNextDiary = () => {
    if (selectedDiaryIndex >= 0 && selectedDiaryIndex < diaries.length - 1) {
      handleSelectDiary(diaries[selectedDiaryIndex + 1]);
    }
  };

  const handlePrevDiary = () => {
    if (selectedDiaryIndex > 0) {
      handleSelectDiary(diaries[selectedDiaryIndex - 1]);
    }
  };

  // 2. Click Diary: Immediately displays cached diary; only syncs/refreshes when in Admin mode
  const handleSelectDiary = async (diary: DiaryEntry) => {
    let original = diaries.find((item) => item.id === diary.id) || diary;

    // Immediately show existing cached diary in modal for instant response
    setSelectedDiary(original);

    // Only sync / refresh from server when logged in as Admin
    if (isAdmin && typeof navigator !== 'undefined' && navigator.onLine) {
      setCloudSyncStatus('syncing');
      try {
        const refreshed = await fetchSingleDiaryOnline(diary.id);
        if (refreshed) {
          original = refreshed;
          setSelectedDiary(refreshed);
          setDiaries((prev) =>
            sortDiariesDescending(prev.map((d) => (d.id === refreshed.id ? refreshed : d)))
          );
        }
      } catch (err) {
        console.warn('Online fetch on diary click note:', err);
      } finally {
        setCloudSyncStatus(navigator.onLine ? 'connected' : 'offline');
      }
    } else if (!isAdmin) {
      // Visitor / Logged-out mode: no sync or refresh
      incrementDiaryViews(original.id).catch(console.warn);
      recordVisitorLocation(original.id, original.title).catch(console.warn);
    }
  };

  // Handler: Open edit modal with full photos loaded if in subcollection (supports offline)
  const handleOpenEditDiary = async (d: DiaryEntry) => {
    let target = d;
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      if (d.hasSubcollectionPhotos || (d.totalPhotosCount && d.totalPhotosCount > d.photos.length)) {
        try {
          const fullPhotos = await fetchDiaryFullPhotos(d.id);
          if (fullPhotos.length > 0) {
            target = { ...target, photos: fullPhotos };
          }
        } catch (err) {
          console.warn('Could not fetch full photos for edit:', err);
        }
      }
    }
    setEditingDiary(target);
    setIsEditorOpen(true);
  };

  // Handler: Reset all diary visitor views back to 0 (Admin Only)
  const handleResetAllViews = async () => {
    if (!isAdmin) {
      openLoginModal('방문자 카운터 초기화는 관리자만 가능합니다.');
      return;
    }
    try {
      setDiaries((prev) => prev.map((d) => ({ ...d, views: 0 })));
      await resetAllDiaryViews();
      setToastMessage({ text: '모든 일기의 방문자 수가 0으로 초기화되었습니다.', type: 'success' });
      setTimeout(() => setToastMessage(null), 3000);
    } catch (err) {
      console.error('Failed to reset views:', err);
      setToastMessage({ text: '방문자 수 초기화 중 오류가 발생했습니다.', type: 'error' });
      setTimeout(() => setToastMessage(null), 3000);
    }
  };

  // Handler: Open Photo Lightbox
  const handleOpenPhotoLightbox = (photos: TravelPhoto[], index: number) => {
    setLightboxPhotos(photos);
    setLightboxIndex(index);
    setIsLightboxOpen(true);
  };

  // Handler: Download Flutter Mobile App Project Zip (Admin Only)
  const handleDownloadFlutterZip = async () => {
    if (!isAdmin) {
      openLoginModal('Flutter 프로젝트 소스코드는 관리자만 다운로드할 수 있습니다.');
      return;
    }
    try {
      setIsDownloadingFlutter(true);
      await downloadFlutterProjectZip();
      setDownloadNotification('travel_flutter_app.zip 다운로드가 시작되었습니다!');
      setTimeout(() => setDownloadNotification(null), 3500);
    } catch (err) {
      console.error('Failed to download Flutter zip', err);
      setDownloadNotification('Flutter 프로젝트 ZIP 생성 중 오류가 발생했습니다.');
      setTimeout(() => setDownloadNotification(null), 3500);
    } finally {
      setIsDownloadingFlutter(false);
    }
  };

  // Calculate cumulative total travel distance starting from the 10/23 bicycle shop visit entry
  const cumulativeDistanceKm = useMemo(() => {
    const sorted = [...diaries].sort(
      (a, b) => new Date(`${a.date}T${a.time}`).getTime() - new Date(`${b.date}T${b.time}`).getTime()
    );

    if (sorted.length === 0) return 0;

    const bikeShopIndex = sorted.findIndex(
      (d) => (d.date && d.date.includes('10-23')) || 
             (d.title && (d.title.includes('자전거') || d.title.includes('가게') || d.title.includes('가계') || d.title.includes('샵'))) ||
             (d.content && (d.content.includes('자전거') || d.content.includes('가게') || d.content.includes('가계')))
    );

    const startIndex = bikeShopIndex !== -1 ? bikeShopIndex : 0;
    const relevantDiaries = sorted.slice(startIndex);

    // Filter only diaries where includeInDistance is not false (default: true)
    const distanceDiaries = relevantDiaries.filter(
      (d) => (d.location?.includeInDistance ?? d.includeInDistance ?? true) !== false
    );

    let dist = 0;
    for (let i = 0; i < distanceDiaries.length - 1; i++) {
      const fromLoc = distanceDiaries[i]?.location;
      const toLoc = distanceDiaries[i + 1]?.location;
      if (fromLoc && toLoc && typeof fromLoc.lat === 'number' && typeof toLoc.lat === 'number') {
        dist += calculateDistanceKm(
          fromLoc.lat,
          fromLoc.lng,
          toLoc.lat,
          toLoc.lng
        );
      }
    }
    return Math.round(dist * 10) / 10;
  }, [diaries]);

  // Handler: Export diaries JSON to device's Download folder
  const handleExportData = async () => {
    try {
      const localDiaries = await getAllLocalDiaries().catch(() => []);
      const sourceDiaries = (localDiaries && localDiaries.length > 0) ? localDiaries : diaries;
      await exportDiariesToJson(sourceDiaries);
      setToastMessage({
        text: '기기 다운로드(Download) 폴더에 백업 JSON 파일이 저장되었습니다.',
        type: 'success',
      });
      setTimeout(() => setToastMessage(null), 3000);
    } catch (err) {
      console.error('Export error:', err);
      setToastMessage({
        text: '파일 다운로드 중 오류가 발생했습니다.',
        type: 'error',
      });
      setTimeout(() => setToastMessage(null), 3000);
    }
  };

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900 flex flex-col font-sans selection:bg-amber-200 selection:text-amber-900 pb-12 sm:pb-14">
      {/* Top Navbar */}
      <Navbar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onOpenNewDiary={() => {
          setEditingDiary(null);
          setIsEditorOpen(true);
        }}
        onExportData={handleExportData}
        totalDiariesCount={diaries.length}
        totalViewsCount={isAdmin ? totalViewsCount : undefined}
        visitorLogsCount={visitorLogs.length}
        onOpenVisitorModal={() => setIsVisitorModalOpen(true)}
        onOpenFlutterCode={() => setIsFlutterCodeOpen(true)}
        cloudSyncStatus={cloudSyncStatus}
        pendingSyncCount={pendingSyncCount}
        onTriggerSync={handleTriggerSync}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Welcome & Mood Header (Shown on Blog, Timeline, and TimeOfDay views) */}
        {viewMode !== 'map' && (
          <div className="mb-6 rounded-2xl bg-gradient-to-r from-stone-900 via-stone-800 to-amber-950 text-white p-4 sm:p-5 shadow-xl relative overflow-hidden border border-stone-800">
            {/* Background ambient accents */}
            <div className="absolute -right-12 -top-12 w-64 h-64 rounded-full bg-amber-600/10 blur-3xl pointer-events-none" />
            <div className="absolute right-1/4 -bottom-16 w-48 h-48 rounded-full bg-amber-500/10 blur-2xl pointer-events-none" />

            <div className="relative z-10 w-full flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex-1">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/25 border border-amber-500/40 text-amber-300 text-xs font-semibold mb-2 shadow-2xs">
                  <Compass className="w-3.5 h-3.5" />
                  <span>{t('heroTag')}</span>
                </div>
                <p className="text-xs sm:text-sm text-stone-300 leading-relaxed max-w-2xl">
                  {t('heroDescription')}
                </p>
              </div>

              {/* Cumulative Total Travel Distance Dashboard Card */}
              <div className="flex items-center gap-3.5 bg-stone-900/90 backdrop-blur-md px-5 py-3 rounded-xl border border-white/15 shadow-xl shrink-0 w-full md:w-auto">
                <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  <Route className="w-5 h-5" />
                </div>
                <div className="flex-1 md:flex-initial">
                  <div className="text-[11px] text-stone-400 font-medium uppercase tracking-wider">
                    {t('totalCumulativeDistance')}
                  </div>
                  <div className="text-lg sm:text-xl font-extrabold text-white flex items-baseline gap-1.5">
                    <span>{cumulativeDistanceKm.toLocaleString()}</span>
                    <span className="text-xs font-bold text-amber-400">km</span>
                  </div>
                </div>
                <div className="hidden sm:block text-right text-[11px] text-stone-400 border-l border-stone-700 pl-3">
                  <div>총 여정: <strong className="text-white">{diaries.length}개</strong></div>
                  <div>방문지: <strong className="text-amber-300">{new Set(diaries.map(d => d.location?.region ? d.location.region.split(' ')[0] : '').filter(Boolean)).size}곳</strong></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Dynamic Views */}
        {viewMode === 'blog' && (
          <BlogFeedView
            diaries={diaries}
            onSelectDiary={handleSelectDiary}
            onEditDiary={handleOpenEditDiary}
            onDeleteDiary={handleRequestDelete}
            onViewOnMap={handleViewOnMap}
            onOpenNewDiary={() => {
              setEditingDiary(null);
              setIsEditorOpen(true);
            }}
            onResetAllViews={handleResetAllViews}
            onOpenVisitorModal={() => setIsVisitorModalOpen(true)}
          />
        )}

        {viewMode === 'map' && (
          <TravelMapView
            diaries={diaries}
            onSelectDiary={handleSelectDiary}
            selectedDiaryId={focusedMapDiaryId}
            visitorLogs={visitorLogs}
            onOpenVisitorModal={() => setIsVisitorModalOpen(true)}
          />
        )}
      </main>

      {/* Fixed Bottom Footer */}
      <footer className="fixed bottom-0 left-0 right-0 z-30 bg-stone-900/95 text-stone-300 border-t border-stone-800 backdrop-blur-md shadow-lg py-2.5 sm:py-3">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-bold text-white tracking-tight truncate">{t('appTitle')}</span>
            <span className="hidden sm:inline text-stone-600">•</span>
            <span className="hidden sm:inline text-stone-400 truncate">{t('footerArchive')}</span>
          </div>
          <p className="text-[11px] sm:text-xs text-stone-400 font-medium shrink-0 ml-auto">
            Developer: H2 | Copyright: © 2026.10
          </p>
        </div>
      </footer>

      {/* Modals */}
      <LoginModal />

      <DiaryEditorModal
        key={editingDiary ? `edit-${editingDiary.id}` : `new-${isEditorOpen}`}
        isOpen={isEditorOpen}
        onClose={() => {
          setIsEditorOpen(false);
          setEditingDiary(null);
        }}
        onSave={handleSaveDiary}
        initialEntry={editingDiary}
      />

      <DiaryDetailModal
        isOpen={!!selectedDiary}
        diary={selectedDiary ? (diaries.find((d) => d.id === selectedDiary.id) || selectedDiary) : null}
        onClose={() => setSelectedDiary(null)}
        onEdit={(d) => {
          setSelectedDiary(null);
          handleOpenEditDiary(d);
        }}
        onDelete={handleRequestDelete}
        onViewOnMap={handleViewOnMap}
        onOpenPhotoLightbox={handleOpenPhotoLightbox}
        onNextDiary={handleNextDiary}
        onPrevDiary={handlePrevDiary}
        hasNext={selectedDiaryIndex >= 0 && selectedDiaryIndex < diaries.length - 1}
        hasPrev={selectedDiaryIndex > 0}
      />

      <PhotoLightbox
        isOpen={isLightboxOpen}
        photos={lightboxPhotos}
        currentIndex={lightboxIndex}
        onClose={() => setIsLightboxOpen(false)}
        onNavigate={(idx) => setLightboxIndex(idx)}
      />

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={!!deleteTarget}
        title={t('confirmDeleteTitle')}
        message={t('confirmDeleteMessage')}
        itemTitle={deleteTarget?.title}
        confirmText={t('confirmDeleteBtn')}
        cancelText={t('confirmCancel')}
        isDanger={true}
        onConfirm={handleConfirmDelete}
        onClose={() => setDeleteTarget(null)}
      />

      {/* Flutter Mobile App Source Code Modal (Admin Only) */}
      <FlutterCodeModal
        isOpen={isFlutterCodeOpen && isAdmin}
        onClose={() => setIsFlutterCodeOpen(false)}
        onDownloadZip={handleDownloadFlutterZip}
      />

      {/* Admin Visitor Location & Traffic Analytics Modal */}
      {isVisitorModalOpen && isAdmin && (
        <VisitorLocationModal
          isOpen={isVisitorModalOpen}
          onClose={() => setIsVisitorModalOpen(false)}
          visitorLogs={visitorLogs}
        />
      )}

      {/* Cloud Sync Top Notification */}
      {toastMessage && (
        <div className={`fixed top-18 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-xs font-semibold shadow-2xl border flex items-center gap-2 backdrop-blur-md animate-in fade-in slide-in-from-top-3 duration-200 max-w-[90vw] ${
          toastMessage.type === 'success' 
            ? 'bg-stone-900/95 text-emerald-300 border-emerald-800/60' 
            : toastMessage.type === 'info'
            ? 'bg-stone-900/95 text-amber-300 border-amber-600/60'
            : 'bg-rose-950/95 text-rose-200 border-rose-800/80'
        }`}>
          {toastMessage.type === 'success' && (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          {toastMessage.type === 'info' && (
            <Loader2 className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
          )}
          {toastMessage.type === 'error' && (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span className="truncate">{toastMessage.text}</span>
        </div>
      )}

      {/* Download Notification Toast */}
      {downloadNotification && (
        <div className="fixed bottom-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl bg-stone-900/95 text-white text-xs font-medium shadow-2xl border border-stone-700 flex items-center gap-2 backdrop-blur-md animate-in fade-in slide-in-from-bottom-3 duration-200">
          <Download className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{downloadNotification}</span>
        </div>
      )}
    </div>
  );
}

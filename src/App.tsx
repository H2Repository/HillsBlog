/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { DiaryEntry, TravelPhoto, ViewMode, VisitorLog } from './types';
import { getStoredDiaries, saveDiaries, exportDiariesToJson, sortDiariesDescending } from './utils/storage';
import { 
  subscribeDiaries, 
  saveDiaryToFirestore, 
  deleteDiaryFromFirestore,
  incrementDiaryViews,
  resetAllDiaryViews,
  fetchDiaryFullPhotos,
  updateOptimizedDiaryToFirestore
} from './services/diaryFirestore';
import { recordVisitorLocation, subscribeVisitorLogs } from './services/visitorService';
import { optimizeAllDiaries } from './utils/imageCompressor';
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
  getPendingSyncCount, 
  enqueuePendingSave, 
  enqueuePendingDelete, 
  processPendingSyncQueue, 
  subscribeSyncQueueChange 
} from './utils/offlineSync';
import { 
  Plus, 
  Compass, 
  MapPin, 
  Download,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';

export default function App() {
  const { t, language } = useLanguage();
  const { isAdmin, openLoginModal, autoLogoutNotice, clearAutoLogoutNotice } = useAuth();
  const [diaries, setDiaries] = useState<DiaryEntry[]>(() => getStoredDiaries());
  const [viewMode, setViewMode] = useState<ViewMode>('blog');
  const [cloudSyncStatus, setCloudSyncStatus] = useState<'syncing' | 'connected' | 'offline'>('syncing');
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(() => getPendingSyncCount());
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [visitorLogs, setVisitorLogs] = useState<VisitorLog[]>([]);
  const [isVisitorModalOpen, setIsVisitorModalOpen] = useState(false);

  // Initial visitor entry logging (if not admin)
  useEffect(() => {
    if (!isAdmin) {
      recordVisitorLocation().catch(console.warn);
    }
  }, [isAdmin]);

  // Subscribe to real-time visitor logs when admin is logged in
  useEffect(() => {
    if (isAdmin) {
      const unsubscribe = subscribeVisitorLogs(setVisitorLogs);
      return () => unsubscribe();
    }
  }, [isAdmin]);

  // Subscribe to offline sync queue changes
  useEffect(() => {
    return subscribeSyncQueueChange(setPendingSyncCount);
  }, []);

  // Show notice when automatically logged out due to inactivity
  useEffect(() => {
    if (autoLogoutNotice) {
      setToastMessage({ text: autoLogoutNotice, type: 'error' });
      clearAutoLogoutNotice();
      const timer = setTimeout(() => setToastMessage(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [autoLogoutNotice, clearAutoLogoutNotice]);

  // Real-time synchronization with Firebase Firestore across all devices
  useEffect(() => {
    const unsubscribe = subscribeDiaries(
      (updatedDiaries) => {
        setDiaries(sortDiariesDescending(updatedDiaries));
        setCloudSyncStatus('connected');
      },
      (error) => {
        console.warn('Firestore sync note:', error);
        setCloudSyncStatus('offline');
      }
    );

    return () => unsubscribe();
  }, []);

  // Manual or automatic synchronization trigger for pending offline operations
  const handleTriggerSync = async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setToastMessage({
        text: '현재 오프라인 상태입니다. 인터넷에 연결되면 자동으로 동기화됩니다.',
        type: 'error',
      });
      setTimeout(() => setToastMessage(null), 3500);
      return;
    }

    const currentCount = getPendingSyncCount();
    if (currentCount === 0) {
      setToastMessage({
        text: '모든 일기가 클라우드와 완벽하게 동기화되어 있습니다.',
        type: 'success',
      });
      setTimeout(() => setToastMessage(null), 2500);
      return;
    }

    setCloudSyncStatus('syncing');
    setToastMessage({
      text: `오프라인 변경사항(${currentCount}개) 동기화 진행 중...`,
      type: 'success',
    });

    const { successCount, failedCount } = await processPendingSyncQueue();
    if (successCount > 0) {
      setCloudSyncStatus('connected');
      setToastMessage({
        text: `동기화 완료: ${successCount}개의 일기가 클라우드에 성공적으로 반영되었습니다.`,
        type: 'success',
      });
      setTimeout(() => setToastMessage(null), 3500);
    } else if (failedCount > 0) {
      setCloudSyncStatus('offline');
      setToastMessage({
        text: '일부 일기 동기화 중 오류가 발생했습니다. 잠시 후 다시 시도합니다.',
        type: 'error',
      });
      setTimeout(() => setToastMessage(null), 4000);
    }
  };

  // Listen for online/offline events and automatically synchronize pending offline operations
  useEffect(() => {
    const handleOnline = async () => {
      setCloudSyncStatus('syncing');
      const count = getPendingSyncCount();
      if (count > 0) {
        setToastMessage({
          text: `인터넷 재연결됨: 오프라인 변경사항(${count}개) 동기화 중...`,
          type: 'success',
        });
        const { successCount } = await processPendingSyncQueue();
        if (successCount > 0) {
          setCloudSyncStatus('connected');
          setToastMessage({
            text: `온라인 동기화 완료: 오프라인에서 변경된 ${successCount}개 일기가 클라우드에 안전하게 반영되었습니다.`,
            type: 'success',
          });
          setTimeout(() => setToastMessage(null), 4000);
        }
      } else {
        setCloudSyncStatus('connected');
      }
    };

    const handleOffline = () => {
      setCloudSyncStatus('offline');
      setToastMessage({
        text: '오프라인 모드로 전환되었습니다. 작성/수정/삭제한 일기는 로컬에 안전하게 보관되며 온라인 시 자동 동기화됩니다.',
        type: 'error',
      });
      setTimeout(() => setToastMessage(null), 4500);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial background sync check if online and pending items exist
    if (typeof navigator !== 'undefined' && navigator.onLine && getPendingSyncCount() > 0) {
      handleOnline();
    }

    // Periodic check every 15s to retry any pending syncs when online
    const interval = setInterval(() => {
      if (typeof navigator !== 'undefined' && navigator.onLine && getPendingSyncCount() > 0) {
        processPendingSyncQueue().then(({ successCount }) => {
          if (successCount > 0) {
            setCloudSyncStatus('connected');
            setToastMessage({
              text: `오프라인 변경사항(${successCount}개) 자동 동기화 완료`,
              type: 'success',
            });
            setTimeout(() => setToastMessage(null), 3000);
          }
        });
      }
    }, 15000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, []);

  // Check and optimize existing diary photos if needed (720px max resize & high-efficiency compression)
  const hasOptimizedExistingPhotosRef = useRef(false);
  useEffect(() => {
    if (diaries.length === 0 || hasOptimizedExistingPhotosRef.current) return;

    let isMounted = true;
    const runCheck = async () => {
      try {
        const { updatedDiaries, totalOptimized, modifiedDiariesCount } = await optimizeAllDiaries(diaries);
        if (!isMounted) return;

        if (modifiedDiariesCount > 0) {
          hasOptimizedExistingPhotosRef.current = true;
          setDiaries(updatedDiaries);
          saveDiaries(updatedDiaries);

          // Update each modified diary in Firestore
          for (const diary of updatedDiaries) {
            updateOptimizedDiaryToFirestore(diary).catch(console.warn);
          }

          setToastMessage({
            text: `기존 사진 ${totalOptimized}장 720px 이하 최적화 및 압축 재저장 완료`,
            type: 'success',
          });
          setTimeout(() => setToastMessage(null), 4000);
        } else {
          hasOptimizedExistingPhotosRef.current = true;
        }
      } catch (err) {
        console.warn('Existing photos optimization note:', err);
      }
    };

    runCheck();

    return () => {
      isMounted = false;
    };
  }, [diaries]);
  
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

  // Handler: Add or Update Diary (Supports both online immediate sync and offline queueing)
  const handleSaveDiary = async (entry: DiaryEntry) => {
    if (!isAdmin) {
      openLoginModal('일기 추가 및 수정은 관리자만 가능합니다. 로그인해주세요.');
      return;
    }

    // 1. Optimistic update in UI and local storage (strictly newest first)
    setDiaries((prev) => {
      const exists = prev.some((d) => d.id === entry.id);
      const updated = exists ? prev.map((d) => (d.id === entry.id ? entry : d)) : [entry, ...prev];
      return sortDiariesDescending(updated);
    });

    // If currently viewing detail, update it
    if (selectedDiary && selectedDiary.id === entry.id) {
      setSelectedDiary(entry);
    }

    // 2. If browser is currently offline, queue immediately without error
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      enqueuePendingSave(entry);
      setToastMessage({
        text: '오프라인 모드: 일기가 로컬에 저장되었습니다. 인터넷이 연결되면 자동으로 클라우드에 업데이트됩니다.',
        type: 'success',
      });
      setTimeout(() => setToastMessage(null), 4500);
      return;
    }

    // 3. Attempt cloud persistence
    try {
      await saveDiaryToFirestore(entry);
      setToastMessage({ text: '클라우드에 안전하게 동기화되었습니다.', type: 'success' });
      setTimeout(() => setToastMessage(null), 3000);

      // Drain any other pending queue items if online
      if (getPendingSyncCount() > 0) {
        processPendingSyncQueue().catch(console.warn);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.warn('Direct cloud sync not completed, checking error:', errorMsg);

      // Network or connection failure: queue for automatic background sync
      if (
        errorMsg.includes('offline') || 
        errorMsg.includes('network') || 
        errorMsg.includes('Failed to fetch') ||
        (typeof navigator !== 'undefined' && !navigator.onLine)
      ) {
        enqueuePendingSave(entry);
        setToastMessage({
          text: '네트워크 연결 불안정: 일기가 로컬에 저장되었으며 인터넷 복구 시 자동 동기화됩니다.',
          type: 'success',
        });
        setTimeout(() => setToastMessage(null), 4500);
        return;
      }

      let msg = '클라우드 저장 중 오류가 발생했습니다.';
      if (err instanceof Error) {
        try {
          const parsed = JSON.parse(err.message);
          if (parsed.error && typeof parsed.error === 'string' && parsed.error.includes('Missing or insufficient permissions')) {
            msg = '저장 권한이 부족합니다. 관리자로 로그인 후 다시 시도해주세요.';
          } else if (parsed.error) {
            msg = String(parsed.error);
          }
        } catch {
          msg = err.message;
        }
      }
      setToastMessage({ text: msg, type: 'error' });
      setTimeout(() => setToastMessage(null), 5000);
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
    setDeleteTarget(diary);
  };

  const handleConfirmDelete = async () => {
    if (!isAdmin) {
      openLoginModal('일기 삭제는 관리자만 가능합니다. 로그인해주세요.');
      setDeleteTarget(null);
      return;
    }
    if (deleteTarget) {
      const targetId = deleteTarget.id;
      handleDeleteDiary(targetId);
      setDeleteTarget(null);

      // If browser is currently offline, queue deletion immediately
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        enqueuePendingDelete(targetId);
        setToastMessage({
          text: '오프라인 모드: 일기가 삭제되었습니다. 인터넷이 연결되면 클라우드에 자동으로 반영됩니다.',
          type: 'success',
        });
        setTimeout(() => setToastMessage(null), 4500);
        return;
      }

      // Persist deletion to Firestore across all devices
      try {
        await deleteDiaryFromFirestore(targetId);
        setToastMessage({ text: '클라우드에서 일기가 삭제되었습니다.', type: 'success' });
        setTimeout(() => setToastMessage(null), 3000);

        if (getPendingSyncCount() > 0) {
          processPendingSyncQueue().catch(console.warn);
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.warn('Direct delete not completed, checking error:', errorMsg);

        if (
          errorMsg.includes('offline') || 
          errorMsg.includes('network') || 
          errorMsg.includes('Failed to fetch') ||
          (typeof navigator !== 'undefined' && !navigator.onLine)
        ) {
          enqueuePendingDelete(targetId);
          setToastMessage({
            text: '네트워크 연결 불안정: 삭제 예약되었으며 인터넷 복구 시 클라우드에서 삭제됩니다.',
            type: 'success',
          });
          setTimeout(() => setToastMessage(null), 4500);
          return;
        }

        setToastMessage({ text: '클라우드 삭제 중 오류가 발생했습니다.', type: 'error' });
        setTimeout(() => setToastMessage(null), 4000);
      }
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

  // Handler: Select diary to read (tracks & increments visitor view count)
  const handleSelectDiary = async (diary: DiaryEntry) => {
    let original = diaries.find((item) => item.id === diary.id) || diary;

    // Load full attached photos from subcollection if diary has large photo set
    if (original.hasSubcollectionPhotos) {
      try {
        const fullPhotos = await fetchDiaryFullPhotos(original.id);
        if (fullPhotos.length > 0) {
          original = { ...original, photos: fullPhotos };
        }
      } catch (err) {
        console.warn('Subcollection photos fetch note:', err);
      }
    }

    setSelectedDiary(original);

    // 관리자 모드로 들어가는 경우 방문자 카운터는 하지 않는다.
    if (isAdmin) {
      return;
    }

    // Check if this visitor already read this diary in the current session
    const sessionKey = `visited_diary_${original.id}`;
    let isNewVisit = false;
    try {
      if (!sessionStorage.getItem(sessionKey)) {
        isNewVisit = true;
      }
    } catch {
      isNewVisit = true;
    }

    if (isNewVisit) {
      // Optimistic state update for instant UI feedback
      setDiaries((prev) =>
        prev.map((d) => (d.id === original.id ? { ...d, views: (d.views || 0) + 1 } : d))
      );
    }

    // Increment in Firestore across all visitors
    incrementDiaryViews(original.id).catch((err) => {
      console.warn('View count sync warning:', err);
    });

    // Record visitor location and diary reading log for admin
    recordVisitorLocation(original.id, original.title).catch((err) => {
      console.warn('Visitor location logging error:', err);
    });
  };

  // Handler: Open edit modal with full photos loaded if in subcollection
  const handleOpenEditDiary = async (d: DiaryEntry) => {
    let target = d;
    if (d.hasSubcollectionPhotos) {
      try {
        const fullPhotos = await fetchDiaryFullPhotos(d.id);
        if (fullPhotos.length > 0) {
          target = { ...target, photos: fullPhotos };
        }
      } catch (err) {
        console.warn('Could not fetch full photos for edit:', err);
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

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900 flex flex-col font-sans selection:bg-amber-200 selection:text-amber-900">
      {/* Top Navbar */}
      <Navbar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onOpenNewDiary={() => {
          setEditingDiary(null);
          setIsEditorOpen(true);
        }}
        onExportData={() => exportDiariesToJson(diaries)}
        totalDiariesCount={diaries.length}
        totalViewsCount={isAdmin ? totalViewsCount : undefined}
        visitorLogsCount={visitorLogs.length}
        onOpenVisitorModal={() => setIsVisitorModalOpen(true)}
        cloudSyncStatus={cloudSyncStatus}
        pendingSyncCount={pendingSyncCount}
        onTriggerSync={handleTriggerSync}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Welcome & Mood Header (Shown on Blog, Timeline, and TimeOfDay views) */}
        {viewMode !== 'map' && (
          <div className="mb-4 rounded-2xl bg-gradient-to-r from-stone-900 via-stone-800 to-amber-950 text-white p-3 sm:p-4 shadow-xl relative overflow-hidden border border-stone-800">
            {/* Background ambient accents */}
            <div className="absolute -right-12 -top-12 w-64 h-64 rounded-full bg-amber-600/10 blur-3xl pointer-events-none" />
            <div className="absolute right-1/4 -bottom-16 w-48 h-48 rounded-full bg-amber-500/10 blur-2xl pointer-events-none" />

            <div className="relative z-10 w-full">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-semibold mb-1.5">
                <Compass className="w-3.5 h-3.5" />
                <span>{t('heroTag')}</span>
              </div>
              <p className="text-xs sm:text-sm text-stone-300 leading-relaxed">
                {t('heroDescription')}
              </p>
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

      {/* Footer */}
      <footer className="mt-auto border-t border-stone-200 bg-white py-6 text-stone-500 text-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-bold text-stone-700">{t('appTitle')}</span>
            <span>•</span>
            <span>{t('footerArchive')}</span>
          </div>

          <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
            {/* Flutter 소스 다운 (관리자 전용) */}
            {isAdmin && (
              <>
                <div className="flex items-center gap-1.5 bg-stone-50 hover:bg-sky-50/60 border border-stone-200 hover:border-sky-300 px-2.5 py-1 rounded-lg transition shadow-2xs">
                  <button
                    id="btn-footer-download-flutter"
                    type="button"
                    onClick={handleDownloadFlutterZip}
                    disabled={isDownloadingFlutter}
                    className="text-stone-700 hover:text-sky-700 flex items-center gap-1.5 transition text-xs font-semibold cursor-pointer disabled:opacity-50"
                    title={t('footerDownloadFlutterTitle')}
                  >
                    <FlutterIcon className={`w-4 h-4 ${isDownloadingFlutter ? 'animate-bounce' : ''}`} />
                    <span>{isDownloadingFlutter ? 'ZIP 다운로드 중...' : t('downloadFlutterZip')}</span>
                    <Download className="w-3.5 h-3.5 text-sky-600" />
                  </button>
                  <button
                    id="btn-footer-view-flutter-code"
                    type="button"
                    onClick={() => setIsFlutterCodeOpen(true)}
                    className="text-[11px] text-stone-500 hover:text-sky-800 bg-white hover:bg-sky-100 border border-stone-200 px-1.5 py-0.5 rounded transition cursor-pointer font-medium"
                    title={t('viewFlutterCode')}
                  >
                    코드보기
                  </button>
                </div>
                <span className="text-stone-300">•</span>
              </>
            )}
            <button
              type="button"
              onClick={() => exportDiariesToJson(diaries)}
              className="text-stone-400 hover:text-stone-700 transition"
              title={t('exportBackup')}
            >
              {t('exportBackup')}
            </button>
          </div>
        </div>
      </footer>

      {/* Floating Action Button (Mobile & Desktop Quick Add) */}
      <button
        id="btn-floating-add-diary"
        type="button"
        onClick={() => {
          if (isAdmin) {
            setEditingDiary(null);
            setIsEditorOpen(true);
          } else {
            openLoginModal('새 일기 작성은 관리자만 가능합니다. 로그인해주세요.');
          }
        }}
        className={`fixed bottom-6 right-6 z-30 p-4 rounded-full text-white shadow-xl hover:scale-105 active:scale-95 transition-all duration-200 flex items-center justify-center group cursor-pointer ${
          isAdmin
            ? 'bg-amber-600 hover:bg-amber-500 shadow-amber-900/40'
            : 'bg-stone-800 hover:bg-stone-700 shadow-stone-900/40'
        }`}
        title={isAdmin ? t('writeDiary') : '새 일기 쓰기 (관리자 로그인 필요)'}
      >
        <Plus className="w-6 h-6" />
        <span className="max-w-0 overflow-hidden whitespace-nowrap group-hover:max-w-xs group-hover:ml-2 transition-all duration-300 text-xs font-bold">
          {isAdmin ? t('writeDiary') : '+'}
        </span>
      </button>

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

      {/* Cloud Sync Toast Notification */}
      {toastMessage && (
        <div className={`fixed top-18 right-6 z-50 px-4 py-2.5 rounded-xl text-xs font-semibold shadow-2xl border flex items-center gap-2 backdrop-blur-md animate-in fade-in slide-in-from-top-3 duration-200 ${
          toastMessage.type === 'success' 
            ? 'bg-stone-900/95 text-emerald-300 border-emerald-800/60' 
            : 'bg-rose-950/95 text-rose-200 border-rose-800/80'
        }`}>
          {toastMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Download Notification Toast */}
      {downloadNotification && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl bg-stone-900/95 text-white text-xs font-medium shadow-2xl border border-stone-700 flex items-center gap-2 backdrop-blur-md animate-in fade-in slide-in-from-bottom-3 duration-200">
          <Download className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{downloadNotification}</span>
        </div>
      )}
    </div>
  );
}

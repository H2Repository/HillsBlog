import React, { useState, useEffect, useMemo, useRef } from 'react';
import { DiaryEntry, TravelPhoto, ViewMode, VisitorLog, CloudSyncStatus } from './types';
import { 
  getStoredDiaries, 
  saveDiaries, 
  exportDiariesToJson, 
  sortDiariesDescending,
  deduplicateDiaries,
  isDiaryDuplicate
} from './utils/storage';
import { 
  syncInitialDiariesSQLite,
  saveDiaryToSQLite, 
  deleteDiaryFromSQLite,
  migrateLocalToSQLite,
  incrementDiaryViewsSQLite,
  resetAllDiaryViewsSQLite
} from './services/diarySQLite';
import { recordVisitorLocation, subscribeVisitorLogs } from './services/visitorService';
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
import { LoginModal } from './components/LoginModal';
import { downloadFlutterProjectZip } from './utils/flutterDownload';
import { useLanguage } from './context/LanguageContext';
import { useAuth } from './context/AuthContext';
import { getCachedDiaryTranslation, hasKorean, translateDiaryAsync } from './utils/translationService';
import { 
  getAllLocalDiaries, 
  getLocalDiaryById,
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
  Loader2
} from 'lucide-react';

export default function App() {
  const { t, language } = useLanguage();
  const { isAdmin, openLoginModal, autoLogoutNotice, clearAutoLogoutNotice } = useAuth();
  const [diaries, setDiaries] = useState<DiaryEntry[]>(() => getStoredDiaries());
  const [viewMode, setViewMode] = useState<ViewMode>('blog');
  const [cloudSyncStatus, setCloudSyncStatus] = useState<CloudSyncStatus>('connected');
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [visitorLogs, setVisitorLogs] = useState<VisitorLog[]>([]);
  const [isVisitorModalOpen, setIsVisitorModalOpen] = useState(false);

  // Subscribe to sync status
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

  // Auto-logout notice
  useEffect(() => {
    if (autoLogoutNotice) {
      setToastMessage({ text: autoLogoutNotice, type: 'error' });
      clearAutoLogoutNotice();
      const timer = setTimeout(() => setToastMessage(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [autoLogoutNotice, clearAutoLogoutNotice]);

  // Initial Load & Migration
  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      try {
        const cached = await getAllLocalDiaries();
        if (cached && cached.length > 0 && isMounted) {
          const { deduplicated } = deduplicateDiaries(cached);
          setDiaries(deduplicated);
        }
      } catch {}

      // Migration
      try {
        const isMigrated = localStorage.getItem('sqlite_migration_done');
        if (!isMigrated) {
          const localDiaries = await getAllLocalDiaries();
          if (localDiaries.length > 0) await migrateLocalToSQLite(localDiaries);
          localStorage.setItem('sqlite_migration_done', 'true');
        }
      } catch {}

      // SQLite Sync
      try {
        const { diaries: freshDiaries } = await syncInitialDiariesSQLite();
        if (isMounted && freshDiaries && freshDiaries.length > 0) {
          setDiaries(sortDiariesDescending(freshDiaries));
          setCloudSyncStatus('connected');
        }
      } catch {
        if (isMounted) setCloudSyncStatus('offline');
      }
    };
    loadData();
    return () => { isMounted = false; };
  }, []);

  const handleTriggerSync = async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setToastMessage({ text: '오프라인 상태입니다.', type: 'error' });
      setTimeout(() => setToastMessage(null), 2000);
      return;
    }
    setCloudSyncStatus('syncing');
    try {
      if (isAdmin) await processSyncQueue();
      const { diaries: freshDiaries } = await syncInitialDiariesSQLite();
      if (freshDiaries) setDiaries(sortDiariesDescending(freshDiaries));
      setCloudSyncStatus('connected');
      setToastMessage({ text: '동기화 완료', type: 'success' });
      setTimeout(() => setToastMessage(null), 2000);
    } catch {
      setCloudSyncStatus('offline');
      setToastMessage({ text: '동기화 오류', type: 'error' });
      setTimeout(() => setToastMessage(null), 2000);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      const unsubscribe = subscribeVisitorLogs(setVisitorLogs);
      handleTriggerSync();
      return () => unsubscribe();
    } else {
      stopSyncQueue();
    }
  }, [isAdmin]);

  // Modals state
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingDiary, setEditingDiary] = useState<DiaryEntry | null>(null);
  const [selectedDiary, setSelectedDiary] = useState<DiaryEntry | null>(null);
  const [focusedMapDiaryId, setFocusedMapDiaryId] = useState<string | null>(null);

  // Translation
  useEffect(() => {
    if (language === 'ko') return;
    let isSubscribed = true;
    const translateEntries = async () => {
      for (const diary of diaries) {
        if (!isSubscribed) break;
        const cached = getCachedDiaryTranslation(diary.id, language);
        if (cached) continue;
        if (hasKorean(diary.title) || hasKorean(diary.content)) {
          try { await translateDiaryAsync(diary, language); } catch {}
        }
      }
    };
    translateEntries();
    return () => { isSubscribed = false; };
  }, [diaries, language]);

  const [isDownloadingFlutter, setIsDownloadingFlutter] = useState(false);
  const [isFlutterCodeOpen, setIsFlutterCodeOpen] = useState(false);
  const [downloadNotification, setDownloadNotification] = useState<string | null>(null);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [lightboxPhotos, setLightboxPhotos] = useState<TravelPhoto[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<DiaryEntry | null>(null);

  useEffect(() => {
    saveDiaries(diaries);
  }, [diaries]);

  const handleSaveDiary = async (entry: DiaryEntry) => {
    if (!isAdmin) {
      openLoginModal('관리자 로그인이 필요합니다.');
      return;
    }
    const existingMatch = diaries.find((d) => isDiaryDuplicate(d, entry));
    let targetEntry: DiaryEntry = { ...entry };
    let obsoleteIdToDelete: string | null = null;
    if (existingMatch) {
      targetEntry.id = existingMatch.id;
      targetEntry.views = Math.max(existingMatch.views || 0, entry.views || 0);
      targetEntry.createdAt = existingMatch.createdAt || entry.createdAt;
      if (entry.id !== existingMatch.id) obsoleteIdToDelete = entry.id;
    }
    setDiaries((prev) => {
      const filtered = prev.filter(d => d.id !== targetEntry.id && (!obsoleteIdToDelete || d.id !== obsoleteIdToDelete));
      return sortDiariesDescending([targetEntry, ...filtered]);
    });
    if (selectedDiary && (selectedDiary.id === targetEntry.id || (obsoleteIdToDelete && selectedDiary.id === obsoleteIdToDelete))) {
      setSelectedDiary(targetEntry);
    }
    if (obsoleteIdToDelete) {
      await deleteLocalDiary(obsoleteIdToDelete).catch(() => {});
      await dequeueLocalSyncItem(obsoleteIdToDelete).catch(() => {});
    }
    try {
      await saveLocalDiary(targetEntry);
      await enqueueLocalSyncItem('save', targetEntry.id, targetEntry);
      setPendingSyncCount(await getLocalSyncQueueCount());
    } catch {}
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        if (obsoleteIdToDelete) await deleteDiaryFromSQLite(obsoleteIdToDelete).catch(() => {});
        await saveDiaryToSQLite(targetEntry);
        await dequeueLocalSyncItem(targetEntry.id);
        setPendingSyncCount(await getLocalSyncQueueCount());
      } catch {}
    }
  };

  const handleConfirmDelete = async () => {
    if (!isAdmin || !deleteTarget) return;
    const targetId = deleteTarget.id;
    setDeleteTarget(null);
    setDiaries((prev) => prev.filter(d => d.id !== targetId));
    if (selectedDiary && selectedDiary.id === targetId) setSelectedDiary(null);
    try {
      await deleteLocalDiary(targetId);
      await enqueueLocalSyncItem('delete', targetId);
      setPendingSyncCount(await getLocalSyncQueueCount());
    } catch {}
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        await deleteDiaryFromSQLite(targetId);
        await dequeueLocalSyncItem(targetId);
        setPendingSyncCount(await getLocalSyncQueueCount());
      } catch {}
    }
  };

  const handleSelectDiary = async (diary: DiaryEntry) => {
    const original = diaries.find((item) => item.id === diary.id) || diary;
    setSelectedDiary(original);
    if (!isAdmin) {
      incrementDiaryViewsSQLite(original.id).catch(console.warn);
      recordVisitorLocation(original.id, original.title).catch(console.warn);
    }
  };

  const handleResetAllViews = async () => {
    if (!isAdmin) return;
    try {
      setDiaries((prev) => prev.map((d) => ({ ...d, views: 0 })));
      await resetAllDiaryViewsSQLite();
      setToastMessage({ text: '방문자 수 초기화 완료', type: 'success' });
      setTimeout(() => setToastMessage(null), 2000);
    } catch {}
  };

  const cumulativeDistanceKm = useMemo(() => {
    const sorted = [...diaries].sort((a, b) => new Date(`${a.date}T${a.time}`).getTime() - new Date(`${b.date}T${b.time}`).getTime());
    if (sorted.length === 0) return 0;
    const startIndex = sorted.findIndex(d => (d.date && d.date.includes('10-23')) || (d.title && d.title.includes('자전거')) || (d.content && d.content.includes('자전거')));
    const relevant = sorted.slice(startIndex !== -1 ? startIndex : 0).filter(d => (d.location?.includeInDistance ?? d.includeInDistance ?? true) !== false);
    let dist = 0;
    for (let i = 0; i < relevant.length - 1; i++) {
      const from = relevant[i]?.location, to = relevant[i + 1]?.location;
      if (from && to && typeof from.lat === 'number' && typeof to.lat === 'number') {
        dist += calculateDistanceKm(from.lat, from.lng, to.lat, to.lng);
      }
    }
    return Math.round(dist * 10) / 10;
  }, [diaries]);

  return (
    <div className="flex flex-col flex-1 bg-stone-100 text-stone-900 font-sans selection:bg-amber-200 selection:text-amber-900 overflow-x-hidden">
      <Navbar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onOpenNewDiary={() => { setEditingDiary(null); setIsEditorOpen(true); }}
        onExportData={() => exportDiariesToJson(diaries)}
        totalDiariesCount={diaries.length}
        totalViewsCount={isAdmin ? diaries.reduce((acc, d) => acc + (d.views || 0), 0) : undefined}
        visitorLogsCount={visitorLogs.length}
        onOpenVisitorModal={() => setIsVisitorModalOpen(true)}
        onOpenFlutterCode={() => setIsFlutterCodeOpen(true)}
        cloudSyncStatus={cloudSyncStatus}
        pendingSyncCount={pendingSyncCount}
        onTriggerSync={handleTriggerSync}
      />

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {viewMode !== 'map' && (
          <div className="mb-6 rounded-2xl bg-gradient-to-r from-stone-900 via-stone-800 to-amber-950 text-white p-4 sm:p-5 shadow-xl relative overflow-hidden border border-stone-800 shrink-0">
            <div className="absolute -right-12 -top-12 w-64 h-64 rounded-full bg-amber-600/10 blur-3xl pointer-events-none" />
            <div className="relative z-10 w-full flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex-1">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/25 border border-amber-500/40 text-amber-300 text-xs font-semibold mb-2 shadow-2xs">
                  <Compass className="w-3.5 h-3.5" />
                  <span>{t('heroTag')}</span>
                </div>
                <p className="text-xs sm:text-sm text-stone-300 leading-relaxed max-w-2xl">{t('heroDescription')}</p>
              </div>
              <div className="flex items-center gap-3.5 bg-stone-900/90 backdrop-blur-md px-5 py-3 rounded-xl border border-white/15 shadow-xl shrink-0 w-full md:w-auto">
                <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30"><Route className="w-5 h-5" /></div>
                <div className="flex-1 md:flex-initial">
                  <div className="text-[11px] text-stone-400 font-medium uppercase tracking-wider">{t('totalCumulativeDistance')}</div>
                  <div className="text-lg sm:text-xl font-extrabold text-white flex items-baseline gap-1.5">
                    <span>{cumulativeDistanceKm.toLocaleString()}</span>
                    <span className="text-xs font-bold text-amber-400">km</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {viewMode === 'blog' && (
          <BlogFeedView
            diaries={diaries}
            onSelectDiary={handleSelectDiary}
            onEditDiary={(d) => { setEditingDiary(d); setIsEditorOpen(true); }}
            onDeleteDiary={(d) => setDeleteTarget(d)}
            onViewOnMap={(d) => { setFocusedMapDiaryId(d.id); setViewMode('map'); }}
            onOpenNewDiary={() => { setEditingDiary(null); setIsEditorOpen(true); }}
            onResetAllViews={handleResetAllViews}
            onOpenVisitorModal={() => setIsVisitorModalOpen(true)}
            onTriggerSync={handleTriggerSync}
            cloudSyncStatus={cloudSyncStatus}
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

      <footer className="shrink-0 bg-stone-900 text-stone-300 border-t border-stone-800 py-3 sm:py-3.5 shadow-md mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-bold text-white tracking-tight truncate">{t('appTitle')}</span>
            <span className="hidden sm:inline text-stone-600">•</span>
            <span className="hidden sm:inline text-stone-400 truncate">{t('footerArchive')}</span>
          </div>
          <p className="text-[11px] sm:text-xs text-stone-400 font-medium shrink-0 ml-auto">Developer: H2 | Copyright: © 2026.10</p>
        </div>
      </footer>

      <LoginModal />
      <DiaryEditorModal
        key={editingDiary ? `edit-${editingDiary.id}` : `new-${isEditorOpen}`}
        isOpen={isEditorOpen}
        onClose={() => { setIsEditorOpen(false); setEditingDiary(null); }}
        onSave={handleSaveDiary}
        initialEntry={editingDiary}
      />
      <DiaryDetailModal
        isOpen={!!selectedDiary}
        diary={selectedDiary}
        onClose={() => setSelectedDiary(null)}
        onEdit={(d) => { setSelectedDiary(null); setEditingDiary(d); setIsEditorOpen(true); }}
        onDelete={(d) => setDeleteTarget(d)}
        onViewOnMap={(d) => { setFocusedMapDiaryId(d.id); setViewMode('map'); }}
        onOpenPhotoLightbox={(photos, index) => { setLightboxPhotos(photos); setLightboxIndex(index); setIsLightboxOpen(true); }}
        onNextDiary={() => {
          const idx = diaries.findIndex(d => d.id === selectedDiary?.id);
          if (idx < diaries.length - 1) setSelectedDiary(diaries[idx + 1]);
        }}
        onPrevDiary={() => {
          const idx = diaries.findIndex(d => d.id === selectedDiary?.id);
          if (idx > 0) setSelectedDiary(diaries[idx - 1]);
        }}
        hasNext={selectedDiary && diaries.findIndex(d => d.id === selectedDiary.id) < diaries.length - 1}
        hasPrev={selectedDiary && diaries.findIndex(d => d.id === selectedDiary.id) > 0}
      />
      <PhotoLightbox
        isOpen={isLightboxOpen}
        photos={lightboxPhotos}
        currentIndex={lightboxIndex}
        onClose={() => setIsLightboxOpen(false)}
        onNavigate={(idx) => setLightboxIndex(idx)}
      />
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
      <FlutterCodeModal isOpen={isFlutterCodeOpen && isAdmin} onClose={() => setIsFlutterCodeOpen(false)} onDownloadZip={async () => {
        try {
          setIsDownloadingFlutter(true);
          await downloadFlutterProjectZip();
          setDownloadNotification('다운로드 시작됨');
          setTimeout(() => setDownloadNotification(null), 3500);
        } catch { setDownloadNotification('다운로드 오류'); setTimeout(() => setDownloadNotification(null), 3500); }
        finally { setIsDownloadingFlutter(false); }
      }} />
      {isVisitorModalOpen && isAdmin && <VisitorLocationModal isOpen={isVisitorModalOpen} onClose={() => setIsVisitorModalOpen(false)} visitorLogs={visitorLogs} />}
      
      {toastMessage && (
        <div className={`fixed top-18 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-xs font-semibold shadow-2xl border flex items-center gap-2 backdrop-blur-md animate-in fade-in slide-in-from-top-3 duration-200 max-w-[90vw] ${
          toastMessage.type === 'success' ? 'bg-stone-900/95 text-emerald-300 border-emerald-800/60' : toastMessage.type === 'info' ? 'bg-stone-900/95 text-amber-300 border-amber-600/60' : 'bg-rose-950/95 text-rose-200 border-rose-800/80'
        }`}>
          {toastMessage.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
          {toastMessage.type === 'info' && <Loader2 className="w-4 h-4 text-amber-400 animate-spin shrink-0" />}
          {toastMessage.type === 'error' && <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />}
          <span className="truncate">{toastMessage.text}</span>
        </div>
      )}
    </div>
  );
}

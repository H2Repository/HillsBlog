import React, { useState } from 'react';
import { ViewMode } from '../types';
import { 
  Compass, 
  MapPin, 
  BookOpen, 
  Map as MapIcon, 
  Plus, 
  Download, 
  Navigation,
  Loader2,
  Cloud,
  CloudOff,
  Check,
  Lock,
  LogOut,
  ShieldCheck,
  UserCheck,
  Eye
} from 'lucide-react';
import { getCurrentGpsPosition, reverseGeocode } from '../utils/geo';
import { useLanguage } from '../context/LanguageContext';
import { LanguageSelector } from './LanguageSelector';
import { useAuth } from '../context/AuthContext';
interface NavbarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onOpenNewDiary: () => void;
  onExportData: () => void;
  totalDiariesCount: number;
  totalViewsCount?: number;
  visitorLogsCount?: number;
  onOpenVisitorModal?: () => void;
  onQuickLocate?: (lat: number, lng: number, address: string, region: string) => void;
  cloudSyncStatus?: 'syncing' | 'connected' | 'offline';
  pendingSyncCount?: number;
  onTriggerSync?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  viewMode,
  onViewModeChange,
  onOpenNewDiary,
  onExportData,
  totalDiariesCount,
  totalViewsCount,
  visitorLogsCount = 0,
  onOpenVisitorModal,
  onQuickLocate,
  cloudSyncStatus = 'connected',
  pendingSyncCount = 0,
  onTriggerSync,
}) => {
  const { t } = useLanguage();
  const { isAdmin, currentUser, openLoginModal, logout } = useAuth();
  const [gpsLoading, setGpsLoading] = useState(false);
  const [currentGpsInfo, setCurrentGpsInfo] = useState<{ region: string; address: string } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const handleFetchCurrentGps = async () => {
    setGpsLoading(true);
    setGpsError(null);
    try {
      const pos = await getCurrentGpsPosition();
      const info = await reverseGeocode(pos.lat, pos.lng);
      setCurrentGpsInfo({
        region: info.region,
        address: info.address,
      });
      if (onQuickLocate) {
        onQuickLocate(pos.lat, pos.lng, info.address, info.region);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '위치를 확인할 수 없습니다.';
      setGpsError(msg);
      setTimeout(() => setGpsError(null), 4000);
    } finally {
      setGpsLoading(false);
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-stone-900/95 text-stone-100 backdrop-blur-md border-b border-stone-800 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-18">
          {/* Logo & Blog Identity */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-600 to-amber-800 flex items-center justify-center shadow-lg shadow-amber-900/30 text-amber-100">
              <Compass className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-1.5">
                  {t('appTitle')}
                </h1>
              </div>
              <p className="text-xs text-stone-400 hidden sm:block">
                {t('appSubtitle')}
              </p>
            </div>
          </div>

          {/* Real-time GPS Tracker & Language Selector */}
          <div className="flex items-center gap-2">
            {/* GPS Tracker (shown on md and up) */}
            <div className="hidden md:flex items-center gap-2">
              {currentGpsInfo ? (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-950/60 border border-emerald-500/40 text-xs text-emerald-300 shadow-inner">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                </div>
              ) : (
                <button
                  id="btn-fetch-current-gps"
                  type="button"
                  onClick={handleFetchCurrentGps}
                  disabled={gpsLoading}
                  className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-stone-800 hover:bg-stone-700/80 border border-stone-700 text-xs text-stone-300 hover:text-white transition-all duration-200 active:scale-95"
                  title={t('gpsCheck')}
                >
                  {gpsLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                  ) : (
                    <Navigation className="w-3.5 h-3.5 text-amber-400" />
                  )}
                </button>
              )}

              {gpsError && (
                <span className="text-xs text-rose-400 bg-rose-950/60 px-2 py-1 rounded border border-rose-800">
                  {gpsError}
                </span>
              )}
            </div>

            {/* Cloud Sync Status Indicator */}
            <div className="flex items-center">
              {pendingSyncCount > 0 ? (
                <button
                  id="btn-sync-pending-queue"
                  type="button"
                  onClick={onTriggerSync}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-950/80 hover:bg-amber-900/90 border border-amber-500/60 text-[11px] text-amber-300 transition shadow-sm cursor-pointer animate-pulse"
                  title={`오프라인 대기열에 ${pendingSyncCount}개의 일기가 있습니다. 인터넷 연결 시 자동으로 동기화되며, 클릭하여 즉시 동기화를 시도할 수 있습니다.`}
                >
                  <CloudOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="font-semibold">{pendingSyncCount}개 대기 중</span>
                </button>
              ) : cloudSyncStatus === 'connected' ? (
                <div 
                  className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-stone-800/90 border border-stone-700/80 text-[11px] text-stone-300 shadow-sm"
                  title="Firebase 클라우드 연동됨 - 모든 기기에서 동일하게 자동 동기화됩니다"
                >
                  <Cloud className="w-3.5 h-3.5 text-sky-400" />
                </div>
              ) : cloudSyncStatus === 'syncing' ? (
                <div 
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-stone-800/90 border border-stone-700/80 text-[11px] text-amber-300 shadow-sm"
                  title="클라우드 동기화 진행 중"
                >
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                  <span className="text-[10px] hidden sm:inline">동기화 중...</span>
                </div>
              ) : (
                <div 
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-stone-800/90 border border-stone-700/80 text-[11px] text-stone-400 shadow-sm"
                  title="오프라인 모드: 작성/수정/삭제한 내용은 로컬에 안전하게 보관되며 온라인 연결 시 자동 동기화됩니다."
                >
                  <CloudOff className="w-3.5 h-3.5 text-stone-400" />
                  <span className="text-[10px] text-stone-400 hidden sm:inline">오프라인</span>
                </div>
              )}
            </div>

            {/* Language Selector: Positioned directly next to the Real-time GPS button */}
            <LanguageSelector />
          </div>

          {/* Action Buttons: Login / Auth status and Write Button */}
          <div className="flex items-center gap-2 sm:gap-2.5">
            {/* Login / Auth Chip */}
            {currentUser ? (
              <div className="flex items-center gap-1.5 bg-stone-800/90 border border-stone-700/90 pl-2.5 pr-1 py-1 rounded-xl text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-stone-300 font-medium hidden md:inline max-w-[90px] truncate" title={currentUser.email}>
                    {currentUser.displayName}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold">
                    관리자
                  </span>
                </div>
                <button
                  id="btn-navbar-logout"
                  type="button"
                  onClick={logout}
                  className="p-1 text-stone-400 hover:text-rose-300 hover:bg-stone-700/80 rounded-lg transition"
                  title="로그아웃"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                id="btn-navbar-login"
                type="button"
                onClick={() => openLoginModal()}
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 hover:text-white text-xs font-medium border border-stone-700 transition"
                title="관리자 로그인 (일기 추가/수정/삭제 권한)"
              >
                <Lock className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">로그인</span>
              </button>
            )}

            <button
              id="btn-export-backup"
              type="button"
              onClick={onExportData}
              className="p-2 rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition"
              title={t('exportBackup')}
            >
              <Download className="w-4 h-4" />
            </button>

            <button
              id="btn-new-diary-modal"
              type="button"
              onClick={() => {
                if (isAdmin) {
                  onOpenNewDiary();
                } else {
                  openLoginModal('새 일기 작성은 관리자만 가능합니다. 로그인해주세요.');
                }
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold shadow-md active:scale-95 transition-all duration-150 ${
                isAdmin
                  ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-900/40'
                  : 'bg-stone-800 hover:bg-stone-700 text-stone-300 border border-stone-700'
              }`}
              title={isAdmin ? '새 일기 쓰기' : '새 일기 쓰기 (관리자 로그인 필요)'}
            >
              <Plus className="w-4 h-4 text-amber-400" />
              <span className="hidden sm:inline">{isAdmin ? '일기 쓰기' : '일기쓰기'}</span>
            </button>
          </div>
        </div>

        {/* View Switcher Sub-bar */}
        <div className="flex items-center justify-between pb-3 pt-1 border-t border-stone-800/60 overflow-x-auto gap-2">
          <nav className="flex items-center gap-1 sm:gap-2">
            <button
              id="nav-view-blog"
              type="button"
              onClick={() => onViewModeChange('blog')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition ${
                viewMode === 'blog'
                  ? 'bg-amber-600/20 text-amber-300 border border-amber-500/30 font-semibold'
                  : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800/50'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              <span>{t('tabBlog')}</span>
              <span className="text-xs px-1.5 py-0.2 rounded-full bg-stone-800 text-stone-400">
                {totalDiariesCount}
              </span>
            </button>

            <button
              id="nav-view-map"
              type="button"
              onClick={() => onViewModeChange('map')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition ${
                viewMode === 'map'
                  ? 'bg-amber-600/20 text-amber-300 border border-amber-500/30 font-semibold'
                  : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800/50'
              }`}
            >
              <MapIcon className="w-4 h-4" />
              <span>{t('tabMap')}</span>
            </button>

            {/* Total Visitor Reads & Location Indicator (Admin Only) */}
            {isAdmin && (
              <button
                type="button"
                onClick={onOpenVisitorModal}
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-stone-800/80 hover:bg-sky-950/60 border border-stone-700/80 hover:border-sky-500/50 text-xs text-stone-300 hover:text-sky-300 ml-2 transition cursor-pointer"
                title="방문자 위치 현황 및 접속 통계 열기"
              >
                <Eye className="w-3.5 h-3.5 text-sky-400" />
                <span className="font-semibold text-sky-300 font-mono">
                  {(totalViewsCount || 0).toLocaleString()}
                </span>
                <span className="text-stone-400 text-[11px]">
                  {t('diaryViewLabel')}
                </span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-300 font-semibold border border-sky-500/30">
                  위치확인
                </span>
              </button>
            )}
          </nav>

          {/* Mobile GPS Trigger button */}
          <div className="md:hidden flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleFetchCurrentGps}
              disabled={gpsLoading}
              className="flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-stone-800 text-amber-400 border border-stone-700"
            >
              {gpsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Navigation className="w-3 h-3" />}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};

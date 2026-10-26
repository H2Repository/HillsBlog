import React, { useState, useEffect, useRef } from 'react';
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
  Lock,
  LogOut,
  ShieldCheck,
  Eye,
  Menu,
  X
} from 'lucide-react';
import { getCurrentGpsPosition, reverseGeocode } from '../utils/geo';
import { useLanguage } from '../context/LanguageContext';
import { LanguageSelector } from './LanguageSelector';
import { useAuth } from '../context/AuthContext';
import { FlutterIcon } from './FlutterIcon';

interface NavbarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onOpenNewDiary: () => void;
  onExportData: () => void;
  totalDiariesCount: number;
  totalViewsCount?: number;
  visitorLogsCount?: number;
  onOpenVisitorModal?: () => void;
  onOpenFlutterCode: () => void;
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
  onOpenFlutterCode,
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
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close hamburger menu when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMenuOpen]);

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
            <div className="w-10 h-10 rounded-xl overflow-hidden shadow-lg shadow-amber-900/30 shrink-0 border border-amber-500/30 bg-stone-800 flex items-center justify-center">
              <img 
                src="/icon.png" 
                alt="App Icon" 
                className="w-full h-full object-cover" 
              />
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

            {/* Language Selector */}
            <LanguageSelector />
          </div>

          {/* Action Buttons: New Diary & Hamburger Menu */}
          <div className="flex items-center gap-2 sm:gap-2.5">
            {/* New Diary Write Button */}
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
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold shadow-md active:scale-95 transition-all duration-150 cursor-pointer ${
                isAdmin
                  ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-900/40'
                  : 'bg-stone-800 hover:bg-stone-700 text-stone-300 border border-stone-700'
              }`}
              title={isAdmin ? '새 일기 쓰기' : '새 일기 쓰기 (관리자 로그인 필요)'}
            >
              <Plus className="w-4 h-4 text-amber-400" />
              <span className="hidden sm:inline">{isAdmin ? '일기 쓰기' : '일기쓰기'}</span>
            </button>

            {/* Hamburger Menu Area */}
            <div className="relative" ref={menuRef}>
              <button
                id="btn-hamburger-menu"
                type="button"
                onClick={() => setIsMenuOpen((prev) => !prev)}
                className={`relative p-2 rounded-xl border transition-all duration-150 flex items-center justify-center cursor-pointer ${
                  isMenuOpen
                    ? 'bg-amber-600/20 border-amber-500/40 text-amber-300 shadow-inner'
                    : 'bg-stone-800 hover:bg-stone-700 text-stone-300 hover:text-white border-stone-700'
                }`}
                title="더보기 메뉴 (Flutter 다운로드, 백업, 관리자 로그온)"
                aria-expanded={isMenuOpen}
                aria-label="메뉴 열기"
              >
                {isMenuOpen ? (
                  <X className="w-5 h-5 text-amber-400" />
                ) : (
                  <Menu className="w-5 h-5" />
                )}
                {/* Admin indicator dot on hamburger icon */}
                {currentUser && (
                  <span 
                    className="absolute top-1 right-1 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-stone-900" 
                    title="관리자 로그인 상태"
                  />
                )}
              </button>

              {/* Hamburger Dropdown Menu Modal */}
              {isMenuOpen && (
                <div className="absolute right-0 top-full mt-2 w-72 sm:w-80 rounded-2xl bg-stone-900/98 border border-stone-700/90 shadow-2xl backdrop-blur-xl p-3 z-50 text-stone-200">
                  {/* Menu Title Header */}
                  <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-stone-800">
                    <span className="text-xs font-bold text-stone-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Compass className="w-3.5 h-3.5 text-amber-400" />
                      여행일기 메뉴
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsMenuOpen(false)}
                      className="p-1 rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition"
                      aria-label="메뉴 닫기"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* 1. 관리자 로그온 / 로그아웃 섹션 */}
                  <div className="p-3 rounded-xl bg-stone-800/90 border border-stone-700/80 mb-2.5 shadow-xs">
                    {currentUser ? (
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0 animate-pulse" />
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-white truncate">
                                {currentUser.displayName || '관리자'}
                              </p>
                              <p className="text-[10px] text-stone-400 truncate">
                                {currentUser.email}
                              </p>
                            </div>
                          </div>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold shrink-0 flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3 text-amber-400" />
                            관리자
                          </span>
                        </div>
                        <button
                          id="btn-menu-logout"
                          type="button"
                          onClick={() => {
                            logout();
                            setIsMenuOpen(false);
                          }}
                          className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-stone-700/70 hover:bg-rose-950/60 hover:text-rose-300 text-stone-300 text-xs font-semibold border border-stone-600/80 transition cursor-pointer"
                        >
                          <LogOut className="w-3.5 h-3.5 text-rose-400" />
                          <span>관리자 로그아웃</span>
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white flex items-center gap-1.5">
                            <Lock className="w-3.5 h-3.5 text-amber-400" />
                            관리자 모드
                          </span>
                          <span className="text-[10px] text-stone-400 bg-stone-700/50 px-2 py-0.5 rounded-full">
                            읽기 전용
                          </span>
                        </div>
                        <p className="text-[11px] text-stone-400 leading-snug">
                          일기 작성, 수정, 삭제 및 관리자 기능을 사용하려면 로그인하세요.
                        </p>
                        <button
                          id="btn-menu-login"
                          type="button"
                          onClick={() => {
                            setIsMenuOpen(false);
                            openLoginModal();
                          }}
                          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shadow-md shadow-amber-900/30 transition cursor-pointer"
                        >
                          <Lock className="w-3.5 h-3.5" />
                          <span>관리자 로그온</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 2. Menu Action Items List */}
                  <div className="space-y-1">
                    {/* 관리자 전용: 클라우드 데이터 동기화 */}
                    {isAdmin && (
                      <button
                        id="btn-menu-cloud-sync"
                        type="button"
                        onClick={() => {
                          setIsMenuOpen(false);
                          if (onTriggerSync) onTriggerSync();
                        }}
                        className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-stone-800 text-left transition group cursor-pointer border border-transparent hover:border-stone-700"
                      >
                        <div className="w-8 h-8 rounded-lg bg-stone-800 group-hover:bg-sky-600/20 flex items-center justify-center text-sky-400 border border-stone-700 group-hover:border-sky-500/40 transition shrink-0">
                          <Cloud className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-white group-hover:text-sky-300 transition">
                            클라우드 데이터 동기화
                          </p>
                          <p className="text-[11px] text-stone-400 truncate">
                            서버의 최신 일기 및 수정 내용 즉시 동기화
                          </p>
                        </div>
                      </button>
                    )}

                    {/* 관리자 전용: 클라우드 동기화 새로고침 */}
                    {isAdmin && onTriggerSync && (
                      <button
                        id="btn-menu-trigger-sync"
                        type="button"
                        onClick={() => {
                          setIsMenuOpen(false);
                          onTriggerSync();
                        }}
                        className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-stone-800 text-left transition group cursor-pointer border border-transparent hover:border-stone-700"
                      >
                        <div className="w-8 h-8 rounded-lg bg-stone-800 group-hover:bg-sky-600/20 flex items-center justify-center text-sky-400 border border-stone-700 group-hover:border-sky-500/40 transition shrink-0">
                          {cloudSyncStatus === 'syncing' ? (
                            <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                          ) : (
                            <Cloud className="w-4 h-4" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-white group-hover:text-sky-300 transition">
                            클라우드 동기화 새로고침
                          </p>
                          <p className="text-[11px] text-stone-400 truncate">
                            서버 최신 일기 불러오기 및 로컬 동기화
                          </p>
                        </div>
                      </button>
                    )}

                    {/* 여행일기 백업 다운로드(JSON) */}
                    <button
                      id="btn-menu-export-backup"
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        onExportData();
                      }}
                      className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-stone-800 text-left transition group cursor-pointer border border-transparent hover:border-stone-700"
                    >
                      <div className="w-8 h-8 rounded-lg bg-stone-800 group-hover:bg-amber-600/20 flex items-center justify-center text-amber-400 border border-stone-700 group-hover:border-amber-500/40 transition shrink-0">
                        <Download className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-white group-hover:text-amber-300 transition">
                          여행일기 백업 다운로드 (JSON)
                        </p>
                        <p className="text-[11px] text-stone-400 truncate">
                          전체 여행일기 데이터를 JSON 파일로 내보내기
                        </p>
                      </div>
                    </button>

                    {/* 관리자 전용: Flutter 모바일 앱 다운로드 */}
                    {isAdmin && (
                      <button
                        id="btn-menu-flutter-download"
                        type="button"
                        onClick={() => {
                          setIsMenuOpen(false);
                          onOpenFlutterCode();
                        }}
                        className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-stone-800 text-left transition group cursor-pointer border border-transparent hover:border-stone-700"
                      >
                        <div className="w-8 h-8 rounded-lg bg-stone-800 group-hover:bg-sky-600/20 flex items-center justify-center text-sky-400 border border-stone-700 group-hover:border-sky-500/40 transition shrink-0">
                          <FlutterIcon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-white group-hover:text-sky-300 transition">
                            Flutter 모바일 앱 다운로드
                          </p>
                          <p className="text-[11px] text-stone-400 truncate">
                            Android / iOS 네이티브 앱 소스 및 설치 안내
                          </p>
                        </div>
                      </button>
                    )}

                    {/* Admin-only: Visitor Location Modal trigger */}
                    {isAdmin && onOpenVisitorModal && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsMenuOpen(false);
                          onOpenVisitorModal();
                        }}
                        className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-stone-800 text-left transition group cursor-pointer border border-transparent hover:border-stone-700"
                      >
                        <div className="w-8 h-8 rounded-lg bg-stone-800 group-hover:bg-emerald-600/20 flex items-center justify-center text-emerald-400 border border-stone-700 group-hover:border-emerald-500/40 transition shrink-0">
                          <Eye className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-white group-hover:text-emerald-300 transition">
                            방문자 통계 및 접속 위치
                          </p>
                          <p className="text-[11px] text-stone-400 truncate">
                            총 {(totalViewsCount || 0).toLocaleString()}회 조회 / 접속 지역 지도
                          </p>
                        </div>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
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

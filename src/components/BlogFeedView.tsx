import React, { useState, useMemo, useEffect } from 'react';
import { DiaryEntry } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { getLocalizedDiary } from '../utils/translationService';
import { useTranslationVersion } from '../utils/translationService';
import { 
  Search, 
  MapPin, 
  Calendar, 
  Clock, 
  Camera, 
  Star, 
  Sun, 
  Cloud, 
  CloudRain, 
  Snowflake, 
  Wind, 
  Compass, 
  ArrowRight, 
  Sparkles, 
  Edit3, 
  Trash2, 
  Share2,
  Plus,
  Lock,
  Eye,
  Users,
  ChevronDown,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  RotateCcw
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const INITIAL_VISIBLE_COUNT = 4;
const PAGE_SIZE = 4;

interface BlogFeedViewProps {
  diaries: DiaryEntry[];
  onSelectDiary: (diary: DiaryEntry) => void;
  onEditDiary: (diary: DiaryEntry) => void;
  onDeleteDiary: (diary: DiaryEntry) => void;
  onViewOnMap: (diary: DiaryEntry) => void;
  onOpenNewDiary: () => void;
  onResetAllViews?: () => void;
  onOpenVisitorModal?: () => void;
}

export const BlogFeedView: React.FC<BlogFeedViewProps> = ({
  diaries,
  onSelectDiary,
  onEditDiary,
  onDeleteDiary,
  onViewOnMap,
  onOpenNewDiary,
  onResetAllViews,
  onOpenVisitorModal,
}) => {
  const { t, language } = useLanguage();
  const { isAdmin, openLoginModal } = useAuth();
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');

  const translationVersion = useTranslationVersion();

  // Localize diaries according to active language
  const localizedDiaries = useMemo(() => {
    return diaries.map((d) => getLocalizedDiary(d, language));
  }, [diaries, language, translationVersion]);

  // Total visitor reads count across all diaries
  const totalViews = useMemo(() => {
    return diaries.reduce((acc, d) => acc + (d.views || 0), 0);
  }, [diaries]);

  // Sort diaries (strictly newest travel date/time first by default)
  const sortedDiaries = useMemo(() => {
    return [...localizedDiaries].sort((a, b) => {
      const dateTimeA = `${a.date || ''} ${a.time || ''}`.trim();
      const dateTimeB = `${b.date || ''} ${b.time || ''}`.trim();

      if (dateTimeA && dateTimeB && dateTimeA !== dateTimeB) {
        return sortOrder === 'newest'
          ? dateTimeB.localeCompare(dateTimeA)
          : dateTimeA.localeCompare(dateTimeB);
      }

      const createdA = a.createdAt || 0;
      const createdB = b.createdAt || 0;
      if (createdA !== createdB) {
        return sortOrder === 'newest' ? createdB - createdA : createdA - createdB;
      }

      const updatedA = a.updatedAt || 0;
      const updatedB = b.updatedAt || 0;
      return sortOrder === 'newest' ? updatedB - updatedA : updatedA - updatedB;
    });
  }, [localizedDiaries, sortOrder]);

  // Visible diaries count (initially 4, increments by 4 on '다음보기')
  const [visibleCount, setVisibleCount] = useState<number>(INITIAL_VISIBLE_COUNT);

  // Reset pagination back to 4 whenever sort order changes
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_COUNT);
  }, [sortOrder]);

  // Paginated slice of diaries to display
  const displayedDiaries = useMemo(() => {
    return sortedDiaries.slice(0, visibleCount);
  }, [sortedDiaries, visibleCount]);

  const weatherIcons: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
    sunny: { label: t('editorWeatherSunny'), icon: Sun },
    cloudy: { label: t('editorWeatherCloudy'), icon: Cloud },
    rainy: { label: t('editorWeatherRainy'), icon: CloudRain },
    snowy: { label: 'Snow', icon: Snowflake },
    windy: { label: t('editorWeatherWindy'), icon: Wind },
    foggy: { label: 'Fog', icon: Cloud },
  };

  return (
    <div className="space-y-6">
      {/* Blog Feed Header Bar (Sort & Stats) */}
      <div className="bg-white rounded-xl p-3 border border-stone-200/90 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-stone-700">
            {t('totalDiaries', { count: sortedDiaries.length })}
          </span>
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto justify-between sm:justify-end">
          {/* Sort Order Selector (Newest First / Oldest First) with Icons */}
          <div className="inline-flex items-center gap-0.5 bg-stone-100 p-0.5 rounded-lg border border-stone-200 text-xs">
            <button
              type="button"
              onClick={() => setSortOrder('newest')}
              className={`p-1.5 rounded transition cursor-pointer flex items-center justify-center ${
                sortOrder === 'newest'
                  ? 'bg-white text-stone-900 shadow-2xs font-bold'
                  : 'text-stone-500 hover:text-stone-800'
              }`}
              title="최신순 (최신 일기부터 정렬)"
              aria-label="최신순 정렬"
            >
              <ArrowDownWideNarrow className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setSortOrder('oldest')}
              className={`p-1.5 rounded transition cursor-pointer flex items-center justify-center ${
                sortOrder === 'oldest'
                  ? 'bg-white text-stone-900 shadow-2xs font-bold'
                  : 'text-stone-500 hover:text-stone-800'
              }`}
              title="오래된순 (과거 일기부터 정렬)"
              aria-label="오래된순 정렬"
            >
              <ArrowUpNarrowWide className="w-3.5 h-3.5" />
            </button>
          </div>

          {isAdmin && (
            <>
              <span className="text-stone-300">•</span>
              <span 
                className="flex items-center gap-1.5 text-xs text-amber-800 font-medium whitespace-nowrap bg-amber-50/90 px-2.5 py-1 rounded-lg border border-amber-200/80 shadow-2xs"
                title={t('totalVisitorsReads')}
              >
                <Eye className="w-3.5 h-3.5 text-amber-600" />
                <span className="hidden">{t('totalVisitorsReads')}: {totalViews.toLocaleString()}</span>
                
                {onOpenVisitorModal && (
                  <button
                    type="button"
                    onClick={onOpenVisitorModal}
                    className="ml-1 px-1.5 py-0.5 rounded bg-sky-100 hover:bg-sky-200 text-sky-800 text-[10px] font-bold flex items-center gap-1 transition cursor-pointer"
                    title="방문자 위치 지도 및 통계 보기"
                  >
                    <MapPin className="w-2.5 h-2.5 text-sky-600" />
                    <span className="hidden">위치확인</span>
                  </button>
                )}

                {onResetAllViews && (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm('방문자 카운터를 모두 0으로 초기화하시겠습니까?')) {
                        onResetAllViews();
                      }
                    }}
                    className="ml-1 p-0.5 text-amber-600 hover:text-rose-600 hover:bg-amber-100/80 rounded transition cursor-pointer"
                    title="방문자 수 0으로 초기화"
                    aria-label="방문자 수 0으로 초기화"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                )}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Diary Feed List */}
      {sortedDiaries.length > 0 ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {displayedDiaries.map((diary) => {
            const coverPhoto = diary.photos.find((p) => p.isCover) || diary.photos[0];
            const WeatherIcon = weatherIcons[diary.weather]?.icon || Sun;

            return (
              <article
                key={diary.id}
                className="group bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-sm hover:shadow-md transition-all duration-300 flex flex-col"
              >
                {/* Cover Image Container */}
                {coverPhoto && (
                  <div
                    className="relative h-60 w-full overflow-hidden bg-stone-100 cursor-pointer"
                    onClick={() => onSelectDiary(diary)}
                  >
                    <img
                      src={coverPhoto.url}
                      alt={diary.title}
                      className="w-full h-full object-cover group-hover:scale-103 transition-transform duration-500"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-stone-950/60 via-transparent to-transparent opacity-80" />

                    {/* Photo Count Pill */}
                    {diary.photos.length > 1 && (
                      <span className="absolute top-3 right-3 bg-stone-900/80 backdrop-blur-sm text-white text-[11px] font-semibold px-2.5 py-1 rounded-full flex items-center gap-1 border border-white/20">
                        <Camera className="w-3 h-3" />
                        <span>+{diary.photos.length}</span>
                      </span>
                    )}

                    {/* Real-time GPS verification pill */}
                    {diary.location.isRealtimeGps && (
                      <span className="absolute top-3 left-3 bg-emerald-950/80 backdrop-blur-sm text-emerald-300 text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 border border-emerald-500/30">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        <span>{t('realtimeGpsLinked')}</span>
                      </span>
                    )}

                    {/* Region on Cover */}
                    <div className="absolute bottom-3 left-4 right-4 flex items-center justify-between text-white">
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-black/40 backdrop-blur-sm border border-white/20 flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-amber-400" />
                        {diary.location.region}
                      </span>
                      <span className="text-xs text-stone-300">
                        {diary.date}
                      </span>
                    </div>
                  </div>
                )}

                {/* Content Section */}
                <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                  <div>
                    {/* Top Row: Meta info */}
                    <div className="flex items-center justify-between text-xs text-stone-500 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1">
                          <WeatherIcon className="w-3.5 h-3.5 text-amber-600" />
                          <span>{weatherIcons[diary.weather]?.label}</span>
                        </span>
                        <span>•</span>
                        <span>{diary.time}</span>
                        {isAdmin && (
                          <>
                            <span>•</span>
                            <span 
                              className="flex items-center gap-1 text-stone-600 font-medium bg-stone-100 px-2 py-0.5 rounded-full"
                              title={t('diaryReadersCount', { count: (diary.views || 0).toLocaleString() })}
                            >
                              <Eye className="w-3.5 h-3.5 text-amber-600" />
                              <span>{(diary.views || 0).toLocaleString()}</span>
                            </span>
                          </>
                        )}
                      </div>

                      <div className="flex items-center">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <Star
                            key={s}
                            className={`w-3 h-3 ${
                              s <= diary.rating
                                ? 'text-amber-500 fill-amber-500'
                                : 'text-stone-300'
                            }`}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Title */}
                    <h2
                      onClick={() => {
                        const original = diaries.find(item => item.id === diary.id) || diary;
                        onSelectDiary(original);
                      }}
                      className="text-lg font-bold text-stone-900 group-hover:text-amber-700 transition cursor-pointer leading-snug line-clamp-2 mb-2"
                    >
                      {diary.title}
                    </h2>

                    {/* Content Snippet */}
                    <p
                      onClick={() => {
                        const original = diaries.find(item => item.id === diary.id) || diary;
                        onSelectDiary(original);
                      }}
                      className="text-xs text-stone-600 line-clamp-3 leading-relaxed font-serif cursor-pointer"
                    >
                      {diary.content}
                    </p>
                  </div>

                  {/* Regional Insights Highlight Pill */}
                  <div className="bg-amber-50/70 border border-amber-200/60 rounded-xl p-2.5 text-xs text-stone-700">
                    <div className="flex items-center gap-1.5 text-amber-800 font-bold text-[11px] mb-1">
                      <Sparkles className="w-3 h-3 text-amber-600" />
                      <span>{t('detailCourseInfo')}</span>
                    </div>
                    <p className="line-clamp-1 text-[11px] text-stone-600">
                      💡 {diary.localInsights.recommendedForSolo}
                    </p>
                  </div>

                  {/* Tags */}
                  {diary.moodTags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {diary.moodTags.slice(0, 4).map((tag) => (
                        <span
                          key={tag}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-stone-100 text-stone-600"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Card Actions Footer */}
                  <div className="pt-3 border-t border-stone-100 flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          const original = diaries.find(item => item.id === diary.id) || diary;
                          onViewOnMap(original);
                        }}
                        className="text-xs font-semibold text-amber-700 hover:text-amber-800 px-2 py-1 rounded hover:bg-amber-50 transition flex items-center gap-1"
                        title={t('cardViewOnMap')}
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        <span>{t('cardViewOnMap')}</span>
                      </button>

                      {/* Admin-only Actions: Edit & Delete */}
                      {isAdmin && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              const original = diaries.find(item => item.id === diary.id) || diary;
                              onEditDiary(original);
                            }}
                            className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded transition"
                            title={t('cardEdit')}
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const original = diaries.find(item => item.id === diary.id) || diary;
                              onDeleteDiary(original);
                            }}
                            className="p-1.5 text-stone-400 hover:text-rose-600 hover:bg-rose-50 rounded transition"
                            title={t('cardDelete')}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        const original = diaries.find(item => item.id === diary.id) || diary;
                        onSelectDiary(original);
                      }}
                      className="text-xs font-bold text-stone-900 group-hover:text-amber-600 flex items-center gap-1 transition"
                    >
                      <span>
                        {t('readFullStory')}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {/* Load More (다음보기) Button & Icon */}
        {sortedDiaries.length > visibleCount && (
          <div className="flex flex-col items-center justify-center pt-4 pb-2">
            <button
              id="btn-load-more-diaries"
              type="button"
              onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
              className="group inline-flex items-center gap-2.5 px-6 py-3.5 rounded-2xl bg-white hover:bg-amber-50 text-stone-900 hover:text-amber-800 font-bold text-xs sm:text-sm border border-stone-200 hover:border-amber-300 shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer active:scale-95"
            >
              <span>다음 일기 더보기</span>
              <div className="w-6 h-6 rounded-full bg-amber-100 group-hover:bg-amber-200 text-amber-800 flex items-center justify-center transition-transform duration-200 group-hover:translate-y-0.5">
                <ChevronDown className="w-4 h-4" />
              </div>
            </button>
            <p className="text-[11px] text-stone-400 mt-2 font-medium">
              {t('showingDiariesCount', { current: displayedDiaries.length, total: sortedDiaries.length })}
            </p>
          </div>
        )}

        {sortedDiaries.length > INITIAL_VISIBLE_COUNT && visibleCount >= sortedDiaries.length && (
          <div className="text-center py-2 text-xs text-stone-400 font-medium">
            ✓ {t('allDiariesLoaded')}
          </div>
        )}
      </div>
      ) : (
        /* Empty State */
        <div className="bg-white rounded-2xl border border-dashed border-stone-300 p-12 text-center max-w-lg mx-auto space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto">
            <Compass className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-stone-900">
              {t('noDiariesFound')}
            </h3>
            <p className="text-xs text-stone-500 mt-1">
              {t('noDiariesGuide')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (isAdmin) {
                onOpenNewDiary();
              } else {
                openLoginModal('새 일기 작성은 관리자만 가능합니다. 로그인해주세요.');
              }
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-md transition cursor-pointer"
          >
            {isAdmin ? <Plus className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
            <span>{isAdmin ? t('btnNewDiaryFirst') : '관리자 로그인 후 작성'}</span>
          </button>
        </div>
      )}
    </div>
  );
};

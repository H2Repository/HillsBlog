import React, { useState, useMemo } from 'react';
import { DiaryEntry } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { getLocalizedDiary } from '../utils/translationService';
import { useTranslationVersion } from '../utils/translationService';
import { calculateDistanceKm } from '../utils/geo';
import { 
  MapPin, 
  Calendar, 
  Clock, 
  ArrowDown, 
  ArrowUp, 
  Compass, 
  Camera, 
  Route, 
  ChevronRight,
  Sparkles,
  Eye
} from 'lucide-react';

interface TimelineViewProps {
  diaries: DiaryEntry[];
  onSelectDiary: (diary: DiaryEntry) => void;
  onViewOnMap: (diary: DiaryEntry) => void;
}

export const TimelineView: React.FC<TimelineViewProps> = ({
  diaries,
  onSelectDiary,
  onViewOnMap,
}) => {
  const { t, language } = useLanguage();
  const { isAdmin } = useAuth();
  const [ascending, setAscending] = useState(true);
  const translationVersion = useTranslationVersion();

  // Localize diaries
  const localizedDiaries = useMemo(() => {
    return diaries.map((d) => getLocalizedDiary(d, language));
  }, [diaries, language, translationVersion]);

  // Sort chronological
  const sorted = useMemo(() => {
    return [...localizedDiaries].sort((a, b) => {
      const timeA = new Date(`${a.date}T${a.time}`).getTime();
      const timeB = new Date(`${b.date}T${b.time}`).getTime();
      return ascending ? timeA - timeB : timeB - timeA;
    });
  }, [localizedDiaries, ascending]);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header Bar */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-stone-200 shadow-sm flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-stone-900 flex items-center gap-2">
            <Compass className="w-5 h-5 text-amber-600" />
            <span>{t('timelineTitle')}</span>
          </h2>
          <p className="text-xs text-stone-500">
            {t('timelineSubtitle')}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setAscending(!ascending)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-semibold transition"
        >
          {ascending ? (
            <>
              <ArrowDown className="w-3.5 h-3.5" />
              <span>{t('timelineAsc')}</span>
            </>
          ) : (
            <>
              <ArrowUp className="w-3.5 h-3.5" />
              <span>{t('timelineDesc')}</span>
            </>
          )}
        </button>
      </div>

      {/* Timeline List */}
      <div className="relative pl-6 sm:pl-8 space-y-8 before:absolute before:left-3 sm:before:left-4 before:top-4 before:bottom-4 before:w-0.5 before:bg-amber-300">
        {sorted.map((diary, idx) => {
          const coverPhoto = diary.photos.find(p => p.isCover) || diary.photos[0];
          const isIncluded = (diary.location?.includeInDistance ?? diary.includeInDistance ?? true) !== false;
          let distFromPrev: number | null = null;

          if (idx > 0 && isIncluded) {
            // Find closest previous stop that is also included in cumulative distance
            for (let pIdx = idx - 1; pIdx >= 0; pIdx--) {
              const pDiary = sorted[pIdx];
              if ((pDiary.location?.includeInDistance ?? pDiary.includeInDistance ?? true) !== false) {
                distFromPrev = calculateDistanceKm(
                  pDiary.location.lat,
                  pDiary.location.lng,
                  diary.location.lat,
                  diary.location.lng
                );
                break;
              }
            }
          }

          const originalDiary = diaries.find(item => item.id === diary.id) || diary;

          return (
            <div key={diary.id} className="relative group">
              {/* Timeline Pin Marker on the line */}
              <div className="absolute -left-6 sm:-left-8 top-1.5 w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-amber-600 border-2 border-white shadow-md text-white flex items-center justify-center text-[10px] sm:text-xs font-bold ring-4 ring-amber-100">
                {ascending ? idx + 1 : sorted.length - idx}
              </div>

              {/* Distance from previous stop badge or Excluded indicator */}
              {!isIncluded ? (
                <div className="mb-3 -mt-4 inline-flex items-center gap-1.5 text-[11px] font-semibold text-stone-600 bg-stone-100 border border-stone-300 px-2.5 py-0.5 rounded-full shadow-xs">
                  <span>📍 누적 주행거리 제외 위치</span>
                </div>
              ) : distFromPrev !== null && distFromPrev > 0 ? (
                <div className="mb-3 -mt-4 inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-800 bg-amber-50/90 border border-amber-200 px-2.5 py-0.5 rounded-full shadow-xs">
                  <Route className="w-3 h-3" />
                  <span>{t('timelineMovedDist', { dist: distFromPrev })}</span>
                </div>
              ) : null}

              {/* Card */}
              <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-xs hover:shadow-md transition duration-200">
                <div className="p-4 sm:p-5 flex flex-col sm:flex-row gap-4">
                  {/* Photo Thumbnail */}
                  {coverPhoto && (
                    <div
                      className="w-full sm:w-44 h-36 sm:h-32 rounded-xl overflow-hidden bg-stone-100 shrink-0 cursor-pointer relative"
                      onClick={() => onSelectDiary(originalDiary)}
                    >
                      <img
                        src={coverPhoto.url}
                        alt=""
                        className="w-full h-full object-cover group-hover:scale-103 transition duration-300"
                      />
                      {diary.photos.length > 1 && (
                        <span className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded backdrop-blur">
                          +{diary.photos.length}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Content Info */}
                  <div className="flex-1 min-w-0 flex flex-col justify-between space-y-2">
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500 mb-1">
                        <span className="flex items-center gap-1 text-amber-700 font-bold bg-amber-50 px-2 py-0.5 rounded">
                          <MapPin className="w-3 h-3" />
                          {diary.location.region}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {diary.date} {diary.time}
                          </span>
                          {isAdmin && (
                            <span 
                              className="flex items-center gap-1 text-stone-600 font-medium bg-stone-100 px-1.5 py-0.5 rounded text-[11px]"
                              title={t('diaryReadersCount', { count: (diary.views || 0).toLocaleString() })}
                            >
                              <Eye className="w-3 h-3 text-amber-600" />
                              <span>{(diary.views || 0).toLocaleString()}</span>
                            </span>
                          )}
                        </div>
                      </div>

                      <h3
                        onClick={() => onSelectDiary(originalDiary)}
                        className="text-base font-bold text-stone-900 group-hover:text-amber-700 transition cursor-pointer"
                      >
                        {diary.title}
                      </h3>

                      <p
                        onClick={() => onSelectDiary(originalDiary)}
                        className="text-xs text-stone-600 line-clamp-2 mt-1 font-serif cursor-pointer leading-relaxed"
                      >
                        {diary.content}
                      </p>
                    </div>

                    {/* Regional Tip and Controls */}
                    <div className="pt-2 border-t border-stone-100 flex items-center justify-between text-xs">
                      <span className="text-[11px] text-stone-500 truncate max-w-[200px]">
                        📍 {diary.location.landmark || diary.location.address}
                      </span>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onViewOnMap(originalDiary)}
                          className="font-semibold text-amber-700 hover:text-amber-800"
                        >
                          {t('timelineViewOnMap')}
                        </button>
                        <button
                          type="button"
                          onClick={() => onSelectDiary(originalDiary)}
                          className="font-bold text-stone-900 hover:text-amber-600 flex items-center"
                        >
                          <span>{t('timelineReadMore')}</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

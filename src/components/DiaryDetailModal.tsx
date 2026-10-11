import React, { useState, useEffect, useRef } from 'react';
import { DiaryEntry } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { getLocalizedDiary } from '../utils/translationService';
import { hasKorean, translateDiaryAsync } from '../utils/translationService';
import L from 'leaflet';
import { 
  X, 
  MapPin, 
  Calendar, 
  Clock, 
  Star, 
  Sun, 
  Cloud, 
  CloudRain, 
  Snowflake, 
  Wind, 
  Share2, 
  Edit3, 
  Trash2, 
  ExternalLink,
  Sparkles, 
  Map as MapIcon, 
  Check, 
  Compass,
  Languages,
  Loader2,
  Eye,
  Users
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface DiaryDetailModalProps {
  diary: DiaryEntry | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit: (diary: DiaryEntry) => void;
  onDelete: (diary: DiaryEntry) => void;
  onViewOnMap: (diary: DiaryEntry) => void;
  onOpenPhotoLightbox: (photos: DiaryEntry['photos'], index: number) => void;
}

export const DiaryDetailModal: React.FC<DiaryDetailModalProps> = ({
  diary,
  isOpen,
  onClose,
  onEdit,
  onDelete,
  onViewOnMap,
  onOpenPhotoLightbox,
}) => {
  const { t, language } = useLanguage();
  const { isAdmin } = useAuth();
  const [copied, setCopied] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [asyncDiary, setAsyncDiary] = useState<DiaryEntry | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    setShowOriginal(false);
  }, [diary?.id, isOpen]);

  useEffect(() => {
    if (!isOpen || !diary || language === 'ko' || showOriginal) {
      setAsyncDiary(null);
      setIsTranslating(false);
      return;
    }

    // Immediate localized diary from curated DIARY_TRANSLATIONS, cache, or dictionary phrases/tags
    const localized = getLocalizedDiary(diary, language);
    setAsyncDiary(localized);

    // If still containing untranslated Korean text in title, content, or insights, run background translator
    const needsTranslation =
      hasKorean(localized.title) ||
      hasKorean(localized.content) ||
      hasKorean(localized.localInsights.recommendedForSolo) ||
      (localized.localInsights.localFood ? hasKorean(localized.localInsights.localFood) : false) ||
      (localized.localInsights.transportTip ? hasKorean(localized.localInsights.transportTip) : false) ||
      (localized.localInsights.soloTravelTip ? hasKorean(localized.localInsights.soloTravelTip) : false);

    if (needsTranslation) {
      setIsTranslating(true);
      let isCancelled = false;

      translateDiaryAsync(diary, language)
        .then((content) => {
          if (!isCancelled) {
            setAsyncDiary({
              ...diary,
              title: content.title,
              content: content.content,
              location: {
                ...diary.location,
                region: content.region || diary.location.region,
                landmark: content.landmark ?? diary.location.landmark,
                address: content.address ?? diary.location.address,
              },
              moodTags: content.moodTags,
              localInsights: {
                ...diary.localInsights,
                recommendedForSolo: content.recommendedForSolo,
                localFood: content.localFood ?? diary.localInsights.localFood,
                transportTip: content.transportTip ?? diary.localInsights.transportTip,
                soloTravelTip: content.soloTravelTip ?? diary.localInsights.soloTravelTip,
              },
            });
          }
        })
        .catch((err) => console.warn('Online translation error:', err))
        .finally(() => {
          if (!isCancelled) setIsTranslating(false);
        });

      return () => {
        isCancelled = true;
      };
    }
  }, [isOpen, diary, language, showOriginal]);

  useEffect(() => {
    if (!isOpen || !diary) return;

    const timer = setTimeout(() => {
      if (!mapContainerRef.current) return;

      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }

      const map = L.map(mapContainerRef.current, {
        center: [diary.location.lat, diary.location.lng],
        zoom: 14,
        zoomControl: false,
        attributionControl: false,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      const pinIcon = L.divIcon({
        className: 'detail-map-pin',
        html: `
          <div class="w-7 h-7 rounded-full bg-amber-600 border-2 border-white shadow-lg flex items-center justify-center text-white text-xs">
            📍
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 28],
      });

      L.marker([diary.location.lat, diary.location.lng], { icon: pinIcon }).addTo(map);
      mapInstanceRef.current = map;
    }, 150);

    return () => {
      clearTimeout(timer);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [isOpen, diary]);

  if (!isOpen || !diary) return null;

  // Localized diary representation according to language and toggle
  const displayDiary = (showOriginal || language === 'ko')
    ? diary
    : (asyncDiary || getLocalizedDiary(diary, language));

  const weatherIcons: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
    sunny: { label: t('editorWeatherSunny'), icon: Sun },
    cloudy: { label: t('editorWeatherCloudy'), icon: Cloud },
    rainy: { label: t('editorWeatherRainy'), icon: CloudRain },
    snowy: { label: 'Snow', icon: Snowflake },
    windy: { label: t('editorWeatherWindy'), icon: Wind },
    foggy: { label: 'Fog', icon: Cloud },
  };

  const WeatherIcon = weatherIcons[displayDiary.weather]?.icon || Sun;
  const coverPhoto = displayDiary.photos.find(p => p.isCover) || displayDiary.photos[0];

  const handleShare = () => {
    const text = `[${t('appTitle')}] ${displayDiary.title}\n📍 ${displayDiary.location.region} (${displayDiary.date})\n\n"${displayDiary.content.slice(0, 100)}..."`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-stone-950/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-stone-200 overflow-hidden my-8 max-h-[92vh] flex flex-col">
        {/* Header bar */}
        <div className="px-6 py-3.5 bg-stone-900 text-white flex items-center justify-between border-b border-stone-800">
          <div className="flex items-center gap-2">
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-semibold border border-amber-500/30">
              {displayDiary.location.region}
            </span>
            <span className="text-xs text-stone-400">
              {displayDiary.date} {displayDiary.time}
            </span>

            {/* Visitor Read Count Badge in Modal Header (Admin Only) */}
            {isAdmin && (
              <span 
                className="flex items-center gap-1.5 text-xs text-stone-300 bg-stone-800/90 border border-stone-700/80 px-2.5 py-0.5 rounded-full font-medium"
                title={t('diaryReadersCount', { count: (displayDiary.views || 0).toLocaleString() })}
              >
                <Eye className="w-3.5 h-3.5 text-amber-400" />
                <span>{t('diaryViewsCount', { count: (displayDiary.views || 0).toLocaleString() })}</span>
              </span>
            )}

            {/* Translation status badge and original toggle */}
            {language !== 'ko' && (
              <button
                type="button"
                onClick={() => setShowOriginal(!showOriginal)}
                className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/40 transition cursor-pointer"
                title={showOriginal ? t('btnViewTranslated') : t('btnViewOriginal')}
              >
                <Languages className="w-3.5 h-3.5" />
                <span>{showOriginal ? t('btnViewTranslated') : t('btnViewOriginal')}</span>
                <span className="text-[10px] px-1 rounded bg-amber-500/30">
                  {showOriginal ? t('originalBadge') : t('translatedBadge')}
                </span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {language !== 'ko' && (
              <button
                type="button"
                onClick={() => setShowOriginal(!showOriginal)}
                className="sm:hidden p-1.5 rounded-lg text-amber-400 hover:text-white bg-amber-950/60 border border-amber-500/40 transition text-xs flex items-center gap-1"
                title={showOriginal ? t('btnViewTranslated') : t('btnViewOriginal')}
              >
                <Languages className="w-3.5 h-3.5" />
                <span>{showOriginal ? t('originalBadge') : t('translatedBadge')}</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleShare}
              className="p-1.5 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800 transition text-xs flex items-center gap-1"
              title={t('btnShare')}
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Share2 className="w-4 h-4" />}
              <span className="hidden sm:inline">{copied ? t('btnShared') : t('btnShare')}</span>
            </button>

            {/* Admin only actions: Edit & Delete */}
            {isAdmin && (
              <>
                <button
                  type="button"
                  onClick={() => onEdit(diary)}
                  className="p-1.5 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800 transition text-xs flex items-center gap-1 cursor-pointer"
                  title={t('cardEdit')}
                >
                  <Edit3 className="w-4 h-4" />
                  <span className="hidden sm:inline">{t('cardEdit')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onDelete(diary);
                  }}
                  className="p-1.5 rounded-lg text-stone-400 hover:text-rose-400 hover:bg-stone-800 transition text-xs cursor-pointer"
                  title={t('cardDelete')}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}

            <div className="w-px h-4 bg-stone-700 mx-1" />

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Reader Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Main Cover Image */}
          {coverPhoto && (
            <div
              className="relative w-full h-72 sm:h-96 bg-stone-900 cursor-pointer overflow-hidden group"
              onClick={() => onOpenPhotoLightbox(displayDiary.photos, 0)}
            >
              <img
                src={coverPhoto.url}
                alt={coverPhoto.caption || displayDiary.title}
                className="w-full h-full object-cover group-hover:scale-102 transition duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-stone-950/80 via-transparent to-black/20" />

              {/* Photo Count badge */}
              <div className="absolute top-4 right-4 bg-stone-900/80 backdrop-blur-md text-white text-xs px-3 py-1.5 rounded-full border border-white/20">
                {t('totalPhotosCount', { count: displayDiary.photos.length })}
              </div>

              {/* Cover Caption */}
              {coverPhoto.caption && (
                <div className="absolute bottom-4 left-6 right-6 text-xs text-stone-200 bg-stone-900/60 backdrop-blur-sm px-3.5 py-1.5 rounded-lg max-w-max">
                  📷 {coverPhoto.caption}
                </div>
              )}
            </div>
          )}

          {/* Photo Thumbnail Strip if multiple photos */}
          {displayDiary.photos.length > 1 && (
            <div className="px-6 py-3 bg-stone-100/70 border-b border-stone-200 flex items-center gap-2.5 overflow-x-auto">
              {displayDiary.photos.map((photo, idx) => (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => onOpenPhotoLightbox(displayDiary.photos, idx)}
                  className="w-16 h-16 rounded-xl overflow-hidden border-2 border-white shadow-sm shrink-0 hover:opacity-90 hover:scale-105 transition"
                >
                  <img src={photo.url} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}

          {/* Diary Body Content */}
          <div className="p-6 sm:p-8 space-y-6">
            {/* Title & Metadata row */}
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500 mb-2">
                <span className="flex items-center gap-1 font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
                  <MapPin className="w-3.5 h-3.5" />
                  {displayDiary.location.region}
                </span>

                <span className="flex items-center gap-1">
                  <WeatherIcon className="w-3.5 h-3.5 text-amber-600" />
                  {weatherIcons[displayDiary.weather]?.label}
                </span>

                <span>•</span>

                <div className="flex items-center">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star
                      key={s}
                      className={`w-3.5 h-3.5 ${
                        s <= displayDiary.rating
                          ? 'text-amber-500 fill-amber-500'
                          : 'text-stone-300'
                      }`}
                    />
                  ))}
                </div>

                {/* Visitor read count in story metadata (Admin Only) */}
                {isAdmin && (
                  <>
                    <span>•</span>
                    <span className="flex items-center gap-1 font-medium text-amber-800 bg-amber-50/80 border border-amber-200/60 px-2 py-0.5 rounded" title={t('diaryReadersCount', { count: (displayDiary.views || 0).toLocaleString() })}>
                      <Eye className="w-3.5 h-3.5 text-amber-600" />
                      <span>{t('diaryViewsCount', { count: (displayDiary.views || 0).toLocaleString() })}</span>
                    </span>
                  </>
                )}

                {displayDiary.location.isRealtimeGps && (
                  <span className="ml-auto text-[11px] text-emerald-600 font-medium flex items-center gap-1 bg-emerald-50 px-2 py-0.5 rounded">
                    🟢 {t('realtimeGpsLinked')}
                  </span>
                )}
              </div>

              {/* Translation notice */}
              {language !== 'ko' && !showOriginal && (
                <div className="inline-flex items-center gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200/80 px-2.5 py-0.5 rounded-full mb-2">
                  {isTranslating ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin text-amber-600" />
                      <span>{language === 'es' ? 'Traduciendo...' : language === 'en' ? 'Translating...' : language === 'ja' ? '翻訳中...' : language === 'vi' ? 'Đang dịch...' : '번역 중...'}</span>
                    </>
                  ) : (
                    <>
                      <span>🌐</span>
                      <span>{t('translationActive')}</span>
                    </>
                  )}
                </div>
              )}

              <h1 className="text-xl sm:text-2xl font-bold text-stone-900 leading-snug tracking-tight mb-3">
                {displayDiary.title}
              </h1>

              {/* Reader / Visitor Count Banner (Admin Only) */}
              {isAdmin && (
                <div className="flex items-center justify-between text-xs py-2 px-3.5 rounded-xl bg-amber-50/80 border border-amber-200/70 text-amber-900 shadow-2xs">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-amber-700 shrink-0" />
                    <span className="font-semibold">
                      {t('diaryReadersCount', { count: (displayDiary.views || 0).toLocaleString() })}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-stone-500 text-[11px] font-medium">
                    <Eye className="w-3.5 h-3.5 text-amber-600" />
                    <span>{(displayDiary.views || 0).toLocaleString()} {t('diaryViewLabel')}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Story Paragraphs */}
            <div className="prose prose-stone max-w-none text-stone-700 text-sm sm:text-base leading-relaxed whitespace-pre-line font-serif">
              {displayDiary.content}
            </div>

            {/* Mood Tags */}
            {displayDiary.moodTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-2 border-t border-stone-200">
                {displayDiary.moodTags.map((tag) => (
                  <span
                    key={tag}
                    className="text-xs px-2.5 py-1 rounded-full bg-stone-100 text-stone-600 font-medium"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Regional Insights Block (지역 정보 & 여행자 맞춤 팁) */}
            <div className="rounded-2xl bg-amber-50/70 border border-amber-200/90 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-amber-600 text-white flex items-center justify-center text-xs">
                  <Sparkles className="w-3.5 h-3.5" />
                </div>
                <h3 className="text-sm font-bold text-stone-900">
                  {t('detailCourseGuideTitle', { region: displayDiary.location.region })}
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-white/80 rounded-xl border border-amber-200/50">
                  <span className="font-bold text-amber-900 block mb-1">
                    🚲 {t('insightWhyRecommend')}
                  </span>
                  <p className="text-stone-700 leading-relaxed">
                    {displayDiary.localInsights.recommendedForSolo}
                  </p>
                </div>

                {displayDiary.localInsights.localFood && (
                  <div className="p-3 bg-white/80 rounded-xl border border-amber-200/50">
                    <span className="font-bold text-amber-900 block mb-1">
                      🍲 {t('insightFood')}
                    </span>
                    <p className="text-stone-700 leading-relaxed">
                      {displayDiary.localInsights.localFood}
                    </p>
                  </div>
                )}

                {displayDiary.localInsights.transportTip && (
                  <div className="p-3 bg-white/80 rounded-xl border border-amber-200/50">
                    <span className="font-bold text-amber-900 block mb-1">
                      🚌 {t('insightTransport')}
                    </span>
                    <p className="text-stone-700 leading-relaxed">
                      {displayDiary.localInsights.transportTip}
                    </p>
                  </div>
                )}

                {displayDiary.localInsights.soloTravelTip && (
                  <div className="p-3 bg-white/80 rounded-xl border border-amber-200/50">
                    <span className="font-bold text-amber-900 block mb-1">
                      💡 {t('insightTravelTip')}
                    </span>
                    <p className="text-stone-700 leading-relaxed">
                      {displayDiary.localInsights.soloTravelTip}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Location & Mini Map Footer */}
            <div className="rounded-2xl border border-stone-200 p-4 bg-stone-50 flex flex-col sm:flex-row items-center gap-4">
              <div className="w-full sm:w-44 h-32 rounded-xl overflow-hidden border border-stone-300 relative shrink-0">
                <div ref={mapContainerRef} className="w-full h-full" />
              </div>

              <div className="flex-1 min-w-0 space-y-1.5 w-full">
                <div className="flex items-center gap-1.5 text-xs text-amber-700 font-bold">
                  <MapPin className="w-4 h-4" />
                  <span>{t('recordedLocation')}</span>
                </div>
                <p className="text-sm font-bold text-stone-900 truncate">
                  {displayDiary.location.landmark || displayDiary.location.region}
                </p>
                <p className="text-xs text-stone-500 break-all">
                  {displayDiary.location.address}
                </p>
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      onViewOnMap(displayDiary);
                      onClose();
                    }}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 hover:text-amber-700 hover:underline"
                  >
                    <MapIcon className="w-3.5 h-3.5" />
                    <span>{t('viewOnFullMap')}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

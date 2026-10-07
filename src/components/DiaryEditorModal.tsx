import React, { useState, useEffect, useRef, useMemo } from 'react';
import { DiaryEntry, GeoLocation, TravelPhoto, WeatherType } from '../types';
import { getCurrentGpsPosition, reverseGeocode, POPULAR_SOLO_DESTINATIONS } from '../utils/geo';
import { 
  compressPhotoToHd, 
  MAX_DIARY_PAYLOAD_BYTES, 
  getDiaryPayloadSizeBytes, 
  formatBytes 
} from '../utils/imageCompressor';
import L from 'leaflet';
import { 
  X, 
  MapPin, 
  Navigation, 
  Camera, 
  Upload, 
  Trash2, 
  Star, 
  Sparkles, 
  Loader2, 
  Check, 
  Calendar, 
  Clock, 
  Sun, 
  Cloud, 
  CloudRain, 
  Snowflake, 
  Wind, 
  Compass,
  Image as ImageIcon,
  Tag,
  AlertCircle,
  RotateCcw
} from 'lucide-react';

interface DiaryEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (entry: DiaryEntry) => void;
  initialEntry?: DiaryEntry | null;
}

const SAMPLE_TRAVEL_PHOTOS = [
  {
    url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80',
    caption: '시원한 에메랄드빛 바다와 부서지는 파도',
  },
  {
    url: 'https://images.unsplash.com/photo-1519046904884-53103b34b206?auto=format&fit=crop&w=1200&q=80',
    caption: '수평선 너머로 저물어가는 황금빛 석양',
  },
  {
    url: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?auto=format&fit=crop&w=1200&q=80',
    caption: '조용하고 운치 있는 밤 골목길 산책',
  },
  {
    url: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&w=1200&q=80',
    caption: '햇살이 잘 드는 아늑한 1인석 카페',
  },
];

const PRESET_TAGS = [
  '#자전거여행',
  '#로드바이크',
  '#해외라이딩',
  '#시마나미해도',
  '#르웨탄호수',
  '#도나우강',
  '#일출라이딩',
  '#노을라이딩',
  '#야간라이딩',
  '#자전거종주',
];

export const DiaryEditorModal: React.FC<DiaryEditorModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialEntry,
}) => {
  // Form State
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  });
  const [weather, setWeather] = useState<WeatherType>('sunny');
  const [rating, setRating] = useState(5);
  const [moodTags, setMoodTags] = useState<string[]>(['#나홀로여행', '#힐링산책']);
  const [tagInput, setTagInput] = useState('');

  // Location State
  const [location, setLocation] = useState<GeoLocation>({
    lat: 33.4619,
    lng: 126.3113,
    address: '제주특별자치도 제주시 애월읍 애월로 11',
    region: '제주 애월 한담해변',
    landmark: '한담해안산책로',
    isRealtimeGps: false,
  });
  const [isGpsLoading, setIsGpsLoading] = useState(false);
  const [gpsMessage, setGpsMessage] = useState<string | null>(null);

  // Photos State
  const [photos, setPhotos] = useState<TravelPhoto[]>([]);
  const [isCompressingPhotos, setIsCompressingPhotos] = useState(false);
  const [compressionNote, setCompressionNote] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Regional Insights
  const [recommendedForSolo, setRecommendedForSolo] = useState('');
  const [localFood, setLocalFood] = useState('');
  const [transportTip, setTransportTip] = useState('');
  const [soloTravelTip, setSoloTravelTip] = useState('');

  // Reset notification state
  const [showResetNotice, setShowResetNotice] = useState(false);

  // Mini Map ref
  const miniMapContainerRef = useRef<HTMLDivElement>(null);
  const miniMapRef = useRef<L.Map | null>(null);
  const miniMarkerRef = useRef<L.Marker | null>(null);

  // Clean Reset Form Handler
  const resetForm = () => {
    const now = new Date();
    setTitle('');
    setContent('');
    setDate(now.toISOString().slice(0, 10));
    setTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
    setWeather('sunny');
    setRating(5);
    setMoodTags(['#자전거여행', '#라이딩']);
    setTagInput('');
    setPhotos([]);
    setIsCompressingPhotos(false);
    setCompressionNote(null);
    setRecommendedForSolo('');
    setLocalFood('');
    setTransportTip('');
    setSoloTravelTip('');
    setGpsMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  const handleResetForm = () => {
    resetForm();
    setShowResetNotice(true);
    setTimeout(() => setShowResetNotice(false), 2500);
  };

  // Initialize or populate when opened
  useEffect(() => {
    if (!isOpen) return;

    if (initialEntry) {
      setTitle(initialEntry.title || '');
      setContent(initialEntry.content || '');
      setDate(initialEntry.date);
      setTime(initialEntry.time);
      setWeather(initialEntry.weather || 'sunny');
      setRating(initialEntry.rating || 5);
      setMoodTags(initialEntry.moodTags || []);
      setLocation(initialEntry.location);
      setPhotos(initialEntry.photos || []);
      setRecommendedForSolo(initialEntry.localInsights.recommendedForSolo || '');
      setLocalFood(initialEntry.localInsights.localFood || '');
      setTransportTip(initialEntry.localInsights.transportTip || '');
      setSoloTravelTip(initialEntry.localInsights.soloTravelTip || '');
      setTagInput('');
      setGpsMessage(null);
    } else {
      // Clean reset to empty defaults for new diary
      resetForm();
      // Try auto-fetching real-time GPS on new modal open if available
      handleAutoFetchGps();
    }
  }, [isOpen, initialEntry]);

  // Initialize Mini Map
  useEffect(() => {
    if (!isOpen) return;

    const timer = setTimeout(() => {
      if (!miniMapContainerRef.current) return;

      if (miniMapRef.current) {
        miniMapRef.current.remove();
        miniMapRef.current = null;
      }

      const map = L.map(miniMapContainerRef.current, {
        center: [location.lat, location.lng],
        zoom: 13,
        zoomControl: true,
      });

      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
      }).addTo(map);

      const pinIcon = L.divIcon({
        className: 'editor-map-pin',
        html: `
          <div class="w-8 h-8 rounded-full bg-amber-600 border-2 border-white shadow-lg flex items-center justify-center text-white text-xs font-bold animate-bounce">
            📍
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 32],
      });

      const marker = L.marker([location.lat, location.lng], {
        icon: pinIcon,
        draggable: true,
      }).addTo(map);

      marker.on('dragend', async () => {
        const pos = marker.getLatLng();
        await updateLocationFromCoords(pos.lat, pos.lng);
      });

      map.on('click', async (e) => {
        marker.setLatLng(e.latlng);
        await updateLocationFromCoords(e.latlng.lat, e.latlng.lng);
      });

      miniMapRef.current = map;
      miniMarkerRef.current = marker;
    }, 150);

    return () => {
      clearTimeout(timer);
      if (miniMapRef.current) {
        miniMapRef.current.remove();
        miniMapRef.current = null;
      }
    };
  }, [isOpen]);

  const updateLocationFromCoords = async (lat: number, lng: number, isRealtime = false) => {
    setIsGpsLoading(true);
    try {
      const info = await reverseGeocode(lat, lng);
      setLocation(prev => ({
        ...prev,
        lat,
        lng,
        address: info.address,
        region: info.region,
        landmark: info.landmark || prev.landmark,
        isRealtimeGps: isRealtime,
      }));
    } catch {
      setLocation(prev => ({
        ...prev,
        lat,
        lng,
        isRealtimeGps: isRealtime,
      }));
    } finally {
      setIsGpsLoading(false);
    }
  };

  const handleAutoFetchGps = async () => {
    setIsGpsLoading(true);
    setGpsMessage('현재 실시간 GPS 위치 확인 중...');
    try {
      const pos = await getCurrentGpsPosition();
      const info = await reverseGeocode(pos.lat, pos.lng);
      setLocation({
        lat: pos.lat,
        lng: pos.lng,
        accuracy: pos.accuracy,
        address: info.address,
        region: info.region,
        landmark: info.landmark,
        isRealtimeGps: true,
      });
      setGpsMessage(`실시간 위치 수신 완료 (오차 ±${pos.accuracy}m)`);

      if (miniMapRef.current && miniMarkerRef.current) {
        miniMapRef.current.setView([pos.lat, pos.lng], 14);
        miniMarkerRef.current.setLatLng([pos.lat, pos.lng]);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '위치를 가져올 수 없습니다.';
      setGpsMessage(msg);
    } finally {
      setIsGpsLoading(false);
    }
  };

  const handleSelectPresetDestination = (dest: GeoLocation) => {
    setLocation({
      ...dest,
      isRealtimeGps: false,
    });
    if (miniMapRef.current && miniMarkerRef.current) {
      miniMapRef.current.setView([dest.lat, dest.lng], 14);
      miniMarkerRef.current.setLatLng([dest.lat, dest.lng]);
    }
  };

  // Handle Photo Upload: Limits photo resolution to HD (1280px) and optimizes size
  const handlePhotoFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsCompressingPhotos(true);

    const fileArray = Array.from(files);
    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      try {
        setCompressionNote(`사진 HD(1280px 이하) 최적화 중 (${i + 1}/${fileArray.length})...`);
        const result = await compressPhotoToHd(file);
        setPhotos((prev) => {
          const newPhoto: TravelPhoto = {
            id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            url: result.dataUrl,
            caption: '',
            timestamp: new Date().toISOString(),
            isCover: prev.length === 0, // first photo becomes cover
          };
          return [...prev, newPhoto];
        });

        const sizeKb = Math.round(result.sizeBytes / 1024);
        setCompressionNote(
          `HD 이하 최적화 완료 (${result.width}×${result.height}px, ${sizeKb}KB)`
        );
      } catch (err) {
        console.error('Failed to compress photo:', err);
        setCompressionNote('사진 처리 중 오류가 발생했습니다.');
      }
    }

    setTimeout(() => {
      setIsCompressingPhotos(false);
      setCompressionNote(null);
    }, 3500);
  };

  const handleAddSamplePhoto = (sample: { url: string; caption: string }) => {
    setPhotos(prev => [
      ...prev,
      {
        id: `photo-sample-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        url: sample.url,
        caption: sample.caption,
        timestamp: new Date().toISOString(),
        isCover: prev.length === 0,
      },
    ]);
  };

  const handleSetCoverPhoto = (id: string) => {
    setPhotos(prev =>
      prev.map(p => ({
        ...p,
        isCover: p.id === id,
      }))
    );
  };

  const handleRemovePhoto = (id: string) => {
    setPhotos(prev => {
      const filtered = prev.filter(p => p.id !== id);
      if (filtered.length > 0 && !filtered.some(p => p.isCover)) {
        filtered[0].isCover = true;
      }
      return filtered;
    });
  };

  const handleUpdateCaption = (id: string, caption: string) => {
    setPhotos(prev =>
      prev.map(p => (p.id === id ? { ...p, caption } : p))
    );
  };

  // Mood Tag handling
  const handleAddTag = (tagToAdd: string) => {
    const formatted = tagToAdd.trim().startsWith('#') ? tagToAdd.trim() : `#${tagToAdd.trim()}`;
    if (formatted.length > 1 && !moodTags.includes(formatted)) {
      setMoodTags(prev => [...prev, formatted]);
    }
    setTagInput('');
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setMoodTags(prev => prev.filter(t => t !== tagToRemove));
  };

  // Dynamic calculation of total diary creation payload (including attached photos, max 2MB)
  const currentPayloadBytes = useMemo(() => {
    return getDiaryPayloadSizeBytes({
      title,
      content,
      date,
      time,
      location,
      photos,
      weather,
      moodTags,
      rating,
      localInsights: {
        recommendedForSolo,
        localFood,
        transportTip,
        soloTravelTip,
      },
    });
  }, [title, content, date, time, location, photos, weather, moodTags, rating, recommendedForSolo, localFood, transportTip, soloTravelTip]);

  const isOverLimit = currentPayloadBytes > MAX_DIARY_PAYLOAD_BYTES;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      alert('일기 제목을 입력해주세요.');
      return;
    }
    if (!content.trim()) {
      alert('여행 일기 내용을 작성해주세요.');
      return;
    }

    if (isOverLimit) {
      alert(`일기 작성 전체 용량(${formatBytes(currentPayloadBytes)})이 최대 허용 용량인 5MB를 초과했습니다. 첨부된 사진 수를 줄이거나 조절해주세요.`);
      return;
    }

    const newDiary: DiaryEntry = {
      id: initialEntry ? initialEntry.id : `diary-${Date.now()}`,
      title: title.trim(),
      content: content.trim(),
      date,
      time,
      location,
      photos,
      weather,
      moodTags,
      localInsights: {
        recommendedForSolo: recommendedForSolo.trim() || '혼자만의 시간을 오롯이 느끼기 좋은 여유로운 장소',
        localFood: localFood.trim() || undefined,
        transportTip: transportTip.trim() || undefined,
        soloTravelTip: soloTravelTip.trim() || undefined,
      },
      rating,
      views: initialEntry?.views ?? 0,
      createdAt: initialEntry ? initialEntry.createdAt : Date.now(),
      updatedAt: Date.now(),
    };

    onSave(newDiary);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-stone-950/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-stone-200 overflow-hidden my-8 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 bg-stone-900 text-white flex items-center justify-between border-b border-stone-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-600 flex items-center justify-center text-white">
              <Compass className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold">
                {initialEntry ? '여행 일기 수정' : '새로운 여행 일기 쓰기'}
              </h2>
              <p className="text-xs text-stone-400">
                실시간 위치와 사진을 연동하여 오늘의 여행 순간을 기록하세요
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="btn-editor-reset-header"
              type="button"
              onClick={handleResetForm}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 hover:text-white text-xs font-medium transition border border-stone-700 active:scale-95"
              title="입력한 모든 일기 내용을 깨끗하게 초기화합니다"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
              <span>내용 초기화</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800 transition"
              title="닫기"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Reset Notification Toast */}
        {showResetNotice && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 bg-stone-900/95 text-white text-xs px-4 py-2 rounded-full shadow-xl border border-amber-500/40 flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
            <RotateCcw className="w-3.5 h-3.5 text-amber-400 animate-spin" />
            <span className="font-medium">일기 작성 내용이 깨끗하게 초기화되었습니다.</span>
          </div>
        )}

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
          {/* SECTION 1: Real-time Location & Map Integration */}
          <div className="bg-amber-50/50 rounded-xl p-4 sm:p-5 border border-amber-200/80">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <MapPin className="w-5 h-5 text-amber-700" />
                <h3 className="text-sm font-bold text-stone-900">
                  실시간 위치 연동 & 여행지 지정
                </h3>
              </div>

              {/* Real-time GPS Button */}
              <button
                type="button"
                id="btn-modal-gps-fetch"
                onClick={handleAutoFetchGps}
                disabled={isGpsLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition active:scale-95"
              >
                {isGpsLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Navigation className="w-3.5 h-3.5" />
                )}
                <span>내 현재 GPS 위치 연동</span>
              </button>
            </div>

            {gpsMessage && (
              <div className="mb-3 text-xs px-3 py-1.5 rounded bg-stone-900 text-stone-200 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>{gpsMessage}</span>
              </div>
            )}

            {/* Location Inputs & Interactive Mini Map Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Mini Map */}
              <div className="lg:col-span-5 h-48 rounded-xl overflow-hidden border border-stone-300 relative">
                <div ref={miniMapContainerRef} className="w-full h-full" />
                <div className="absolute bottom-1.5 left-1.5 bg-stone-900/80 text-white text-[10px] px-2 py-0.5 rounded shadow pointer-events-none">
                  지도를 클릭하거나 핀을 드래그하여 위치 변경
                </div>
              </div>

              {/* Location Text Details */}
              <div className="lg:col-span-7 space-y-2.5">
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    지역 명칭 (현지 언어 표기)
                  </label>
                  <input
                    type="text"
                    value={location.region}
                    onChange={(e) => setLocation({ ...location, region: e.target.value })}
                    placeholder="예: TP. Thanh Hóa, Quận Hoàn Kiếm, Hà Nội, 경기도 수원시"
                    className="w-full px-3 py-2 text-xs sm:text-sm rounded-lg border border-stone-300 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    상세 주소 (현지 언어 도로명 / 상세 위치)
                  </label>
                  <input
                    type="text"
                    value={location.address}
                    onChange={(e) => setLocation({ ...location, address: e.target.value })}
                    placeholder="예: Đường Hồ Xuân Hương, Phố Lý Quốc Sư, 만석로"
                    className="w-full px-3 py-2 text-xs sm:text-sm rounded-lg border border-stone-300 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                  />
                </div>

                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-stone-700 mb-1">
                      구체적 여행 포인트 / 명소 (현지 언어)
                    </label>
                    <input
                      type="text"
                      value={location.landmark || ''}
                      onChange={(e) => setLocation({ ...location, landmark: e.target.value })}
                      placeholder="예: Nhà thờ Lớn Hà Nội, Cầu Hữu Nghị, Cảng HKQT Nội Bài"
                      className="w-full px-3 py-2 text-xs sm:text-sm rounded-lg border border-stone-300 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                    />
                  </div>
                  <div className="w-28">
                    <label className="block text-xs font-medium text-stone-700 mb-1">
                      좌표
                    </label>
                    <div className="text-[11px] text-stone-600 bg-stone-100 px-2 py-2.5 rounded-lg border border-stone-200 truncate">
                      {location.lat.toFixed(3)}, {location.lng.toFixed(3)}
                    </div>
                  </div>
                </div>

                {/* Popular Presets */}
                <div className="pt-1">
                  <span className="text-[11px] text-stone-500 mr-1.5">추천 코스:</span>
                  <div className="inline-flex flex-wrap gap-1">
                    {POPULAR_SOLO_DESTINATIONS.map((dest) => (
                      <button
                        key={dest.region}
                        type="button"
                        onClick={() => handleSelectPresetDestination(dest)}
                        className="text-[10px] px-2 py-0.5 rounded bg-white hover:bg-amber-100 text-stone-700 border border-stone-200 transition"
                      >
                        {dest.region}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 2: Photo Upload & Live Camera Integration */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <Camera className="w-5 h-5 text-amber-700" />
                  <h3 className="text-sm font-bold text-stone-900">
                    여행 사진 연동 ({photos.length}장)
                  </h3>
                </div>
                <p className="text-[11px] text-stone-500 mt-0.5">
                  사진 용량은 HD(1280×720) 이하로 제한되며, 일기는 사진 첨부 포함 최대 2MB까지 작성할 수 있습니다.
                </p>
              </div>

              {/* Upload & Camera Buttons */}
              <div className="flex items-center gap-2">
                <label
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-white text-xs font-medium transition cursor-pointer"
                  title="카메라로 실시간 촬영하기"
                >
                  <input
                    type="file"
                    onChange={(e) => handlePhotoFiles(e.target.files)}
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    name="cameraInput"
                  />
                  <Camera className="w-3.5 h-3.5 text-amber-400" />
                  <span>카메라 촬영</span>
                </label>
                <label
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium transition shadow-sm cursor-pointer"
                >
                  <input
                    type="file"
                    onChange={(e) => handlePhotoFiles(e.target.files)}
                    accept="image/*"
                    multiple
                    className="sr-only"
                    name="photoInput"
                  />
                  <Upload className="w-3.5 h-3.5" />
                  <span>사진 업로드</span>
                </label>
              </div>
            </div>

            {/* Compression Progress Notification */}
            {compressionNote && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 font-medium animate-fadeIn">
                {isCompressingPhotos ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600 shrink-0" />
                ) : (
                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                )}
                <span>{compressionNote}</span>
              </div>
            )}

            {/* Photo List Grid */}
            {photos.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {photos.map((photo) => (
                  <div
                    key={photo.id}
                    className="group relative rounded-xl overflow-hidden border border-stone-200 bg-stone-100 flex flex-col"
                  >
                    <div className="relative h-28 w-full">
                      <img
                        src={photo.url}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                      {photo.isCover && (
                        <span className="absolute top-2 left-2 bg-amber-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow">
                          대표 사진
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemovePhoto(photo.id)}
                        className="absolute top-2 right-2 p-1 rounded-full bg-stone-900/70 hover:bg-rose-600 text-white transition"
                        title="사진 삭제"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>

                    <div className="p-2 space-y-1.5 bg-white flex-1 flex flex-col justify-between">
                      <input
                        type="text"
                        value={photo.caption || ''}
                        onChange={(e) => handleUpdateCaption(photo.id, e.target.value)}
                        placeholder="사진 설명 입력..."
                        className="w-full text-xs px-2 py-1 rounded border border-stone-200 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                      {!photo.isCover && (
                        <button
                          type="button"
                          onClick={() => handleSetCoverPhoto(photo.id)}
                          className="text-[10px] text-stone-500 hover:text-amber-700 font-medium text-left"
                        >
                          ⭐️ 대표 사진으로 설정
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="border-2 border-dashed border-stone-300 rounded-xl p-6 text-center bg-stone-50/50">
                <ImageIcon className="w-8 h-8 mx-auto text-stone-400 mb-2" />
                <p className="text-xs text-stone-600 font-medium">
                  여행 중 촬영한 사진을 업로드하거나 실시간 카메라로 바로 담아보세요.
                </p>
                <div className="mt-3 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-1.5 rounded-lg bg-stone-200 hover:bg-stone-300 text-stone-800 text-xs font-medium transition"
                  >
                    사진 파일 선택
                  </button>
                  <span className="text-xs text-stone-400">또는</span>
                  <div className="flex gap-1">
                    {SAMPLE_TRAVEL_PHOTOS.slice(0, 2).map((s, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleAddSamplePhoto(s)}
                        className="text-[11px] px-2 py-1 rounded bg-amber-100 hover:bg-amber-200 text-amber-900 transition"
                      >
                        샘플 사진 {idx + 1} 추가
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* SECTION 3: Date, Time, Weather, Rating */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-stone-500" />
                <span>날짜</span>
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 text-xs sm:text-sm rounded-lg border border-stone-300 bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-stone-500" />
                <span>시간</span>
              </label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full px-3 py-2 text-xs sm:text-sm rounded-lg border border-stone-300 bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1">
                날씨
              </label>
              <div className="flex items-center gap-1">
                {(
                  [
                    { type: 'sunny', label: '맑음', icon: Sun },
                    { type: 'cloudy', label: '흐림', icon: Cloud },
                    { type: 'rainy', label: '비', icon: CloudRain },
                    { type: 'windy', label: '바람', icon: Wind },
                  ] as const
                ).map(({ type, label, icon: Icon }) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setWeather(type)}
                    className={`flex-1 p-2 rounded-lg border flex flex-col items-center gap-0.5 text-[10px] transition ${
                      weather === type
                        ? 'bg-amber-600 text-white border-amber-600 font-bold'
                        : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1">
                만족도 별점
              </label>
              <div className="flex items-center h-10 px-2 rounded-lg border border-stone-300 bg-white gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    className="p-1 text-stone-300 hover:scale-110 transition"
                  >
                    <Star
                      className={`w-5 h-5 ${
                        star <= rating
                          ? 'text-amber-500 fill-amber-500'
                          : 'text-stone-300'
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* SECTION 4: Title & Story Content */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1">
                일기 제목
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="오늘의 여정을 한 문장으로 표현해보세요 (예: 고요한 바닷가 골목길에서 마주친 작은 위로)"
                className="w-full px-4 py-2.5 text-sm font-semibold rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-stone-700">
                  나홀로 여행 일기 이야기
                </label>
                <span className="text-[11px] text-stone-400">
                  {content.length}자
                </span>
              </div>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={5}
                placeholder="혼자 여행하며 보고 느낀 점, 길 위에서의 생각, 마주친 풍경과 사람들, 나 자신과의 대화를 자유롭게 기록해보세요..."
                className="w-full px-4 py-3 text-sm rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-500/50 leading-relaxed font-sans"
              />
            </div>
          </div>

          {/* SECTION 5: Regional Insights for Travelers */}
          <div className="bg-stone-50 rounded-xl p-4 sm:p-5 border border-stone-200 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-600" />
              <h4 className="text-xs font-bold text-stone-900 uppercase tracking-wider">
                코스 정보 & 여행자 맞춤 팁 (Route Guide)
              </h4>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-stone-600 mb-1">
                  여행 추천 이유 & 코스 특징
                </label>
                <input
                  type="text"
                  value={recommendedForSolo}
                  onChange={(e) => setRecommendedForSolo(e.target.value)}
                  placeholder="예: 완만한 경사로와 전용 도로 완비, 호수/해안 파노라마 뷰"
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-stone-300 bg-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-stone-600 mb-1">
                  라이더 추천 보급식 / 로컬 카페
                </label>
                <input
                  type="text"
                  value={localFood}
                  onChange={(e) => setLocalFood(e.target.value)}
                  placeholder="예: 갓 구운 와플, 지역 특산 과일 주스, 따뜻한 에스프레소"
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-stone-300 bg-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-stone-600 mb-1">
                  코스 접근성 & 교통 팁
                </label>
                <input
                  type="text"
                  value={transportTip}
                  onChange={(e) => setTransportTip(e.target.value)}
                  placeholder="예: 인접 기차역에서 대여 및 열차 내 거치 가능"
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-stone-300 bg-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-stone-600 mb-1">
                  여행 꿀팁
                </label>
                <input
                  type="text"
                  value={soloTravelTip}
                  onChange={(e) => setSoloTravelTip(e.target.value)}
                  placeholder="예: 일몰 30분 전 골든아워 진입 추천, 전조등/후미등 점등 필수"
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-stone-300 bg-white"
                />
              </div>
            </div>
          </div>

          {/* SECTION 6: Mood Tags */}
          <div>
            <label className="block text-xs font-medium text-stone-700 mb-1.5 flex items-center gap-1">
              <Tag className="w-3.5 h-3.5 text-stone-500" />
              <span>여행 태그 & 무드</span>
            </label>
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              {moodTags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-200"
                >
                  <span>{t}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(t)}
                    className="hover:text-rose-700"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTag(tagInput);
                  }
                }}
                placeholder="#태그 직접 입력 후 엔터"
                className="px-3 py-1.5 text-xs rounded-lg border border-stone-300 flex-1 max-w-xs"
              />
              <button
                type="button"
                onClick={() => handleAddTag(tagInput)}
                className="px-3 py-1.5 rounded-lg bg-stone-200 hover:bg-stone-300 text-xs font-medium text-stone-800"
              >
                추가
              </button>

              <div className="hidden sm:flex items-center gap-1 ml-2">
                <span className="text-[11px] text-stone-400">추천:</span>
                {PRESET_TAGS.slice(0, 4).map((pt) => (
                  <button
                    key={pt}
                    type="button"
                    onClick={() => handleAddTag(pt)}
                    className="text-[10px] px-2 py-0.5 rounded bg-stone-100 text-stone-600 hover:bg-amber-50"
                  >
                    {pt}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Footer Buttons & 2MB Capacity Meter */}
          <div className="pt-4 border-t border-stone-200 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 w-full sm:w-auto justify-between sm:justify-start">
              <button
                id="btn-editor-reset-footer"
                type="button"
                onClick={handleResetForm}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-stone-600 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition border border-stone-200 hover:border-rose-300 active:scale-95 cursor-pointer"
                title="작성 중인 모든 입력 내용을 깨끗하게 초기화합니다"
              >
                <RotateCcw className="w-3.5 h-3.5 text-stone-400" />
                <span>내용 초기화</span>
              </button>

              {/* 2MB Capacity Meter */}
              <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-stone-100 border border-stone-200 text-xs">
                <span className="text-stone-500 text-[11px]">작성 용량:</span>
                <span className={`font-mono text-xs font-bold ${isOverLimit ? 'text-rose-600' : 'text-stone-700'}`}>
                  {formatBytes(currentPayloadBytes)} / 2 MB
                </span>
                <div className="w-16 h-1.5 rounded-full bg-stone-200 overflow-hidden hidden sm:block">
                  <div
                    className={`h-full transition-all duration-300 ${
                      isOverLimit ? 'bg-rose-500' : currentPayloadBytes > 1500000 ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min(100, (currentPayloadBytes / MAX_DIARY_PAYLOAD_BYTES) * 100)}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-xl transition cursor-pointer"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={isOverLimit}
                className="px-6 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-semibold shadow-md shadow-amber-900/30 transition active:scale-95 flex items-center gap-1.5 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>{initialEntry ? '일기 수정 완료' : '일기 등록'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

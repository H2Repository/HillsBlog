import React, { useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import { VisitorLog } from '../types';
import { clearAllVisitorLogs } from '../services/visitorService';
import { 
  X, 
  MapPin, 
  Users, 
  Eye, 
  Smartphone, 
  Monitor, 
  Tablet, 
  RotateCcw, 
  RefreshCw, 
  Clock, 
  Globe2, 
  CheckCircle2,
  Trash2
} from 'lucide-react';

interface VisitorLocationModalProps {
  isOpen: boolean;
  onClose: () => void;
  visitorLogs: VisitorLog[];
  onRefresh?: () => void;
}

export const VisitorLocationModal: React.FC<VisitorLocationModalProps> = ({
  isOpen,
  onClose,
  visitorLogs,
  onRefresh,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const [selectedLog, setSelectedLog] = useState<VisitorLog | null>(null);
  const [filterCity, setFilterCity] = useState<string>('ALL');
  const [isClearing, setIsClearing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Group by city for stats
  const cityStats = useMemo(() => {
    const map = new Map<string, number>();
    visitorLogs.forEach((l) => {
      const key = `${l.city || '알 수 없음'}, ${l.country || ''}`.trim().replace(/,$/, '');
      map.set(key, (map.get(key) || 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [visitorLogs]);

  // Group by device
  const deviceStats = useMemo(() => {
    let mobile = 0;
    let desktop = 0;
    let tablet = 0;
    visitorLogs.forEach((l) => {
      if (l.device === 'Mobile') mobile++;
      else if (l.device === 'Tablet') tablet++;
      else desktop++;
    });
    return { mobile, desktop, tablet, total: visitorLogs.length };
  }, [visitorLogs]);

  // Filtered logs
  const filteredLogs = useMemo(() => {
    if (filterCity === 'ALL') return visitorLogs;
    return visitorLogs.filter((l) => `${l.city}, ${l.country}`.includes(filterCity) || l.city === filterCity);
  }, [visitorLogs, filterCity]);

  // Initialize or update Leaflet Map
  useEffect(() => {
    if (!isOpen || !mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const defaultCenter: [number, number] = visitorLogs.length > 0 
        ? [visitorLogs[0].lat, visitorLogs[0].lng] 
        : [37.5665, 126.9780];

      const map = L.map(mapContainerRef.current, {
        center: defaultCenter,
        zoom: visitorLogs.length > 0 ? 5 : 4,
        zoomControl: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 18,
      }).addTo(map);

      mapInstanceRef.current = map;
    }

    const map = mapInstanceRef.current;

    // Clear old markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    // Create visitor marker icon
    const visitorIcon = L.divIcon({
      className: 'custom-visitor-marker',
      html: `
        <div style="
          width: 28px;
          height: 28px;
          background: #0284c7;
          border: 2.5px solid white;
          border-radius: 50%;
          box-shadow: 0 4px 10px rgba(2, 132, 199, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 13px;
        ">
          👁️
        </div>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -14],
    });

    // Add markers for each log
    const bounds = L.latLngBounds([]);

    filteredLogs.forEach((log) => {
      const marker = L.marker([log.lat, log.lng], { icon: visitorIcon }).addTo(map);
      
      const timeStr = new Date(log.timestamp).toLocaleString('ko-KR', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      const popupHtml = `
        <div style="font-family: sans-serif; font-size: 12px; line-height: 1.5; min-width: 170px;">
          <div style="font-weight: bold; color: #0369a1; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
            <span>📍 ${log.city || '알 수 없음'}, ${log.country || ''}</span>
          </div>
          <div style="color: #44403c; font-size: 11px;">🕒 ${timeStr}</div>
          <div style="color: #44403c; font-size: 11px;">📖 ${log.diaryTitle || '홈 피드'}</div>
          <div style="color: #78716c; font-size: 10px; margin-top: 3px;">📱 ${log.device} • IP: ${log.ipMasked || '***'}</div>
        </div>
      `;

      marker.bindPopup(popupHtml);
      marker.on('click', () => setSelectedLog(log));

      markersRef.current.push(marker);
      bounds.extend([log.lat, log.lng]);
    });

    if (filteredLogs.length > 0) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 });
    }

    setTimeout(() => {
      map.invalidateSize();
    }, 200);
  }, [isOpen, filteredLogs]);

  // Focus single log on map
  const handleFocusLog = (log: VisitorLog) => {
    setSelectedLog(log);
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([log.lat, log.lng], 10, { animate: true });
      const targetMarker = markersRef.current.find((m) => {
        const latLng = m.getLatLng();
        return Math.abs(latLng.lat - log.lat) < 0.0001 && Math.abs(latLng.lng - log.lng) < 0.0001;
      });
      if (targetMarker) {
        targetMarker.openPopup();
      }
    }
  };

  // Handle Clear All Logs
  const handleClearLogs = async () => {
    if (!window.confirm('방문자 위치 기록 데이터를 모두 초기화하시겠습니까?')) {
      return;
    }
    setIsClearing(true);
    try {
      await clearAllVisitorLogs();
      setStatusMsg('방문자 위치 기록이 성공적으로 초기화되었습니다.');
      if (onRefresh) onRefresh();
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (e) {
      console.error(e);
      setStatusMsg('초기화 중 오류가 발생했습니다.');
      setTimeout(() => setStatusMsg(null), 3000);
    } finally {
      setIsClearing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-stone-900/70 backdrop-blur-xs animate-fadeIn">
      <div 
        className="bg-white rounded-2xl max-w-5xl w-full h-[90vh] max-h-[850px] shadow-2xl flex flex-col overflow-hidden border border-stone-200"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200 bg-stone-50/80">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-sky-100 border border-sky-200 flex items-center justify-center text-sky-700 shadow-2xs">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-stone-900 flex items-center gap-2">
                <span>방문자 위치 현황</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-semibold border border-amber-200">
                  관리자 전용
                </span>
              </h2>
              <p className="text-xs text-stone-500">
                블로그를 방문한 사용자들의 접속 위치 및 열람 기록 통계
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                className="p-2 text-stone-500 hover:text-stone-800 hover:bg-stone-200/60 rounded-lg transition cursor-pointer"
                title="새로고침"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={handleClearLogs}
              disabled={isClearing || visitorLogs.length === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition disabled:opacity-50 cursor-pointer"
              title="방문자 위치 로그 전체 초기화"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">위치 기록 초기화</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-stone-400 hover:text-stone-700 hover:bg-stone-200/60 rounded-lg transition cursor-pointer ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Status Message */}
        {statusMsg && (
          <div className="px-5 py-2 bg-sky-50 border-b border-sky-200 text-sky-900 text-xs font-medium flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-sky-600" />
            <span>{statusMsg}</span>
          </div>
        )}

        {/* Summary Stats Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 bg-stone-100/60 border-b border-stone-200 text-xs">
          <div className="bg-white p-2.5 rounded-xl border border-stone-200 shadow-2xs">
            <div className="text-stone-500 text-[11px] font-medium flex items-center gap-1">
              <Eye className="w-3.5 h-3.5 text-sky-600" />
              <span>총 기록된 위치</span>
            </div>
            <div className="text-lg font-bold text-stone-900 mt-0.5">
              {visitorLogs.length}건
            </div>
          </div>

          <div className="bg-white p-2.5 rounded-xl border border-stone-200 shadow-2xs">
            <div className="text-stone-500 text-[11px] font-medium flex items-center gap-1">
              <Globe2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>최다 방문 지역</span>
            </div>
            <div className="text-xs font-bold text-stone-900 mt-1 truncate" title={cityStats[0]?.[0] || '-'}>
              {cityStats[0] ? `${cityStats[0][0]} (${cityStats[0][1]}회)` : '기록 없음'}
            </div>
          </div>

          <div className="bg-white p-2.5 rounded-xl border border-stone-200 shadow-2xs">
            <div className="text-stone-500 text-[11px] font-medium flex items-center gap-1">
              <Smartphone className="w-3.5 h-3.5 text-amber-600" />
              <span>모바일 접속</span>
            </div>
            <div className="text-lg font-bold text-stone-900 mt-0.5">
              {deviceStats.mobile}건
              {deviceStats.total > 0 && (
                <span className="text-xs font-normal text-stone-500 ml-1">
                  ({Math.round((deviceStats.mobile / deviceStats.total) * 100)}%)
                </span>
              )}
            </div>
          </div>

          <div className="bg-white p-2.5 rounded-xl border border-stone-200 shadow-2xs">
            <div className="text-stone-500 text-[11px] font-medium flex items-center gap-1">
              <Monitor className="w-3.5 h-3.5 text-indigo-600" />
              <span>데스크톱 접속</span>
            </div>
            <div className="text-lg font-bold text-stone-900 mt-0.5">
              {deviceStats.desktop}건
              {deviceStats.total > 0 && (
                <span className="text-xs font-normal text-stone-500 ml-1">
                  ({Math.round((deviceStats.desktop / deviceStats.total) * 100)}%)
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Content Body: Left is Map, Right is Log List */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Map Area */}
          <div className="flex-1 relative min-h-[260px] md:min-h-0 bg-stone-100">
            <div ref={mapContainerRef} className="w-full h-full" />
            <div className="absolute top-3 left-3 z-[1000] bg-white/95 backdrop-blur-xs px-2.5 py-1.5 rounded-lg shadow-md border border-stone-200 text-[11px] text-stone-700 flex items-center gap-1.5 font-medium">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-500 animate-ping inline-block" />
              <span>파란 마커: 방문자 접속 위치</span>
            </div>
          </div>

          {/* Right Sidebar: City Filter & Logs List */}
          <div className="w-full md:w-80 lg:w-96 border-t md:border-t-0 md:border-l border-stone-200 bg-stone-50 flex flex-col overflow-hidden">
            {/* City Filter Chips */}
            <div className="p-2.5 border-b border-stone-200 bg-white flex items-center gap-1 overflow-x-auto">
              <button
                type="button"
                onClick={() => setFilterCity('ALL')}
                className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap transition cursor-pointer ${
                  filterCity === 'ALL'
                    ? 'bg-sky-600 text-white shadow-2xs'
                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                }`}
              >
                전체 ({visitorLogs.length})
              </button>
              {cityStats.slice(0, 5).map(([cityLabel, count]) => (
                <button
                  key={cityLabel}
                  type="button"
                  onClick={() => setFilterCity(cityLabel)}
                  className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap transition cursor-pointer ${
                    filterCity === cityLabel
                      ? 'bg-sky-600 text-white shadow-2xs'
                      : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                  }`}
                >
                  {cityLabel.split(',')[0]} ({count})
                </button>
              ))}
            </div>

            {/* Logs List */}
            <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
              {filteredLogs.length > 0 ? (
                filteredLogs.map((log) => {
                  const isSelected = selectedLog?.id === log.id;
                  const timeFormatted = new Date(log.timestamp).toLocaleString('ko-KR', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  });

                  return (
                    <div
                      key={log.id}
                      onClick={() => handleFocusLog(log)}
                      className={`p-2.5 rounded-xl border text-xs cursor-pointer transition ${
                        isSelected
                          ? 'bg-sky-50/80 border-sky-300 ring-2 ring-sky-400/30'
                          : 'bg-white border-stone-200 hover:border-stone-300 hover:bg-stone-50/50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="font-bold text-sky-900 flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                          <span>{log.city || '알 수 없음'}, {log.country || ''}</span>
                        </span>
                        <span className="text-[10px] text-stone-400">{timeFormatted}</span>
                      </div>

                      <div className="text-[11px] text-stone-700 truncate" title={log.diaryTitle}>
                        📖 {log.diaryTitle || '홈 화면 방문'}
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-stone-400 mt-1.5 pt-1.5 border-t border-stone-100">
                        <span className="flex items-center gap-1">
                          {log.device === 'Mobile' ? (
                            <Smartphone className="w-3 h-3 text-amber-600" />
                          ) : (
                            <Monitor className="w-3 h-3 text-indigo-600" />
                          )}
                          <span>{log.device}</span>
                        </span>
                        <span>IP: {log.ipMasked || '***'}</span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="py-12 text-center text-stone-400 text-xs">
                  <Users className="w-8 h-8 mx-auto mb-2 text-stone-300" />
                  <p>기록된 방문자 위치가 없습니다.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

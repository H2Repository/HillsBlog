import { VisitorLog } from '../types';

const API_BASE = '/api';

/**
 * Anonymizes an IP address for privacy protection
 */
function maskIp(ip?: string): string {
  if (!ip) return '***';
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.***`;
    }
  }
  if (ip.includes(':')) {
    const parts = ip.split(':');
    return `${parts.slice(0, 3).join(':')}:****`;
  }
  return '***';
}

/**
 * Detects visitor device type (Mobile, Desktop, Tablet)
 */
function detectDevice(): string {
  if (typeof navigator === 'undefined') return 'Desktop';
  const ua = navigator.userAgent || '';
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
    return 'Tablet';
  }
  if (/Mobile|iP(hone|od)|Android|BlackBerry|IEMobile|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/i.test(ua)) {
    return 'Mobile';
  }
  return 'Desktop';
}

/**
 * Fetches geographical location for the current visitor.
 */
async function fetchVisitorGeoLocation(): Promise<{
  lat: number;
  lng: number;
  city: string;
  country: string;
  region: string;
  ipMasked: string;
}> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);
    const res = await fetch('https://ipwho.is/', { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      if (data && data.success !== false) {
        return {
          lat: data.latitude,
          lng: data.longitude,
          city: data.city || data.region || '알 수 없음',
          country: data.country || '대한민국',
          region: data.region || '',
          ipMasked: maskIp(data.ip),
        };
      }
    }
  } catch {}

  return {
    lat: 37.5665,
    lng: 126.9780,
    city: '서울',
    country: '대한민국',
    region: '',
    ipMasked: '***',
  };
}

/**
 * Records a visitor's location and viewed content into SQLite via API.
 */
export async function recordVisitorLocation(diaryId?: string, diaryTitle?: string): Promise<void> {
  if (!diaryId) return;

  // Skip if user agent is a bot
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent || '';
    if (/bot|googlebot|crawler|spider|robot|crawling|headless/i.test(ua)) {
      return;
    }
  }

  // Session debounce
  const sessionKey = `visitor_loc_logged_global`;
  try {
    const lastLogged = localStorage.getItem(sessionKey);
    if (lastLogged) {
      const elapsed = Date.now() - Number(lastLogged);
      if (elapsed < 30 * 60 * 1000) return;
    }
    localStorage.setItem(sessionKey, String(Date.now()));
  } catch {}

  try {
    const geo = await fetchVisitorGeoLocation();
    const logId = `vlog-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const logEntry: VisitorLog = {
      id: logId,
      timestamp: Date.now(),
      lat: geo.lat,
      lng: geo.lng,
      city: geo.city,
      country: geo.country,
      region: geo.region,
      diaryId: diaryId,
      diaryTitle: diaryTitle || '블로그 홈 피드',
      device: detectDevice(),
      ipMasked: geo.ipMasked,
    };

    await fetch(`${API_BASE}/visitor-logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(logEntry),
    });
  } catch (err) {
    console.warn('Could not record visitor location:', err);
  }
}

/**
 * Fetches visitor logs from SQLite API.
 */
export async function fetchVisitorLogsOnline(): Promise<VisitorLog[]> {
  try {
    const res = await fetch(`${API_BASE}/visitor-logs`);
    if (!res.ok) throw new Error('Failed to fetch visitor logs');
    return await res.json();
  } catch (err) {
    console.error('Error fetching visitor logs:', err);
    return [];
  }
}

/**
 * Subscribes to visitor logs (Polling fallback for SQLite since no real-time push like Firestore)
 */
export function subscribeVisitorLogs(
  onUpdate: (logs: VisitorLog[]) => void,
  _onError?: (error: Error) => void
): () => void {
  fetchVisitorLogsOnline().then(onUpdate);
  const interval = setInterval(() => {
    fetchVisitorLogsOnline().then(onUpdate);
  }, 30000); // 30s poll
  return () => clearInterval(interval);
}

/**
 * Clears all visitor logs.
 */
export async function clearAllVisitorLogs(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/visitor-logs`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to clear visitor logs');
  } catch (err) {
    console.error('Error clearing logs:', err);
  }
}


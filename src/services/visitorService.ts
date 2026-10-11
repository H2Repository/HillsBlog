import { 
  collection, 
  doc, 
  setDoc, 
  deleteDoc, 
  onSnapshot, 
  getDocs, 
  query, 
  orderBy, 
  limit 
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { VisitorLog } from '../types';
import { checkAdminPermission } from './diaryFirestore';

const VISITOR_LOGS_COLLECTION = 'visitor_logs';

/**
 * Anonymizes an IP address for privacy protection (e.g. 123.45.67.89 -> 123.45.67.***)
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
 * Uses fast IP geolocation with fallback to browser timezone heuristic.
 */
async function fetchVisitorGeoLocation(): Promise<{
  lat: number;
  lng: number;
  city: string;
  country: string;
  region: string;
  ipMasked: string;
}> {
  // Try 1: ipwho.is (fast and highly accurate)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);
    const res = await fetch('https://ipwho.is/', { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      if (data && data.success !== false && typeof data.latitude === 'number' && typeof data.longitude === 'number') {
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
  } catch {
    // Fall through to Try 2
  }

  // Try 2: freeipapi.com
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);
    const res = await fetch('https://freeipapi.com/api/json', { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.latitude === 'number' && typeof data.longitude === 'number') {
        return {
          lat: data.latitude,
          lng: data.longitude,
          city: data.cityName || '알 수 없음',
          country: data.countryName || '대한민국',
          region: data.regionName || '',
          ipMasked: maskIp(data.ipAddress),
        };
      }
    }
  } catch {
    // Fall through to heuristic fallback
  }

  // Fallback based on client timezone
  let defaultCity = '서울';
  let defaultLat = 37.5665;
  let defaultLng = 126.9780;
  let defaultCountry = '대한민국';

  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz.includes('Tokyo')) {
      defaultCity = '도쿄';
      defaultCountry = '일본';
      defaultLat = 35.6762;
      defaultLng = 139.6503;
    } else if (tz.includes('Bangkok') || tz.includes('Ho_Chi_Minh')) {
      defaultCity = '하노이';
      defaultCountry = '베트남';
      defaultLat = 21.0285;
      defaultLng = 105.8542;
    } else if (tz.includes('New_York')) {
      defaultCity = '뉴욕';
      defaultCountry = '미국';
      defaultLat = 40.7128;
      defaultLng = -74.0060;
    }
  } catch {}

  return {
    lat: defaultLat,
    lng: defaultLng,
    city: defaultCity,
    country: defaultCountry,
    region: '',
    ipMasked: '***',
  };
}

/**
 * Records a visitor's location and viewed content into Firestore.
 * Automatically skips if:
 * 1. Current user is admin
 * 2. No specific diary was clicked (only logs when a diary is clicked/read)
 * 3. User agent is a known bot/crawler
 */
export async function recordVisitorLocation(diaryId?: string, diaryTitle?: string): Promise<void> {
  // 1. 일기 내용을 클릭한 경우에만 기록 (홈 피드 단순 진입이나 ID 없는 호출 차단)
  if (!diaryId) {
    return;
  }

  // 2. 관리자 모드인 경우 기록 제외
  if (checkAdminPermission()) {
    return;
  }

  // 3. 웹 크롤러 / 점검 봇 제외
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent || '';
    if (/bot|googlebot|crawler|spider|robot|crawling|headless/i.test(ua)) {
      return;
    }
  }

  // Prevent spamming in same browser session within 10 minutes for the same diary
  const sessionKey = `visitor_loc_logged_${diaryId}`;
  try {
    const lastLogged = sessionStorage.getItem(sessionKey);
    if (lastLogged) {
      const elapsed = Date.now() - Number(lastLogged);
      if (elapsed < 10 * 60 * 1000) {
        return; // Already logged recently in this session
      }
    }
    sessionStorage.setItem(sessionKey, String(Date.now()));
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

    const docRef = doc(db, VISITOR_LOGS_COLLECTION, logId);
    await setDoc(docRef, logEntry);
  } catch (err) {
    console.warn('Could not record visitor location:', err);
  }
}

/**
 * Subscribes to real-time visitor logs from Firestore (Admin only)
 */
export function subscribeVisitorLogs(
  onUpdate: (logs: VisitorLog[]) => void,
  onError?: (error: Error) => void
): () => void {
  const colRef = collection(db, VISITOR_LOGS_COLLECTION);
  const q = query(colRef, orderBy('timestamp', 'desc'), limit(150));

  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const list: VisitorLog[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as VisitorLog;
        if (data && typeof data.lat === 'number' && typeof data.lng === 'number') {
          list.push(data);
        }
      });
      onUpdate(list);
    },
    (err) => {
      console.warn('Visitor logs subscription error:', err);
      if (onError) onError(err);
    }
  );

  return unsubscribe;
}

/**
 * Clears all visitor location logs from Firestore (Admin operation)
 */
export async function clearAllVisitorLogs(): Promise<void> {
  if (!checkAdminPermission()) {
    throw new Error('방문자 위치 기록 초기화는 관리자만 가능합니다.');
  }

  const snap = await getDocs(collection(db, VISITOR_LOGS_COLLECTION));
  const deletions = snap.docs.map((d) => deleteDoc(doc(db, VISITOR_LOGS_COLLECTION, d.id)));
  await Promise.all(deletions);
}

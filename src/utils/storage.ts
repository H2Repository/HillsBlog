import { DiaryEntry } from '../types';

const STORAGE_KEY = 'hills_blog_diaries_v2';

/**
 * Strictly sorts diaries so the newest travel date & time appears first.
 * If dates are identical, falls back to newest creation timestamp (createdAt).
 */
export function sortDiariesDescending(diaries: DiaryEntry[]): DiaryEntry[] {
  return [...diaries].sort((a, b) => {
    // 1. Primary: Compare travel date and time (YYYY-MM-DD HH:mm) descending
    const dateTimeA = `${a.date || ''} ${a.time || ''}`.trim();
    const dateTimeB = `${b.date || ''} ${b.time || ''}`.trim();

    if (dateTimeA && dateTimeB && dateTimeA !== dateTimeB) {
      return dateTimeB.localeCompare(dateTimeA);
    }

    // 2. Secondary: Compare createdAt timestamp descending
    const createdA = a.createdAt || 0;
    const createdB = b.createdAt || 0;
    if (createdA !== createdB) {
      return createdB - createdA;
    }

    // 3. Fallback: Compare updatedAt timestamp descending
    const updatedA = a.updatedAt || 0;
    const updatedB = b.updatedAt || 0;
    return updatedB - updatedA;
  });
}

export function getStoredDiaries(): DiaryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return sortDiariesDescending(parsed);
    }
    return [];
  } catch (e) {
    console.error('Failed to parse diaries from localStorage:', e);
    return [];
  }
}

export function saveDiaries(diaries: DiaryEntry[]): void {
  const sorted = sortDiariesDescending(diaries);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted));
  } catch (e) {
    console.warn('Direct localStorage save quota exceeded, trimming cache payload:', e);
    try {
      // 1. Fallback: preserve thumbnails or lightweight URLs (< 80KB), omitting large multi-MB base64 strings
      const leanDiaries = sorted.map((d) => ({
        ...d,
        photos: (d.photos || []).map((p) => ({
          id: p.id,
          caption: p.caption,
          timestamp: p.timestamp,
          isCover: p.isCover,
          isChunked: p.isChunked,
          chunkCount: p.chunkCount,
          thumbnailUrl: p.thumbnailUrl,
          // Only keep url if it's already a thumbnail or small (< 80KB)
          url: p.thumbnailUrl || (p.url && p.url.length < 80000 ? p.url : ''),
        })),
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(leanDiaries));
    } catch (innerErr) {
      console.warn('Fallback lean save also exceeded, saving essential feed items:', innerErr);
      try {
        // 2. Fallback: Keep most recent 20 diaries
        const minimal = sorted.slice(0, 20).map((d) => ({
          ...d,
          photos: (d.photos || []).filter(p => p.isCover).map((p) => ({
            id: p.id,
            caption: p.caption,
            timestamp: p.timestamp,
            isCover: true,
            url: p.thumbnailUrl || '',
          })),
        }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(minimal));
      } catch (finalErr) {
        console.error('All localStorage fallback saves failed:', finalErr);
      }
    }
  }
}

export function exportDiariesToJson(diaries: DiaryEntry[]): void {
  const sorted = sortDiariesDescending(diaries);
  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(sorted, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute('href', dataStr);
  downloadAnchor.setAttribute('download', `solo-travel-diaries-${new Date().toISOString().slice(0, 10)}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

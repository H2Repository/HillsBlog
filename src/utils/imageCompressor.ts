import { DiaryEntry, TravelPhoto } from '../types';

export const MAX_PHOTO_DIMENSION = 2048; // Crisp 2K resolution up to 2048px
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024; // 3MB limit per photo (3메가 제한)
export const MAX_HD_PHOTO_BYTES = MAX_PHOTO_BYTES; // Backward compatibility alias
export const MAX_DIARY_PAYLOAD_BYTES = 10 * 1024 * 1024; // 10MB max diary creation payload (including photos)
export const DEFAULT_JPEG_QUALITY = 0.88;

/**
 * Calculates bounding box dimensions so that neither width nor height exceeds maxDimension (up to 2048px),
 * while strictly preserving original aspect ratio.
 */
export function calculateTargetDimensions(
  origWidth: number,
  origHeight: number,
  maxDimension: number = MAX_PHOTO_DIMENSION
): { width: number; height: number; wasScaled: boolean } {
  if (origWidth <= 0 || origHeight <= 0) {
    return { width: maxDimension, height: maxDimension, wasScaled: false };
  }

  // If already within bounds on both dimensions, no downscaling needed
  if (origWidth <= maxDimension && origHeight <= maxDimension) {
    return { width: origWidth, height: origHeight, wasScaled: false };
  }

  const scale = Math.min(maxDimension / origWidth, maxDimension / origHeight);
  return {
    width: Math.max(1, Math.round(origWidth * scale)),
    height: Math.max(1, Math.round(origHeight * scale)),
    wasScaled: true,
  };
}

export const calculateHdDimensions = calculateTargetDimensions;
export const calculate720Dimensions = calculateTargetDimensions;
export const calculate1080Dimensions = calculateTargetDimensions;
export const calculateFullHdDimensions = calculateTargetDimensions;

/**
 * Loads an image from a File, blob URL, or data URL string into an HTMLImageElement
 */
export function loadImage(source: File | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error(`Failed to load image: ${e}`));

    if (typeof source === 'string') {
      img.src = source;
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(source);
    }
  });
}

export interface CompressResult {
  dataUrl: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  wasScaled: boolean;
  sizeBytes: number;
}

/**
 * Compresses an image file or base64 data URL:
 * 1. Supports crisp high resolution (up to 2048px).
 * 2. Downscales if larger while preserving aspect ratio.
 * 3. Enforces strict 3MB limit (3메가 제한): guarantees the resulting photo does not exceed 3MB.
 * 4. Iteratively optimizes quality if necessary to fit comfortably within the 3MB ceiling.
 */
export async function compressPhotoToHd(
  source: File | string,
  quality: number = DEFAULT_JPEG_QUALITY
): Promise<CompressResult> {
  const img = await loadImage(source);
  const origW = img.naturalWidth || img.width;
  const origH = img.naturalHeight || img.height;

  let { width: targetW, height: targetH, wasScaled } = calculateTargetDimensions(origW, origH, MAX_PHOTO_DIMENSION);

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context is not available');
  }

  // Smooth high-definition rendering
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, targetW, targetH);

  let currentQuality = quality;
  let dataUrl = canvas.toDataURL('image/jpeg', currentQuality);
  let sizeBytes = Math.round((dataUrl.length * 3) / 4);

  // If output size exceeds 3MB, iteratively reduce quality or scale down to guarantee <= 3MB
  let attempts = 0;
  while (sizeBytes > MAX_PHOTO_BYTES && attempts < 6) {
    attempts++;
    currentQuality = Math.max(0.45, currentQuality - 0.1);
    dataUrl = canvas.toDataURL('image/jpeg', currentQuality);
    sizeBytes = Math.round((dataUrl.length * 3) / 4);

    if (sizeBytes > MAX_PHOTO_BYTES && attempts >= 2) {
      targetW = Math.round(targetW * 0.85);
      targetH = Math.round(targetH * 0.85);
      canvas.width = targetW;
      canvas.height = targetH;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, targetW, targetH);
      dataUrl = canvas.toDataURL('image/jpeg', currentQuality);
      sizeBytes = Math.round((dataUrl.length * 3) / 4);
      wasScaled = true;
    }
  }

  return {
    dataUrl,
    width: targetW,
    height: targetH,
    originalWidth: origW,
    originalHeight: origH,
    wasScaled,
    sizeBytes,
  };
}

// Backward compatibility aliases
export const compressPhotoTo3MB = compressPhotoToHd;
export const compressPhotoTo2MB = compressPhotoToHd;
export const compressPhotoTo720 = compressPhotoToHd;
export const compressPhotoTo1080 = compressPhotoToHd;
export const compressPhotoToFullHd = compressPhotoToHd;

/**
 * Creates a lightweight thumbnail (max 480px, ~40KB-70KB) for instant feed cover display.
 * Prevents bloating the main diary Firestore document when attached photos are up to 3MB.
 */
export async function createThumbnail(
  source: File | string,
  maxDimension: number = 480,
  quality: number = 0.75
): Promise<string> {
  try {
    const img = await loadImage(source);
    const origW = img.naturalWidth || img.width;
    const origH = img.naturalHeight || img.height;

    const { width: targetW, height: targetH } = calculateTargetDimensions(origW, origH, maxDimension);

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;

    const ctx = canvas.getContext('2d');
    if (!ctx) return typeof source === 'string' ? source : '';

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(img, 0, 0, targetW, targetH);

    return canvas.toDataURL('image/jpeg', quality);
  } catch (err) {
    console.warn('createThumbnail failed, fallback to original:', err);
    return typeof source === 'string' ? source : '';
  }
}

/**
 * Helper to calculate byte size of a diary entry
 */
export function getDiaryPayloadSizeBytes(entry: Partial<DiaryEntry>): number {
  try {
    return new TextEncoder().encode(JSON.stringify(entry)).length;
  } catch {
    return 0;
  }
}

/**
 * Formats bytes to human-readable string (e.g. "420 KB", "2.8 MB")
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Optimizes a single diary entry's photos only if exceeding the 3MB limit.
 */
export async function optimizeDiaryPhotos(diary: DiaryEntry): Promise<{
  updatedDiary: DiaryEntry;
  modified: boolean;
  photosOptimized: number;
}> {
  if (!diary.photos || diary.photos.length === 0) {
    return { updatedDiary: diary, modified: false, photosOptimized: 0 };
  }

  let modified = false;
  let photosOptimized = 0;
  const newPhotos: TravelPhoto[] = [];

  for (const photo of diary.photos) {
    if (photo.url && photo.url.startsWith('data:image/')) {
      const approxBytes = Math.round((photo.url.length * 3) / 4);
      // Only compress if photo exceeds the 3MB limit
      if (approxBytes > MAX_PHOTO_BYTES) {
        try {
          const result = await compressPhotoToHd(photo.url);
          newPhotos.push({
            ...photo,
            url: result.dataUrl,
          });
          modified = true;
          photosOptimized++;
          continue;
        } catch (err) {
          console.warn(`Could not optimize photo ${photo.id}:`, err);
        }
      }
    }
    newPhotos.push(photo);
  }

  return {
    updatedDiary: modified ? { ...diary, photos: newPhotos } : diary,
    modified,
    photosOptimized,
  };
}

/**
 * Optimizes all existing diaries in an array, returning the updated list
 */
export async function optimizeAllDiaries(diaries: DiaryEntry[]): Promise<{
  updatedDiaries: DiaryEntry[];
  totalOptimized: number;
  modifiedDiariesCount: number;
}> {
  let totalOptimized = 0;
  let modifiedDiariesCount = 0;
  const updatedDiaries: DiaryEntry[] = [];

  for (const diary of diaries) {
    const { updatedDiary, modified, photosOptimized } = await optimizeDiaryPhotos(diary);
    if (modified) {
      modifiedDiariesCount++;
      totalOptimized += photosOptimized;
      updatedDiaries.push(updatedDiary);
    } else {
      updatedDiaries.push(diary);
    }
  }

  return {
    updatedDiaries,
    totalOptimized,
    modifiedDiariesCount,
  };
}

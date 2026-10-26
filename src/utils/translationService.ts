import { useState, useEffect } from 'react';
import { SupportedLanguage } from '../i18n/translations';
import { DiaryEntry } from '../types';
export interface LocalizedDiaryContent {
  title: string;
  content: string;
  region: string;
  landmark?: string;
  address: string;
  moodTags: string[];
  recommendedForSolo: string;
  localFood?: string;
  transportTip?: string;
  soloTravelTip?: string;
}

export function getLocalizedDiary(diary: DiaryEntry, lang: SupportedLanguage): DiaryEntry {
  if (lang === 'ko') return diary;
  const cached = getCachedDiaryTranslation(diary.id, lang);
  if (!cached) return diary;

  return {
    ...diary,
    title: cached.title || diary.title,
    content: cached.content || diary.content,
    // Regional names, detailed addresses, and specific landmarks strictly preserve original local language as-is
    location: {
      ...diary.location,
      region: diary.location.region,
      landmark: diary.location.landmark,
      address: diary.location.address,
    },
    moodTags: cached.moodTags || diary.moodTags,
    localInsights: {
      ...diary.localInsights,
      recommendedForSolo: cached.recommendedForSolo || diary.localInsights.recommendedForSolo,
      localFood: cached.localFood || diary.localInsights.localFood,
      transportTip: cached.transportTip || diary.localInsights.transportTip,
      soloTravelTip: cached.soloTravelTip || diary.localInsights.soloTravelTip,
    }
  };
}

// Memory cache for online translation
const memoryCache: Record<string, string> = {};

// Cache key helper
function getCacheKey(diaryId: string, lang: SupportedLanguage): string {
  return `cached_diary_tr_${diaryId}_${lang}`;
}

/**
 * Common tag translations dictionary
 */
export const TAG_TRANSLATIONS: Record<string, Record<SupportedLanguage, string>> = {
  '#나홀로여행': {
    ko: '#나홀로여행',
    en: '#SoloTravel',
    ja: '#一人旅',
    vi: '#DuLichMotMinh',
    es: '#ViajeEnSolitario',
  },
  '#힐링산책': {
    ko: '#힐링산책',
    en: '#HealingWalk',
    ja: '#癒しの散歩',
    vi: '#DiDaoThuGian',
    es: '#PaseoTranquilo',
  },
  '#자전거여행': {
    ko: '#자전거여행',
    en: '#BikeTour',
    ja: '#自転車旅行',
    vi: '#DuLichXeDap',
    es: '#ViajeEnBicicleta',
  },
  '#로드바이크': {
    ko: '#로드바이크',
    en: '#RoadBike',
    ja: '#ロードバイク',
    vi: '#XeDapCuoc',
    es: '#BicicletaDeCarretera',
  },
  '#해외라이딩': {
    ko: '#해외라이딩',
    en: '#OverseasRide',
    ja: '#海外ライディング',
    vi: '#DapXeNuocNgoai',
    es: '#CiclismoInternacional',
  },
  '#시마나미해도': {
    ko: '#시마나미해도',
    en: '#ShimanamiKaido',
    ja: '#しまなみ海道',
    vi: '#ShimanamiKaido',
    es: '#ShimanamiKaido',
  },
  '#르웨탄호수': {
    ko: '#르웨탄호수',
    en: '#SunMoonLake',
    ja: '#日月潭',
    vi: '#HoNhatNguyet',
    es: '#LagoSunMoon',
  },
  '#도나우강': {
    ko: '#도나우강',
    en: '#DanubeRiver',
    ja: '#ドナウ川',
    vi: '#SongDanube',
    es: '#RioDanubio',
  },
  '#일출라이딩': {
    ko: '#일출라이딩',
    en: '#SunriseRide',
    ja: '#日の出ライド',
    vi: '#DapXeDonBinhMinh',
    es: '#RutaAlAmanecer',
  },
  '#노을라이딩': {
    ko: '#노을라이딩',
    en: '#SunsetRide',
    ja: '#夕暮れライド',
    vi: '#DapXeHoangHon',
    es: '#RutaAlAtardecer',
  },
  '#야간라이딩': {
    ko: '#야간라이딩',
    en: '#NightRide',
    ja: '#ナイトライド',
    vi: '#DapXeDem',
    es: '#RutaNocturna',
  },
  '#자전거종주': {
    ko: '#자전거종주',
    en: '#CrossCountryRide',
    ja: '#自転車縦走',
    vi: '#HanhTrinhXeDap',
    es: '#TravesiaEnBicicleta',
  },
  '#라이딩': {
    ko: '#라이딩',
    en: '#Cycling',
    ja: '#ライディング',
    vi: '#DapXe',
    es: '#Ciclismo',
  },
  '#새벽라이딩': {
    ko: '#새벽라이딩',
    en: '#DawnRide',
    ja: '#早朝ライド',
    vi: '#DapXeSangSom',
    es: '#RutaAlAlba',
  },
  '#수상자전거길': {
    ko: '#수상자전거길',
    en: '#FloatingBikeway',
    ja: '#水上サイクルロード',
    vi: '#DuongXeDapTrenNuoc',
    es: '#CicloviaFlotante',
  },
  '#혼여': {
    ko: '#혼여',
    en: '#SoloTrip',
    ja: '#一人旅',
    vi: '#DuLichMotMinh',
    es: '#ViajeEnSolitario',
  },
  '#힐링': {
    ko: '#힐링',
    en: '#Healing',
    ja: '#癒し',
    vi: '#ThuGian',
    es: '#Relajacion',
  },
  '#산책': {
    ko: '#산책',
    en: '#Walk',
    ja: '#散歩',
    vi: '#DiDao',
    es: '#Paseo',
  },
  '#맛집': {
    ko: '#맛집',
    en: '#Gourmet',
    ja: '#グルメ',
    vi: '#AmThuc',
    es: '#Gastronomia',
  },
  '#풍경': {
    ko: '#풍경',
    en: '#Scenery',
    ja: '#風景',
    vi: '#PhongCanh',
    es: '#Paisaje',
  },
  '#바다': {
    ko: '#바다',
    en: '#Ocean',
    ja: '#海',
    vi: '#Bien',
    es: '#Mar',
  },
  '#호수': {
    ko: '#호수',
    en: '#Lake',
    ja: '#湖',
    vi: '#Ho',
    es: '#Lago',
  },
};

/**
 * Common phrase dictionary for instant translation
 */
export const PHRASE_DICTIONARY: Record<string, Record<SupportedLanguage, string>> = {
  // Titles
  '도착 첫째날': {
    ko: '도착 첫째날',
    en: 'First Day of Arrival',
    ja: '到着初日',
    vi: 'Ngày đầu tiên đến nơi',
    es: 'Primer día de llegada',
  },
  '도착 둘째날': {
    ko: '도착 둘째날',
    en: 'Second Day of Arrival',
    ja: '到着2日目',
    vi: 'Ngày thứ hai đến nơi',
    es: 'Segundo día de llegada',
  },
  '도착 셋째날': {
    ko: '도착 셋째날',
    en: 'Third Day of Arrival',
    ja: '到着3日目',
    vi: 'Ngày thứ ba đến nơi',
    es: 'Tercer día de llegada',
  },
  '첫째날': {
    ko: '첫째날',
    en: 'Day 1',
    ja: '1日目',
    vi: 'Ngày 1',
    es: 'Primer día',
  },
  '둘째날': {
    ko: '둘째날',
    en: 'Day 2',
    ja: '2日目',
    vi: 'Ngày 2',
    es: 'Segundo día',
  },
  '셋째날': {
    ko: '셋째날',
    en: 'Day 3',
    ja: '3日目',
    vi: 'Ngày 3',
    es: 'Tercer día',
  },
  '마지막날': {
    ko: '마지막날',
    en: 'Final Day',
    ja: '最終日',
    vi: 'Ngày cuối cùng',
    es: 'Último día',
  },
  '자전거 여행 첫째날': {
    ko: '자전거 여행 첫째날',
    en: 'Day 1 of Backpack Tour',
    ja: '自転車旅行 1日目',
    vi: 'Ngày đầu chuyến du lịch xe đạp',
    es: 'Primer día de la ruta en bicicleta',
  },

  // Contents
  '도착했다': {
    ko: '도착했다',
    en: 'I have arrived.',
    ja: '到着した。',
    vi: 'Tôi đã đến nơi.',
    es: 'He llegado.',
  },
  '도착했다.': {
    ko: '도착했다.',
    en: 'I have arrived.',
    ja: '到着した。',
    vi: 'Tôi đã đến nơi.',
    es: 'He llegado.',
  },
  '출발했다': {
    ko: '출발했다',
    en: 'Departed.',
    ja: '出発した。',
    vi: 'Đã xuất phát.',
    es: 'He partido.',
  },
  '출발했다.': {
    ko: '출발했다.',
    en: 'Departed.',
    ja: '出発した。',
    vi: 'Đã xuất phát.',
    es: 'He partido.',
  },
  '안전하게 완주했다.': {
    ko: '안전하게 완주했다.',
    en: 'Safely finished the ride.',
    ja: '安全に完走した。',
    vi: 'Đã hoàn thành chuyến đi an toàn.',
    es: 'Completé el recorrido con seguridad.',
  },

  // Local Insights
  '혼자 방문해도 눈치 보이지 않고 편안하게 사색할 수 있는 차분한 분위기': {
    ko: '혼자 방문해도 눈치 보이지 않고 편안하게 사색할 수 있는 차분한 분위기',
    en: 'A peaceful atmosphere where you can contemplate comfortably without feeling self-conscious even when visiting alone.',
    ja: '一人で訪れても周囲の目を気にせず、落ち着いて思索できる穏やかな雰囲気。',
    vi: 'Không gian yên bình giúp bạn thoải mái suy ngẫm mà không lo bị để ý dù đi một mình.',
    es: 'Un ambiente tranquilo donde puedes meditar cómodamente sin sentirte observado, incluso visitando solo.',
  },
  '혼자만의 시간을 오롯이 느끼기 좋은 여유로운 장소': {
    ko: '혼자만의 시간을 오롯이 느끼기 좋은 여유로운 장소',
    en: 'A serene place perfect for fully immersing in your own solo time.',
    ja: '一人の時間を心ゆくまで感じられるゆったりとした場所。',
    vi: 'Một nơi thư thả lý tưởng để tận hưởng trọn vẹn khoảng thời gian riêng tư.',
    es: 'Un lugar sereno ideal para disfrutar de tu propio tiempo en soledad.',
  },
};

/**
 * Check if a text contains Korean characters (Hangul)
 */
export function hasKorean(text: string): boolean {
  return /[\uac00-\ud7a3]/.test(text);
}

/**
 * Translate a single tag
 */
export function translateTag(tag: string, lang: SupportedLanguage): string {
  if (lang === 'ko') return tag;
  const cleanTag = tag.trim();
  if (TAG_TRANSLATIONS[cleanTag]?.[lang]) {
    return TAG_TRANSLATIONS[cleanTag][lang];
  }
  // Try without hashtag
  const noHash = cleanTag.replace(/^#/, '');
  if (TAG_TRANSLATIONS[`#${noHash}`]?.[lang]) {
    return TAG_TRANSLATIONS[`#${noHash}`][lang];
  }
  return tag;
}

/**
 * Translate known phrases or return best fallback
 */
export function translatePhrase(text: string, lang: SupportedLanguage): string {
  if (lang === 'ko' || !text) return text;
  const trimmed = text.trim();
  if (PHRASE_DICTIONARY[trimmed]?.[lang]) {
    return PHRASE_DICTIONARY[trimmed][lang];
  }
  return text;
}

/**
 * Online translation fetcher using Google Translate web service
 */
export async function translateTextOnline(text: string, targetLang: SupportedLanguage): Promise<string> {
  if (targetLang === 'ko' || !text || !text.trim()) {
    return text;
  }

  // Check phrase dictionary first
  const phraseMatch = translatePhrase(text, targetLang);
  if (phraseMatch !== text) {
    return phraseMatch;
  }

  const cacheKey = `tr_mem_${targetLang}_${text.trim()}`;
  if (memoryCache[cacheKey]) {
    return memoryCache[cacheKey];
  }

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text.trim())}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Translation failed with status ${res.status}`);
    }
    const data = await res.json();
    if (Array.isArray(data) && Array.isArray(data[0])) {
      const translated = data[0].map((item: any) => item[0]).join('');
      if (translated) {
        memoryCache[cacheKey] = translated;
        return translated;
      }
    }
  } catch (err) {
    console.warn('Online translation error:', err);
  }

  return text;
}

/**
 * Get cached translation from localStorage
 */
export function getCachedDiaryTranslation(diaryId: string, lang: SupportedLanguage): LocalizedDiaryContent | null {
  if (lang === 'ko') return null;
  try {
    const raw = localStorage.getItem(getCacheKey(diaryId, lang));
    if (raw) {
      return JSON.parse(raw) as LocalizedDiaryContent;
    }
  } catch (e) {
    console.warn('Failed to parse cached translation:', e);
  }
  return null;
}

/**
 * Save translation to localStorage and notify components
 */
export function saveCachedDiaryTranslation(diaryId: string, lang: SupportedLanguage, data: LocalizedDiaryContent): void {
  if (lang === 'ko') return;
  try {
    localStorage.setItem(getCacheKey(diaryId, lang), JSON.stringify(data));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('diary_translation_updated', { detail: { diaryId, lang } }));
    }
  } catch (e) {
    console.warn('Failed to save cached translation:', e);
  }
}

/**
 * Hook to trigger re-renders when translations are updated in cache
 */
export function useTranslationVersion(): number {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const handleUpdate = () => setVersion((v) => v + 1);
    window.addEventListener('diary_translation_updated', handleUpdate);
    return () => window.removeEventListener('diary_translation_updated', handleUpdate);
  }, []);

  return version;
}

/**
 * Translate a complete DiaryEntry asynchronously and store in cache
 */
export async function translateDiaryAsync(diary: DiaryEntry, lang: SupportedLanguage): Promise<LocalizedDiaryContent> {
  // Translate title
  const title = await translateTextOnline(diary.title, lang);

  // Translate content
  const content = await translateTextOnline(diary.content, lang);

  // Translate tags
  const moodTags = await Promise.all(
    diary.moodTags.map(async (tag) => {
      const dictTag = translateTag(tag, lang);
      if (dictTag !== tag) return dictTag;
      if (hasKorean(tag)) {
        const clean = tag.replace(/^#/, '');
        const trans = await translateTextOnline(clean, lang);
        return `#${trans.replace(/\s+/g, '')}`;
      }
      return tag;
    })
  );

  // Translate local insights
  const recommendedForSolo = await translateTextOnline(diary.localInsights.recommendedForSolo, lang);
  const localFood = diary.localInsights.localFood ? await translateTextOnline(diary.localInsights.localFood, lang) : undefined;
  const transportTip = diary.localInsights.transportTip ? await translateTextOnline(diary.localInsights.transportTip, lang) : undefined;
  const soloTravelTip = diary.localInsights.soloTravelTip ? await translateTextOnline(diary.localInsights.soloTravelTip, lang) : undefined;

  const result: LocalizedDiaryContent = {
    title,
    content,
    region: diary.location.region,
    landmark: diary.location.landmark,
    address: diary.location.address,
    moodTags,
    recommendedForSolo,
    localFood,
    transportTip,
    soloTravelTip,
  };

  saveCachedDiaryTranslation(diary.id, lang, result);
  return result;
}

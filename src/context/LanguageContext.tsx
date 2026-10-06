import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { SupportedLanguage, translations, TranslationKeys, LANGUAGE_OPTIONS, LanguageOption } from '../i18n/translations';

interface LanguageContextType {
  language: SupportedLanguage;
  systemLanguage: SupportedLanguage;
  isSystemLanguage: boolean;
  hasManualOverride: boolean;
  setLanguage: (lang: SupportedLanguage) => void;
  resetToSystemLanguage: () => void;
  t: (key: TranslationKeys, params?: Record<string, string | number>) => string;
  languageOptions: LanguageOption[];
  currentOption: LanguageOption;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const MANUAL_OVERRIDE_KEY = 'bike_diary_manual_override';
const LEGACY_STORAGE_KEY = 'bike_diary_lang_pref';

/**
 * Detect the operating system or browser's language preference
 */
export const detectSystemLanguage = (): SupportedLanguage => {
  if (typeof navigator === 'undefined') return 'ko';
  try {
    const candidateLangs: string[] = [];
    if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
      candidateLangs.push(...navigator.languages);
    }
    if (navigator.language) {
      candidateLangs.push(navigator.language);
    }
    if ((navigator as any).userLanguage) {
      candidateLangs.push((navigator as any).userLanguage);
    }
    if ((navigator as any).browserLanguage) {
      candidateLangs.push((navigator as any).browserLanguage);
    }

    for (const lang of candidateLangs) {
      if (!lang || typeof lang !== 'string') continue;
      const clean = lang.toLowerCase().trim().split('-')[0].split('_')[0];
      const matched = LANGUAGE_OPTIONS.find(opt => opt.code === clean);
      if (matched) {
        return matched.code;
      }
      if (clean === 'kor') return 'ko';
      if (clean === 'eng') return 'en';
      if (clean === 'jpn' || clean === 'jp') return 'ja';
      if (clean === 'vie') return 'vi';
      if (clean === 'spa') return 'es';
    }
  } catch (e) {
    console.warn('System language detection error:', e);
  }
  return 'ko';
};

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [systemLanguage, setSystemLanguage] = useState<SupportedLanguage>(() => detectSystemLanguage());
  const [hasManualOverride, setHasManualOverride] = useState<boolean>(() => {
    try {
      return !!localStorage.getItem(MANUAL_OVERRIDE_KEY);
    } catch {
      return false;
    }
  });

  // Initialize language: on execution, use manual override if explicitly chosen, otherwise use system language
  const [language, setLanguageState] = useState<SupportedLanguage>(() => {
    try {
      const manual = localStorage.getItem(MANUAL_OVERRIDE_KEY);
      if (manual && LANGUAGE_OPTIONS.some(opt => opt.code === manual)) {
        return manual as SupportedLanguage;
      }
    } catch {
      // ignore
    }
    // Execution default: follows system language
    return detectSystemLanguage();
  });

  // Listen to browser/system language changes in real-time
  useEffect(() => {
    const handleLanguageChange = () => {
      const detected = detectSystemLanguage();
      setSystemLanguage(detected);

      // If user hasn't explicitly locked a manual override, follow the new system language automatically
      try {
        const manual = localStorage.getItem(MANUAL_OVERRIDE_KEY);
        if (!manual) {
          setLanguageState(detected);
          document.documentElement.lang = detected;
        }
      } catch {
        setLanguageState(detected);
      }
    };

    window.addEventListener('languagechange', handleLanguageChange);
    return () => {
      window.removeEventListener('languagechange', handleLanguageChange);
    };
  }, []);

  const setLanguage = (newLang: SupportedLanguage) => {
    setLanguageState(newLang);
    setHasManualOverride(true);
    try {
      localStorage.setItem(MANUAL_OVERRIDE_KEY, newLang);
      localStorage.setItem(LEGACY_STORAGE_KEY, newLang);
    } catch {
      // ignore
    }
    document.documentElement.lang = newLang;
  };

  const resetToSystemLanguage = useCallback(() => {
    try {
      localStorage.removeItem(MANUAL_OVERRIDE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // ignore
    }
    const detected = detectSystemLanguage();
    setSystemLanguage(detected);
    setHasManualOverride(false);
    setLanguageState(detected);
    document.documentElement.lang = detected;
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const t = (key: TranslationKeys, params?: Record<string, string | number>): string => {
    const langDict = translations[language] || translations.ko;
    let str: string = (langDict as any)[key] || (translations.ko as any)[key] || String(key);

    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      });
    }

    return str;
  };

  const currentOption = LANGUAGE_OPTIONS.find(opt => opt.code === language) || LANGUAGE_OPTIONS[0];
  const isSystemLanguage = language === systemLanguage && !hasManualOverride;

  return (
    <LanguageContext.Provider
      value={{
        language,
        systemLanguage,
        isSystemLanguage,
        hasManualOverride,
        setLanguage,
        resetToSystemLanguage,
        t,
        languageOptions: LANGUAGE_OPTIONS,
        currentOption,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = (): LanguageContextType => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};


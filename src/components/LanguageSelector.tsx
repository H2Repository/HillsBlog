import React, { useState, useRef, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { Globe, Check, ChevronDown } from 'lucide-react';
import { SupportedLanguage } from '../i18n/translations';

interface LanguageSelectorProps {
  compact?: boolean;
}

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({ compact = false }) => {
  const { 
    language, 
    setLanguage, 
    languageOptions, 
    currentOption, 
    systemLanguage, 
    hasManualOverride, 
    resetToSystemLanguage, 
    t 
  } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleSelectLanguage = (code: SupportedLanguage) => {
    setLanguage(code);
    setIsOpen(false);
  };

  const handleResetToSystem = () => {
    resetToSystemLanguage();
    setIsOpen(false);
  };

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      {/* Language Trigger Button with Globe icon, Flag, Language Short Code, and Chevron */}
      <button
        id="btn-language-selector"
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-stone-800/90 hover:bg-stone-700 text-xs font-medium text-stone-200 hover:text-white border border-stone-700 shadow-sm transition-all duration-150 active:scale-95"
        title={t('langSelectTitle')}
        aria-expanded={isOpen}
      >
        <Globe className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <span className="text-xs leading-none" aria-hidden="true">{currentOption.flag}</span>
        <span className="text-xs font-bold text-stone-200 tracking-wide uppercase">{currentOption.shortCode}</span>
        <ChevronDown className={`w-3 h-3 text-stone-400 transition-transform duration-200 ${isOpen ? 'rotate-180 text-amber-400' : ''}`} />
      </button>

      {/* Language Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 sm:left-0 sm:right-auto mt-2 w-52 rounded-xl bg-stone-900 border border-stone-700/80 shadow-2xl py-1.5 z-50 animate-in fade-in zoom-in-95 duration-150 backdrop-blur-md">
          <div className="px-3 py-1.5 border-b border-stone-800 text-[10px] font-semibold text-stone-400 uppercase tracking-wider flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-amber-400" />
              <span>{t('langSelectTitle')}</span>
            </span>
          </div>

          <div className="py-1">
            {languageOptions.map((opt) => {
              const isSelected = opt.code === language;
              const isSystem = opt.code === systemLanguage;
              return (
                <button
                  key={opt.code}
                  id={`btn-lang-option-${opt.code}`}
                  type="button"
                  onClick={() => handleSelectLanguage(opt.code)}
                  className={`w-full flex items-center justify-between px-3 py-2 text-xs transition text-left ${
                    isSelected
                      ? 'bg-amber-600/20 text-amber-300 font-semibold'
                      : 'text-stone-300 hover:bg-stone-800 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm leading-none">{opt.flag}</span>
                    <span className="text-xs font-medium">{opt.label}</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-stone-800 text-amber-300/90 font-mono font-bold border border-stone-700">
                      {opt.shortCode}
                    </span>
                    {isSystem && (
                      <span className="text-[9px] px-1 py-0.2 rounded bg-stone-800 text-stone-400 border border-stone-700">
                        {t('autoDetected')}
                      </span>
                    )}
                  </div>

                  {isSelected && (
                    <Check className="w-3.5 h-3.5 text-amber-400 shrink-0 ml-2" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Reset to System Language Option if user manually chose a different language */}
          {hasManualOverride && (
            <div className="pt-1 mt-1 border-t border-stone-800 px-1">
              <button
                type="button"
                id="btn-lang-reset-system"
                onClick={handleResetToSystem}
                className="w-full flex items-center justify-between px-2.5 py-1.5 text-[11px] text-stone-400 hover:text-amber-300 hover:bg-stone-800/80 rounded-lg transition"
                title={t('systemLangLabel')}
              >
                <span className="flex items-center gap-1.5">
                  <Globe className="w-3 h-3 text-stone-500" />
                  <span>{t('systemLangLabel')}</span>
                </span>
                <span className="text-[10px] font-mono text-amber-400 font-semibold">
                  {systemLanguage.toUpperCase()}
                </span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

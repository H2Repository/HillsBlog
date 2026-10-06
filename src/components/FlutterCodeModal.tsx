import React, { useState } from 'react';
import { 
  X, 
  Copy, 
  Check, 
  FileText, 
  Download
} from 'lucide-react';
import { FLUTTER_CODE_SNIPPETS } from '../utils/flutterSnippets';
import { FlutterIcon } from './FlutterIcon';

export { FLUTTER_CODE_SNIPPETS };

interface FlutterCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDownloadZip?: () => void;
}

export const FlutterCodeModal: React.FC<FlutterCodeModalProps> = ({
  isOpen,
  onClose,
  onDownloadZip,
}) => {
  const [activeTab, setActiveTab] = useState<keyof typeof FLUTTER_CODE_SNIPPETS>('main');
  const [copiedTab, setCopiedTab] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);

  if (!isOpen) return null;

  const currentCode = FLUTTER_CODE_SNIPPETS[activeTab];

  const handleCopyCurrent = () => {
    navigator.clipboard.writeText(currentCode);
    setCopiedTab(true);
    setTimeout(() => setCopiedTab(false), 2000);
  };

  const handleCopyAll = () => {
    const fullSource = `// ============================================
// Hill's Blog (Travel Diary) - Flutter Complete Source Code
// ============================================

// 1. pubspec.yaml
${FLUTTER_CODE_SNIPPETS.pubspec}

// 2. lib/models/diary_entry.dart
${FLUTTER_CODE_SNIPPETS.models}

// 3. lib/services/location_service.dart
${FLUTTER_CODE_SNIPPETS.location}

// 4. lib/services/firestore_service.dart
${FLUTTER_CODE_SNIPPETS.firestore}

// 5. lib/screens/travel_map_screen.dart (히스토리 지도)
${FLUTTER_CODE_SNIPPETS.screens}

// 6. lib/screens/diary_editor_screen.dart (일기 작성/수정)
${FLUTTER_CODE_SNIPPETS.editor}

// 7. lib/main.dart
${FLUTTER_CODE_SNIPPETS.main}

// 8. README.md
${FLUTTER_CODE_SNIPPETS.readme}
`;
    navigator.clipboard.writeText(fullSource);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2500);
  };

  const tabList: { key: keyof typeof FLUTTER_CODE_SNIPPETS; label: string; badge?: string }[] = [
    { key: 'main', label: 'main.dart' },
    { key: 'models', label: 'diary_entry.dart' },
    { key: 'screens', label: 'travel_map_screen.dart', badge: '히스토리 지도' },
    { key: 'editor', label: 'diary_editor_screen.dart', badge: '작성/수정' },
    { key: 'firestore', label: 'firestore_service.dart', badge: '클라우드' },
    { key: 'location', label: 'location_service.dart', badge: 'GPS' },
    { key: 'pubspec', label: 'pubspec.yaml' },
    { key: 'readme', label: 'README.md' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="bg-stone-900 border border-stone-700 w-full max-w-5xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] text-stone-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-stone-800 bg-stone-950 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-500/30 flex items-center justify-center font-bold">
              <FlutterIcon className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-white">
                  Hill's Blog • Flutter (Dart) 모바일 소스코드
                </h2>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-950 text-amber-400 border border-amber-800 font-mono">
                  Flutter 3.x
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800">
                  히스토리 지도 & Firebase 지원
                </span>
              </div>
              <p className="text-xs text-stone-400 mt-0.5">
                실시간 위치(GPS), 사진 첨부, 히스토리 지도(OpenStreetMap 경로 궤적), Firestore 클라우드 실시간 동기화 완비
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Top Bar */}
        <div className="px-4 py-2.5 bg-stone-900/90 border-b border-stone-800 flex flex-wrap items-center justify-between gap-2">
          {/* File Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto text-xs py-1">
            {tabList.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`px-3 py-1.5 rounded-lg font-mono transition flex items-center gap-1.5 whitespace-nowrap ${
                  activeTab === tab.key
                    ? 'bg-amber-600 text-white font-semibold shadow'
                    : 'text-stone-400 hover:bg-stone-800 hover:text-stone-200'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
                {tab.badge && (
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                    activeTab === tab.key ? 'bg-amber-700 text-amber-100' : 'bg-stone-800 text-stone-400'
                  }`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Copy and Download Buttons */}
          <div className="flex items-center gap-2">
            {onDownloadZip && (
              <button
                type="button"
                onClick={onDownloadZip}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-600 text-xs font-semibold text-white shadow transition active:scale-95 cursor-pointer"
                title="프로젝트 전체 소스코드 .zip 파일 다운로드"
              >
                <FlutterIcon className="w-3.5 h-3.5" />
                <span>전체 소스 ZIP 다운로드</span>
                <Download className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={handleCopyCurrent}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-xs font-semibold text-stone-200 transition"
            >
              {copiedTab ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedTab ? '현재 파일 복사됨!' : '현재 파일 복사'}</span>
            </button>

            <button
              type="button"
              onClick={handleCopyAll}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white text-xs font-bold shadow-md transition active:scale-95"
            >
              {copiedAll ? <Check className="w-3.5 h-3.5 text-white" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedAll ? '전체 코드 복사 완료!' : '전체 Flutter 코드 복사'}</span>
            </button>
          </div>
        </div>

        {/* Code Viewer */}
        <div className="flex-1 overflow-y-auto p-4 bg-stone-950/90 font-mono text-xs leading-relaxed text-stone-300">
          <pre className="whitespace-pre overflow-x-auto">
            <code>{currentCode}</code>
          </pre>
        </div>

        {/* Footer info */}
        <div className="p-3 bg-stone-950 border-t border-stone-800 text-[11px] text-stone-500 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>💡 flutter create hills_blog_app 후 코드를 복사하여 안드로이드 및 iOS 앱으로 즉시 빌드 및 실행할 수 있습니다.</span>
          <span className="text-amber-500/90 font-medium">Hill's Blog 모바일 킷 (동기화 완료)</span>
        </div>
      </div>
    </div>
  );
};

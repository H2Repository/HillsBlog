import React, { useState } from 'react';
import { 
  X, 
  ShieldCheck, 
  Lock, 
  Key, 
  AlertCircle, 
  CheckCircle2, 
  Loader2, 
  UserCheck 
} from 'lucide-react';
import { useAuth, ADMIN_EMAIL } from '../context/AuthContext';

export const LoginModal: React.FC = () => {
  const { 
    isLoginModalOpen, 
    closeLoginModal, 
    loginActionPrompt, 
    loginWithGoogle, 
    loginWithAdminPasscode,
    isLoading,
    currentUser,
    logout
  } = useAuth();

  const [activeTab, setActiveTab] = useState<'passcode' | 'google'>('passcode');
  const [passcode, setPasscode] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isLoginModalOpen) return null;

  const handlePasscodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    if (!passcode.trim()) {
      setErrorMessage('비밀번호를 입력해주세요.');
      return;
    }

    setIsSubmitting(true);
    const res = await loginWithAdminPasscode(passcode);
    setIsSubmitting(false);

    if (!res.success) {
      setErrorMessage(res.error || '로그인에 실패했습니다.');
    } else {
      setPasscode('');
    }
  };

  const handleGoogleLogin = async () => {
    setErrorMessage(null);
    setIsSubmitting(true);
    const res = await loginWithGoogle();
    setIsSubmitting(false);

    if (!res.success) {
      setErrorMessage(res.error || 'Google 로그인 중 오류가 발생했습니다.');
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto"
      onClick={closeLoginModal}
    >
      <div 
        className="bg-white border border-stone-200 w-[95vw] max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col text-stone-900 my-auto max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 bg-stone-900 text-stone-100 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2 truncate">
                블로그 관리자 로그인
              </h2>
              <p className="text-[10px] sm:text-xs text-stone-400 mt-0.5 leading-tight">
                관리자 전용 기능을 위해 로그인해주세요.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={closeLoginModal}
            className="p-1.5 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800 transition shrink-0 ml-2"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action prompt if triggered by an action */}
        {loginActionPrompt && (
          <div className="px-4 sm:px-5 py-2.5 bg-amber-50 border-b border-amber-200/80 flex items-center gap-2 text-[11px] sm:text-xs text-amber-900">
            <AlertCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-600 shrink-0" />
            <span className="font-medium">{loginActionPrompt}</span>
          </div>
        )}

        {/* Body */}
        <div className="p-5 sm:p-6 space-y-5">
          {currentUser ? (
            /* Already logged in view */
            <div className="space-y-4 text-center py-2">
              <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-stone-900">현재 로그인되어 있습니다</h3>
                <p className="text-[11px] sm:text-xs text-stone-500 mt-1 break-all">
                  계정: <span className="font-semibold text-stone-800">{currentUser.email || currentUser.displayName}</span>
                </p>
                <div className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 text-[10px] sm:text-xs font-semibold">
                  <UserCheck className="w-3.5 h-3.5" />
                  <span>관리자 권한 보유</span>
                </div>
              </div>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={logout}
                  className="w-full py-2.5 rounded-xl border border-stone-300 hover:bg-stone-50 text-xs font-semibold text-stone-700 transition active:scale-98"
                >
                  로그아웃
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Tab Selector */}
              <div className="flex rounded-xl bg-stone-100 p-1 text-[11px] sm:text-xs font-medium">
                <button
                  type="button"
                  onClick={() => { setActiveTab('passcode'); setErrorMessage(null); }}
                  className={`flex-1 py-2 rounded-lg transition flex items-center justify-center gap-1.5 ${
                    activeTab === 'passcode' 
                      ? 'bg-white text-stone-900 font-bold shadow-sm' 
                      : 'text-stone-500 hover:text-stone-800'
                  }`}
                >
                  <Key className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>비밀번호</span>
                </button>
                <button
                  type="button"
                  disabled={true}
                  className="flex-1 py-2 rounded-lg flex items-center justify-center gap-1.5 text-stone-300 cursor-not-allowed opacity-50"
                >
                  <svg className="w-3.5 h-3.5 opacity-60 shrink-0" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                  </svg>
                  <span>Google</span>
                </button>
              </div>

              {/* Tab 1: Passcode Form */}
              {activeTab === 'passcode' && (
                <form onSubmit={handlePasscodeSubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[11px] sm:text-xs font-semibold text-stone-700 flex items-center justify-between">
                      <span>관리자 비밀번호</span>
                      <span className="text-[10px] text-stone-400 font-normal truncate ml-2">계정: {ADMIN_EMAIL}</span>
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="password"
                        value={passcode}
                        onChange={(e) => setPasscode(e.target.value)}
                        placeholder="비밀번호 입력"
                        className="w-full pl-9 pr-3 py-2.5 text-xs rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 transition-all"
                        autoFocus
                      />
                    </div>
                  </div>

                  {errorMessage && (
                    <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-[11px] sm:text-xs text-rose-700 flex items-center gap-2 animate-in slide-in-from-top-1">
                      <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                      <span>{errorMessage}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isSubmitting || isLoading}
                    className="w-full py-2.5 sm:py-3 rounded-xl bg-amber-600 hover:bg-amber-500 active:scale-95 text-white text-xs font-bold shadow-md shadow-amber-900/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:active:scale-100"
                  >
                    {isSubmitting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Key className="w-4 h-4" />
                    )}
                    <span>관리자 로그인</span>
                  </button>
                </form>
              )}

              {/* Tab 2: Google Sign-In (Disabled) */}
              {activeTab === 'google' && (
                <div className="space-y-4 py-1">
                  <div className="p-3 rounded-xl bg-stone-100 border border-stone-200 text-stone-600 text-[11px] sm:text-xs space-y-1.5">
                    <div className="flex items-center gap-1.5 font-bold text-stone-800">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>Google 로그인이 비활성화되었습니다</span>
                    </div>
                    <p className="text-[10px] sm:text-[11px] text-stone-500 leading-relaxed">
                      현재 구글 로그인은 비활성화 정책에 따라 사용하실 수 없습니다. 블로그 관리 기능을 이용하시려면 <strong>관리자 비밀번호</strong>로 로그인해주세요.
                    </p>
                  </div>

                  {errorMessage && (
                    <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-[11px] sm:text-xs text-rose-700 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                      <span>{errorMessage}</span>
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={true}
                    className="w-full py-2.5 px-4 rounded-xl border border-stone-200 bg-stone-100 text-stone-400 text-xs font-semibold flex items-center justify-center gap-2.5 shadow-none cursor-not-allowed select-none pointer-events-none opacity-60"
                  >
                    <svg className="w-4 h-4 opacity-50 grayscale" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                    </svg>
                    <span>Google 로그인</span>
                  </button>

                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => { setActiveTab('passcode'); setErrorMessage(null); }}
                      className="w-full py-2 px-3 text-[11px] sm:text-xs text-amber-700 hover:text-amber-800 font-semibold text-center hover:underline cursor-pointer"
                    >
                      ← 관리자 비밀번호 입력으로 이동
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer info */}
        <div className="px-5 sm:px-6 py-3 bg-stone-50 border-t border-stone-200 text-[10px] sm:text-[11px] text-stone-500 flex items-center justify-between shrink-0">
          <span className="truncate mr-2">방문자 모드: 코스 검색 및 지도 탐색 가능</span>
          <span className="text-amber-700 font-bold shrink-0">관리자 전용</span>
        </div>
      </div>
    </div>
  );
};

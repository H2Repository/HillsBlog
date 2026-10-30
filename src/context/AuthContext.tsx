import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged,
  User as FirebaseUser
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import { stopSyncQueue } from '../utils/syncManager';

// Designated Admin Email from system metadata
export const ADMIN_EMAIL = 'htol65@gmail.com';
const ADMIN_SESSION_STORAGE_KEY = 'hills_blog_admin_session';
const LAST_ACTIVITY_STORAGE_KEY = 'hills_blog_last_activity';
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes (10분 무작업 시 자동 로그아웃)

export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  isAdmin: boolean;
  provider: 'google' | 'admin_credentials';
}

interface AuthContextType {
  currentUser: AppUser | null;
  isAdmin: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  isLoginModalOpen: boolean;
  loginActionPrompt: string | null;
  autoLogoutNotice: string | null;
  clearAutoLogoutNotice: () => void;
  openLoginModal: (promptReason?: string) => void;
  closeLoginModal: () => void;
  loginWithGoogle: () => Promise<{ success: boolean; error?: string }>;
  loginWithAdminPasscode: (passcode: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [loginActionPrompt, setLoginActionPrompt] = useState<string | null>(null);
  const [autoLogoutNotice, setAutoLogoutNotice] = useState<string | null>(null);

  const lastActivityRef = useRef<number>(Date.now());

  const clearAutoLogoutNotice = useCallback(() => {
    setAutoLogoutNotice(null);
  }, []);

  const closeLoginModal = useCallback(() => {
    setIsLoginModalOpen(false);
    setLoginActionPrompt(null);
  }, []);

  const logout = useCallback(async (isAuto = false) => {
    try {
      await signOut(auth);
    } catch (e) {
      console.warn('Firebase signout error:', e);
    }
    localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
    localStorage.removeItem(LAST_ACTIVITY_STORAGE_KEY);
    setCurrentUser(null);
    closeLoginModal();
    // Stop sync and refresh operations when admin logs out
    stopSyncQueue();
    if (isAuto) {
      setAutoLogoutNotice('10분 동안 아무런 활동이 없어 보안을 위해 자동 로그아웃되었습니다.');
    }
  }, [closeLoginModal]);

  // Update activity timestamp on user action (touch, tap, scroll, key, click)
  const recordActivity = useCallback(() => {
    const now = Date.now();
    // Throttle updates to at most once per 1 second
    if (now - lastActivityRef.current > 1000) {
      lastActivityRef.current = now;
      try {
        localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, now.toString());
      } catch {
        // ignore storage errors
      }
    }
  }, []);

  // Check saved admin session on boot
  useEffect(() => {
    try {
      const savedAdminSession = localStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
      if (savedAdminSession) {
        // Verify if 10-minute inactivity timeout has already expired
        const lastActive = localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY);
        if (lastActive) {
          const elapsed = Date.now() - parseInt(lastActive, 10);
          if (elapsed >= INACTIVITY_TIMEOUT_MS) {
            localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
            localStorage.removeItem(LAST_ACTIVITY_STORAGE_KEY);
            setCurrentUser(null);
            setIsLoading(false);
            return;
          }
        }

        const parsed = JSON.parse(savedAdminSession);
        if (parsed && parsed.isAdmin) {
          setCurrentUser(parsed);
          lastActivityRef.current = Date.now();
          localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, Date.now().toString());
          setIsLoading(false);
          return;
        }
      }
    } catch (e) {
      console.warn('Failed to parse saved admin session', e);
    }

    // Listen to Firebase Auth state
    const unsubscribe = onAuthStateChanged(auth, (fbUser: FirebaseUser | null) => {
      if (fbUser) {
        // Check if session has expired
        const lastActive = localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY);
        if (lastActive) {
          const elapsed = Date.now() - parseInt(lastActive, 10);
          if (elapsed >= INACTIVITY_TIMEOUT_MS) {
            logout(true);
            setIsLoading(false);
            return;
          }
        }

        const userEmail = fbUser.email || '';
        const isAdmin = userEmail.toLowerCase() === ADMIN_EMAIL.toLowerCase() || userEmail.length > 0;
        
        const appUser: AppUser = {
          uid: fbUser.uid,
          email: userEmail,
          displayName: fbUser.displayName || userEmail.split('@')[0] || '사용자',
          photoURL: fbUser.photoURL || undefined,
          isAdmin,
          provider: 'google',
        };
        setCurrentUser(appUser);
        lastActivityRef.current = Date.now();
        localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, Date.now().toString());
      } else {
        const savedSession = localStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
        if (!savedSession) {
          setCurrentUser(null);
        }
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [logout]);

  // Set up 10-minute inactivity detection when authenticated
  useEffect(() => {
    if (!currentUser) return;

    // Reset activity timer immediately upon login
    const now = Date.now();
    lastActivityRef.current = now;
    try {
      localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, now.toString());
    } catch {
      // ignore
    }

    // User interaction events to detect activity on phones and desktop
    const activityEvents = [
      'touchstart',
      'touchend',
      'touchmove',
      'pointerdown',
      'pointerup',
      'pointermove',
      'click',
      'scroll',
      'keydown',
      'mousedown',
      'mousemove'
    ];
    activityEvents.forEach(event => {
      window.addEventListener(event, recordActivity, { passive: true });
      document.addEventListener(event, recordActivity, { passive: true });
    });

    // Check every 3 seconds for inactivity timeout
    const intervalId = setInterval(() => {
      let lastActive = lastActivityRef.current;
      try {
        const stored = localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY);
        if (stored) {
          const parsed = parseInt(stored, 10);
          if (!isNaN(parsed) && parsed > lastActive) {
            lastActive = parsed;
            lastActivityRef.current = parsed;
          }
        }
      } catch {
        // ignore
      }

      const elapsed = Date.now() - lastActive;
      if (elapsed >= INACTIVITY_TIMEOUT_MS) {
        logout(true);
      }
    }, 3000);

    // Also check immediately when phone screen turns back on, or tab becomes visible/focused
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        let lastActive = lastActivityRef.current;
        try {
          const stored = localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY);
          if (stored) {
            const parsed = parseInt(stored, 10);
            if (!isNaN(parsed)) {
              lastActive = parsed;
            }
          }
        } catch {
          // ignore
        }
        if (Date.now() - lastActive >= INACTIVITY_TIMEOUT_MS) {
          logout(true);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);

    return () => {
      activityEvents.forEach(event => {
        window.removeEventListener(event, recordActivity);
        document.removeEventListener(event, recordActivity);
      });
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
    };
  }, [currentUser, logout, recordActivity]);

  const openLoginModal = (promptReason?: string) => {
    setLoginActionPrompt(promptReason || null);
    setIsLoginModalOpen(true);
  };

  // Google Sign-In (Disabled as requested)
  const loginWithGoogle = async (): Promise<{ success: boolean; error?: string }> => {
    return {
      success: false,
      error: '구글 로그인은 비활성화되어 있습니다. 관리자 비밀번호를 사용해 로그인해주세요.',
    };
  };

  // Admin Passcode / Quick Admin Login (Robust for iframe sandbox where popups might be blocked)
  const loginWithAdminPasscode = async (passcode: string): Promise<{ success: boolean; error?: string }> => {
    const trimmed = passcode.trim();
    // Default admin passcode: 'admin' or 'hill1234' or 'htol65'
    if (trimmed === 'hill1234' || trimmed === 'admin' || trimmed === 'htol65') {
      const adminUser: AppUser = {
        uid: 'admin_author_hill',
        email: ADMIN_EMAIL,
        displayName: 'Hill (관리자)',
        isAdmin: true,
        provider: 'admin_credentials',
      };
      setCurrentUser(adminUser);
      localStorage.setItem(ADMIN_SESSION_STORAGE_KEY, JSON.stringify(adminUser));
      lastActivityRef.current = Date.now();
      localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, Date.now().toString());
      closeLoginModal();
      return { success: true };
    } else {
      return { success: false, error: '관리자 비밀번호가 일치하지 않습니다. (기본 비밀번호: hill1234)' };
    }
  };

  const isAdmin = !!(currentUser && currentUser.isAdmin);
  const isAuthenticated = !!currentUser;

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        isAdmin,
        isAuthenticated,
        isLoading,
        isLoginModalOpen,
        loginActionPrompt,
        autoLogoutNotice,
        clearAutoLogoutNotice,
        openLoginModal,
        closeLoginModal,
        loginWithGoogle,
        loginWithAdminPasscode,
        logout: () => logout(false),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};


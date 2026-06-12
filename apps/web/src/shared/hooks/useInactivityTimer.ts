import { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useSessionStore } from '../store/sessionStore';
import { authApi } from '../../features/auth/services/authApi';

const NORMAL_TIMEOUT_MS = 15 * 60 * 1000;    // 15 min
const WARNING_BEFORE_MS = 2 * 60 * 1000;     // 2 min warning
const SCRIBE_KEEPALIVE_MS = 4 * 60 * 1000;   // keep below the 5 min clinic minimum idle window

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'] as const;

export function useInactivityTimer(): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const navigate = useNavigate();
  const clearUser = useAuthStore((s) => s.clearUser);
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const scribeActive = useSessionStore((s) => s.scribeActive);
  const setShowWarning = useSessionStore((s) => s.setShowSessionWarning);
  const setSecondsLeft = useSessionStore((s) => s.setSecondsLeft);
  const setSessionExpired = useSessionStore((s) => s.setSessionExpired);

  const clearIdleTimers = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    timerRef.current = null;
    warningTimerRef.current = null;
    countdownRef.current = null;
  }, []);

  const clearKeepAliveTimer = useCallback(() => {
    if (keepAliveRef.current) clearInterval(keepAliveRef.current);
    keepAliveRef.current = null;
  }, []);

  const logout = useCallback(async () => {
    setShowWarning(false);
    clearIdleTimers();
    clearKeepAliveTimer();
    if (countdownRef.current) clearInterval(countdownRef.current);
    window.dispatchEvent(new CustomEvent('signacare:auto-save-draft'));

    // Call server-side logout to revoke the session/refresh token
    try {
      await authApi.logout();
    } catch {
      // Best-effort — session may already be expired on the server
    }

    // Show "Session expired" briefly before redirecting
    setSessionExpired(true);
    clearUser();

    // Small delay so the user sees the expired message
    setTimeout(() => {
      setSessionExpired(false);
      navigate('/login', { replace: true });
    }, 2000);
  }, [clearIdleTimers, clearKeepAliveTimer, clearUser, navigate, setShowWarning, setSessionExpired]);

  const resetTimer = useCallback(() => {
    clearIdleTimers();
    setShowWarning(false);
    setSecondsLeft(0);

    if (scribeActive) {
      return;
    }

    warningTimerRef.current = setTimeout(() => {
      setShowWarning(true);
      let remaining = Math.ceil(WARNING_BEFORE_MS / 1000);
      setSecondsLeft(remaining);
      countdownRef.current = setInterval(() => {
        remaining--;
        setSecondsLeft(remaining);
        if (remaining <= 0 && countdownRef.current) clearInterval(countdownRef.current);
      }, 1000);
    }, NORMAL_TIMEOUT_MS - WARNING_BEFORE_MS);

    timerRef.current = setTimeout(logout, NORMAL_TIMEOUT_MS);
  }, [clearIdleTimers, logout, scribeActive, setSecondsLeft, setShowWarning]);

  useEffect(() => {
    if (!isAuth) return;
    resetTimer();
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }));
    return () => {
      clearIdleTimers();
      clearKeepAliveTimer();
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, resetTimer));
    };
  }, [clearIdleTimers, clearKeepAliveTimer, isAuth, resetTimer]);

  useEffect(() => {
    if (!isAuth) {
      clearKeepAliveTimer();
      return;
    }

    if (!scribeActive) {
      clearKeepAliveTimer();
      return;
    }

    clearIdleTimers();
    setShowWarning(false);
    setSecondsLeft(0);

    const refreshSession = async () => {
      try {
        await authApi.refreshSession();
      } catch {
        // Let the shared 401 interceptor handle expiry/redirection.
      }
    };

    void refreshSession();
    keepAliveRef.current = setInterval(() => {
      void refreshSession();
    }, SCRIBE_KEEPALIVE_MS);

    return () => {
      clearKeepAliveTimer();
    };
  }, [clearIdleTimers, clearKeepAliveTimer, isAuth, scribeActive, setSecondsLeft, setShowWarning]);
}

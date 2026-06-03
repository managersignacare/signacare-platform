import { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useSessionStore } from '../store/sessionStore';
import { authApi } from '../../features/auth/services/authApi';

const NORMAL_TIMEOUT_MS = 15 * 60 * 1000;    // 15 min
const SCRIBE_TIMEOUT_MS = 75 * 60 * 1000;    // 75 min when scribe active
const WARNING_BEFORE_MS = 2 * 60 * 1000;     // 2 min warning

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'] as const;

export function useInactivityTimer(): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const navigate = useNavigate();
  const clearUser = useAuthStore((s) => s.clearUser);
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const scribeActive = useSessionStore((s) => s.scribeActive);
  const setShowWarning = useSessionStore((s) => s.setShowSessionWarning);
  const setSecondsLeft = useSessionStore((s) => s.setSecondsLeft);
  const setSessionExpired = useSessionStore((s) => s.setSessionExpired);

  const logout = useCallback(async () => {
    setShowWarning(false);
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
  }, [clearUser, navigate, setShowWarning, setSessionExpired]);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    setShowWarning(false);

    const timeout = scribeActive ? SCRIBE_TIMEOUT_MS : NORMAL_TIMEOUT_MS;

    warningTimerRef.current = setTimeout(() => {
      setShowWarning(true);
      let remaining = Math.ceil(WARNING_BEFORE_MS / 1000);
      setSecondsLeft(remaining);
      countdownRef.current = setInterval(() => {
        remaining--;
        setSecondsLeft(remaining);
        if (remaining <= 0 && countdownRef.current) clearInterval(countdownRef.current);
      }, 1000);
    }, timeout - WARNING_BEFORE_MS);

    timerRef.current = setTimeout(logout, timeout);
  }, [logout, scribeActive, setShowWarning, setSecondsLeft]);

  useEffect(() => {
    if (!isAuth) return;
    resetTimer();
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }));
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, resetTimer));
    };
  }, [isAuth, resetTimer]);
}

'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { css } from '@/lib/css';

const Ctx = createContext<(msg: string) => void>(() => {});

export function useFlash() {
  return useContext(Ctx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; closing: boolean } | null>(null);
  const timers = useRef<number[]>([]);

  const flash = useCallback((msg: string) => {
    timers.current.forEach(clearTimeout);
    setToast({ msg, closing: false });
    timers.current = [
      window.setTimeout(() => setToast(t => (t ? { ...t, closing: true } : t)), 2320),
      window.setTimeout(() => setToast(null), 2600)
    ];
  }, []);

  return (
    <Ctx.Provider value={flash}>
      {children}
      {toast && (
        <div role="status" style={{
          ...css('position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 0); background: var(--color-accent-900); color: var(--color-bg); padding: 12px 20px; font-family: var(--font-heading); font-size: 14px; letter-spacing: .14em; text-transform: uppercase; box-shadow: var(--shadow-lg); max-width: min(560px, 90vw); text-align: center; z-index: 60'),
          animation: toast.closing ? 'toastOut .28s ease forwards' : 'toastIn .22s ease'
        }}>{toast.msg}</div>
      )}
    </Ctx.Provider>
  );
}

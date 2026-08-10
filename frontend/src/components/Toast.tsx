/** Kisa bildirim ("Link kopyalandi" gibi). */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

const ToastContext = createContext<(mesaj: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [mesaj, setMesaj] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const goster = useCallback((yeni: string) => {
    setMesaj(yeni);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMesaj(null), 2400);
  }, []);

  const value = useMemo(() => goster, [goster]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {mesaj && <div className="toast">{mesaj}</div>}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

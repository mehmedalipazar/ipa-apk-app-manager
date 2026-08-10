/**
 * Kucuk yonlendirici (router).
 *
 * Uygulamada dort ekran var; harici bir router kutuphanesi eklemek yerine
 * History API uzerine ince bir katman yeterli.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

interface RouterValue {
  path: string;
  navigate: (to: string, options?: { replace?: boolean }) => void;
  /**
   * Sayfadan ayrilmayi engelleyecek soruyu kaydeder. `null` engeli kaldirir.
   * Kaydedilmemis form verisi olan ekranlar `useNavigationBlocker` ile kullanir.
   */
  setBlocker: (soru: (() => boolean) | null) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(() => window.location.pathname);
  // Ref: engel degistiginde navigate()'in kimligi degismesin.
  const blocker = useRef<(() => boolean) | null>(null);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const setBlocker = useCallback((soru: (() => boolean) | null) => {
    blocker.current = soru;
  }, []);

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    if (to === window.location.pathname) return;
    // Kaydedilmemis veri varsa once ekran karar verir; hayir derse hicbir sey olmaz.
    if (blocker.current && !blocker.current()) return;
    if (options?.replace) window.history.replaceState(null, '', to);
    else window.history.pushState(null, '', to);
    setPath(to);
    window.scrollTo(0, 0);
  }, []);

  const value = useMemo<RouterValue>(
    () => ({ path, navigate, setBlocker }),
    [path, navigate, setBlocker],
  );
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

/**
 * Kaydedilmemis degisiklik varken hem uygulama ici gecisi hem de sekme
 * kapatma/yenilemeyi sorar.
 *
 * @param aktif  Engel su anda gecerli mi (orn. `degisti`).
 * @param onay   Kullaniciya sorulacak; `true` donerse gecise izin verilir.
 */
export function useNavigationBlocker(aktif: boolean, onay: () => boolean): void {
  const { setBlocker } = useRouter();

  useEffect(() => {
    if (!aktif) {
      setBlocker(null);
      return;
    }
    setBlocker(onay);

    // Tarayici kendi metnini gosterir; icerik ozellestirilemez.
    const beforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', beforeUnload);

    return () => {
      setBlocker(null);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [aktif, onay, setBlocker]);
}

export function useRouter(): RouterValue {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter yalnizca RouterProvider icinde kullanilabilir.');
  return ctx;
}

export function Link({
  to,
  className,
  children,
}: {
  to: string;
  className?: string;
  children: ReactNode;
}) {
  const { path, navigate } = useRouter();
  const aktif = path === to;

  return (
    <a
      href={to}
      className={[className, aktif ? 'active' : ''].filter(Boolean).join(' ')}
      onClick={(e) => {
        // Yeni sekmede acmak isteyen kullaniciyi engelleme.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

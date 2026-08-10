import { useCallback, useEffect, useState } from 'react';
import { Link, useRouter } from './router.tsx';
import { UploadPage } from './pages/UploadPage.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { BuildsPage } from './pages/BuildsPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { Spinner } from './components/common.tsx';
import { IconApple, IconBox, IconLogout, IconSettings, IconUpload } from './components/icons.tsx';
import { api, type SessionInfo } from './api.ts';

export function App() {
  const { path, navigate } = useRouter();
  const [session, setSession] = useState<SessionInfo | null>(null);

  const oturumuTazele = useCallback(async () => {
    try {
      setSession(await api.me());
    } catch {
      setSession({ authenticated: false, configured: false, expiresAt: null });
    }
  }, []);

  useEffect(() => {
    void oturumuTazele();
  }, [oturumuTazele]);

  // "Site adi" ayari yalnizca kurulum sayfasini degil, yonetici sekmesini de
  // besler. Ayarlar ucu oturum istedigi icin giristen sonra okunur; ayar
  // panelden degistirildiginde SettingsPage basligi kendisi gunceller.
  useEffect(() => {
    if (!session?.authenticated) return;
    void api
      .getSettings()
      .then((s) => {
        if (s.values.siteName) document.title = s.values.siteName;
      })
      .catch(() => undefined);
  }, [session?.authenticated]);

  const cikis = async () => {
    await api.logout().catch(() => undefined);
    await oturumuTazele();
    navigate('/');
  };

  if (!session) {
    return (
      <div className="center-screen">
        <Spinner />
      </div>
    );
  }

  // Bu arayuzun tamami yonetici panelidir: yukleme de, surum yonetimi de
  // oturum ister. Son kullanicinin gordugu tek sayfa sunucunun urettigi
  // `/i/:token` kurulum sayfasidir; oraya bu SPA hic karismaz.
  if (!session.authenticated) {
    return (
      <LoginPage
        configured={session.configured}
        onLogin={() => {
          void oturumuTazele().then(() =>
            navigate(path.startsWith('/admin') ? path : '/', { replace: true }),
          );
        }}
      />
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <IconApple size={19} />
          <span>IPA OTA</span>
        </Link>

        <nav className="nav">
          <Link to="/">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <IconUpload size={15} /> Yukle
            </span>
          </Link>
          <Link to="/admin/surumler">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <IconBox size={15} /> Surumler
            </span>
          </Link>
          <Link to="/admin/ayarlar">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <IconSettings size={15} /> Ayarlar
            </span>
          </Link>
          <button className="btn ghost sm" onClick={() => void cikis()} title="Cikis yap">
            <IconLogout size={15} />
          </button>
        </nav>
      </header>

      <Sayfa path={path} />
    </div>
  );
}

function Sayfa({ path }: { path: string }) {
  if (path === '/admin/ayarlar') return <SettingsPage />;
  if (path === '/admin/surumler' || path === '/admin' || path === '/admin/') return <BuildsPage />;
  if (path === '/') return <UploadPage />;

  return (
    <div className="main narrow">
      <div className="empty">
        <h3>Sayfa bulunamadi</h3>
        <p>
          <Link to="/">Ana sayfaya donun</Link>
        </p>
      </div>
    </div>
  );
}

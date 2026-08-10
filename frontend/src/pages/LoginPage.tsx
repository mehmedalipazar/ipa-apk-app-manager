import { useState } from 'react';
import { Alert, Spinner } from '../components/common.tsx';
import { IconApple } from '../components/icons.tsx';
import { ApiError, api } from '../api.ts';

export function LoginPage({ onLogin, configured }: { onLogin: () => void; configured: boolean }) {
  const [sifre, setSifre] = useState('');
  const [hata, setHata] = useState<string | null>(null);
  const [bekliyor, setBekliyor] = useState(false);

  const gonder = async (e: React.FormEvent) => {
    e.preventDefault();
    setBekliyor(true);
    setHata(null);
    try {
      await api.login(sifre);
      onLogin();
    } catch (err) {
      setHata(err instanceof ApiError ? err.message : 'Giris yapilamadi.');
    } finally {
      setBekliyor(false);
    }
  };

  return (
    <div className="center-screen">
      <div className="login-card">
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <IconApple size={34} />
          <h1 style={{ marginTop: 9 }}>Yonetici girisi</h1>
          <p style={{ color: 'var(--fg-muted)', marginTop: 5 }}>
            Surumleri ve ayarlari yonetmek icin giris yapin.
          </p>
        </div>

        {!configured && (
          <div className="alerts">
            <Alert kind="warn">
              Admin sifresi tanimlanmamis. Sunucuda <code>ADMIN_PASSWORD</code> ortam degiskenini
              ayarlayip servisi yeniden baslatin.
            </Alert>
          </div>
        )}

        {hata && (
          <div className="alerts">
            <Alert kind="err">{hata}</Alert>
          </div>
        )}

        <form className="card" onSubmit={(e) => void gonder(e)}>
          <div className="card-body">
            <div className="field">
              <label htmlFor="sifre">Sifre</label>
              <input
                id="sifre"
                className="input"
                type="password"
                autoComplete="current-password"
                value={sifre}
                autoFocus
                disabled={!configured || bekliyor}
                onChange={(e) => setSifre(e.target.value)}
              />
            </div>
            <button className="btn block" type="submit" disabled={!configured || bekliyor || !sifre}>
              {bekliyor ? (
                <>
                  <Spinner /> Kontrol ediliyor
                </>
              ) : (
                'Giris yap'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

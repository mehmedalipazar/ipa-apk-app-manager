import { useState } from 'react';
import { Alert, BrandMark, Spinner } from '../components/common.tsx';
import { ApiError, api, baglantiHatasiMetni, baglantiHatasiMi } from '../api.ts';

/**
 * Giris ekrani iki farkli "simdi giremezsin" durumunu ayirt eder:
 *
 *   sunucuHatasi != null  ->  API'ye ulasilamiyor. Sifre denemek anlamsiz,
 *                             form hic cizilmez; kullaniciya sebep + tekrar
 *                             deneme sunulur.
 *   configured == false   ->  Sunucuya ULASILDI ve "admin sifresi tanimli
 *                             degil" dedi. Yalnizca bu durumda ADMIN_PASSWORD
 *                             uyarisi cikar.
 *
 * Ikisi eskiden tek bayrakti; backend kapaliyken de ADMIN_PASSWORD uyarisi
 * basiliyordu (yanlis teshis).
 */
export function LoginPage({
  onLogin,
  configured,
  sunucuHatasi,
  onYenidenDene,
}: {
  onLogin: () => void;
  configured: boolean;
  sunucuHatasi: string | null;
  onYenidenDene: () => Promise<void>;
}) {
  const [sifre, setSifre] = useState('');
  const [hata, setHata] = useState<string | null>(null);
  const [bekliyor, setBekliyor] = useState(false);
  const [deneniyor, setDeneniyor] = useState(false);

  const gonder = async (e: React.FormEvent) => {
    e.preventDefault();
    setBekliyor(true);
    setHata(null);
    try {
      await api.login(sifre);
      onLogin();
    } catch (err) {
      // Sayfa acikken sunucu duserse ham "Istek basarisiz (HTTP 502)" yerine
      // ne oldugunu soyleyen metni goster.
      if (baglantiHatasiMi(err)) setHata(baglantiHatasiMetni(err));
      else setHata(err instanceof ApiError ? err.message : 'Giris yapilamadi.');
    } finally {
      setBekliyor(false);
    }
  };

  const yenidenDene = async () => {
    setDeneniyor(true);
    try {
      await onYenidenDene();
    } finally {
      setDeneniyor(false);
    }
  };

  return (
    <div className="center-screen">
      <div className="login-card">
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div className="brand center">
            <BrandMark size={32} withName={false} />
          </div>
          <h1 style={{ marginTop: 11 }}>Yonetici girisi</h1>
          <p style={{ color: 'var(--fg-muted)', marginTop: 5 }}>
            Surumleri ve ayarlari yonetmek icin giris yapin.
          </p>
        </div>

        {sunucuHatasi && (
          <div className="alerts">
            <Alert kind="err">{sunucuHatasi}</Alert>
          </div>
        )}

        {!sunucuHatasi && !configured && (
          <div className="alerts">
            <Alert kind="warn">
              Admin sifresi tanimlanmamis. Sunucuda <code>ADMIN_PASSWORD</code> ortam degiskenini
              ayarlayip servisi yeniden baslatin.
            </Alert>
          </div>
        )}

        {hata && !sunucuHatasi && (
          <div className="alerts">
            <Alert kind="err">{hata}</Alert>
          </div>
        )}

        {sunucuHatasi ? (
          <div className="card">
            <div className="card-body">
              <button
                className="btn block"
                type="button"
                disabled={deneniyor}
                onClick={() => void yenidenDene()}
              >
                {deneniyor ? (
                  <>
                    <Spinner /> Deneniyor
                  </>
                ) : (
                  'Tekrar dene'
                )}
              </button>
            </div>
          </div>
        ) : (
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
              <button
                className="btn block"
                type="submit"
                disabled={!configured || bekliyor || !sifre}
              >
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
        )}
      </div>
    </div>
  );
}

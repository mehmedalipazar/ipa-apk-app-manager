/**
 * Ana ekran: IPA yukle -> kurulum linki al.
 *
 * Yalnizca yonetici gorur; App.tsx oturum yoksa giris ekranini gosterir.
 */
import { useEffect, useRef, useState } from 'react';
import { Dropzone } from '../components/Dropzone.tsx';
import { Alert, AlertList, AppIcon, CopyButton, Spinner } from '../components/common.tsx';
import { IconBox, IconLink } from '../components/icons.tsx';
import { ApiError, api, formatBytes, formatHours, uploadIpa, type AppConfig, type BuildDto } from '../api.ts';
import { SURE_ONAYARLARI } from '../ttl.ts';
import { Link } from '../router.tsx';

type Durum = 'bos' | 'hazir' | 'yukleniyor' | 'bitti';

export function UploadPage() {
  const [durum, setDurum] = useState<Durum>('bos');
  const [dosya, setDosya] = useState<File | null>(null);
  const [hata, setHata] = useState<string | null>(null);

  const [ttlHours, setTtlHours] = useState<number>(24);
  const [not, setNot] = useState('');
  const [sifre, setSifre] = useState('');

  const [yuzde, setYuzde] = useState(0);
  const [yuklenen, setYuklenen] = useState(0);
  const [sonuc, setSonuc] = useState<BuildDto | null>(null);
  const [uyarilar, setUyarilar] = useState<string[]>([]);

  const [limitler, setLimitler] = useState<Pick<AppConfig, 'maxUploadMb' | 'maxTtlHours' | 'defaultTtlHours' | 'showQrCode'> | null>(null);
  const iptalRef = useRef<AbortController | null>(null);

  // Sunucudaki sinirlari al; alinamazsa sunucu yine de dogrulayacak.
  useEffect(() => {
    void api
      .getSettings()
      .then((s) => {
        setLimitler(s.values);
        setTtlHours(s.values.defaultTtlHours);
      })
      .catch(() => {
        /* Limit alinamazsa sunucu yine de dogrulayacak. */
      });
  }, []);

  const dosyaSecildi = (secilen: File) => {
    setHata(null);
    if (!secilen.name.toLowerCase().endsWith('.ipa')) {
      setHata(`"${secilen.name}" bir .ipa dosyasi degil. iOS uygulama paketi secin.`);
      return;
    }
    const maxMb = limitler?.maxUploadMb;
    if (maxMb && secilen.size > maxMb * 1024 * 1024) {
      setHata(`Dosya ${formatBytes(secilen.size)} — sinir ${maxMb} MB.`);
      return;
    }
    setDosya(secilen);
    setDurum('hazir');
  };

  const yukle = async () => {
    if (!dosya) return;
    setDurum('yukleniyor');
    setHata(null);
    setYuzde(0);

    const controller = new AbortController();
    iptalRef.current = controller;

    try {
      const yanit = await uploadIpa({
        file: dosya,
        ttlHours,
        note: not,
        password: sifre,
        signal: controller.signal,
        onProgress: (p, loaded) => {
          setYuzde(p);
          setYuklenen(loaded);
        },
      });
      setSonuc(yanit.build);
      setUyarilar(yanit.warnings);
      setDurum('bitti');
    } catch (e) {
      setHata(e instanceof ApiError ? e.message : 'Beklenmeyen bir hata olustu.');
      setDurum('hazir');
    } finally {
      iptalRef.current = null;
    }
  };

  const sifirla = () => {
    setDosya(null);
    setSonuc(null);
    setUyarilar([]);
    setHata(null);
    setNot('');
    setSifre('');
    setYuzde(0);
    setDurum('bos');
  };

  /* --- Sonuc ekrani --- */
  if (durum === 'bitti' && sonuc) {
    return (
      <div className="main narrow">
        <div className="page-head">
          <h1>Link hazir</h1>
          <p>Bu adresi paylasin; alici iPhone'da Safari ile acip tek dokunusla kursun.</p>
        </div>

        <AlertList warnings={uyarilar} />

        <div className="card">
          <div className="card-body">
            <div className="result-head">
              <AppIcon src={sonuc.iconUrl} name={sonuc.appName} className="app-icon" />
              <div className="meta">
                <h2>{sonuc.appName}</h2>
                <div className="sub">
                  Surum {sonuc.version} ({sonuc.buildNumber}) &middot; {sonuc.sizeLabel}
                </div>
                <div className="sub">{sonuc.bundleId}</div>
              </div>
            </div>

            <div className="divider" />

            {sonuc.installUrl ? (
              <>
                <div className="field">
                  <label>Kurulum linki</label>
                  <div className="link-box">
                    <code>{sonuc.installUrl}</code>
                    <CopyButton value={sonuc.installUrl} />
                  </div>
                  <div className="help" style={{ marginTop: 7 }}>
                    {sonuc.remainingLabel
                      ? `${sonuc.remainingLabel} sonra gecersiz olacak.`
                      : 'Suresi dolmus.'}
                    {sonuc.hasPassword && ' Link sifre korumali.'}
                  </div>
                </div>

                {limitler?.showQrCode !== false && sonuc.qrUrl && (
                  <div className="qr-panel">
                    <img src={sonuc.qrUrl} alt="Kurulum linki QR kodu" />
                    <div className="qr-text">
                      <strong style={{ color: 'var(--fg)' }}>Telefonla okutun</strong>
                      <br />
                      iPhone kamerasini QR koda tutun, cikan bildirime dokunun. Sayfa Safari'de
                      acilir ve kurulum baslar.
                    </div>
                  </div>
                )}
              </>
            ) : (
              <Alert kind="err">
                Kurulum linki uretilemedi cunku genel adres (Base URL) ayarlanmamis.{' '}
                <Link to="/admin/ayarlar">Ayarlar</Link> bolumunden servisin https adresini girin.
              </Alert>
            )}

            <div className="divider" />

            <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
              <button className="btn secondary" onClick={sifirla}>
                <IconBox size={16} /> Yeni yukleme
              </button>
              <Link to="/admin/surumler" className="btn ghost">
                Tum surumler
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* --- Yukleme formu --- */
  const maxTtl = limitler?.maxTtlHours ?? 720;

  return (
    <div className="main narrow">
      <div className="page-head">
        <h1>IPA yukle</h1>
        <p>iOS uygulamanizi yukleyin, paylasilabilir bir kurulum linki alin.</p>
      </div>

      {hata && (
        <div className="alerts">
          <Alert kind="err">{hata}</Alert>
        </div>
      )}

      {durum === 'bos' && <Dropzone onFile={dosyaSecildi} hata={hata} />}

      {(durum === 'hazir' || durum === 'yukleniyor') && dosya && (
        <>
          <div className="file-chip">
            <div className="fc-icon">
              <IconBox size={21} />
            </div>
            <div className="fc-main">
              <div className="fc-name">{dosya.name}</div>
              <div className="fc-size">
                {formatBytes(dosya.size)}
                {durum === 'yukleniyor' && ` — ${formatBytes(yuklenen)} gonderildi`}
              </div>
            </div>
            {durum === 'hazir' && (
              <button className="btn ghost sm" onClick={sifirla}>
                Degistir
              </button>
            )}
          </div>

          {durum === 'yukleniyor' ? (
            <div className="card" style={{ marginTop: 18 }}>
              <div className="card-body">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 9 }}>
                  <strong>{yuzde < 100 ? 'Yukleniyor...' : 'Cozumleniyor...'}</strong>
                  <span className="unit">{yuzde}%</span>
                </div>
                <div className={`progress ${yuzde >= 100 ? 'indeterminate' : ''}`}>
                  <div style={{ width: `${yuzde}%` }} />
                </div>
                <div className="help" style={{ marginTop: 11, marginBottom: 0 }}>
                  {yuzde >= 100
                    ? 'Dosya alindi; paket bilgileri ve simge cikariliyor.'
                    : 'Sayfayi kapatmayin.'}
                </div>
              </div>
            </div>
          ) : (
            <div className="card" style={{ marginTop: 18 }}>
              <div className="card-head">
                <h2>Link ayarlari</h2>
              </div>
              <div className="card-body">
                <div className="field">
                  <label htmlFor="ttl">Gecerlilik suresi</label>
                  <div className="help">
                    Bu sure sonunda link calismaz hale gelir. En fazla {maxTtl} saat (
                    {formatHours(maxTtl)}). Daha uzunu icin{' '}
                    <Link to="/admin/ayarlar">Ayarlar &rsaquo; En uzun link suresi</Link> degerini
                    yukseltin.
                  </div>
                  <div className="input-row">
                    <input
                      id="ttl"
                      className="input"
                      type="number"
                      min={1}
                      max={maxTtl}
                      value={ttlHours}
                      onChange={(e) => setTtlHours(Number(e.target.value))}
                    />
                    <span className="unit">saat</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 9, flexWrap: 'wrap' }}>
                    {SURE_ONAYARLARI.filter((o) => o.saat <= maxTtl).map((o) => (
                      <button
                        key={o.saat}
                        type="button"
                        className={`btn sm ${ttlHours === o.saat ? '' : 'secondary'}`}
                        onClick={() => setTtlHours(o.saat)}
                      >
                        {o.etiket}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="not">Not (opsiyonel)</label>
                  <div className="help">Yalnizca yonetici panelinde gorunur.</div>
                  <input
                    id="not"
                    className="input"
                    value={not}
                    maxLength={500}
                    placeholder="orn. Musteri demo surumu"
                    onChange={(e) => setNot(e.target.value)}
                  />
                </div>

                <div className="field">
                  <label htmlFor="sifre">Link sifresi (opsiyonel)</label>
                  <div className="help">
                    Girilirse kurulum sayfasi acilmadan once sifre sorulur.
                  </div>
                  <input
                    id="sifre"
                    className="input"
                    type="text"
                    value={sifre}
                    placeholder="Bos birakilirsa sifre sorulmaz"
                    onChange={(e) => setSifre(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          <div style={{ marginTop: 18, display: 'flex', gap: 9 }}>
            <button
              className="btn lg block"
              disabled={durum === 'yukleniyor'}
              onClick={() => void yukle()}
            >
              {durum === 'yukleniyor' ? (
                <>
                  <Spinner /> Yukleniyor
                </>
              ) : (
                <>
                  <IconLink size={17} /> Yukle ve link olustur
                </>
              )}
            </button>
            {durum === 'yukleniyor' && (
              <button
                className="btn secondary"
                onClick={() => {
                  iptalRef.current?.abort();
                  setDurum('hazir');
                }}
              >
                Iptal
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

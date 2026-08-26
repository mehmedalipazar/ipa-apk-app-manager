/**
 * Yuklenmis surumlerin listesi ve link yonetimi.
 *
 * Yukleme sirasinda girilen link ayarlari (sure / not / sifre) kayitta durur
 * ve buradaki "Duzenle" panelinden degistirilebilir.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  AppIcon,
  CopyButton,
  EmptyState,
  PlatformBadge,
  Spinner,
  StatusBadge,
} from '../components/common.tsx';
import {
  IconBan,
  IconClock,
  IconDownload,
  IconEye,
  IconLock,
  IconQr,
  IconSettings,
  IconTrash,
} from '../components/icons.tsx';
import { useToast } from '../components/Toast.tsx';
import {
  ApiError,
  api,
  formatBytes,
  formatDateTime,
  formatHours,
  type AppConfig,
  type BuildDto,
  type BuildPatch,
  type Platform,
  type StatsResponse,
  type TtlBasis,
} from '../api.ts';
import { SURE_ONAYARLARI } from '../ttl.ts';

/** Liste filtresi secenekleri; '' = tum platformlar (sorguya eklenmez). */
const PLATFORM_FILTRELERI: ReadonlyArray<{ deger: Platform | ''; etiket: string }> = [
  { deger: '', etiket: 'Tumu' },
  { deger: 'ios', etiket: 'iOS' },
  { deger: 'android', etiket: 'Android' },
];

export function BuildsPage() {
  const toast = useToast();
  const [items, setItems] = useState<BuildDto[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [limitler, setLimitler] = useState<Pick<
    AppConfig,
    'maxTtlHours' | 'defaultTtlHours' | 'showQrCode'
  > | null>(null);
  /** QR'i acik olan surum. Liste kalabaliklasmasin diye tek seferde bir tane. */
  const [qrAcik, setQrAcik] = useState<string | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState<string | null>(null);
  const [arama, setArama] = useState('');
  const [sadeceAktif, setSadeceAktif] = useState(false);
  const [platform, setPlatform] = useState<Platform | ''>('');
  const [islemdeki, setIslemdeki] = useState<string | null>(null);
  const [duzenlenen, setDuzenlenen] = useState<string | null>(null);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    setHata(null);
    try {
      const [liste, ozet, ayarlar] = await Promise.all([
        api.listBuilds({
          search: arama || undefined,
          onlyActive: sadeceAktif,
          platform: platform || undefined,
        }),
        api.getStats(),
        api.getSettings(),
      ]);
      setItems(liste.items);
      setStats(ozet);
      setLimitler(ayarlar.values);
    } catch (e) {
      setHata(e instanceof ApiError ? e.message : 'Liste alinamadi.');
    } finally {
      setYukleniyor(false);
    }
  }, [arama, sadeceAktif, platform]);

  useEffect(() => {
    // Yazarken her tusa istek atmamak icin kisa gecikme.
    const t = window.setTimeout(() => void getir(), arama ? 300 : 0);
    return () => window.clearTimeout(t);
  }, [getir, arama]);

  /** Islemi kosar; basariliysa true doner (panel kapatma karari cagirana ait). */
  const islem = async (id: string, fn: () => Promise<unknown>, basariMesaji: string): Promise<boolean> => {
    setIslemdeki(id);
    try {
      await fn();
      toast(basariMesaji);
      await getir();
      return true;
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Islem basarisiz');
      return false;
    } finally {
      setIslemdeki(null);
    }
  };

  const sil = (build: BuildDto) => {
    const onay = window.confirm(
      `"${build.appName} ${build.version}" kalici olarak silinecek.\n\n` +
        'Kurulum linki calismayacak ve paket dosyasi (.ipa/.apk) diskten kaldirilacak. Devam edilsin mi?',
    );
    if (!onay) return;
    void islem(build.id, () => api.deleteBuild(build.id), 'Surum silindi');
  };

  const kaydet = async (build: BuildDto, patch: BuildPatch) => {
    if (Object.keys(patch).length === 0) {
      setDuzenlenen(null);
      toast('Degisiklik yok');
      return;
    }
    // Hata olursa panel ACIK kalir: girilenler kaybolmasin, kullanici duzeltsin.
    const basarili = await islem(build.id, () => api.patchBuild(build.id, patch), 'Link ayarlari guncellendi');
    if (basarili) setDuzenlenen(null);
  };

  /** Iptal edilmis link yeniden acilir; suresi de dolmussa ayni sure yeniden verilir. */
  const yenidenAc = (build: BuildDto) => {
    const suresiDolmus = build.expiresAt <= Date.now();
    const patch: BuildPatch = suresiDolmus
      ? { revoked: false, ttlHours: build.ttlHours, ttlFrom: 'now' }
      : { revoked: false };
    void islem(
      build.id,
      () => api.patchBuild(build.id, patch),
      suresiDolmus ? `Link yeniden acildi (${formatHours(build.ttlHours)})` : 'Link yeniden acildi',
    );
  };

  return (
    <div className="main">
      <div className="page-head">
        <h1>Surumler</h1>
        <p>
          {stats
            ? `${stats.total} surum, ${stats.active} aktif link, diskte ${formatBytes(stats.totalBytes)}.`
            : 'Yuklenen tum uygulama paketleri (.ipa/.apk) ve kurulum linkleri.'}
        </p>
      </div>

      {hata && (
        <div className="alerts">
          <Alert kind="err">{hata}</Alert>
        </div>
      )}

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-body" style={{ display: 'flex', gap: 13, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 200 }}
            placeholder="Uygulama adi, paket adi ya da surum ara..."
            value={arama}
            onChange={(e) => setArama(e.target.value)}
          />
          <label className="switch" style={{ alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={sadeceAktif}
              onChange={(e) => setSadeceAktif(e.target.checked)}
            />
            <span className="switch-text">
              <strong style={{ margin: 0 }}>Sadece aktif</strong>
            </span>
          </label>
          <div className="seg">
            {PLATFORM_FILTRELERI.map((f) => (
              <label key={f.etiket} className={platform === f.deger ? 'on' : ''}>
                <input
                  type="radio"
                  name="platform-filtre"
                  checked={platform === f.deger}
                  onChange={() => setPlatform(f.deger)}
                />
                {f.etiket}
              </label>
            ))}
          </div>
        </div>
      </div>

      {yukleniyor && items.length === 0 ? (
        <EmptyState title="Yukleniyor...">
          <Spinner />
        </EmptyState>
      ) : items.length === 0 ? (
        <EmptyState title="Henuz surum yok">
          <p>Ilk paketinizi (.ipa ya da .apk) yukleyin; kurulum linki burada listelenecek.</p>
        </EmptyState>
      ) : (
        <div className="build-list">
          {items.map((build) => (
            <div className="build" key={build.id}>
              <div className="build-top">
                <AppIcon src={build.iconUrl} name={build.appName} className="build-icon" />

                <div className="build-info">
                  <div className="build-title">
                    <strong>{build.appName}</strong>
                    <span className="unit">
                      {build.version} ({build.buildNumber})
                    </span>
                    <PlatformBadge platform={build.platform} />
                    <StatusBadge status={build.status} label={build.statusLabel} />
                    {build.hasPassword && (
                      <span className="badge">
                        <IconLock size={12} /> Sifreli
                      </span>
                    )}
                  </div>

                  <div className="build-sub">
                    {build.bundleId} &middot; {build.sizeLabel} &middot; {formatDateTime(build.createdAt)}
                  </div>

                  {build.note && (
                    <div className="build-sub" style={{ fontStyle: 'italic' }}>
                      {build.note}
                    </div>
                  )}

                  <div className="build-stats">
                    <span title={`Verilen sure: ${formatHours(build.ttlHours)} — bitis ${formatDateTime(build.expiresAt)}`}>
                      <IconClock size={13} />
                      {formatHours(build.ttlHours)}
                      {build.remainingLabel ? ` — ${build.remainingLabel} kaldi` : ' — suresi doldu'}
                    </span>
                    <span>
                      <IconEye size={13} /> {build.viewCount} goruntuleme
                    </span>
                    <span>
                      <IconDownload size={13} /> {build.downloadCount} indirme
                    </span>
                  </div>
                </div>
              </div>

              {build.installUrl && build.status === 'active' && (
                <div className="link-box" style={{ marginTop: 13 }}>
                  <code>{build.installUrl}</code>
                  <CopyButton value={build.installUrl} label="Kopyala" />
                </div>
              )}

              {qrAcik === build.id && build.qrUrl && (
                <div className="qr-panel" style={{ marginTop: 13 }}>
                  <img src={build.qrUrl} alt={`${build.appName} kurulum linki QR kodu`} />
                  <div className="qr-text">
                    {build.platform === 'ios'
                      ? 'iPhone kamerasini QR koda tutun, cikan bildirime dokunun. Sayfa mobil tarayicinizda acilir ve kurulum tek dokunusla baslar.'
                      : 'Android cihazin kamerasini QR koda tutun, cikan bildirime dokunun. Sayfa tarayicida acilir ve indirme baslar.'}
                  </div>
                </div>
              )}

              {duzenlenen === build.id && limitler && (
                <LinkAyarlari
                  build={build}
                  maxTtl={limitler.maxTtlHours}
                  mesgul={islemdeki === build.id}
                  onKaydet={(patch) => void kaydet(build, patch)}
                  onVazgec={() => setDuzenlenen(null)}
                />
              )}

              <div className="build-actions">
                {build.installUrl && build.status === 'active' && (
                  <a className="btn secondary sm" href={build.installUrl} target="_blank" rel="noreferrer">
                    Sayfayi ac
                  </a>
                )}
                {/* QR yalnizca ayar acikken: kurulum sayfasindaki davranisla ayni. */}
                {limitler?.showQrCode !== false && build.qrUrl && build.status === 'active' && (
                  <button
                    className="btn secondary sm"
                    onClick={() => setQrAcik(qrAcik === build.id ? null : build.id)}
                  >
                    <IconQr size={14} /> {qrAcik === build.id ? 'QR kodu gizle' : 'QR kod'}
                  </button>
                )}
                <button
                  className="btn secondary sm"
                  disabled={islemdeki === build.id || build.status === 'purged'}
                  onClick={() => setDuzenlenen(duzenlenen === build.id ? null : build.id)}
                >
                  <IconSettings size={14} /> {duzenlenen === build.id ? 'Duzenlemeyi kapat' : 'Duzenle'}
                </button>
                {build.status === 'revoked' ? (
                  <button
                    className="btn secondary sm"
                    disabled={islemdeki === build.id}
                    onClick={() => yenidenAc(build)}
                  >
                    <IconClock size={14} /> Yeniden ac
                  </button>
                ) : (
                  build.status === 'active' && (
                    <button
                      className="btn secondary sm"
                      disabled={islemdeki === build.id}
                      onClick={() =>
                        void islem(build.id, () => api.patchBuild(build.id, { revoked: true }), 'Link iptal edildi')
                      }
                    >
                      <IconBan size={14} /> Iptal et
                    </button>
                  )
                )}
                <button
                  className="btn danger sm"
                  disabled={islemdeki === build.id}
                  onClick={() => sil(build)}
                  style={{ marginLeft: 'auto' }}
                >
                  <IconTrash size={14} /> Sil
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* --- Link ayarlari duzenleme paneli ---------------------------------------- */

type SifreEylemi = 'koru' | 'degistir' | 'kaldir';

interface AyarProps {
  build: BuildDto;
  maxTtl: number;
  mesgul: boolean;
  onKaydet: (patch: BuildPatch) => void;
  onVazgec: () => void;
}

function LinkAyarlari({ build, maxTtl, mesgul, onKaydet, onVazgec }: AyarProps) {
  const [saat, setSaat] = useState(build.ttlHours);
  const [baslangic, setBaslangic] = useState<TtlBasis>('upload');
  const [not, setNot] = useState(build.note ?? '');
  const [sifreEylemi, setSifreEylemi] = useState<SifreEylemi>('koru');
  const [sifre, setSifre] = useState('');

  const gecerliSaat = Number.isFinite(saat) && saat >= 1 ? Math.min(Math.round(saat), maxTtl) : null;
  const baslangicMs = baslangic === 'upload' ? build.createdAt : Date.now();
  const yeniBitis = gecerliSaat !== null ? baslangicMs + gecerliSaat * 3_600_000 : null;
  const gecmisteKaliyor = yeniBitis !== null && yeniBitis <= Date.now();

  const sureDegisti = gecerliSaat !== null && (gecerliSaat !== build.ttlHours || baslangic !== 'upload');
  const notDegisti = not.trim() !== (build.note ?? '');
  const sifreDegisti = sifreEylemi === 'kaldir' || (sifreEylemi === 'degistir' && sifre.trim() !== '');
  const kaydedilebilir = sureDegisti || notDegisti || sifreDegisti;

  const gonder = () => {
    const patch: BuildPatch = {};
    if (sureDegisti && gecerliSaat !== null) {
      patch.ttlHours = gecerliSaat;
      patch.ttlFrom = baslangic;
    }
    if (notDegisti) patch.note = not.trim() || null;
    if (sifreEylemi === 'kaldir') patch.password = null;
    else if (sifreEylemi === 'degistir' && sifre.trim()) patch.password = sifre.trim();
    onKaydet(patch);
  };

  return (
    <div className="build-edit">
      <div className="group-title" style={{ marginTop: 0 }}>
        Yuklemede girilen link ayarlari
      </div>

      <div className="field">
        <label htmlFor={`ttl-${build.id}`}>Gecerlilik suresi</label>
        <div className="help">
          Yuklenirken {formatHours(build.ttlHours)} verilmisti. En fazla {maxTtl} saat (
          {formatHours(maxTtl)}).
        </div>
        <div className="input-row">
          <input
            id={`ttl-${build.id}`}
            className="input"
            type="number"
            min={1}
            max={maxTtl}
            value={Number.isFinite(saat) ? saat : ''}
            onChange={(e) => setSaat(Number(e.target.value))}
          />
          <span className="unit">saat</span>
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 9, flexWrap: 'wrap' }}>
          {SURE_ONAYARLARI.filter((o) => o.saat <= maxTtl).map((o) => (
            <button
              key={o.saat}
              type="button"
              className={`btn sm ${saat === o.saat ? '' : 'secondary'}`}
              onClick={() => setSaat(o.saat)}
            >
              {o.etiket}
            </button>
          ))}
        </div>

        <div className="seg" style={{ marginTop: 11 }}>
          <label className={baslangic === 'upload' ? 'on' : ''}>
            <input
              type="radio"
              name={`basis-${build.id}`}
              checked={baslangic === 'upload'}
              onChange={() => setBaslangic('upload')}
            />
            Yukleme anindan
          </label>
          <label className={baslangic === 'now' ? 'on' : ''}>
            <input
              type="radio"
              name={`basis-${build.id}`}
              checked={baslangic === 'now'}
              onChange={() => setBaslangic('now')}
            />
            Simdiden
          </label>
        </div>

        <div className="help" style={{ marginTop: 7, marginBottom: 0 }}>
          {yeniBitis === null ? (
            'Gecerli bir saat degeri girin.'
          ) : (
            <>
              Yeni bitis: <strong style={{ color: 'var(--fg)' }}>{formatDateTime(yeniBitis)}</strong>
              {gecmisteKaliyor && ' — bu tarih gecmiste; link hemen gecersiz olur.'}
            </>
          )}
        </div>
      </div>

      <div className="field">
        <label htmlFor={`not-${build.id}`}>Not</label>
        <div className="help">Yalnizca yonetici panelinde gorunur.</div>
        <input
          id={`not-${build.id}`}
          className="input"
          value={not}
          maxLength={500}
          placeholder="orn. Musteri demo surumu"
          onChange={(e) => setNot(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor={`sifre-${build.id}`}>Link sifresi</label>
        <div className="help">
          {build.hasPassword
            ? 'Bu link sifreli. Mevcut sifre geri okunamaz; ancak degistirilebilir ya da kaldirilabilir.'
            : 'Bu linkte sifre yok. Sifre koyarsaniz kurulum sayfasi acilmadan once sorulur.'}
        </div>
        <div className="input-row">
          <select
            className="select"
            style={{ flex: '0 0 auto' }}
            value={sifreEylemi}
            onChange={(e) => setSifreEylemi(e.target.value as SifreEylemi)}
          >
            <option value="koru">Degistirme</option>
            <option value="degistir">{build.hasPassword ? 'Yeni sifre belirle' : 'Sifre koy'}</option>
            {build.hasPassword && <option value="kaldir">Sifreyi kaldir</option>}
          </select>
          {sifreEylemi === 'degistir' && (
            <input
              id={`sifre-${build.id}`}
              className="input"
              type="text"
              value={sifre}
              placeholder="Yeni sifre"
              onChange={(e) => setSifre(e.target.value)}
            />
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 7 }}>
        <button className="btn sm" disabled={mesgul || !kaydedilebilir} onClick={gonder}>
          {mesgul ? <Spinner /> : 'Kaydet'}
        </button>
        <button className="btn ghost sm" disabled={mesgul} onClick={onVazgec}>
          Vazgec
        </button>
      </div>
    </div>
  );
}

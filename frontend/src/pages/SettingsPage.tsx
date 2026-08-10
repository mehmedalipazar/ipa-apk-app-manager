/**
 * Ayarlar paneli.
 *
 * Alanlar sunucudan gelen `fields` tanimina gore uretilir; sunucudaki semaya
 * yeni bir ayar eklendiginde bu ekran kendiliginden guncellenir.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, AlertList, Spinner } from '../components/common.tsx';
import { useToast } from '../components/Toast.tsx';
import { useNavigationBlocker } from '../router.tsx';
import {
  ApiError,
  api,
  formatBytes,
  formatHours,
  type AppConfig,
  type CleanupPreview,
  type FieldMeta,
} from '../api.ts';

const GRUP_ADLARI: Record<FieldMeta['group'], string> = {
  link: 'Link davranisi',
  yukleme: 'Yukleme',
  gorunum: 'Gorunum',
};

const GRUP_SIRASI: FieldMeta['group'][] = ['link', 'yukleme', 'gorunum'];

export function SettingsPage() {
  const toast = useToast();
  const [values, setValues] = useState<AppConfig | null>(null);
  /** Sunucudaki son bilinen hal — yalnizca DEGISEN alanlari gondermek icin. */
  const [kayitli, setKayitli] = useState<AppConfig | null>(null);
  const [fields, setFields] = useState<FieldMeta[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [hataliAlan, setHataliAlan] = useState<string | null>(null);

  useEffect(() => {
    void api
      .getSettings()
      .then((s) => {
        setValues(s.values);
        setKayitli(s.values);
        setFields(s.fields);
        setWarnings(s.warnings);
      })
      .catch((e: unknown) => setHata(e instanceof ApiError ? e.message : 'Ayarlar alinamadi.'))
      .finally(() => setYukleniyor(false));
  }, []);

  /** Kaydedilmemis degisiklikler: hem "Kaydet"i acar hem sayfadan cikisi sorar. */
  const degisenler = useMemo<Partial<AppConfig>>(() => {
    if (!values || !kayitli) return {};
    const fark: Record<string, unknown> = {};
    for (const alan of Object.keys(values) as (keyof AppConfig)[]) {
      if (values[alan] !== kayitli[alan]) fark[alan] = values[alan];
    }
    return fark as Partial<AppConfig>;
  }, [values, kayitli]);

  const degisti = Object.keys(degisenler).length > 0;

  useNavigationBlocker(
    degisti,
    useCallback(() => window.confirm('Kaydedilmemis ayar degisiklikleri var. Yine de cikilsin mi?'), []),
  );

  const degistir = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
    setValues((onceki) => (onceki ? { ...onceki, [key]: value } : onceki));
    // Kullanici alani duzeltmeye basladiysa eski hatayi ustunde tutma.
    if (hataliAlan === key) {
      setHataliAlan(null);
      setHata(null);
    }
  };

  const kaydet = async () => {
    if (!values || !degisti) return;
    setKaydediliyor(true);
    setHata(null);
    setHataliAlan(null);
    setNotes([]);
    try {
      // Yalnizca DEGISEN alanlar gonderilir. Tum govdeyi gondermek, elle
      // dokunulmamis ayarlari da veritabanina cakiyor ve semadaki varsayilan
      // degerleri kalici olarak golgeliyordu.
      const yanit = await api.putSettings(degisenler);
      setValues(yanit.values);
      setKayitli(yanit.values);
      setWarnings(yanit.warnings);
      setNotes(yanit.notes);
      // Site adi tarayici sekmesini de besler.
      document.title = yanit.values.siteName || 'IPA OTA Dagitim';
      toast('Ayarlar kaydedildi');
    } catch (e) {
      if (e instanceof ApiError) {
        setHata(e.message);
        setHataliAlan(e.field ?? null);
        if (e.field) {
          const girdi = document.getElementById(e.field);
          girdi?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          (girdi as HTMLInputElement | null)?.focus();
        }
      } else {
        setHata('Kaydedilemedi.');
      }
    } finally {
      setKaydediliyor(false);
    }
  };

  if (yukleniyor) {
    return (
      <div className="main narrow">
        <div className="empty">
          <Spinner />
        </div>
      </div>
    );
  }

  if (!values) {
    return (
      <div className="main narrow">
        <Alert kind="err">{hata ?? 'Ayarlar yuklenemedi.'}</Alert>
      </div>
    );
  }

  return (
    <div className="main narrow">
      <div className="page-head">
        <h1>Ayarlar</h1>
        <p>Servisin calisma bicimini buradan yonetin. Degisiklikler aninda gecerli olur.</p>
      </div>

      <AlertList warnings={warnings} />
      <AlertList warnings={notes} kind="info" />

      {/* Alana baglanamayan hatalar burada; alana bagli olanlar girdinin altinda. */}
      {hata && !hataliAlan && (
        <div className="alerts">
          <Alert kind="err">{hata}</Alert>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void kaydet();
        }}
      >
        <div className="card">
          <div className="card-body">
            <BaseUrlField baseUrl={values.baseUrl} />

            {GRUP_SIRASI.map((grup) => {
              const grupAlanlari = fields.filter((f) => f.group === grup);
              if (grupAlanlari.length === 0) return null;

              // Sarmalayici <div> KULLANILMAZ: her grubun basligi kendi kabinin ilk
              // cocugu olur ve `.group-title:first-child { margin-top: 0 }` hepsinde
              // tutar; gruplar birbirine yapisir. Fragment ile duz liste uretiyoruz.
              return (
                <Fragment key={grup}>
                  <h2 className="group-title">{GRUP_ADLARI[grup]}</h2>
                  {grupAlanlari.map((field) => (
                    <SettingField
                      key={field.key}
                      field={field}
                      value={values[field.key]}
                      hata={hataliAlan === field.key ? hata : null}
                      degisti={kayitli ? values[field.key] !== kayitli[field.key] : false}
                      onChange={(v) => degistir(field.key, v as AppConfig[typeof field.key])}
                    />
                  ))}
                </Fragment>
              );
            })}
          </div>
        </div>

        {/* Form uzun; kaydet dugmesi ekrandan cikmasin diye yapiskan. */}
        <div className="save-bar">
          <button className="btn" type="submit" disabled={!degisti || kaydediliyor}>
            {kaydediliyor ? (
              <>
                <Spinner /> Kaydediliyor
              </>
            ) : (
              'Kaydet'
            )}
          </button>
          {degisti && (
            <span className="unit">
              {Object.keys(degisenler).length} alan degisti — kaydedilmedi
            </span>
          )}
        </div>
      </form>

      <BakimKarti />
      <PasswordCard />
    </div>
  );
}

/**
 * Genel adres — salt okunur.
 *
 * `baseUrl` sunucudan `values` icinde gelir ama `fields` listesinde YOKTUR:
 * kaynagi PUBLIC_BASE_URL ortam degiskenidir ve panelden yazilamaz (PUT govdesinde
 * gonderilse bile yok sayilir). Buna ragmen gosteriyoruz, cunku kurulum linklerinin
 * ve manifest.plist icindeki tum adreslerin koku bu degerdir: yanlis oldugunda
 * kurulum telefonda SESSIZCE basarisiz olur, dolayisiyla teshis icin gorunur olmali.
 */
function BaseUrlField({ baseUrl }: { baseUrl: string }) {
  return (
    <>
      <h2 className="group-title">Sunucu</h2>
      <div className="field">
        <div className="field-label">Genel adres</div>
        <div className="help">
          Kurulum linklerinin ve manifest.plist icindeki adreslerin koku. Panelden
          degistirilemez; kaynagi sunucudaki PUBLIC_BASE_URL ortam degiskenidir. iOS
          yalnizca gecerli sertifikali https adreslerinden kurulum yapar.
        </div>
        <div className="readonly-value">{baseUrl || 'ayarlanmamis'}</div>
      </div>
    </>
  );
}

/** Sayi alanlarinin altinda gosterilen insan okunur karsilik. */
function birimKarsiligi(field: FieldMeta, deger: number): string | null {
  if (!Number.isFinite(deger) || deger <= 0) return null;
  if (field.unit === 'saat') return deger < 24 ? null : formatHours(deger);
  if (field.unit === 'dakika') {
    if (deger < 60) return null;
    const saat = Math.floor(deger / 60);
    const dakika = deger % 60;
    return dakika ? `${saat} saat ${dakika} dakika` : `${saat} saat`;
  }
  if (field.unit === 'MB') return deger < 1024 ? null : formatBytes(deger * 1024 * 1024);
  return null;
}

function SettingField({
  field,
  value,
  hata,
  degisti,
  onChange,
}: {
  field: FieldMeta;
  value: AppConfig[keyof AppConfig];
  hata: string | null;
  degisti: boolean;
  onChange: (v: string | number | boolean) => void;
}) {
  const sinif = ['field', hata ? 'has-error' : '', degisti ? 'is-dirty' : ''].filter(Boolean).join(' ');

  if (field.kind === 'boolean') {
    return (
      <div className={sinif}>
        <label className="switch">
          <input
            id={field.key}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="switch-text">
            <strong>{field.label}</strong>
            <span>{field.help}</span>
          </span>
        </label>
        {hata && <div className="field-error">{hata}</div>}
      </div>
    );
  }

  const karsilik = field.kind === 'number' ? birimKarsiligi(field, Number(value)) : null;

  return (
    <div className={sinif}>
      <label htmlFor={field.key}>{field.label}</label>
      <div className="help">{field.help}</div>

      {field.kind === 'textarea' ? (
        <textarea
          id={field.key}
          className="textarea"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.kind === 'number' ? (
        <div className="input-row">
          <input
            id={field.key}
            className="input"
            type="number"
            min={field.min}
            max={field.max}
            value={Number(value ?? 0)}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          {field.unit && <span className="unit">{field.unit}</span>}
          {karsilik && <span className="unit hint">= {karsilik}</span>}
        </div>
      ) : (
        <input
          id={field.key}
          className="input"
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {hata && <div className="field-error">{hata}</div>}
    </div>
  );
}

/**
 * Bakim karti.
 *
 * Temizlik geri alinamaz: dosyalar diskten silinir. Bu yuzden once GET ile
 * kapsam sorulur ("kac surum, kac bayt"), sonra ayri bir onay adimi gelir.
 */
function BakimKarti() {
  const toast = useToast();
  const [onizleme, setOnizleme] = useState<CleanupPreview | null>(null);
  const [onayda, setOnayda] = useState(false);
  const [mesgul, setMesgul] = useState(false);

  const tazele = useCallback(async () => {
    try {
      setOnizleme(await api.previewCleanup());
    } catch {
      setOnizleme(null);
    }
  }, []);

  useEffect(() => {
    void tazele();
  }, [tazele]);

  const calistir = async () => {
    setMesgul(true);
    try {
      const sonuc = await api.runCleanup();
      toast(
        sonuc.purged > 0
          ? `${sonuc.purged} surumun dosyasi silindi (${formatBytes(sonuc.freedBytes)})`
          : 'Silinecek dosya yok',
      );
      setOnayda(false);
      await tazele();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Temizlik calistirilamadi');
    } finally {
      setMesgul(false);
    }
  };

  const adaySayisi = onizleme?.purgeable ?? 0;

  return (
    <div className="card" style={{ marginTop: 26 }}>
      <div className="card-head">
        <h2>Bakim</h2>
      </div>
      <div className="card-body">
        <p style={{ color: 'var(--fg-muted)', fontSize: 14, marginBottom: 13 }}>
          Suresi dolmus surumlerin IPA dosyalari normalde arka planda silinir. Diski hemen
          bosaltmak icin temizligi elle calistirabilirsiniz. Kayitlar silinmez, yalnizca
          dosyalar kaldirilir; link 410 doner.
        </p>

        <p style={{ fontSize: 14, marginBottom: 13 }}>
          {onizleme === null
            ? 'Silinmeye aday surum sayisi alinamadi.'
            : adaySayisi === 0
              ? 'Su anda silinmeye aday dosya yok.'
              : `Su anda ${adaySayisi} surum silinmeye hazir — ${formatBytes(onizleme.bytes)} bosalir.`}
        </p>

        {onayda ? (
          <div className="confirm-row">
            <span>
              {adaySayisi} surumun dosyalari kalici olarak silinecek. Devam edilsin mi?
            </span>
            <button className="btn danger sm" disabled={mesgul} onClick={() => void calistir()}>
              {mesgul ? <Spinner /> : 'Evet, sil'}
            </button>
            <button className="btn secondary sm" disabled={mesgul} onClick={() => setOnayda(false)}>
              Vazgec
            </button>
          </div>
        ) : (
          <button
            className="btn secondary"
            disabled={adaySayisi === 0}
            onClick={() => setOnayda(true)}
          >
            Temizligi simdi calistir
          </button>
        )}
      </div>
    </div>
  );
}

function PasswordCard() {
  const toast = useToast();
  const [mevcut, setMevcut] = useState('');
  const [yeni, setYeni] = useState('');
  const [tekrar, setTekrar] = useState('');
  const [bekliyor, setBekliyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  const gonder = async (e: React.FormEvent) => {
    e.preventDefault();
    setHata(null);

    if (yeni !== tekrar) {
      setHata('Yeni sifreler eslesmiyor.');
      return;
    }
    setBekliyor(true);
    try {
      await api.changePassword(mevcut, yeni);
      setMevcut('');
      setYeni('');
      setTekrar('');
      toast('Sifre degistirildi');
    } catch (err) {
      setHata(err instanceof ApiError ? err.message : 'Sifre degistirilemedi.');
    } finally {
      setBekliyor(false);
    }
  };

  return (
    <form className="card" style={{ marginTop: 18 }} onSubmit={(e) => void gonder(e)}>
      <div className="card-head">
        <h2>Yonetici sifresi</h2>
      </div>
      <div className="card-body">
        {hata && (
          <div className="alerts">
            <Alert kind="err">{hata}</Alert>
          </div>
        )}
        <div className="field">
          <label htmlFor="mevcut">Mevcut sifre</label>
          <input
            id="mevcut"
            className="input"
            type="password"
            autoComplete="current-password"
            value={mevcut}
            onChange={(e) => setMevcut(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="yeni">Yeni sifre</label>
          <div className="help">En az 8 karakter.</div>
          <input
            id="yeni"
            className="input"
            type="password"
            autoComplete="new-password"
            value={yeni}
            onChange={(e) => setYeni(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="tekrar">Yeni sifre (tekrar)</label>
          <input
            id="tekrar"
            className="input"
            type="password"
            autoComplete="new-password"
            value={tekrar}
            onChange={(e) => setTekrar(e.target.value)}
          />
        </div>
        <button className="btn secondary" type="submit" disabled={bekliyor || !mevcut || !yeni}>
          {bekliyor ? <Spinner /> : 'Sifreyi degistir'}
        </button>
      </div>
    </form>
  );
}

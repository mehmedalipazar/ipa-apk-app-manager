/** Ekranlar arasinda paylasilan kucuk parcalar. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  IconAndroid,
  IconApple,
  IconCheck,
  IconChevron,
  IconClose,
  IconCopy,
  IconNote,
  IconWarn,
} from './icons.tsx';
import { useToast } from './Toast.tsx';
import { NOT_MAX_KARAKTER, type BuildStatus, type Platform } from '../api.ts';

export function Alert({
  kind,
  children,
}: {
  kind: 'warn' | 'err' | 'ok' | 'info';
  children: ReactNode;
}) {
  return (
    <div className={`alert ${kind}`}>
      {kind === 'warn' || kind === 'err' ? <IconWarn size={17} /> : null}
      <div>{children}</div>
    </div>
  );
}

export function AlertList({
  warnings,
  kind = 'warn',
}: {
  warnings: string[];
  kind?: 'warn' | 'err' | 'info';
}) {
  if (warnings.length === 0) return null;
  return (
    <div className="alerts">
      {warnings.map((w) => (
        <Alert key={w} kind={kind}>
          {w}
        </Alert>
      ))}
    </div>
  );
}

export function StatusBadge({ status, label }: { status: BuildStatus; label: string }) {
  return (
    <span className={`badge ${status}`}>
      <span className="dot" />
      {label}
    </span>
  );
}

/**
 * Urun adi. Servis iki platform birden dagittigi icin ad da iki uzantiyi anar.
 * Kurulum sayfasindaki "Site adi" AYRI bir ayardir (Ayarlar > Gorunum) ve
 * bunu ezmez; burasi yalnizca panelin kendi markasidir.
 */
export const APP_NAME = 'Ipa / Apk Application Manager';

/**
 * Marka isareti: iki platform simgesi, aralarinda ince bir ayrac. Servis hem
 * .ipa hem .apk dagittigi icin logo tek platformu one cikarmaz.
 *
 * Iki olcu hesaplanarak veriliyor, sabit degil: android basi dogasi geregi
 * elmadan genis ve basik oldugu icin biraz kucuk cizilir (yoksa yaninda blok
 * gibi durur), ayrac ve aralik da simge boyuyla olceklenir.
 *
 * `withName` giris kartinda false: orada hemen altinda "Yonetici girisi"
 * basligi var, marka yazisi onunla yarisiyor.
 */
export function BrandMark({ size = 19, withName = true }: { size?: number; withName?: boolean }) {
  return (
    <>
      <span className="brand-icons" style={{ gap: Math.round(size * 0.4) }} aria-hidden="true">
        <IconApple size={size} />
        <span className="brand-sep" style={{ height: Math.round(size * 0.7) }} />
        <IconAndroid size={Math.round(size * 0.9)} />
      </span>
      {withName && <span className="brand-name">{APP_NAME}</span>}
    </>
  );
}

/** Paketin platformu: iOS (.ipa) ya da Android (.apk). Renkler styles.css `.badge.platform`. */
export function PlatformBadge({ platform }: { platform: Platform }) {
  return (
    <span className={`badge platform ${platform}`}>
      {platform === 'ios' ? <IconApple size={12} /> : <IconAndroid size={12} />}
      {platform === 'ios' ? 'iOS' : 'Android'}
    </span>
  );
}

/** Panoya kopyalayan buton. HTTPS disinda clipboard API yoksa yedek yontem kullanir. */
export function CopyButton({
  value,
  label = 'Kopyala',
  className = 'btn secondary sm',
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const toast = useToast();
  const [kopyalandi, setKopyalandi] = useState(false);

  const kopyala = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
      } else {
        // Guvenli olmayan baglamda (http) Clipboard API yoktur.
        const alan = document.createElement('textarea');
        alan.value = value;
        alan.style.position = 'fixed';
        alan.style.opacity = '0';
        document.body.appendChild(alan);
        alan.select();
        document.execCommand('copy');
        document.body.removeChild(alan);
      }
      setKopyalandi(true);
      toast('Panoya kopyalandi');
      window.setTimeout(() => setKopyalandi(false), 1800);
    } catch {
      toast('Kopyalanamadi — linki elle secip kopyalayin');
    }
  };

  return (
    <button type="button" className={className} onClick={() => void kopyala()}>
      {kopyalandi ? <IconCheck size={15} /> : <IconCopy size={15} />}
      {kopyalandi ? 'Kopyalandi' : label}
    </button>
  );
}

/** Uygulama simgesi; yoksa bas harfli yer tutucu. */
export function AppIcon({
  src,
  name,
  className,
}: {
  src: string | null;
  name: string;
  className: string;
}) {
  const [hata, setHata] = useState(false);

  if (!src || hata) {
    return <div className={`${className} placeholder`}>{name.trim().charAt(0).toUpperCase() || '?'}</div>;
  }
  return <img className={className} src={src} alt={name} onError={() => setHata(true)} />;
}

export function Spinner() {
  return <span className="spinner" />;
}

/**
 * Not alanlarinin karakter sayaci.
 *
 * Sinira dayanan kullanici, yazdiginin sessizce kesildigini sanmasin diye son
 * %10'luk dilimde uyari rengine doner. Kesme isini sayac degil girdinin
 * `maxLength`i yapar; burasi yalnizca gorunur geri bildirim.
 */
export function KarakterSayaci({
  uzunluk,
  sinir = NOT_MAX_KARAKTER,
}: {
  uzunluk: number;
  sinir?: number;
}) {
  const yakin = uzunluk >= sinir - Math.round(sinir / 10);
  return (
    <span className={`char-count ${yakin ? 'near' : ''}`} aria-live="polite">
      {uzunluk} / {sinir} karakter
    </span>
  );
}

/**
 * Not penceresi — surum kartindaki "Not" butonunun actigi salt okunur pencere.
 *
 * Kart icinde acilan bir panel altindaki her seyi asagi itiyor, uzun listede
 * okunan satirin yerini kaybettiriyordu. Pencere hicbir seyi oynatmaz ve 1000
 * karakterlik nota da yer birakir (tasarsa kendi icinde kayar).
 * Esc, capraz ve arka plan tiklamasi kapatir.
 */
export function NotPenceresi({
  baslik,
  not,
  onKapat,
}: {
  baslik: string;
  not: string;
  onKapat: () => void;
}) {
  const dugmeRef = useRef<HTMLButtonElement>(null);
  // Esc dinleyicisi yalnizca ACILISTA kurulur; onKapat her render'da yeni bir
  // fonksiyon oldugu icin dogrudan bagimlilik yapilirsa odak surekli calinir.
  const sonKapat = useRef(onKapat);
  useEffect(() => {
    sonKapat.current = onKapat;
  });
  useEffect(() => {
    dugmeRef.current?.focus();
    const tus = (e: KeyboardEvent) => {
      if (e.key === 'Escape') sonKapat.current();
    };
    window.addEventListener('keydown', tus);
    return () => window.removeEventListener('keydown', tus);
  }, []);

  return (
    <div className="modal-katman" onClick={() => onKapat()}>
      {/* Pencerenin kendisine tiklamak kapatmamali. */}
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="not-penceresi-baslik"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <IconNote size={16} />
          <strong id="not-penceresi-baslik">Not &mdash; {baslik}</strong>
          <button ref={dugmeRef} className="btn ghost sm" aria-label="Kapat" onClick={() => onKapat()}>
            <IconClose size={14} />
          </button>
        </div>
        <div className="modal-body">
          <p className="not-metni">{not}</p>
        </div>
      </div>
    </div>
  );
}

export interface NotAlaniProps {
  /** Metin kutusunun id'si — ayni sayfada birden fazla ornek olabilir. */
  id: string;
  deger: string;
  onDegis: (yeni: string) => void;
  /** Panel acik baslasin mi (orn. duzenlemede kayitli bir not zaten varsa). */
  acikBasla?: boolean;
  sinir?: number;
}

/**
 * Not alani — butona bagli, acilip kapanan cok satirli panel.
 *
 * Not ikincil bir alandir: surekli acik dursa formu uzatir, tumden gizlense
 * unutulur. Bu yuzden kapali baslar ama KAPALIYKEN DE icerigi baslik satirinda
 * ozetlenir; gonderilecek ya da kaydedilecek bir sey hicbir zaman gorunmez
 * olmaz. Yukleme ve Surumler ekranlari ayni bileseni kullanir — iki yerde ayni
 * sinir, ayni sayac, ayni davranis.
 */
export function NotAlani({ id, deger, onDegis, acikBasla = false, sinir = NOT_MAX_KARAKTER }: NotAlaniProps) {
  const [acik, setAcik] = useState(acikBasla);
  // Cok satirli notun ozeti tek satira sigmali: satir sonlari bosluga doner.
  const ozet = deger.trim().replace(/\s+/g, ' ');

  return (
    <div className={`field disclosure ${acik ? 'open' : ''}`}>
      <button
        type="button"
        className="disclosure-btn"
        aria-expanded={acik}
        aria-controls={`${id}-govde`}
        onClick={() => setAcik((a) => !a)}
      >
        <IconNote size={16} className="dc-icon" />
        <span>{ozet ? 'Not' : 'Not ekle (opsiyonel)'}</span>
        <span className="dc-summary">{acik ? '' : ozet}</span>
        <IconChevron size={16} className="dc-arrow" />
      </button>

      {acik && (
        <div className="disclosure-body" id={`${id}-govde`}>
          <div className="help">
            Yalnizca yonetici panelinde gorunur; kurulum sayfasinda yer almaz. En fazla {sinir}{' '}
            karakter, satir sonu kullanabilirsiniz.
          </div>
          <textarea
            id={id}
            className="textarea"
            value={deger}
            maxLength={sinir}
            placeholder={'orn. Musteri demo surumu — 26 Agustos sunumu icin.\nBilinen eksik: cevrimdisi mod kapali.'}
            aria-label="Not"
            autoFocus
            onChange={(e) => onDegis(e.target.value)}
          />
          <div className="disclosure-foot">
            {deger !== '' && (
              <button type="button" className="btn ghost sm" onClick={() => onDegis('')}>
                Temizle
              </button>
            )}
            <KarakterSayaci uzunluk={deger.length} sinir={sinir} />
          </div>
        </div>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

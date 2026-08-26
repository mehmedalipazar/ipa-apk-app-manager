/** Ekranlar arasinda paylasilan kucuk parcalar. */
import { useState, type ReactNode } from 'react';
import { IconAndroid, IconApple, IconCheck, IconCopy, IconWarn } from './icons.tsx';
import { useToast } from './Toast.tsx';
import type { BuildStatus, Platform } from '../api.ts';

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
export const APP_NAME = 'Ipa Apk Application Manager';

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

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

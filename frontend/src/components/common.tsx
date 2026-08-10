/** Ekranlar arasinda paylasilan kucuk parcalar. */
import { useState, type ReactNode } from 'react';
import { IconCheck, IconCopy, IconWarn } from './icons.tsx';
import { useToast } from './Toast.tsx';
import type { BuildStatus } from '../api.ts';

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

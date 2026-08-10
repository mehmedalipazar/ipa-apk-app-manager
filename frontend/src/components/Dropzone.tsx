/**
 * Surukle-birak dosya alani.
 *
 * Klavye ve ekran okuyucu ile de kullanilabilir olmasi icin gorunmez bir
 * <input type="file"> uzerine kuruludur.
 */
import { useCallback, useRef, useState, type DragEvent } from 'react';
import { IconUpload } from './icons.tsx';

export interface DropzoneProps {
  onFile: (file: File) => void;
  /** Kabul edilen uzanti — dogrulama burada yapilir, sunucu ayrica kontrol eder. */
  accept?: string;
  disabled?: boolean;
  hata?: string | null;
}

export function Dropzone({ onFile, accept = '.ipa', disabled = false, hata = null }: DropzoneProps) {
  const [uzerinde, setUzerinde] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const dosyaSec = useCallback(
    (files: FileList | null) => {
      const dosya = files?.[0];
      if (dosya) onFile(dosya);
    },
    [onFile],
  );

  const surukle = (e: DragEvent<HTMLDivElement>, aktif: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setUzerinde(aktif);
  };

  return (
    <div
      className={['dropzone', uzerinde ? 'over' : '', hata ? 'has-error' : ''].filter(Boolean).join(' ')}
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragEnter={(e) => surukle(e, true)}
      onDragOver={(e) => surukle(e, true)}
      onDragLeave={(e) => surukle(e, false)}
      onDrop={(e) => {
        surukle(e, false);
        if (!disabled) dosyaSec(e.dataTransfer.files);
      }}
    >
      <div className="dz-icon">
        <IconUpload size={34} />
      </div>
      <div className="dz-title">IPA dosyasini buraya birakin</div>
      <div className="dz-sub">ya da tiklayarak bilgisayarinizdan secin</div>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        disabled={disabled}
        onChange={(e) => {
          dosyaSec(e.target.files);
          // Ayni dosya tekrar secilebilsin diye degeri sifirla.
          e.target.value = '';
        }}
      />
    </div>
  );
}

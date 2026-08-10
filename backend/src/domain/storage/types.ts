import type { Readable } from 'node:stream';

/**
 * Dosya deposu arayuzu.
 *
 * Yerel disk disinda bir hedefe (S3, MinIO, NFS) gecmek isterseniz bu
 * arayuzu uygulayan yeni bir surucu yazip `createStorage()` icinde secin;
 * uygulamanin geri kalani degismez.
 */
export interface Storage {
  /** Gelen akisi kaydeder; yazilan bayt sayisi ve SHA-256 ozetini dondurur. */
  saveStream(key: string, stream: Readable, maxBytes: number): Promise<SaveResult>;
  /** Bellekteki veriyi kaydeder. */
  saveBuffer(key: string, data: Buffer): Promise<void>;
  /** Okuma akisi acar. Dosya yoksa null. */
  createReadStream(key: string, range?: ByteRange): Promise<Readable | null>;
  /** Dosya boyutu. Yoksa null. */
  size(key: string): Promise<number | null>;
  exists(key: string): Promise<boolean>;
  /** Dosyayi siler. Yoksa sessizce gecer. */
  remove(key: string): Promise<void>;
  /** Bir on ek altindaki her seyi siler (orn. bir build'in tum dosyalari). */
  removePrefix(prefix: string): Promise<void>;

  /**
   * Dosyayi yerel bir yol uzerinden kullandirir.
   *
   * IPA cozumlemesi (zip okuma) rastgele erisim gerektirir, akis yetmez.
   * Yerel surucu dogrudan kendi yolunu verir; uzak bir surucu (S3 vb.)
   * gecici dosyaya indirip is bitince silmelidir.
   */
  withLocalFile<T>(key: string, fn: (path: string) => Promise<T>): Promise<T>;
}

export interface SaveResult {
  readonly bytes: number;
  readonly sha256: string;
}

export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

export class StorageLimitError extends Error {
  override readonly name = 'StorageLimitError';
}

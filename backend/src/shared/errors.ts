/**
 * Tipli hata siniflari — tek yerde.
 *
 * Her hatanin bir `statusCode` alani vardir; `server.ts` icindeki hata
 * yakalayici 4xx icin `message` degerini oldugu gibi istemciye doner,
 * 5xx icin genel bir metin yazar ve ayrintiyi yalnizca loga dusurur.
 *
 * Yeni bir hata turu eklerken AppError'dan turetin; boylece HTTP katmaninda
 * ayrica ele alinmasi gerekmez.
 */

export class AppError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** Yapilandirma eksik ya da tutarsiz (orn. baseUrl ayarlanmamis). */
export class ConfigError extends AppError {
  override readonly name = 'ConfigError';

  constructor(message: string) {
    super(message, 503);
  }
}

/** Yukleme akisinda kullanicidan kaynaklanan hata. */
export class UploadError extends AppError {
  override readonly name = 'UploadError';
}

/** Kimlik dogrulama / sifre degistirme hatasi. */
export class AuthError extends AppError {
  override readonly name = 'AuthError';

  constructor(message: string, statusCode = 400) {
    super(message, statusCode);
  }
}

// Alan modullerinde tanimli hatalar da buradan tek noktadan alinabilsin.
export { PackageParseError } from '../domain/package/types.ts';
export { IpaParseError } from '../domain/ipa/types.ts';
export { ApkParseError } from '../domain/apk/types.ts';
export { StorageLimitError } from '../domain/storage/types.ts';

/**
 * Link durumu ve adres uretimi.
 */
import type { BuildRecord } from '../../db/repositories/builds.repository.ts';
import type { ConfigService } from '../../config/settings.service.ts';
import { env } from '../../config/env.ts';
import { signAccess, type AccessPurpose } from './token.ts';

export type BuildStatus = 'active' | 'expired' | 'revoked' | 'purged';

export function getStatus(build: BuildRecord, now = Date.now()): BuildStatus {
  if (build.filesDeletedAt !== null) return 'purged';
  if (build.revokedAt !== null) return 'revoked';
  if (build.expiresAt <= now) return 'expired';
  return 'active';
}

export function isDownloadable(build: BuildRecord, now = Date.now()): boolean {
  return getStatus(build, now) === 'active';
}

export const STATUS_LABELS: Record<BuildStatus, string> = {
  active: 'Aktif',
  expired: 'Suresi doldu',
  revoked: 'Iptal edildi',
  purged: 'Dosyalar silindi',
};

export class LinkService {
  private readonly config: ConfigService;
  private readonly secret: string;

  constructor(config: ConfigService, secret: string) {
    this.config = config;
    this.secret = secret;
  }

  /**
   * Paylasilacak genel adres — orn. https://ota.sirket.com/i/aB3x...
   * Yol oneki INSTALL_PATH_PREFIX'ten gelir; rotalar da ayni degeri kullanir.
   */
  publicUrl(token: string): string {
    return `${this.config.requireBaseUrl()}${env.INSTALL_PATH_PREFIX}/${token}`;
  }

  /** Kisa omurlu imza eklenmis alt adres. */
  signedUrl(token: string, purpose: AccessPurpose, path: string): string {
    const ttlMs = this.config.get().signedUrlTtlMinutes * 60_000;
    const key = signAccess(this.secret, token, purpose, ttlMs);
    return `${this.publicUrl(token)}/${path}?k=${encodeURIComponent(key)}`;
  }

  manifestUrl(token: string): string {
    return this.signedUrl(token, 'manifest', 'manifest.plist');
  }

  ipaUrl(token: string): string {
    return this.signedUrl(token, 'ipa', 'app.ipa');
  }

  /** Android: tarayicinin dogrudan indirdigi imzali .apk adresi (manifest yok). */
  apkUrl(token: string): string {
    return this.signedUrl(token, 'apk', 'app.apk');
  }

  /** Simge adresi; dosya adi (icon.png / icon.webp) kayittaki iconPath'ten turer. */
  iconUrl(token: string, iconPath: string): string {
    return this.signedUrl(token, 'icon', iconPath.slice(iconPath.lastIndexOf('/') + 1));
  }

  /**
   * iOS'un anladigi kurulum adresi.
   * Not: `url=` parametresi HTML icine yazilirken & karakteri &amp; olarak
   * kacislanmalidir — bunu sayfayi ureten taraf yapar.
   */
  itmsServicesUrl(token: string): string {
    return `itms-services://?action=download-manifest&url=${encodeURIComponent(this.manifestUrl(token))}`;
  }
}

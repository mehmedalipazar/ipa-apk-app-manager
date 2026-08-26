/**
 * Veritabani kaydi -> arayuze gonderilen JSON.
 *
 * Sunucu ile arayuz arasindaki sozlesme burasidir; `frontend/src/api.ts`
 * icindeki tip bunun aynasidir ve ELLE senkron tutulur. Bu dosyayi
 * degistirirseniz orayi da guncelleyin — derleyici bu kaymayi yakalamaz;
 * tests/suite-c-api.mjs C10b iki dosyadaki alan ADLARINI karsilastirir
 * (tipleri degil).
 */
import type { BuildRecord } from '../../db/repositories/builds.repository.ts';
import type { Platform } from '../../domain/package/types.ts';
import type { LinkService } from '../../domain/links/service.ts';
import { getStatus, STATUS_LABELS, type BuildStatus } from '../../domain/links/service.ts';
import { formatBytes, formatRemaining } from '../../shared/format.ts';

export interface BuildDto {
  id: string;
  token: string;
  /** 'ios' (.ipa) ya da 'android' (.apk). */
  platform: Platform;

  appName: string;
  bundleId: string;
  version: string;
  buildNumber: string;
  minOsVersion: string | null;
  platforms: string[];

  originalFilename: string;
  sizeBytes: number;
  sizeLabel: string;
  sha256: string;
  note: string | null;

  createdAt: number;
  expiresAt: number;
  /** Yuklemede secilen link omru (saat) — panelde duzenlenebilir. */
  ttlHours: number;
  status: BuildStatus;
  statusLabel: string;
  /** "2 gun 3 saat" — suresi dolmussa null */
  remainingLabel: string | null;

  hasPassword: boolean;
  viewCount: number;
  installCount: number;
  downloadCount: number;

  /** Paylasilacak genel adres. Base URL ayarli degilse null. */
  installUrl: string | null;
  qrUrl: string | null;
  iconUrl: string | null;
}

export function toBuildDto(build: BuildRecord, links: LinkService): BuildDto {
  const status = getStatus(build);

  // Base URL ayarlanmamissa adres uretilemez; arayuz bunu uyariyla gosterir.
  let installUrl: string | null = null;
  let qrUrl: string | null = null;
  let iconUrl: string | null = null;
  try {
    installUrl = links.publicUrl(build.token);
    qrUrl = `${installUrl}/qr.svg`;
    if (build.iconPath && status === 'active') iconUrl = links.iconUrl(build.token, build.iconPath);
  } catch {
    // Sessizce null birak — uyari ayrica warnings[] ile gider.
  }

  return {
    id: build.id,
    token: build.token,
    platform: build.platform,
    appName: build.appName,
    bundleId: build.bundleId,
    version: build.version,
    buildNumber: build.buildNumber,
    minOsVersion: build.minOsVersion,
    platforms: build.platforms,
    originalFilename: build.originalFilename,
    sizeBytes: build.sizeBytes,
    sizeLabel: formatBytes(build.sizeBytes),
    sha256: build.sha256,
    note: build.note,
    createdAt: build.createdAt,
    expiresAt: build.expiresAt,
    ttlHours: build.ttlHours,
    status,
    statusLabel: STATUS_LABELS[status],
    remainingLabel: formatRemaining(build.expiresAt),
    hasPassword: build.passwordHash !== null,
    viewCount: build.viewCount,
    installCount: build.installCount,
    downloadCount: build.downloadCount,
    installUrl,
    qrUrl,
    iconUrl,
  };
}

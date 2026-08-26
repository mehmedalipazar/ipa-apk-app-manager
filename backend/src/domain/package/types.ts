/**
 * Platformdan bagimsiz paket sozlesmesi.
 *
 * Yukleme akisi (BuildService) yalnizca bu katmani tanir: bir dosya ya .ipa
 * (domain/ipa) ya da .apk (domain/apk) olarak cozumlenir ve ikisi de ayni
 * PackageMetadata seklini doldurur. Platforma ozel ayrintilar (Info.plist,
 * AndroidManifest.xml, simge bicimi) bu katmanin altinda kalir.
 */

export const PLATFORMS = ['ios', 'android'] as const;
export type Platform = (typeof PLATFORMS)[number];

/** Depolanan simge bicimi — dosya adi uzantisi bununla belirlenir (icon.png / icon.webp). */
export type IconFormat = 'png' | 'webp';

export interface PackageIcon {
  readonly data: Buffer;
  readonly format: IconFormat;
}

export interface PackageMetadata {
  readonly platform: Platform;
  /** iOS: CFBundleIdentifier — Android: package */
  readonly bundleId: string;
  /** Kullaniciya gosterilecek ad */
  readonly appName: string;
  /** iOS: CFBundleShortVersionString — Android: versionName */
  readonly version: string;
  /** iOS: CFBundleVersion — Android: versionCode */
  readonly buildNumber: string;
  /** iOS: MinimumOSVersion ("15.0") — Android: minSdkVersion API seviyesi ("24") */
  readonly minOsVersion: string | null;
  /** iOS: CFBundleSupportedPlatforms (["iPhoneOS"]) — Android: ["Android"] */
  readonly platforms: readonly string[];
  /** Uygulama simgesi. Bulunamaz ya da cevrilemezse null — simge istege bagli, kurulum degil. */
  readonly icon: PackageIcon | null;
}

/**
 * Paket cozumleme hatasi — HTTP katmaninda 422 olur (BuildService.ingest).
 * `name` bilerek `string` tipli: alt siniflar (IpaParseError, ApkParseError)
 * kendi adlarini yazabilsin.
 */
export class PackageParseError extends Error {
  override readonly name: string = 'PackageParseError';
  /** Alttaki asil hata (varsa) — loglamak icin. */
  readonly reason: unknown;

  constructor(message: string, reason?: unknown) {
    super(message);
    this.reason = reason;
  }
}

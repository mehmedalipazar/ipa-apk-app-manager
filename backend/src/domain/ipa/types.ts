/** Bir IPA dosyasindan cikarilan bilgiler. */
export interface IpaMetadata {
  /** CFBundleIdentifier — orn. com.kgm.gtbys */
  readonly bundleId: string;
  /** Kullaniciya gosterilecek ad (CFBundleDisplayName, yoksa CFBundleName) */
  readonly appName: string;
  /** CFBundleShortVersionString — orn. 1.2.5 */
  readonly version: string;
  /** CFBundleVersion — orn. 1 */
  readonly buildNumber: string;
  /** MinimumOSVersion — orn. 11.0 */
  readonly minOsVersion: string | null;
  /** CFBundleSupportedPlatforms — orn. ["iPhoneOS"] */
  readonly platforms: readonly string[];
  /** .app klasorunun IPA icindeki yolu — orn. Payload/GTBYS.app */
  readonly appPath: string;
  /** Normal PNG'ye cevrilmis uygulama simgesi. Bulunamazsa null. */
  readonly icon: Buffer | null;
}

export class IpaParseError extends Error {
  override readonly name = 'IpaParseError';
  /** Alttaki asil hata (varsa) — loglamak icin. */
  readonly reason: unknown;

  constructor(message: string, reason?: unknown) {
    super(message);
    this.reason = reason;
  }
}

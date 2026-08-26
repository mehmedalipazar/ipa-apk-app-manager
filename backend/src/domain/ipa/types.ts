import { PackageParseError, type PackageMetadata } from '../package/types.ts';

/** Bir IPA dosyasindan cikarilan bilgiler (ortak sekil + .app yolu). */
export interface IpaMetadata extends PackageMetadata {
  readonly platform: 'ios';
  /** .app klasorunun IPA icindeki yolu — orn. Payload/GTBYS.app */
  readonly appPath: string;
}

export class IpaParseError extends PackageParseError {
  override readonly name = 'IpaParseError';
}

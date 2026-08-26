import { PackageParseError, type PackageMetadata } from '../package/types.ts';

/** Bir .apk dosyasindan cikarilan bilgiler. */
export interface ApkMetadata extends PackageMetadata {
  readonly platform: 'android';
}

export class ApkParseError extends PackageParseError {
  override readonly name = 'ApkParseError';
}

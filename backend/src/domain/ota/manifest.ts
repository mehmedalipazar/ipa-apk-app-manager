/**
 * iOS OTA manifest.plist ureticisi.
 *
 * iOS, `itms-services://?action=download-manifest&url=...` adresine
 * dokunuldugunda bu dosyayi indirir ve icindeki `software-package` adresinden
 * .ipa dosyasini ceker. Iki kritik kural:
 *
 *   1. Icerideki TUM adresler mutlak (absolute) ve https olmalidir.
 *   2. Sertifika gecerli olmalidir — self-signed sertifika sessizce basarisiz
 *      olur, kullaniciya "Uygulama yuklenemedi" disinda bir sey gostermez.
 */
import { buildPlist } from '../ipa/plist.ts';

export interface ManifestInput {
  readonly bundleId: string;
  readonly version: string;
  readonly title: string;
  readonly ipaUrl: string;
  /** 57x57 gorsel. Yoksa atlanir. */
  readonly displayImageUrl?: string | null;
  /** 512x512 gorsel. Yoksa atlanir. */
  readonly fullSizeImageUrl?: string | null;
}

interface Asset {
  kind: string;
  url: string;
}

export function buildManifest(input: ManifestInput): string {
  const assets: Asset[] = [{ kind: 'software-package', url: input.ipaUrl }];

  if (input.displayImageUrl) {
    assets.push({ kind: 'display-image', url: input.displayImageUrl });
  }
  if (input.fullSizeImageUrl) {
    assets.push({ kind: 'full-size-image', url: input.fullSizeImageUrl });
  }

  return buildPlist({
    items: [
      {
        assets,
        metadata: {
          'bundle-identifier': input.bundleId,
          'bundle-version': input.version,
          kind: 'software',
          title: input.title,
        },
      },
    ],
  });
}

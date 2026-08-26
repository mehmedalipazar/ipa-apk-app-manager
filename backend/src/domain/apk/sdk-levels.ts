/**
 * Android API seviyesi -> surum adi eslemesi.
 *
 * `minOsVersion` DTO'da ham API seviyesi olarak kalir ("24"); insan okur etiket
 * ("7.0 (API 24)") yalnizca kurulum sayfasinda uretilir. Tablo bilinen
 * surumleri kapsar; listede olmayan bir seviye "API 40" gibi ham gosterilir,
 * kod adi (orn. "VanillaIceCream") oldugu gibi gecer.
 */

export const ANDROID_VERSION_BY_API: Readonly<Record<number, string>> = {
  21: '5.0',
  22: '5.1',
  23: '6.0',
  24: '7.0',
  25: '7.1',
  26: '8.0',
  27: '8.1',
  28: '9',
  29: '10',
  30: '11',
  31: '12',
  32: '12L',
  33: '13',
  34: '14',
  35: '15',
  36: '16',
};

export function androidVersionLabel(minSdk: string | null): string | null {
  if (minSdk === null) return null;
  const ham = minSdk.trim();
  if (ham === '') return null;
  if (!/^\d+$/.test(ham)) return ham; // kod adi: oldugu gibi
  const seviye = Number(ham);
  const surum = ANDROID_VERSION_BY_API[seviye];
  return surum ? `${surum} (API ${seviye})` : `API ${seviye}`;
}

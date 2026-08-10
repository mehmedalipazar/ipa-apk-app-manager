/**
 * Bir .ipa dosyasindan OTA dagitimi icin gereken bilgileri cikarir.
 *
 * Iki gecis yapilir:
 *   1. Arsivin icindekiler listelenir (yalnizca meta veri, acma yok).
 *   2. Sadece gereken 2 dosya (Info.plist + en buyuk simge) bellege okunur.
 */
import { listZipEntries, readZipEntries } from './zip.ts';
import { parsePlist, readString, readStringArray } from './plist.ts';
import { normalizePng } from './cgbi.ts';
import { IpaParseError, type IpaMetadata } from './types.ts';

const APP_DIR_RE = /^(Payload\/[^/]+\.app)\//;
const ICON_RE = /^(?:AppIcon|Icon)[^/]*\.png$/i;

export async function parseIpa(filePath: string): Promise<IpaMetadata> {
  const girdiler = await listZipEntries(filePath);

  /* --- .app klasorunu bul --- */
  let appPath: string | null = null;
  for (const girdi of girdiler) {
    const eslesme = APP_DIR_RE.exec(girdi.path);
    if (eslesme?.[1]) {
      appPath = eslesme[1];
      break;
    }
  }
  if (!appPath) {
    throw new IpaParseError(
      'Bu bir iOS uygulamasi (.ipa) degil — arsiv icinde Payload/<uygulama>.app klasoru bulunamadi.',
    );
  }

  const infoPlistPath = `${appPath}/Info.plist`;
  if (!girdiler.some((g) => g.path === infoPlistPath)) {
    throw new IpaParseError(`Arsiv icinde ${infoPlistPath} bulunamadi — IPA bozuk olabilir.`);
  }

  /* --- Simge adaylari: .app kokundeki AppIcon*.png dosyalari --- */
  const onEk = `${appPath}/`;
  const simgeAdaylari = girdiler
    .filter((g) => {
      if (!g.path.startsWith(onEk)) return false;
      const ad = g.path.slice(onEk.length);
      return !ad.includes('/') && ICON_RE.test(ad);
    })
    .sort((a, b) => b.size - a.size); // En buyuk = en yuksek cozunurluk

  const enIyiSimge = simgeAdaylari[0]?.path;

  /* --- Gereken dosyalari oku --- */
  const okunacak = new Set<string>([infoPlistPath]);
  if (enIyiSimge) okunacak.add(enIyiSimge);

  const icerikler = await readZipEntries(filePath, (p) => okunacak.has(p));

  const infoBuf = icerikler.get(infoPlistPath);
  if (!infoBuf) throw new IpaParseError('Info.plist okunamadi.');

  const info = parsePlist(infoBuf);

  const bundleId = readString(info, 'CFBundleIdentifier');
  if (!bundleId) {
    throw new IpaParseError('Info.plist icinde CFBundleIdentifier yok — gecerli bir uygulama degil.');
  }

  const appName =
    readString(info, 'CFBundleDisplayName') ??
    readString(info, 'CFBundleName') ??
    bundleId.split('.').pop() ??
    'Uygulama';

  const version = readString(info, 'CFBundleShortVersionString') ?? '0.0.0';
  const buildNumber = readString(info, 'CFBundleVersion') ?? '0';
  const minOsVersion = readString(info, 'MinimumOSVersion');
  const platforms = readStringArray(info, 'CFBundleSupportedPlatforms');

  /* --- Simgeyi normal PNG'ye cevir (basarisiz olursa simgesiz devam) --- */
  let icon: Buffer | null = null;
  if (enIyiSimge) {
    const ham = icerikler.get(enIyiSimge);
    if (ham) icon = normalizePng(ham);
  }

  return { bundleId, appName, version, buildNumber, minOsVersion, platforms, appPath, icon };
}

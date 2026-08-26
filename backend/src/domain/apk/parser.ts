/**
 * Bir .apk dosyasindan dagitim icin gereken bilgileri cikarir.
 *
 * iOS'taki gibi iki gecis yapilir:
 *   1. Arsiv listelenir (AndroidManifest.xml var mi? hangi simge dosyalari mevcut?).
 *   2. Yalnizca AndroidManifest.xml + resources.arsc, ardindan secilen tek simge
 *      dosyasi bellege okunur.
 *
 * resources.arsc istege baglidir: yoksa, 64 MiB'i asiyorsa ya da bozuksa
 * yukleme yine basarilidir — ad paket adinin son parcasina duser, simge null
 * olur. Zorunlu olan yalnizca manifestteki `package` ozniteligidir.
 */
import { listZipEntries, readZipEntries } from '../package/zip.ts';
import type { PackageIcon } from '../package/types.ts';
import { isPng, normalizePng } from '../ipa/cgbi.ts';
import {
  ATTR,
  TYPE_DYNAMIC_REFERENCE,
  TYPE_INT_DEC,
  TYPE_INT_HEX,
  TYPE_REFERENCE,
  TYPE_STRING,
  findAttr,
  parseAxml,
  type AxmlAttr,
  type AxmlElement,
} from './axml.ts';
import { DENSITY, parseResourceTable, type ResFile, type ResourceTable } from './arsc.ts';
import { ApkParseError, type ApkMetadata } from './types.ts';

const MANIFEST_PATH = 'AndroidManifest.xml';
const ARSC_PATH = 'resources.arsc';
/** Buyuk uygulamalarin tablosu 8 MiB'lik varsayilan siniri asar; asani "tablo yok" sayariz. */
const ARSC_MAX_BYTES = 64 * 1024 * 1024;
/** Adaptive (.xml) ve vektor simgeler atlanir; yalnizca bitmap dosyalar. */
const ICON_FILE_RE = /\.(png|webp)$/i;

export async function parseApk(filePath: string): Promise<ApkMetadata> {
  const girdiler = await listZipEntries(filePath);

  /* --- Yapisal kapi: manifest var mi? --- */
  const listede = new Map<string, number>();
  for (const g of girdiler) listede.set(g.path, g.size);
  if (!listede.has(MANIFEST_PATH)) {
    throw new ApkParseError(
      'Bu bir Android uygulamasi (.apk) degil — arsiv icinde AndroidManifest.xml bulunamadi.',
    );
  }

  /* --- Manifest + kaynak tablosu --- */
  const icerikler = await readZipEntries(
    filePath,
    (p) => p === MANIFEST_PATH || p === ARSC_PATH,
    ARSC_MAX_BYTES,
  );

  const manifestBuf = icerikler.get(MANIFEST_PATH);
  if (!manifestBuf) throw new ApkParseError('AndroidManifest.xml okunamadi — APK bozuk olabilir.');

  const belge = parseAxml(manifestBuf);
  const arscBuf = icerikler.get(ARSC_PATH);
  const tablo = arscBuf ? tabloyuDene(arscBuf) : null;

  /* --- <manifest>: package, versionName, versionCode --- */
  const manifest = belge.elements.find((e) => e.depth === 0 && e.name === 'manifest') ?? belge.elements[0];
  const paket = manifest ? metin(findAttr(manifest, null, 'package'), tablo) : null;
  if (!manifest || !paket) {
    throw new ApkParseError('AndroidManifest.xml icinde package ozniteligi yok — gecerli bir uygulama degil.');
  }

  const version = metin(findAttr(manifest, ATTR.versionName, 'versionName'), tablo) || '0.0.0';
  const buildNumber = metin(findAttr(manifest, ATTR.versionCode, 'versionCode'), tablo) || '0';

  /* --- <uses-sdk>: minSdkVersion (sayi ya da kod adi) --- */
  const usesSdk = cocuk(belge.elements, 'uses-sdk');
  const minOsVersion = usesSdk ? metin(findAttr(usesSdk, ATTR.minSdkVersion, 'minSdkVersion'), tablo) || null : null;

  /* --- <application>: label, icon --- */
  const application = cocuk(belge.elements, 'application');
  const label = application ? metin(findAttr(application, ATTR.label, 'label'), tablo) : null;
  const appName = label || paket.split('.').pop() || 'Uygulama';

  let icon: PackageIcon | null = null;
  if (application && tablo) {
    const secilen =
      simgeSec(simgeAdaylari(findAttr(application, ATTR.icon, 'icon'), tablo), listede) ??
      simgeSec(simgeAdaylari(findAttr(application, ATTR.roundIcon, 'roundIcon'), tablo), listede);
    if (secilen) {
      const simgeler = await readZipEntries(filePath, (p) => p === secilen);
      const ham = simgeler.get(secilen);
      if (ham) icon = simgeCoz(ham);
    }
  }

  return {
    platform: 'android',
    bundleId: paket,
    appName,
    version,
    buildNumber,
    minOsVersion,
    platforms: ['Android'],
    icon,
  };
}

/* --- Yardimcilar --------------------------------------------------------- */

/** Bozuk tablo yuklemeyi durdurmaz: null = "tablo yok" (ad yedegi, simge yok). */
function tabloyuDene(buf: Buffer): ResourceTable | null {
  try {
    return parseResourceTable(buf);
  } catch {
    return null;
  }
}

/** `<manifest>`'in dogrudan cocugu (depth 1) olan ilk `name` elementi. */
function cocuk(elements: readonly AxmlElement[], name: string): AxmlElement | null {
  return elements.find((e) => e.depth === 1 && e.name === name) ?? null;
}

/**
 * Bir ozniteligin metin degeri: STRING havuzdan, REFERENCE tablodan (tablo yoksa
 * null), tam sayilar ondalik string. Diger tipler ve eksik oznitelik null.
 */
function metin(attr: AxmlAttr | null, tablo: ResourceTable | null): string | null {
  if (!attr) return null;
  switch (attr.type) {
    case TYPE_STRING:
      return attr.raw ?? '';
    case TYPE_REFERENCE:
    case TYPE_DYNAMIC_REFERENCE:
      return tablo ? tablo.resolveString(attr.data) : null;
    case TYPE_INT_DEC:
    case TYPE_INT_HEX:
      return String(attr.data);
    default:
      return null;
  }
}

/** Simge ozniteligi bir basvuruysa tablodaki tum dosya adaylari; degilse bos. */
function simgeAdaylari(attr: AxmlAttr | null, tablo: ResourceTable): ResFile[] {
  if (!attr || (attr.type !== TYPE_REFERENCE && attr.type !== TYPE_DYNAMIC_REFERENCE)) return [];
  return tablo.resolveFiles(attr.data);
}

/**
 * En yuksek yogunluklu bitmap adayi secer. Yalnizca .png/.webp VE arsivde
 * gercekten bulunan yollar (split APK'lar dis dosyaya basvurabilir); nodpi
 * (0xffff) yogunluk 0 gibi, anydpi (0xfffe) en sona. Esitlikte buyuk dosya.
 */
function simgeSec(adaylar: readonly ResFile[], listede: ReadonlyMap<string, number>): string | null {
  let enIyi: { path: string; sira: number; boyut: number } | null = null;
  for (const aday of adaylar) {
    if (!ICON_FILE_RE.test(aday.path)) continue;
    const boyut = listede.get(aday.path);
    if (boyut === undefined) continue;
    const sira = aday.density === DENSITY.NONE ? 0 : aday.density === DENSITY.ANY ? -1 : aday.density;
    if (!enIyi || sira > enIyi.sira || (sira === enIyi.sira && boyut > enIyi.boyut)) {
      enIyi = { path: aday.path, sira, boyut };
    }
  }
  return enIyi?.path ?? null;
}

/** PNG (CgBI dahil) normal PNG'ye cevrilir; WebP oldugu gibi saklanir; baska bicim simgesiz. */
function simgeCoz(ham: Buffer): PackageIcon | null {
  if (isPng(ham)) {
    const png = normalizePng(ham);
    return png ? { data: png, format: 'png' } : null;
  }
  if (webpMi(ham)) return { data: ham, format: 'webp' };
  return null;
}

/** RIFF konteyneri: bayt 0-3 "RIFF", 8-11 "WEBP". */
function webpMi(buf: Buffer): boolean {
  return buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
}

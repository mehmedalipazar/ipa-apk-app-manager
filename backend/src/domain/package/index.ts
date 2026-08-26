/**
 * Paket giris noktasi: dosya adindan platformu bul, dogru cozumleyiciye yonlendir.
 *
 * Uzanti yalnizca hangi cozumleyicinin denenecegini secer; asil format kapisi
 * cozumleyicinin yapisal kontrolleridir (Payload/*.app vs AndroidManifest.xml).
 */
import type { Platform, PackageMetadata } from './types.ts';
import { parseIpa } from '../ipa/parser.ts';
import { parseApk } from '../apk/parser.ts';

export function platformFromFilename(name: string): Platform | null {
  if (/\.ipa$/i.test(name)) return 'ios';
  if (/\.apk$/i.test(name)) return 'android';
  return null;
}

export async function parsePackage(filePath: string, platform: Platform): Promise<PackageMetadata> {
  return platform === 'ios' ? parseIpa(filePath) : parseApk(filePath);
}

export { listZipEntries, readZipEntries, type ZipEntryInfo, type EntrySelector } from './zip.ts';
export * from './types.ts';

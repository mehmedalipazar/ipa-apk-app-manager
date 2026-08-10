/**
 * plist okuma/yazma.
 *
 * IPA icindeki Info.plist genellikle ikili (binary, "bplist00") formattadir,
 * ama XML de olabilir. Ikisini de destekliyoruz.
 */
import bplist from 'bplist-parser';
import plist from 'plist';
import { IpaParseError } from './types.ts';

export type PlistValue = string | number | boolean | Date | Buffer | PlistValue[] | { [k: string]: PlistValue };
export type PlistDict = Record<string, unknown>;

const BPLIST_MAGIC = Buffer.from('bplist00', 'ascii');

export function isBinaryPlist(buf: Buffer): boolean {
  return buf.length >= 8 && buf.subarray(0, 8).equals(BPLIST_MAGIC);
}

/** Ikili ya da XML plist'i sozluk olarak cozer. */
export function parsePlist(buf: Buffer): PlistDict {
  if (buf.length === 0) throw new IpaParseError('plist bos.');

  try {
    if (isBinaryPlist(buf)) {
      const sonuc = bplist.parseBuffer(buf);
      const ilk = Array.isArray(sonuc) ? sonuc[0] : sonuc;
      if (!ilk || typeof ilk !== 'object') throw new Error('kok sozluk degil');
      return ilk as PlistDict;
    }

    const sonuc = plist.parse(buf.toString('utf8'));
    if (!sonuc || typeof sonuc !== 'object' || Array.isArray(sonuc)) {
      throw new Error('kok sozluk degil');
    }
    return sonuc as PlistDict;
  } catch (e) {
    throw new IpaParseError('Info.plist cozumlenemedi — dosya bozuk olabilir.', e);
  }
}

/**
 * XML plist uretir. Kacis (escaping) islerini kutuphane halleder.
 *
 * `plist` paketinin PlistValue tipi ic ice dizi/nesne yapilarini yapisal
 * olarak dogrulayamadigi icin girdi burada donusturuluyor; uretilen cikti
 * yine de gecerli plist olur.
 */
export function buildPlist(value: Record<string, unknown>): string {
  return plist.build(value as plist.PlistValue);
}

/* --- Sozlukten guvenli okuma yardimcilari --------------------------------- */

export function readString(dict: PlistDict, key: string): string | null {
  const v = dict[key];
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return null;
}

export function readStringArray(dict: PlistDict, key: string): string[] {
  const v = dict[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

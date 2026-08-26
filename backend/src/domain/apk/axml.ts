/**
 * Ikili (binary) AndroidManifest.xml okuyucu.
 *
 * aapt2 manifesti derlerken duz XML'i Android'in "ResXMLTree" bicimine cevirir:
 * dosya, LE (little-endian) u16/u32 alanlardan olusan chunk'lara bolunur, tum
 * metinler tek bir string havuzunda toplanir ve android: ozniteliklerinin
 * cogu adla degil kaynak id'siyle taninir (0x0101021b = versionCode gibi).
 * Kaynak kucultucu (R8 / aapt2 --collapse-resource-names) ad stringlerini
 * silebildiginden findAttr() once id'ye, sonra ada bakar.
 *
 * Burasi yalnizca gerekeni okur: element listesi (ad + derinlik, belge
 * sirasinda) ve her elementin oznitelikleri. Ad alani (namespace) chunk'lari,
 * CDATA ve stiller atlanir.
 *
 * Tum sayilar IMZASIZ okunur — versionCode ya da bir kaynak id'si 2^31'i
 * asabilir. Yapisal bozukluk (tasan chunk, kisa baslik) ApkParseError olur;
 * Buffer'in kendi RangeError'lari da ayni hataya cevrilir.
 *
 * String havuzu ve chunk basligi resources.arsc ile ortak oldugundan
 * (StringPool, readStringPool, readChunkHeader) buradan disa acilir; arsc.ts
 * bunlari yeniden kullanir.
 *
 * Referans: frameworks/base/libs/androidfw/include/androidfw/ResourceTypes.h
 */
import { ApkParseError } from './types.ts';

/* --- Sabitler ------------------------------------------------------------ */

/** Chunk tipleri (ResChunk_header.type). */
export const CHUNK = {
  STRING_POOL: 0x0001,
  TABLE: 0x0002,
  XML: 0x0003,
  XML_START_NAMESPACE: 0x0100,
  XML_END_NAMESPACE: 0x0101,
  XML_START_ELEMENT: 0x0102,
  XML_END_ELEMENT: 0x0103,
  XML_CDATA: 0x0104,
  XML_RESOURCE_MAP: 0x0180,
  TABLE_PACKAGE: 0x0200,
  TABLE_TYPE: 0x0201,
  TABLE_TYPE_SPEC: 0x0202,
  TABLE_LIBRARY: 0x0203,
  TABLE_OVERLAYABLE: 0x0204,
  TABLE_OVERLAYABLE_POLICY: 0x0205,
  TABLE_STAGED_ALIAS: 0x0206,
} as const;

/** Res_value.dataType degerleri. */
export const TYPE_NULL = 0x00;
export const TYPE_REFERENCE = 0x01;
export const TYPE_ATTRIBUTE = 0x02;
export const TYPE_STRING = 0x03;
export const TYPE_DYNAMIC_REFERENCE = 0x07;
export const TYPE_INT_DEC = 0x10;
export const TYPE_INT_HEX = 0x11;
export const TYPE_INT_BOOLEAN = 0x12;

/** Manifestte ihtiyac duyulan android: ozniteliklerinin kaynak id'leri (android.R.attr). */
export const ATTR = {
  label: 0x01010001,
  icon: 0x01010002,
  name: 0x01010003,
  minSdkVersion: 0x0101020c,
  versionCode: 0x0101021b,
  versionName: 0x0101021c,
  targetSdkVersion: 0x01010270,
  roundIcon: 0x0101052c,
} as const;

export const ANDROID_NS = 'http://schemas.android.com/apk/res/android';

/** String havuzuna "basvuru yok" degeri (ResStringPool_ref.index = -1). */
const NO_REF = 0xffffffff;
const UTF8_FLAG = 0x100;

const BOZUK_MESAJ = 'AndroidManifest.xml cozumlenemedi — dosya bozuk olabilir.';

/* --- Ortak yapilar: chunk basligi ve string havuzu ----------------------- */

export interface ChunkHeader {
  readonly type: number;
  readonly headerSize: number;
  readonly size: number;
}

/**
 * `off` konumundaki chunk basligini okur ve dogrular; `end` chunk'in icinde
 * kalmasi gereken ust sinirdir. Tutarsiz baslikta null doner — hata mesajini
 * cagiran taraf (manifest / arsc) kendi baglamina gore secer.
 */
export function readChunkHeader(buf: Buffer, off: number, end: number): ChunkHeader | null {
  if (off < 0 || off + 8 > end || end > buf.length) return null;
  const type = buf.readUInt16LE(off);
  const headerSize = buf.readUInt16LE(off + 2);
  const size = buf.readUInt32LE(off + 4);
  if (size < 8 || headerSize < 8 || headerSize > size || off + size > end) return null;
  return { type, headerSize, size };
}

/**
 * ResStringPool: tembel ve onbellekli. Sinir disi indeks ya da kesik veri
 * bos string verir — havuz okumasi hicbir zaman firlatmaz.
 */
export class StringPool {
  private readonly buf: Buffer;
  private readonly count: number;
  private readonly utf8: boolean;
  private readonly offsetsAt: number;
  private readonly stringsAt: number;
  private readonly end: number;
  private readonly onbellek = new Map<number, string>();

  constructor(buf: Buffer, count: number, utf8: boolean, offsetsAt: number, stringsAt: number, end: number) {
    this.buf = buf;
    this.count = count;
    this.utf8 = utf8;
    this.offsetsAt = offsetsAt;
    this.stringsAt = stringsAt;
    this.end = end;
  }

  get length(): number {
    return this.count;
  }

  get(i: number): string {
    if (!Number.isInteger(i) || i < 0 || i >= this.count) return '';
    const hazir = this.onbellek.get(i);
    if (hazir !== undefined) return hazir;
    const deger = this.oku(i);
    this.onbellek.set(i, deger);
    return deger;
  }

  private oku(i: number): string {
    const buf = this.buf;
    const end = this.end;
    const offsetAt = this.offsetsAt + i * 4;
    if (offsetAt + 4 > end) return '';
    let p = this.stringsAt + buf.readUInt32LE(offsetAt);

    if (this.utf8) {
      // u8 karakter sayisi (kullanilmaz) + u8 bayt sayisi; ust bit set ise iki bayt.
      const uzunlukOku = (): number | null => {
        if (p >= end) return null;
        let n = buf.readUInt8(p);
        p += 1;
        if (n & 0x80) {
          if (p >= end) return null;
          n = ((n & 0x7f) << 8) | buf.readUInt8(p);
          p += 1;
        }
        return n;
      };
      if (uzunlukOku() === null) return '';
      const baytSayisi = uzunlukOku();
      if (baytSayisi === null) return '';
      return buf.toString('utf8', p, Math.min(p + baytSayisi, end));
    }

    // UTF-16: u16 kod birimi sayisi; ust bit set ise 32-bit'e genisler.
    if (p + 2 > end) return '';
    let n = buf.readUInt16LE(p);
    p += 2;
    if (n & 0x8000) {
      if (p + 2 > end) return '';
      n = ((n & 0x7fff) << 16) | buf.readUInt16LE(p);
      p += 2;
    }
    return buf.toString('utf16le', p, Math.min(p + n * 2, end));
  }
}

/**
 * `off` konumundaki STRING_POOL chunk'ini acar. Baslik tutarsizsa null.
 *   u32 stringCount @8, styleCount @12, flags @16 (UTF8 = 0x100),
 *   stringsStart @20, stylesStart @24; offset dizisi `off + headerSize`.
 */
export function readStringPool(buf: Buffer, off: number, end: number): StringPool | null {
  const c = readChunkHeader(buf, off, end);
  if (!c || c.type !== CHUNK.STRING_POOL || c.headerSize < 28) return null;
  const count = buf.readUInt32LE(off + 8);
  const flags = buf.readUInt32LE(off + 16);
  const stringsStart = buf.readUInt32LE(off + 20);
  if (c.headerSize + count * 4 > c.size || stringsStart > c.size) return null;
  return new StringPool(buf, count, (flags & UTF8_FLAG) !== 0, off + c.headerSize, off + stringsStart, off + c.size);
}

/* --- AXML belgesi -------------------------------------------------------- */

export interface AxmlAttr {
  /** Ad alani URI'si; ad alansiz oznitelikte (orn. `package`) bos string. */
  readonly ns: string;
  readonly name: string;
  /** Kaynak haritasindan gelen android.R.attr id'si; yoksa null. */
  readonly resId: number | null;
  /** Res_value.dataType (TYPE_* sabitleri). */
  readonly type: number;
  /** Res_value.data — imzasiz u32; TYPE_STRING icin havuz indeksi. */
  readonly data: number;
  /**
   * Metin degeri: TYPE_STRING icin havuzdaki string; diger tiplerde varsa
   * rawValue stringi (aapt2 bunu yalnizca stringler icin yazar), yoksa null.
   */
  readonly raw: string | null;
}

export interface AxmlElement {
  readonly name: string;
  /** Kok element 0; `<manifest>` altindakiler 1. */
  readonly depth: number;
  readonly attrs: readonly AxmlAttr[];
}

export interface AxmlDocument {
  /** Belge sirasinda tum baslangic elementleri. */
  readonly elements: readonly AxmlElement[];
}

export function parseAxml(buf: Buffer): AxmlDocument {
  if (buf.length < 8 || buf.readUInt16LE(0) !== CHUNK.XML) {
    throw new ApkParseError('AndroidManifest.xml ikili (binary XML) bicimde degil — APK bozuk olabilir.');
  }
  try {
    return belgeyiOku(buf);
  } catch (e) {
    if (e instanceof ApkParseError) throw e;
    throw new ApkParseError(BOZUK_MESAJ, e);
  }
}

/**
 * Onceligi: kaynak id'si (kucultucu adlari silmis olabilir), sonra android:
 * ad alaninda ad, en son ad alansiz ("ciplak") ad — `package` boyle bulunur.
 */
export function findAttr(el: AxmlElement, resId: number | null, name: string): AxmlAttr | null {
  if (resId !== null) {
    const idIle = el.attrs.find((a) => a.resId === resId);
    if (idIle) return idIle;
  }
  return (
    el.attrs.find((a) => a.ns === ANDROID_NS && a.name === name) ??
    el.attrs.find((a) => a.ns === '' && a.name === name) ??
    null
  );
}

function bozuk(): ApkParseError {
  return new ApkParseError(BOZUK_MESAJ);
}

function belgeyiOku(buf: Buffer): AxmlDocument {
  const kok = readChunkHeader(buf, 0, buf.length);
  if (!kok) throw bozuk();
  const end = kok.size;

  const elements: AxmlElement[] = [];
  let havuz: StringPool | null = null;
  let resIds: number[] = [];
  let depth = 0;

  let off = kok.headerSize;
  while (off + 8 <= end) {
    const c = readChunkHeader(buf, off, end);
    if (!c) throw bozuk();

    switch (c.type) {
      case CHUNK.STRING_POOL: {
        if (!havuz) {
          havuz = readStringPool(buf, off, end);
          if (!havuz) throw bozuk();
        }
        break;
      }
      case CHUNK.XML_RESOURCE_MAP: {
        // Oznitelik adi indeksi i < resIds.length ise adin kaynak id'si resIds[i].
        const adet = (c.size - c.headerSize) >>> 2;
        resIds = [];
        for (let i = 0; i < adet; i++) resIds.push(buf.readUInt32LE(off + c.headerSize + i * 4));
        break;
      }
      case CHUNK.XML_START_ELEMENT: {
        if (!havuz) throw bozuk();
        elements.push(elementOku(buf, off, c, havuz, resIds, depth));
        depth++;
        break;
      }
      case CHUNK.XML_END_ELEMENT: {
        depth = Math.max(0, depth - 1);
        break;
      }
      default:
        break; // ad alani, CDATA, bilinmeyen: atla
    }
    off += c.size;
  }

  return { elements };
}

/**
 * ResXMLTree_node basligi 16 bayt; ardindan ResXMLTree_attrExt:
 *   u32 ns @0, u32 name @4, u16 attributeStart @8, u16 attributeSize @10,
 *   u16 attributeCount @12. Oznitelik j = attrExt + attributeStart + j*attributeSize:
 *   u32 ns, u32 name, u32 rawValue, u16 size, u8 res0, u8 dataType @15, u32 data @16.
 */
function elementOku(
  buf: Buffer,
  off: number,
  c: ChunkHeader,
  havuz: StringPool,
  resIds: readonly number[],
  depth: number,
): AxmlElement {
  const chunkEnd = off + c.size;
  const ext = off + c.headerSize;
  if (ext + 20 > chunkEnd) throw bozuk();

  const adIdx = buf.readUInt32LE(ext + 4);
  const attributeStart = buf.readUInt16LE(ext + 8);
  const attributeSize = buf.readUInt16LE(ext + 10);
  const attributeCount = buf.readUInt16LE(ext + 12);
  if (attributeCount > 0 && attributeSize < 20) throw bozuk();

  const strRef = (i: number): string => (i === NO_REF ? '' : havuz.get(i));

  const attrs: AxmlAttr[] = [];
  for (let j = 0; j < attributeCount; j++) {
    const a = ext + attributeStart + j * attributeSize;
    if (a + 20 > chunkEnd) throw bozuk();

    const nsIdx = buf.readUInt32LE(a);
    const nameIdx = buf.readUInt32LE(a + 4);
    const rawIdx = buf.readUInt32LE(a + 8);
    const type = buf.readUInt8(a + 15);
    const data = buf.readUInt32LE(a + 16);

    const resId = nameIdx < resIds.length ? (resIds[nameIdx] ?? 0) : 0;
    const raw = type === TYPE_STRING ? havuz.get(data) : rawIdx === NO_REF ? null : havuz.get(rawIdx);

    attrs.push({
      ns: strRef(nsIdx),
      name: strRef(nameIdx),
      resId: resId === 0 ? null : resId,
      type,
      data,
      raw,
    });
  }

  return { name: strRef(adIdx), depth, attrs };
}

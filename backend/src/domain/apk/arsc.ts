/**
 * resources.arsc cozumleyici.
 *
 * Manifest `android:label="@string/app_name"` ya da `android:icon="@mipmap/ic_launcher"`
 * gibi degerleri ada degil kaynak id'sine (0x7f0e0001) cevrilmis olarak tasir;
 * id'nin arkasindaki string ya da dosya yolu bu tabloda durur. Tablo, chunk
 * agaci olarak yazilir:
 *
 *   TABLE (0x0002)
 *     STRING_POOL          — tum deger stringleri (dosya yollari dahil)
 *     PACKAGE (0x0200)     — id (0x7f), ad, tip/anahtar havuzlari
 *       TYPE_SPEC (0x0202) — atlanir
 *       TYPE (0x0201)      — bir tipin BIR yapilandirmadaki (values, values-tr,
 *                            mipmap-xxhdpi ...) girdileri: offset dizisi + girdiler
 *
 * Ayni kaynak id'si birden fazla TYPE chunk'inda (her yapilandirma icin bir kez)
 * gecebilir; hepsi Map<resId, ResEntry[]> icinde toplanir ve cozumleme sirasinda
 * varsayilan yapilandirma (dil yok, gece modu yok, yogunluk 0) tercih edilir —
 * `values-tr/strings.xml` uygulama adini ele geciremez.
 *
 * Desteklenen: u32 / OFFSET16 / SPARSE offset dizileri, tam ve COMPACT girdiler,
 * UTF-8 / UTF-16 havuzlar, coklu paket ve yapilandirma. Atlanan: COMPLEX (bag)
 * girdileri, kutuphane / overlayable / staged-alias chunk'lari, stiller.
 * Cozumleme hicbir zaman firlatmaz (null'a duser); ApkParseError yalnizca
 * yapisal tutarsizlikta — parseApk bunu yakalar ve "tablo yok" sayar.
 *
 * Referans: frameworks/base/libs/androidfw/include/androidfw/ResourceTypes.h
 */
import {
  CHUNK,
  StringPool,
  TYPE_DYNAMIC_REFERENCE,
  TYPE_REFERENCE,
  TYPE_STRING,
  readChunkHeader,
  readStringPool,
  type ChunkHeader,
} from './axml.ts';
import { ApkParseError } from './types.ts';

/* --- Sabitler ------------------------------------------------------------ */

/** ResTable_config.density degerleri. */
export const DENSITY = {
  DEFAULT: 0,
  LOW: 120,
  MEDIUM: 160,
  TV: 213,
  HIGH: 240,
  XHIGH: 320,
  XXHIGH: 480,
  XXXHIGH: 640,
  ANY: 0xfffe,
  NONE: 0xffff,
} as const;

/** Android cerceve paketi — degerleri bu tabloda yoktur. */
const FRAMEWORK_PACKAGE_ID = 0x01;

/** ResTable_type.flags */
const TYPE_FLAG_SPARSE = 0x01;
const TYPE_FLAG_OFFSET16 = 0x02;

/** ResTable_entry.flags */
const ENTRY_FLAG_COMPLEX = 0x0001;
const ENTRY_FLAG_COMPACT = 0x0008;

const NO_ENTRY_32 = 0xffffffff;
const NO_ENTRY_16 = 0xffff;

/** ResTable_config.uiMode */
const UI_MODE_NIGHT_MASK = 0x30;
const UI_MODE_NIGHT_YES = 0x20;

/** Basvuru zinciri (@string/a -> @string/b -> ...) icin en fazla derinlik. */
const MAX_DEPTH = 8;

const BOZUK_MESAJ = 'resources.arsc cozumlenemedi — dosya bozuk olabilir.';

/* --- Tipler -------------------------------------------------------------- */

export interface ResConfig {
  /** ISO dil kodu; '' = varsayilan (yerellestirilmemis) yapilandirma. */
  readonly language: string;
  readonly density: number;
  readonly sdkVersion: number;
  readonly night: boolean;
}

export interface ResEntry {
  /** Res_value.dataType */
  readonly type: number;
  /** Res_value.data — imzasiz u32 */
  readonly data: number;
  readonly cfg: ResConfig;
}

export interface ResFile {
  /** Arsiv icindeki yol, orn. `res/mipmap-xxhdpi-v4/ic_launcher.png` */
  readonly path: string;
  readonly density: number;
  readonly sdkVersion: number;
}

/* --- Tablo --------------------------------------------------------------- */

export class ResourceTable {
  private readonly pool: StringPool;
  private readonly entries: ReadonlyMap<number, readonly ResEntry[]>;
  private readonly packageIds: ReadonlySet<number>;

  constructor(pool: StringPool, entries: ReadonlyMap<number, readonly ResEntry[]>, packageIds: ReadonlySet<number>) {
    this.pool = pool;
    this.entries = entries;
    this.packageIds = packageIds;
  }

  /** Tablodaki (yapilandirma bazinda) girdi sayisi — tani/test amacli. */
  get entryCount(): number {
    let toplam = 0;
    for (const liste of this.entries.values()) toplam += liste.length;
    return toplam;
  }

  /**
   * Bir kaynak id'sinin string degeri. Basvurular (TYPE_REFERENCE /
   * TYPE_DYNAMIC_REFERENCE) en fazla 8 adim izlenir; varsayilan yapilandirma
   * tercih edilir. Cerceve paketine (0x01) ya da bilinmeyen pakete basvuru,
   * TYPE_ATTRIBUTE ve string olmayan degerler null verir.
   */
  resolveString(resId: number): string | null {
    return this.stringCoz(resId >>> 0, 0);
  }

  /**
   * Bir kaynak id'sinden basvurular uzerinden ulasilan TUM dosya yollari
   * (her yapilandirma icin bir tane): simge secimi yogunluga gore burada
   * degil, cagiran tarafta yapilir.
   */
  resolveFiles(resId: number): ResFile[] {
    const sonuc: ResFile[] = [];
    const gezilen = new Set<number>();

    const gez = (id: number, depth: number): void => {
      if (depth > MAX_DEPTH || gezilen.has(id)) return;
      gezilen.add(id);
      const adaylar = this.girdiler(id);
      if (!adaylar) return;
      for (const g of adaylar) {
        if (g.type === TYPE_STRING) {
          sonuc.push({ path: this.pool.get(g.data), density: g.cfg.density, sdkVersion: g.cfg.sdkVersion });
        } else if (g.type === TYPE_REFERENCE || g.type === TYPE_DYNAMIC_REFERENCE) {
          gez(g.data >>> 0, depth + 1);
        }
      }
    };

    gez(resId >>> 0, 0);
    return sonuc;
  }

  private stringCoz(resId: number, depth: number): string | null {
    if (depth > MAX_DEPTH) return null;
    const adaylar = this.girdiler(resId);
    if (!adaylar) return null;
    const secilen = enUygun(adaylar);
    switch (secilen.type) {
      case TYPE_STRING:
        return this.pool.get(secilen.data);
      case TYPE_REFERENCE:
      case TYPE_DYNAMIC_REFERENCE:
        return this.stringCoz(secilen.data >>> 0, depth + 1);
      default:
        return null;
    }
  }

  private girdiler(resId: number): readonly ResEntry[] | null {
    const paket = resId >>> 24;
    if (paket === FRAMEWORK_PACKAGE_ID || !this.packageIds.has(paket)) return null;
    return this.entries.get(resId) ?? null;
  }
}

/**
 * Varsayilan yapilandirmaya en yakin girdi: dil > gece modu > yogunluk
 * agirligiyla puanlanir, en dusuk puan kazanir; esitlikte belge sirasi.
 */
function enUygun(adaylar: readonly ResEntry[]): ResEntry {
  const puan = (cfg: ResConfig): number =>
    (cfg.language !== '' ? 100 : 0) + (cfg.night ? 10 : 0) + (cfg.density !== 0 ? 1 : 0);

  let enIyi = adaylar[0]!;
  let enIyiPuan = puan(enIyi.cfg);
  for (let i = 1; i < adaylar.length; i++) {
    const aday = adaylar[i]!;
    const p = puan(aday.cfg);
    if (p < enIyiPuan) {
      enIyi = aday;
      enIyiPuan = p;
    }
  }
  return enIyi;
}

/* --- Okuma --------------------------------------------------------------- */

export function parseResourceTable(buf: Buffer): ResourceTable {
  try {
    return tabloyuOku(buf);
  } catch (e) {
    if (e instanceof ApkParseError) throw e;
    throw new ApkParseError(BOZUK_MESAJ, e);
  }
}

function bozuk(): ApkParseError {
  return new ApkParseError(BOZUK_MESAJ);
}

function tabloyuOku(buf: Buffer): ResourceTable {
  const kok = readChunkHeader(buf, 0, buf.length);
  if (!kok || kok.type !== CHUNK.TABLE) throw bozuk();
  const end = kok.size;

  let havuz: StringPool | null = null;
  const entries = new Map<number, ResEntry[]>();
  const packageIds = new Set<number>();

  let off = kok.headerSize;
  while (off + 8 <= end) {
    const c = readChunkHeader(buf, off, end);
    if (!c) throw bozuk();

    if (c.type === CHUNK.STRING_POOL) {
      if (!havuz) {
        havuz = readStringPool(buf, off, end);
        if (!havuz) throw bozuk();
      }
    } else if (c.type === CHUNK.TABLE_PACKAGE) {
      paketOku(buf, off, c, entries, packageIds);
    }
    // diger tipler (bilinmeyen dahil): boyutuyla atla
    off += c.size;
  }

  if (!havuz) throw bozuk(); // deger havuzu olmadan hicbir string/yol cozulemez
  return new ResourceTable(havuz, entries, packageIds);
}

/**
 * ResTable_package: u32 id @8 (0 = paylasimli kutuphane, atla), char16 name[128] @12,
 * typeStrings @268, keyStrings @276 — ad ve havuzlar okunmaz, cozum sayisal id ile.
 * Cocuklar `pkg + headerSize` ... `pkg + size` arasinda.
 */
function paketOku(
  buf: Buffer,
  off: number,
  c: ChunkHeader,
  entries: Map<number, ResEntry[]>,
  packageIds: Set<number>,
): void {
  if (c.headerSize < 12) throw bozuk();
  const paketId = buf.readUInt32LE(off + 8) & 0xff;
  if (paketId === 0) return;
  packageIds.add(paketId);

  const paketEnd = off + c.size;
  let p = off + c.headerSize;
  while (p + 8 <= paketEnd) {
    const cc = readChunkHeader(buf, p, paketEnd);
    if (!cc) throw bozuk();
    if (cc.type === CHUNK.TABLE_TYPE) tipOku(buf, p, cc, paketId, entries);
    // STRING_POOL (tip/anahtar adlari), TYPE_SPEC, LIBRARY, OVERLAYABLE(_POLICY),
    // STAGED_ALIAS ve bilinmeyenler: boyutuyla atla
    p += cc.size;
  }
}

/**
 * ResTable_type: u8 id @8 (1 tabanli tip), u8 flags @9, u32 entryCount @12,
 * u32 entriesStart @16, ResTable_config @20. Offset dizisi `chunk + headerSize`'dan
 * baslar (20 + config.size varsayilmaz):
 *   varsayilan  u32[entryCount]            (0xffffffff = girdi yok)
 *   OFFSET16    u16[entryCount] x4         (0xffff = girdi yok)
 *   SPARSE      { u16 idx; u16 offset x4 }[entryCount]
 * Girdi `chunk + entriesStart + offset`.
 */
function tipOku(buf: Buffer, off: number, c: ChunkHeader, paketId: number, entries: Map<number, ResEntry[]>): void {
  if (c.headerSize < 24) throw bozuk(); // config.size alanina kadar
  const chunkEnd = off + c.size;

  const tipId = buf.readUInt8(off + 8);
  const bayraklar = buf.readUInt8(off + 9);
  const entryCount = buf.readUInt32LE(off + 12);
  const entriesStart = buf.readUInt32LE(off + 16);
  const cfgSize = buf.readUInt32LE(off + 20);
  if (20 + cfgSize > c.size || entriesStart > c.size) throw bozuk();

  const cfg = configOku(buf, off + 20, cfgSize);

  const sparse = (bayraklar & TYPE_FLAG_SPARSE) !== 0;
  const offset16 = !sparse && (bayraklar & TYPE_FLAG_OFFSET16) !== 0;
  const slot = offset16 ? 2 : 4;
  const offsetsAt = off + c.headerSize;
  if (offsetsAt + entryCount * slot > chunkEnd) throw bozuk();
  const entriesAt = off + entriesStart;

  for (let i = 0; i < entryCount; i++) {
    let idx: number;
    let goreli: number;
    if (sparse) {
      idx = buf.readUInt16LE(offsetsAt + i * 4);
      goreli = buf.readUInt16LE(offsetsAt + i * 4 + 2) * 4;
    } else if (offset16) {
      const v = buf.readUInt16LE(offsetsAt + i * 2);
      if (v === NO_ENTRY_16) continue;
      idx = i;
      goreli = v * 4;
    } else {
      const v = buf.readUInt32LE(offsetsAt + i * 4);
      if (v === NO_ENTRY_32) continue;
      idx = i;
      goreli = v;
    }

    const girdi = girdiOku(buf, entriesAt + goreli, chunkEnd, cfg);
    if (!girdi) continue;

    const resId = ((paketId << 24) | (tipId << 16) | idx) >>> 0;
    const liste = entries.get(resId);
    if (liste) liste.push(girdi);
    else entries.set(resId, [girdi]);
  }
}

/**
 * ResTable_entry: u16 flags @2 her iki duzende ayni yerde.
 *   COMPLEX  -> bag (stil/dizi/plural): atla
 *   COMPACT  -> u16 key @0, dataType = (flags >> 8) & 0xff, u32 data @4
 *   aksi     -> u16 size @0, u32 key @4; Res_value `e + size`: u8 dataType @+3, u32 data @+4
 * Sinir disi girdi yapisal hata sayilmaz, atlanir.
 */
function girdiOku(buf: Buffer, e: number, chunkEnd: number, cfg: ResConfig): ResEntry | null {
  if (e + 8 > chunkEnd) return null;
  const bayraklar = buf.readUInt16LE(e + 2);
  if (bayraklar & ENTRY_FLAG_COMPLEX) return null;

  if (bayraklar & ENTRY_FLAG_COMPACT) {
    return { type: (bayraklar >> 8) & 0xff, data: buf.readUInt32LE(e + 4), cfg };
  }

  const v = e + buf.readUInt16LE(e);
  if (v + 8 > chunkEnd) return null;
  return { type: buf.readUInt8(v + 3), data: buf.readUInt32LE(v + 4), cfg };
}

/**
 * ResTable_config (chunk'a gore @20): u32 size @0, language[2] @8, country[2] @10,
 * u16 density @14, u16 sdkVersion @24, u8 uiMode @29. Eski araclar daha kisa
 * config yazar; bir alan yalnizca `size` onu kapsiyorsa okunur, yoksa 0.
 */
function configOku(buf: Buffer, at: number, size: number): ResConfig {
  const u8 = (rel: number): number => (rel + 1 <= size ? buf.readUInt8(at + rel) : 0);
  const u16 = (rel: number): number => (rel + 2 <= size ? buf.readUInt16LE(at + rel) : 0);

  return {
    language: dilCoz(u8(8), u8(9)),
    density: u16(14),
    sdkVersion: u16(24),
    night: (u8(29) & UI_MODE_NIGHT_MASK) === UI_MODE_NIGHT_YES,
  };
}

/**
 * Iki baytlik dil alani: 0/0 = yok; ust bit set ise 3 harfli ISO-639-2 kodu
 * 5'er bitle paketlenmistir (Android `unpackLanguageOrRegion`), aksi halde iki ASCII harf.
 */
function dilCoz(b0: number, b1: number): string {
  if (b0 === 0 && b1 === 0) return '';
  if (b0 & 0x80) {
    const ilk = b1 & 0x1f;
    const ikinci = ((b1 & 0xe0) >> 5) + ((b0 & 0x03) << 3);
    const ucuncu = (b0 & 0x7c) >> 2;
    return String.fromCharCode(0x61 + ilk, 0x61 + ikinci, 0x61 + ucuncu);
  }
  return String.fromCharCode(b0, b1);
}

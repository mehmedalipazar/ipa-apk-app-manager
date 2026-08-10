/**
 * CgBI -> standart PNG donusturucu.
 *
 * Xcode, uygulama simgelerini derleme sirasinda Apple'a ozgu "CgBI" bicimine
 * cevirir. Bu dosyalar .png uzantili olmalarina ragmen standart PNG DEGILDIR;
 * tarayicilar ve normal goruntu kutuphaneleri acamaz. Uc farki vardir:
 *
 *   1. IHDR'den once fazladan bir `CgBI` yigini (chunk) bulunur.
 *   2. IDAT verisi ham deflate'tir — zlib basligi/checksum yoktur.
 *   3. Pikseller RGBA yerine BGRA sirasindadir ve alfa ile onceden
 *      carpilmistir (premultiplied).
 *
 * Burasi bu uc adimi geri alir. Cevrilemeyen bir bicimle karsilasilirsa
 * (orn. interlace'li ya da 16-bit) null doner; cagiran taraf simgesiz devam
 * eder — simge kozmetiktir, kurulumu etkilemez.
 *
 * Referans: PNG spec (RFC 2083) + CgBI bicim analizi (pngdefry, "iphone PNG").
 */
import { deflateSync, inflateRawSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/* --- CRC32 (PNG yiginlari icin) ------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/* --- Yigin (chunk) okuma/yazma ------------------------------------------- */

interface Chunk {
  readonly type: string;
  readonly data: Buffer;
}

function readChunks(buf: Buffer): Chunk[] {
  const chunks: Chunk[] = [];
  let offset = PNG_SIGNATURE.length;

  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buf.length) break; // Kesik dosya
    chunks.push({ type, data: buf.subarray(dataStart, dataEnd) });
    offset = dataEnd + 4; // + CRC
    if (type === 'IEND') break;
  }
  return chunks;
}

function writeChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.allocUnsafe(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, 'ascii');
  data.copy(out, 8);
  const crcInput = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  out.writeUInt32BE(crc32(crcInput), 8 + data.length);
  return out;
}

/* --- PNG satir filtrelerini geri alma ------------------------------------ */

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Filtrelenmis ham veriyi cozup filtresiz piksel dizisi dondurur.
 * @param bpp Piksel basina bayt (RGBA icin 4)
 */
function unfilter(raw: Buffer, width: number, height: number, bpp: number): Buffer {
  const rowBytes = width * bpp;
  const out = Buffer.allocUnsafe(rowBytes * height);

  let rawPos = 0;
  let outPos = 0;

  for (let y = 0; y < height; y++) {
    if (rawPos >= raw.length) throw new Error('PNG verisi eksik');
    const filterType = raw[rawPos++]!;
    const prevRow = outPos - rowBytes;

    for (let x = 0; x < rowBytes; x++) {
      const filt = raw[rawPos + x] ?? 0;
      const a = x >= bpp ? out[outPos + x - bpp]! : 0;
      const b = y > 0 ? out[prevRow + x]! : 0;
      const c = y > 0 && x >= bpp ? out[prevRow + x - bpp]! : 0;

      let value: number;
      switch (filterType) {
        case 0: value = filt; break;
        case 1: value = filt + a; break;
        case 2: value = filt + b; break;
        case 3: value = filt + ((a + b) >> 1); break;
        case 4: value = filt + paeth(a, b, c); break;
        default: throw new Error(`Bilinmeyen PNG filtresi: ${filterType}`);
      }
      out[outPos + x] = value & 0xff;
    }

    rawPos += rowBytes;
    outPos += rowBytes;
  }

  return out;
}

/** Her satirin basina filtre baytini (0 = None) ekler. */
function addNoneFilter(pixels: Buffer, width: number, height: number, bpp: number): Buffer {
  const rowBytes = width * bpp;
  const out = Buffer.allocUnsafe((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    out[y * (rowBytes + 1)] = 0;
    pixels.copy(out, y * (rowBytes + 1) + 1, y * rowBytes, (y + 1) * rowBytes);
  }
  return out;
}

/* --- Ana islev ------------------------------------------------------------ */

export function isPng(buf: Buffer): boolean {
  return buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE);
}

/**
 * Verilen PNG'yi tarayicida gosterilebilir standart PNG'ye cevirir.
 *
 * - Zaten standart PNG ise girdiyi oldugu gibi dondurur.
 * - CgBI ise donusturur.
 * - Desteklenmeyen bir varyant ise null doner.
 */
export function normalizePng(buf: Buffer): Buffer | null {
  if (!isPng(buf)) return null;

  let chunks: Chunk[];
  try {
    chunks = readChunks(buf);
  } catch {
    return null;
  }

  const cgbi = chunks.find((c) => c.type === 'CgBI');
  if (!cgbi) return buf; // Standart PNG — dokunma.

  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr || ihdr.data.length < 13) return null;

  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8]!;
  const colorType = ihdr.data[9]!;
  const interlace = ihdr.data[12]!;

  // Uygulama simgeleri her zaman 8-bit RGBA ve interlace'sizdir.
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) return null;
  if (width === 0 || height === 0 || width > 4096 || height > 4096) return null;

  const idatData = chunks.filter((c) => c.type === 'IDAT').map((c) => c.data);
  if (idatData.length === 0) return null;

  try {
    // (2) Ham deflate — zlib basligi yok.
    const inflated = inflateRawSync(Buffer.concat(idatData));
    const pixels = unfilter(inflated, width, height, 4);

    // (3) BGRA -> RGBA ve alfa carpimini geri al.
    for (let i = 0; i < pixels.length; i += 4) {
      const b = pixels[i]!;
      const g = pixels[i + 1]!;
      const r = pixels[i + 2]!;
      const a = pixels[i + 3]!;

      if (a === 0) {
        pixels[i] = 0;
        pixels[i + 1] = 0;
        pixels[i + 2] = 0;
      } else if (a === 255) {
        pixels[i] = r;
        pixels[i + 2] = b;
      } else {
        pixels[i] = Math.min(255, Math.round((r * 255) / a));
        pixels[i + 1] = Math.min(255, Math.round((g * 255) / a));
        pixels[i + 2] = Math.min(255, Math.round((b * 255) / a));
      }
    }

    // (1) CgBI yiginini atarak yeniden kur.
    const newIhdr = Buffer.from(ihdr.data);
    const filtered = addNoneFilter(pixels, width, height, 4);
    const compressed = deflateSync(filtered, { level: 9 });

    const korunacak = new Set(['PLTE', 'tRNS', 'pHYs', 'sRGB', 'gAMA']);
    const ekYiginlar = chunks
      .filter((c) => korunacak.has(c.type))
      .map((c) => writeChunk(c.type, c.data));

    return Buffer.concat([
      PNG_SIGNATURE,
      writeChunk('IHDR', newIhdr),
      ...ekYiginlar,
      writeChunk('IDAT', compressed),
      writeChunk('IEND', Buffer.alloc(0)),
    ]);
  } catch {
    return null;
  }
}

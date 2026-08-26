/**
 * Fiksturler icin kucuk ama gecerli gorsel verisi (make-ipa.mjs ve make-apk.mjs kullanir).
 *
 *   pngUret(genislik, yukseklik, rgb)  -> duz renkli, 8 bit truecolor PNG (Buffer)
 *   WEBP_1x1                           -> 1x1 kayipsiz (VP8L) WebP, 34 bayt (Buffer)
 */
import { deflateRawSync } from 'node:zlib';

/* --- Kucuk ama gecerli bir PNG (120x120 duz renk) ------------------------ */
export function pngUret(genislik = 120, yukseklik = 120, rgb = [0x2f, 0x6f, 0xed]) {
  const crcTablo = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  const crc32 = (buf) => {
    let c = -1;
    for (const b of buf) c = crcTablo[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (tip, veri) => {
    const uzunluk = Buffer.alloc(4);
    uzunluk.writeUInt32BE(veri.length);
    const govde = Buffer.concat([Buffer.from(tip, 'ascii'), veri]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(govde));
    return Buffer.concat([uzunluk, govde, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(genislik, 0);
  ihdr.writeUInt32BE(yukseklik, 4);
  ihdr[8] = 8; // bit derinligi
  ihdr[9] = 2; // renk tipi: truecolor
  const satirlar = [];
  for (let y = 0; y < yukseklik; y++) {
    const satir = Buffer.alloc(1 + genislik * 3);
    for (let x = 0; x < genislik; x++) {
      satir[1 + x * 3] = rgb[0];
      satir[2 + x * 3] = rgb[1];
      satir[3 + x * 3] = rgb[2];
    }
    satirlar.push(satir);
  }
  const ham = Buffer.concat(satirlar);
  // zlib basligi + deflate + adler32
  const adler = (() => {
    let a = 1, b = 0;
    for (const byte of ham) {
      a = (a + byte) % 65521;
      b = (b + a) % 65521;
    }
    const out = Buffer.alloc(4);
    out.writeUInt32BE(((b << 16) | a) >>> 0);
    return out;
  })();
  const idatVeri = Buffer.concat([Buffer.from([0x78, 0x01]), deflateRawSync(ham), adler]);

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idatVeri),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* --- 1x1 kayipsiz WebP (RIFF/WEBP/VP8L, 34 bayt) ------------------------- */
export const WEBP_1x1 = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');

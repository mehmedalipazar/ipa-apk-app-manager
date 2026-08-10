/**
 * Test icin sentetik .ipa uretir.
 *
 *   node tests/fixtures/make-ipa.mjs <cikti.ipa> [bundleId] [appName] [version] [build] [boyutKB]
 *
 * Uretilen arsiv parser'in bekledigi minimum yapiya sahiptir:
 *   Payload/<AppName>.app/Info.plist          (XML plist)
 *   Payload/<AppName>.app/AppIcon60x60@2x.png (gecerli PNG)
 *   Payload/<AppName>.app/dolgu.bin           (istenen boyuta ulasmak icin)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';

const [, , ciktiArg, bundleId = 'com.ankageo.testapp', appName = 'TestApp', version = '1.0.0', buildNo = '100', boyutKB = '64'] =
  process.argv;

if (!ciktiArg) {
  console.error('Kullanim: node make-ipa.mjs <cikti.ipa> [bundleId] [appName] [version] [build] [boyutKB]');
  process.exit(2);
}

const cikti = resolve(ciktiArg);

/* --- Info.plist --------------------------------------------------------- */
const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>${bundleId}</string>
  <key>CFBundleDisplayName</key><string>${appName}</string>
  <key>CFBundleName</key><string>${appName}</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${buildNo}</string>
  <key>MinimumOSVersion</key><string>15.0</string>
  <key>CFBundleSupportedPlatforms</key>
  <array><string>iPhoneOS</string></array>
  <key>CFBundleExecutable</key><string>${appName}</string>
</dict>
</plist>
`;

/* --- Kucuk ama gecerli bir PNG (120x120 duz renk) ------------------------ */
function pngUret(genislik = 120, yukseklik = 120, rgb = [0x2f, 0x6f, 0xed]) {
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

/* --- Arsivi kur ---------------------------------------------------------- */
const gecici = mkdtempSync(join(tmpdir(), 'ipa-fixture-'));
try {
  const appDir = join(gecici, 'Payload', `${appName}.app`);
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(appDir, 'Info.plist'), infoPlist, 'utf8');
  writeFileSync(join(appDir, 'AppIcon60x60@2x.png'), pngUret());

  const dolguBayt = Math.max(0, Number(boyutKB) * 1024 - 4096);
  if (dolguBayt > 0) writeFileSync(join(appDir, 'dolgu.bin'), randomBytes(dolguBayt));

  mkdirSync(dirname(cikti), { recursive: true });
  const geciciZip = join(gecici, 'out.zip');
  // -X: ek nitelikleri yazma, -0: dolgu sikismasin (boyut ongorulebilir olsun)
  execFileSync('zip', ['-r', '-X', '-0', '-q', geciciZip, 'Payload'], { cwd: gecici });
  renameSync(geciciZip, cikti);

  console.log(cikti);
} finally {
  rmSync(gecici, { recursive: true, force: true });
}

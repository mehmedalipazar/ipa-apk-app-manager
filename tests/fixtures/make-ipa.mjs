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
import { pngUret } from './png.mjs';

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

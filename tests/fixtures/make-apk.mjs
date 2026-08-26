/**
 * Test icin sentetik .apk uretir (Android SDK build-tools + Java gerekir; uretilen ikililer commit'lidir,
 * test paketi SDK olmadan da kosar).
 *
 *   node tests/fixtures/make-apk.mjs <cikti.apk> [package] [label] [versionName] [versionCode] [minSdk] [simge: png|webp|yok] [etiket: ref|literal] [boyutKB]
 *   node tests/fixtures/make-apk.mjs --bozuk <cikti.apk>       # 16 bayt duz metin ("bu bir apk degil"), zip degil
 *   node tests/fixtures/make-apk.mjs --zip-degil <cikti.apk>   # yalnizca README.txt iceren zip, AndroidManifest.xml yok
 *
 * Uretilen arsiv gercek bir APK'dir: aapt2 ile derlenip baglanir, zipalign ile hizalanir, apksigner ile
 * (v1 + v2 + v3) imzalanir. Parser'in bekledigi yapi:
 *   AndroidManifest.xml                          (ikili AXML; package, versionCode/Name, uses-sdk, label, icon)
 *   resources.arsc                               (yalnizca kaynak varsa: etiket=ref veya simge!=yok)
 *   res/mipmap-mdpi-v4/ic_launcher.png           (48x48)   } simge=png: yogunluk secimini sinar
 *   res/mipmap-xxhdpi-v4/ic_launcher.png         (144x144) }
 *   res/mipmap-anydpi-v26/ic_launcher.xml        (adaptive icon; XML'in atlanmasini sinar)
 *   res/mipmap-xxhdpi-v4/ic_launcher.webp        (simge=webp: 1x1 VP8L)
 *   assets/dolgu.bin                             (istenen boyuta ulasmak icin; sikistirilmaz)
 *   META-INF/*                                   (v1 imzasi; parser'i sasirtmadigini kanitlar)
 * etiket=ref: android:label="@string/app_name"; values/ ve values-tr/ ("<label> TR") ikisi de yazilir ki
 * parser'in varsayilan konfigurasyonu sectigi kanitlansin. etiket=literal: label manifeste dogrudan yazilir.
 *
 * SDK arama sirasi: ANDROID_HOME -> ANDROID_SDK_ROOT -> ~/Library/Android/sdk. aapt2 iceren en yuksek
 * build-tools/* ve en yuksek platforms/android-<N>/android.jar secilir; keytool ve java PATH'te olmali.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pngUret, WEBP_1x1 } from './png.mjs';

const KULLANIM = `Kullanim:
  node make-apk.mjs <cikti.apk> [package] [label] [versionName] [versionCode] [minSdk] [simge: png|webp|yok] [etiket: ref|literal] [boyutKB]
  node make-apk.mjs --bozuk <cikti.apk>
  node make-apk.mjs --zip-degil <cikti.apk>`;

/** Beklenen, temiz raporlanan hata (yigin izi basilmaz). */
class FiksturHatasi extends Error {}

function kullanimHatasi(mesaj) {
  console.error(mesaj);
  console.error(KULLANIM);
  process.exit(2);
}

const argv = process.argv.slice(2);
const mod = argv[0] === '--bozuk' || argv[0] === '--zip-degil' ? argv.shift().slice(2) : 'apk';

const [
  ciktiArg,
  paket = 'com.ankageo.testapp',
  etiketMetni = 'TestApp',
  versionName = '1.0.0',
  versionCode = '100',
  minSdk = '24',
  simge = 'png',
  etiket = 'ref',
  boyutKB = '64',
] = argv;

if (!ciktiArg) kullanimHatasi('Cikti yolu eksik.');
if (mod === 'apk') {
  if (!['png', 'webp', 'yok'].includes(simge)) kullanimHatasi(`Gecersiz simge secimi: ${simge} (png|webp|yok)`);
  if (!['ref', 'literal'].includes(etiket)) kullanimHatasi(`Gecersiz etiket secimi: ${etiket} (ref|literal)`);
  for (const [ad, deger] of [['versionCode', versionCode], ['minSdk', minSdk], ['boyutKB', boyutKB]]) {
    if (!/^\d+$/.test(deger)) kullanimHatasi(`${ad} tam sayi olmali: ${deger}`);
  }
}

const cikti = resolve(ciktiArg);

/* --- SDK kesfi ----------------------------------------------------------- */
// "37.0.0", "36.1", "34" gibi surum adlarini sayisal parcalarina gore karsilastirir (rc eki yok sayilir)
function surumAnahtari(ad) {
  return ad.split('-')[0].split('.').map(Number);
}
function surumKarsilastir(a, b) {
  const ka = surumAnahtari(a), kb = surumAnahtari(b);
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const fark = (ka[i] ?? 0) - (kb[i] ?? 0);
    if (fark) return fark;
  }
  return 0;
}
function enYuksek(adlar) {
  return adlar.filter((ad) => /^\d+(\.\d+)*(-.*)?$/.test(ad)).sort(surumKarsilastir).at(-1);
}

function sdkBul() {
  const varsayilan = join(homedir(), 'Library', 'Android', 'sdk');
  const adaylar = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, varsayilan].filter(Boolean);
  const kok = adaylar.find((d) => existsSync(join(d, 'build-tools')));
  if (!kok) {
    throw new FiksturHatasi(
      `Android SDK bulunamadi. ANDROID_HOME veya ANDROID_SDK_ROOT tanimlayin (bakilan yerler: ${adaylar.join(', ')}).`,
    );
  }

  const buildToolsKok = join(kok, 'build-tools');
  const buildTools = enYuksek(readdirSync(buildToolsKok).filter((d) => existsSync(join(buildToolsKok, d, 'aapt2'))));
  if (!buildTools) throw new FiksturHatasi(`aapt2 iceren build-tools bulunamadi: ${buildToolsKok}`);

  const platformlarKok = join(kok, 'platforms');
  const platformlar = existsSync(platformlarKok)
    ? readdirSync(platformlarKok).filter((d) => d.startsWith('android-') && existsSync(join(platformlarKok, d, 'android.jar')))
    : [];
  const platformSurumu = enYuksek(platformlar.map((d) => d.slice('android-'.length)));
  if (!platformSurumu) throw new FiksturHatasi(`android.jar iceren platforms/android-* bulunamadi: ${platformlarKok}`);

  const bt = join(buildToolsKok, buildTools);
  return {
    aapt2: join(bt, 'aapt2'),
    zipalign: join(bt, 'zipalign'),
    apksigner: join(bt, 'apksigner'),
    androidJar: join(platformlarKok, `android-${platformSurumu}`, 'android.jar'),
  };
}

/* --- XML yardimcilari ---------------------------------------------------- */
function xmlKacis(metin) {
  return metin.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
// aapt2 kaynak dizgelerinde kesme isareti ters bolu ile kacirilmali
function kaynakDizgesi(metin) {
  return xmlKacis(metin).replace(/'/g, "\\'");
}
function stringsXml(deger) {
  return `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="app_name">${kaynakDizgesi(deger)}</string>
</resources>
`;
}

/* --- Uretim -------------------------------------------------------------- */
const gecici = mkdtempSync(join(tmpdir(), 'apk-fixture-'));
try {
  const yaz = (goreliYol, icerik) => {
    const tam = join(gecici, goreliYol);
    mkdirSync(dirname(tam), { recursive: true });
    writeFileSync(tam, icerik);
  };
  // Adimlar gecici dizinde kosar; stderr dogrudan akar ki aapt2/apksigner hatalari gorunsun
  const adim = (ad, komut, args) => {
    try {
      return execFileSync(komut, args, { cwd: gecici, stdio: ['ignore', 'pipe', 'inherit'] });
    } catch (err) {
      throw new FiksturHatasi(`${ad} basarisiz (cikis kodu ${err.status ?? '?'}): ${komut} ${args.join(' ')}`);
    }
  };

  mkdirSync(dirname(cikti), { recursive: true });

  if (mod === 'bozuk') {
    // 16 bayt, zip imzasi (PK\x03\x04) yok
    writeFileSync(cikti, 'bu bir apk degil', 'ascii');
  } else if (mod === 'zip-degil') {
    yaz('README.txt', 'Bu arsiv gecerli bir zip ama APK degil: AndroidManifest.xml yok.\n');
    // -X: ek nitelikleri yazma (make-ipa.mjs ile ayni)
    adim('zip', 'zip', ['-X', '-q', 'out.zip', 'README.txt']);
    copyFileSync(join(gecici, 'out.zip'), cikti);
  } else {
    const sdk = sdkBul();

    /* AndroidManifest.xml */
    const etiketDegeri = etiket === 'ref' ? '@string/app_name' : xmlKacis(etiketMetni);
    const simgeNiteligi = simge === 'yok' ? '' : ' android:icon="@mipmap/ic_launcher"';
    yaz(
      'AndroidManifest.xml',
      `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="${paket}"
    android:versionCode="${versionCode}"
    android:versionName="${xmlKacis(versionName)}">
  <uses-sdk android:minSdkVersion="${minSdk}" android:targetSdkVersion="34"/>
  <application android:label="${etiketDegeri}"${simgeNiteligi}/>
</manifest>
`,
    );

    /* Kaynaklar */
    if (etiket === 'ref') {
      yaz('res/values/strings.xml', stringsXml(etiketMetni));
      yaz('res/values-tr/strings.xml', stringsXml(`${etiketMetni} TR`)); // varsayilan config secimini kanitlar
    }
    if (simge === 'png') {
      yaz('res/mipmap-mdpi/ic_launcher.png', pngUret(48, 48, [0x2f, 0x6f, 0xed]));
      yaz('res/mipmap-xxhdpi/ic_launcher.png', pngUret(144, 144, [0xed, 0x6f, 0x2f])); // farkli renk: secim ayirt edilebilsin
      yaz('res/mipmap-mdpi/ic_launcher_fg.png', pngUret(48, 48, [0x21, 0xa3, 0x66]));
      yaz(
        'res/values/colors.xml',
        `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ic_bg">#ff2f6fed</color>
</resources>
`,
      );
      // API 26+ cihazlarda kazanan adaptive icon: parser XML'i atlayip PNG'ye dusmeli
      yaz(
        'res/mipmap-anydpi-v26/ic_launcher.xml',
        `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/ic_bg"/>
  <foreground android:drawable="@mipmap/ic_launcher_fg"/>
</adaptive-icon>
`,
      );
    } else if (simge === 'webp') {
      yaz('res/mipmap-xxhdpi/ic_launcher.webp', WEBP_1x1);
    }

    /* Dolgu: manifest + arsc + imza yaklasik 8 KB tutar */
    const dolguBayt = Number(boyutKB) * 1024 - 8192;
    if (dolguBayt > 0) yaz('assets/dolgu.bin', randomBytes(dolguBayt));

    /* Derle -> bagla -> hizala -> imzala */
    const kaynakVar = existsSync(join(gecici, 'res'));
    if (kaynakVar) adim('aapt2 compile', sdk.aapt2, ['compile', '--dir', 'res', '-o', 'res.zip']);

    const linkArgs = ['link', '-o', 'unsigned.apk', '-I', sdk.androidJar, '--manifest', 'AndroidManifest.xml'];
    if (dolguBayt > 0) linkArgs.push('-A', 'assets', '-0', 'bin'); // -0: .bin sonekli dosyalar sikistirilmasin
    if (kaynakVar) linkArgs.push('res.zip');
    adim('aapt2 link', sdk.aapt2, linkArgs);

    adim('zipalign', sdk.zipalign, ['-f', '4', 'unsigned.apk', 'aligned.apk']);

    // Imza ayristirma icin sart degil: keytool/apksigner basarisizsa uyari verip hizalanmis APK'yi yazariz.
    let imzali = false;
    try {
      const sessiz = { cwd: gecici, stdio: ['ignore', 'pipe', 'pipe'] };
      execFileSync(
        'keytool',
        ['-genkeypair', '-keystore', 'test.jks', '-storepass', 'testtest', '-keypass', 'testtest', '-alias', 'test',
          '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=Test, O=AnkaGeo'],
        sessiz,
      );
      // v1 acik: minSdk >= 24 iken apksigner v1'i varsayilan olarak atlar, META-INF girdilerini istiyoruz.
      // v4 kapali: yoksa yanina ayri bir .idsig dosyasi yazar.
      execFileSync(
        sdk.apksigner,
        ['sign', '--ks', 'test.jks', '--ks-pass', 'pass:testtest', '--key-pass', 'pass:testtest',
          '--v1-signing-enabled', 'true', '--v4-signing-enabled', 'false', '--out', 'signed.apk', 'aligned.apk'],
        sessiz,
      );
      imzali = true;
    } catch (err) {
      const neden = (err.stderr?.toString() || err.message).trim().split('\n')[0];
      console.warn(`Uyari: imzalama basarisiz, imzasiz (yalnizca hizalanmis) APK yaziliyor: ${neden}`);
    }
    copyFileSync(join(gecici, imzali ? 'signed.apk' : 'aligned.apk'), cikti);
  }

  console.log(cikti);
} catch (err) {
  if (!(err instanceof FiksturHatasi)) throw err;
  console.error(`Hata: ${err.message}`);
  process.exitCode = 1;
} finally {
  rmSync(gecici, { recursive: true, force: true });
}

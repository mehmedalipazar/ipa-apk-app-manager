/**
 * Kurulum sayfasi — son kullanicinin gordugu tek ekran.
 *
 * Sunucu tarafinda uretilir (React degil), cunku:
 *   - iPhone'da mobil tarayicida aninda acilmali, JS paketi beklemeden.
 *   - Kurum aglarinda JS engelli olsa bile kurulum butonu calismali.
 */
import { escapeHtml, formatBytes, formatDateTime, formatRemaining } from '../../shared/format.ts';
import type { BuildRecord } from '../../db/repositories/builds.repository.ts';
import { androidVersionLabel } from '../apk/sdk-levels.ts';
import { STATUS_LABELS, type BuildStatus } from '../links/service.ts';

export interface InstallPageInput {
  readonly siteName: string;
  readonly build: BuildRecord;
  readonly status: BuildStatus;
  /** iOS cihazdan mi geliniyor? Degilse QR kod gosterilir. */
  readonly isIos: boolean;
  /** Android cihazdan mi geliniyor? (Android paketleri icin: degilse uyari + QR.) */
  readonly isAndroid: boolean;
  /** iOS: itms-services:// adresi — Android: imzali app.apk adresi. Sifre girilmemisse null. */
  readonly installUrl: string | null;
  /** Simge adresi (imzali). Simge yoksa null. */
  readonly iconUrl: string | null;
  /** Bu sayfanin kendi genel adresi — QR icin. */
  readonly pageUrl: string;
  readonly showQrCode: boolean;
  readonly installNote: string;
  /** Sifre korumali mi ve daha girilmedi mi? */
  readonly needsPassword: boolean;
  readonly passwordError: string | null;
}

const STYLES = `
:root {
  --bg: #f2f2f7; --card: #ffffff; --fg: #1c1c1e; --muted: #6b6b70;
  --accent: #007aff; --border: #e3e3e8; --warn-bg: #fff4e5; --warn-fg: #93400a;
  --err-bg: #ffebe9; --err-fg: #b3261e;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #000000; --card: #1c1c1e; --fg: #f2f2f7; --muted: #98989f;
    --accent: #0a84ff; --border: #2c2c2e; --warn-bg: #3a2a12; --warn-fg: #ffb861;
    --err-bg: #3b1d1b; --err-fg: #ff9a91;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 28px 18px 56px; background: var(--bg); color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
  display: flex; flex-direction: column; align-items: center; line-height: 1.5;
  -webkit-text-size-adjust: 100%;
}
.wrap { width: 100%; max-width: 460px; }
.head { display: flex; flex-direction: column; align-items: center; text-align: center; }
.icon {
  width: 108px; height: 108px; border-radius: 24px; background: var(--card);
  box-shadow: 0 4px 18px rgba(0,0,0,.16); object-fit: cover;
}
.icon.placeholder {
  display: flex; align-items: center; justify-content: center;
  font-size: 42px; font-weight: 600; color: var(--muted); border: 1px solid var(--border);
}
h1 { font-size: 24px; margin: 18px 0 2px; letter-spacing: -0.02em; }
.sub { color: var(--muted); font-size: 15px; margin: 0; }
.btn {
  display: block; width: 100%; margin-top: 26px; padding: 16px 20px; border: 0;
  border-radius: 14px; background: var(--accent); color: #fff; font-size: 18px;
  font-weight: 600; text-align: center; text-decoration: none; cursor: pointer;
  font-family: inherit;
}
.btn:active { opacity: .82; }
.btn[disabled], .btn.disabled { background: var(--border); color: var(--muted); pointer-events: none; }
.card {
  background: var(--card); border: 1px solid var(--border); border-radius: 16px;
  padding: 18px 20px; margin-top: 22px;
}
.card h2 { font-size: 15px; margin: 0 0 12px; text-transform: uppercase;
  letter-spacing: .04em; color: var(--muted); font-weight: 600; }
dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; font-size: 15px; }
dt { color: var(--muted); }
dd { margin: 0; text-align: right; word-break: break-all; }
ol { margin: 0; padding-left: 20px; font-size: 15px; }
ol li { margin-bottom: 9px; }
ol li:last-child { margin-bottom: 0; }
.notice { border-radius: 12px; padding: 13px 15px; font-size: 14px; margin-top: 18px; }
.notice.warn { background: var(--warn-bg); color: var(--warn-fg); }
.notice.err  { background: var(--err-bg);  color: var(--err-fg); }
/* #masaustu-uyari icindeki adres cubugu "AA" dugmesi taklidi.
   NOT: bu CSS her sayfaya (iPhone gorunumu dahil) gomulur; buraya tarayici
   markasi YAZMAYIN — H8 iPhone sayfasinda o marka adinin gecmedigini pinler. */
.safari-menu-icon {
  display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px;
  margin-right: 5px; border: 1px solid currentColor; border-radius: 7px; font-size: 12px;
  font-weight: 700; line-height: 1; vertical-align: -7px;
}
.qr { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.qr img { width: 210px; height: 210px; background: #fff; border-radius: 12px; padding: 10px; }
.field {
  width: 100%; padding: 14px 15px; font-size: 17px; border-radius: 12px;
  border: 1px solid var(--border); background: var(--bg); color: var(--fg);
  font-family: inherit; margin-top: 8px;
}
.foot { margin-top: 26px; text-align: center; color: var(--muted); font-size: 13px; }
.status-big { text-align: center; padding: 26px 0 6px; }
.status-big .emoji { font-size: 44px; }
.status-big h1 { margin-top: 12px; }
`;

/**
 * Sekme simgesi. Backend statik dosya SUNMAZ (kurulum sayfasi tek parca HTML'dir),
 * bu yuzden panelin `frontend/public/favicon.svg` cizimi data URI olarak gomulu.
 * `#` isareti data URI icinde parca ayraci sayildigi icin renkler %23 ile yazilir.
 * Iki dosya elle esitlenir; ayni marka iki ayri serviste yasiyor.
 */
const FAVICON =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='%230a66ff'/><g fill='%23ffffff'><g transform='translate(-3.6 12.8) scale(1.6)'><path d='M17.05 12.54c-.02-2.2 1.8-3.26 1.88-3.31-1.02-1.5-2.61-1.7-3.18-1.72-1.35-.14-2.64.79-3.33.79-.68 0-1.74-.77-2.87-.75-1.47.02-2.83.86-3.59 2.17-1.53 2.66-.39 6.6 1.1 8.75.73 1.06 1.6 2.24 2.74 2.2 1.1-.05 1.52-.71 2.85-.71s1.7.71 2.87.69c1.19-.02 1.94-1.07 2.66-2.13.84-1.22 1.19-2.4 1.2-2.46-.03-.01-2.3-.88-2.33-3.52zM14.9 5.9c.6-.73 1.01-1.75.9-2.76-.87.03-1.92.58-2.55 1.31-.56.64-1.05 1.68-.92 2.67.97.07 1.96-.49 2.57-1.22z'/></g><g transform='translate(25.7 11.2) scale(1.6)'><path fill-rule='evenodd' d='M3.2 18.6a8.8 8.8 0 0 1 17.6 0v1H3.2zM7.7 13.8a1.3 1.3 0 1 0 2.6 0 1.3 1.3 0 1 0-2.6 0zm6 0a1.3 1.3 0 1 0 2.6 0 1.3 1.3 0 1 0-2.6 0z'/><path d='M6.9 11.4 4.6 6.4M17.1 11.4l2.3-5' fill='none' stroke='%23ffffff' stroke-width='1.7' stroke-linecap='round'/></g></g></svg>";

/**
 * @param title  Sekmede gorunecek ad (uygulama + surum).
 * @param siteName  Varsa sekme basligina " · <site adi>" olarak eklenir.
 *   Ayarlardaki "Site adi" alani hem burayi hem de altbilgiyi besler.
 */
function shell(title: string, body: string, siteName?: string): string {
  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="${FAVICON}">
<title>${escapeHtml(title)}${siteName ? ` &middot; ${escapeHtml(siteName)}` : ''}</title>
<style>${STYLES}</style>
</head>
<body><div class="wrap">${body}</div></body>
</html>`;
}

function iconBlock(iconUrl: string | null, appName: string): string {
  if (iconUrl) {
    return `<img class="icon" src="${escapeHtml(iconUrl)}" alt="${escapeHtml(appName)}">`;
  }
  const harf = escapeHtml(appName.trim().charAt(0).toUpperCase() || '?');
  return `<div class="icon placeholder">${harf}</div>`;
}

/** Kurulabilir durumdaki uygulama sayfasi. */
export function renderInstallPage(input: InstallPageInput): string {
  const { build, siteName } = input;
  const baslik = `${build.appName} ${build.version}`;

  const kalan = formatRemaining(build.expiresAt);

  // "En az" satiri: iOS'ta ham surum ("15.0"), Android'de API seviyesinden
  // turetilen etiket ("7.0 (API 24)"). Bilinmiyorsa satir hic cizilmez.
  let enAzSatiri = '';
  if (build.platform === 'android') {
    const etiket = androidVersionLabel(build.minOsVersion);
    if (etiket) enAzSatiri = `<dt>En az Android</dt><dd>${escapeHtml(etiket)}</dd>`;
  } else if (build.minOsVersion) {
    enAzSatiri = `<dt>En az iOS</dt><dd>${escapeHtml(build.minOsVersion)}</dd>`;
  }

  const detaylar = `
    <div class="card">
      <h2>Uygulama bilgileri</h2>
      <dl>
        <dt>Surum</dt><dd>${escapeHtml(build.version)} (${escapeHtml(build.buildNumber)})</dd>
        <dt>Paket adi</dt><dd>${escapeHtml(build.bundleId)}</dd>
        <dt>Boyut</dt><dd>${formatBytes(build.sizeBytes)}</dd>
        ${enAzSatiri}
        <dt>Link gecerlilik</dt><dd>${kalan ? `${escapeHtml(kalan)} kaldi` : 'doldu'}</dd>
      </dl>
    </div>`;

  const not = input.installNote
    ? `<div class="card"><h2>Not</h2><div>${escapeHtml(input.installNote)}</div></div>`
    : '';

  /* --- Sifre istegi --- */
  if (input.needsPassword) {
    const hata = input.passwordError
      ? `<div class="notice err">${escapeHtml(input.passwordError)}</div>`
      : '';
    return shell(
      baslik,
      `<div class="head">
         ${iconBlock(input.iconUrl, build.appName)}
         <h1>${escapeHtml(build.appName)}</h1>
         <p class="sub">Surum ${escapeHtml(build.version)}</p>
       </div>
       ${hata}
       <form method="POST" action="${escapeHtml(input.pageUrl)}">
         <div class="card">
           <h2>Bu link sifre korumali</h2>
           <input class="field" type="password" name="password" placeholder="Sifre"
                  autocomplete="current-password" required autofocus>
         </div>
         <button class="btn" type="submit">Devam Et</button>
       </form>
       <div class="foot">${escapeHtml(siteName)}</div>`,
      siteName,
    );
  }

  /* --- Android paketi: manifest/itms zinciri yok, dogrudan indirme --- */
  if (build.platform === 'android') return renderAndroidPage(input, detaylar, not);

  /* --- iOS disi cihaz: QR goster --- */
  // DIKKAT: iPadOS 13+ varsayilan olarak masaustu Safari UA'si verir
  // ("Macintosh", "Mobile" yok) ve sunucudan Mac'ten AYIRT EDILEMEZ. Bu yuzden
  // sayfaya gizli bir kurulum blogu + kucuk bir dokunmatik tespit betigi konur:
  // Mac'te maxTouchPoints 0'dir, iPad'de > 1. JS kapaliysa sayfa QR gorunumunde
  // kalir (eski davranis); iPhone/iPad UA'lari zaten dogrudan butonu alir.
  // Tespit BASARISIZ olursa (JS kapali, farkli tarayici) kullanicinin tek yolu
  // Safari menusunden "Mobil Web Sitesi"ni secmektir — menu etiketi birebir
  // budur, iPad'de dogrulandi. O yuzden talimat gizli blokta DEGIL, her zaman
  // gorunen #masaustu-uyari icindedir (2026-08-25).
  if (!input.isIos) {
    const qr = input.showQrCode
      ? `<div class="card qr">
           <img src="${escapeHtml(input.pageUrl)}/qr.svg" alt="QR kod" width="210" height="210">
           <div style="color:var(--muted);font-size:14px;text-align:center">
             iPhone kamerasiyla okutun
           </div>
         </div>`
      : '';

    const ipadKurulum = input.installUrl
      ? `<div id="ipad-kurulum" hidden>
           <a class="btn" href="${escapeHtml(input.installUrl)}">Uygulamayi Yukle</a>
         </div>
         <script>
         (function () {
           if (!(/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)) return;
           var kurulum = document.getElementById('ipad-kurulum');
           var uyari = document.getElementById('masaustu-uyari');
           if (kurulum) kurulum.hidden = false;
           if (uyari) uyari.hidden = true;
         })();
         </script>`
      : '';

    return shell(
      baslik,
      `<div class="head">
         ${iconBlock(input.iconUrl, build.appName)}
         <h1>${escapeHtml(build.appName)}</h1>
         <p class="sub">Surum ${escapeHtml(build.version)} (${escapeHtml(build.buildNumber)})</p>
       </div>
       ${ipadKurulum}
       <div class="notice warn" id="masaustu-uyari">
         Bu uygulama yalnizca <strong>iPhone ve iPad</strong> cihazlara kurulabilir.
         Kurulum icin bu sayfayi iOS cihazinizdaki <strong>mobil tarayicinizda</strong> acin.
         <br><br>
         Eger tarayiciniz Safari ise ve <strong>Uygulamayi Yukle</strong> butonu gozukmuyorsa,
         adres cubugunun hemen solundaki <span class="safari-menu-icon" aria-hidden="true">AA</span>
         dugmesine dokunun, uc noktaya basin ve <strong>Mobil Web Sitesi</strong>'ni secin.
       </div>
       ${qr}
       ${detaylar}
       ${not}
       <div class="foot">${escapeHtml(siteName)}</div>`,
      siteName,
    );
  }

  /* --- Normal kurulum --- */
  // Onemli: itms-services adresi bir HTML ozniteligi icine giriyor, & -> &amp;
  const buton = input.installUrl
    ? `<a class="btn" href="${escapeHtml(input.installUrl)}">Uygulamayi Yukle</a>`
    : `<span class="btn disabled">Kurulum kullanilamiyor</span>`;

  return shell(
    baslik,
    `<div class="head">
       ${iconBlock(input.iconUrl, build.appName)}
       <h1>${escapeHtml(build.appName)}</h1>
       <p class="sub">Surum ${escapeHtml(build.version)} (${escapeHtml(build.buildNumber)})</p>
       ${buton}
     </div>

     <div class="card">
       <h2>Kurulum adimlari</h2>
       <ol>
         <li><strong>Uygulamayi Yukle</strong>'ye dokunun, cikan pencerede <strong>Yukle</strong>'yi secin.</li>
         <li>Ana ekranda simge belirir; yuklenmesini bekleyin.</li>
         <li>Ilk aciliste <em>"Guvenilmeyen Kurumsal Gelistirici"</em> uyarisi cikarsa:
             <strong>Ayarlar &rsaquo; Genel &rsaquo; VPN ve Aygit Yonetimi</strong> yolundan
             gelistiriciye <strong>Guven</strong> deyin.</li>
       </ol>
     </div>

     ${detaylar}
     ${not}

     <div class="notice warn">
       Kurulum sirasinda cihazin internete bagli kalmasi gerekir.
       Sayfa mobil tarayiciniz disinda (orn. WhatsApp ya da Instagram icinde) acildiysa
       kurulum baslamayabilir; bu durumda linki mobil tarayicinizda acin.
     </div>

     <div class="foot">${escapeHtml(siteName)}</div>`,
    siteName,
  );
}

/**
 * Android (.apk) sayfasi.
 *
 * Android'de manifest/itms zinciri yoktur: buton imzali app.apk adresine gider,
 * tarayici dosyayi indirir, kullanici indirilen dosyayi acip paket yukleyiciye
 * verir. Buton HER goruntude vardir — APK duz bir dosyadir; masaustunden indirip
 * `adb install` ile kurmak mesru, ayrica Chrome'un "masaustu sitesi" modu UA'dan
 * "Android"i dusurur. Cihaz disi goruntude ek olarak uyari + QR gosterilir.
 * Metinlere tarayici markasi YAZILMAZ (bkz. STYLES yorumu / H8).
 */
function renderAndroidPage(input: InstallPageInput, detaylar: string, not: string): string {
  const { build, siteName } = input;
  const baslik = `${build.appName} ${build.version}`;

  const head = (buton: string) => `<div class="head">
       ${iconBlock(input.iconUrl, build.appName)}
       <h1>${escapeHtml(build.appName)}</h1>
       <p class="sub">Surum ${escapeHtml(build.version)} (${escapeHtml(build.buildNumber)})</p>
       ${buton}
     </div>`;

  /* --- Android cihazda: indir + adimlar --- */
  if (input.isAndroid) {
    const buton = input.installUrl
      ? `<a class="btn" href="${escapeHtml(input.installUrl)}">Uygulamayi Indir</a>`
      : `<span class="btn disabled">Indirme kullanilamiyor</span>`;

    return shell(
      baslik,
      `${head(buton)}

       <div class="card">
         <h2>Kurulum adimlari</h2>
         <ol>
           <li><strong>Uygulamayi Indir</strong>'e dokunun; indirme bildirim cubugunda gorunur.</li>
           <li>Indirme bitince bildirime dokunun (ya da <strong>Dosyalar &rsaquo; Indirilenler</strong>
               icindeki .apk dosyasini acin).</li>
           <li><em>"Bilinmeyen uygulamalari yukle"</em> izni istenirse acilan ayardan tarayiciniza
               izin verin ve geri donun.</li>
           <li><strong>Yukle</strong>'ye dokunun. Play Protect uyarisi cikarsa
               <strong>Yine de yukle</strong>'yi secin.</li>
         </ol>
       </div>

       ${detaylar}
       ${not}

       <div class="notice warn">
         Kurulum sirasinda cihazin internete bagli kalmasi gerekir.
         Sayfa mobil tarayiciniz disinda (orn. WhatsApp ya da Instagram icinde) acildiysa
         indirme baslamayabilir; bu durumda linki mobil tarayicinizda acin.
       </div>

       <div class="foot">${escapeHtml(siteName)}</div>`,
      siteName,
    );
  }

  /* --- Android disi cihaz (masaustu, iPhone): uyari + indirme + QR --- */
  const buton = input.installUrl
    ? `<a class="btn" href="${escapeHtml(input.installUrl)}">Uygulamayi Indir (.apk)</a>`
    : '';

  const qr = input.showQrCode
    ? `<div class="card qr">
         <img src="${escapeHtml(input.pageUrl)}/qr.svg" alt="QR kod" width="210" height="210">
         <div style="color:var(--muted);font-size:14px;text-align:center">
           Android cihazin kamerasiyla okutun
         </div>
       </div>`
    : '';

  return shell(
    baslik,
    `${head('')}
     <div class="notice warn" id="android-uyari">
       Bu uygulama yalnizca <strong>Android</strong> cihazlara kurulabilir.
       Kurulum icin bu sayfayi Android cihazinizin tarayicisinda acin ya da asagidaki QR kodu okutun.
       Dosyayi buradan indirip cihaza aktarabilirsiniz de.
     </div>
     ${buton}
     ${qr}
     ${detaylar}
     ${not}
     <div class="foot">${escapeHtml(siteName)}</div>`,
    siteName,
  );
}

/** Suresi dolmus / iptal edilmis / bulunamayan linkler icin. */
export function renderUnavailablePage(
  siteName: string,
  status: BuildStatus | 'notfound' | 'yapilandirma',
  appName?: string,
  expiresAt?: number,
): string {
  const metinler: Record<BuildStatus | 'notfound' | 'yapilandirma', { emoji: string; baslik: string; aciklama: string }> = {
    expired: {
      emoji: '&#9203;',
      baslik: 'Linkin suresi doldu',
      aciklama: expiresAt
        ? `Bu kurulum linki ${formatDateTime(expiresAt)} tarihinde gecersiz oldu. Yeni bir link icin uygulamayi paylasan kisiyle iletisime gecin.`
        : 'Bu kurulum linki artik gecerli degil. Yeni bir link icin uygulamayi paylasan kisiyle iletisime gecin.',
    },
    revoked: {
      emoji: '&#128683;',
      baslik: 'Link iptal edildi',
      aciklama: 'Bu kurulum linki yonetici tarafindan kapatildi.',
    },
    purged: {
      emoji: '&#128465;',
      baslik: 'Dosya silindi',
      aciklama: 'Bu surumun kurulum dosyasi sunucudan kaldirildi.',
    },
    notfound: {
      emoji: '&#128269;',
      baslik: 'Link bulunamadi',
      aciklama: 'Adres hatali olabilir. Linki eksiksiz kopyaladiginizdan emin olun.',
    },
    yapilandirma: {
      emoji: '&#9888;&#65039;',
      baslik: 'Kurulum su anda yapilamiyor',
      aciklama:
        'Sunucu yapilandirmasi eksik oldugu icin kurulum baslatilamiyor. Sorun sizde degil — uygulamayi paylasan kisiye haber verin.',
    },
    active: { emoji: '', baslik: '', aciklama: '' },
  };

  const m = metinler[status];
  const altBaslik = appName ? `<p class="sub">${escapeHtml(appName)}</p>` : '';

  return shell(
    m.baslik,
    `<div class="status-big">
       <div class="emoji">${m.emoji}</div>
       <h1>${escapeHtml(m.baslik)}</h1>
       ${altBaslik}
     </div>
     <div class="card"><div>${escapeHtml(m.aciklama)}</div></div>
     <div class="foot">${escapeHtml(siteName)} &middot; ${escapeHtml(STATUS_LABELS[status as BuildStatus] ?? '')}</div>`,
    siteName,
  );
}

/**
 * iPhone/iPad tespiti — yalnizca UA'dan.
 *
 * iPadOS 13+ varsayilan (masaustu) modda "Macintosh" der ve Mobile/ TASIMAZ;
 * o durum sunucudan ayirt edilemez ve renderInstallPage icindeki dokunmatik
 * tespit betigiyle istemci tarafinda yakalanir. Buradaki Mobile/ kontrolu
 * yalnizca "mobil site iste" acik olan iPad'leri yakalar.
 */
export function isIosUserAgent(ua: string | undefined): boolean {
  if (!ua) return false;
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && /Mobile\//i.test(ua);
}

/**
 * Android tespiti — yalnizca UA'dan. iOS UA'lari "Android" icermez. Chrome'un
 * "masaustu sitesi" modu bu sozcugu dusurur; o durumda sayfa yine indirme
 * butonunu tasir (renderAndroidPage), yalnizca uyari + QR eklenir.
 */
export function isAndroidUserAgent(ua: string | undefined): boolean {
  return !!ua && /Android/i.test(ua);
}

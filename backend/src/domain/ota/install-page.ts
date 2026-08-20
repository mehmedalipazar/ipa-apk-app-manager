/**
 * Kurulum sayfasi — son kullanicinin gordugu tek ekran.
 *
 * Sunucu tarafinda uretilir (React degil), cunku:
 *   - iPhone'da Safari ile aninda acilmali, JS paketi beklemeden.
 *   - Kurum aglarinda JS engelli olsa bile kurulum butonu calismali.
 */
import { escapeHtml, formatBytes, formatDateTime, formatRemaining } from '../../shared/format.ts';
import type { BuildRecord } from '../../db/repositories/builds.repository.ts';
import { STATUS_LABELS, type BuildStatus } from '../links/service.ts';

export interface InstallPageInput {
  readonly siteName: string;
  readonly build: BuildRecord;
  readonly status: BuildStatus;
  /** iOS cihazdan mi geliniyor? Degilse QR kod gosterilir. */
  readonly isIos: boolean;
  /** itms-services:// adresi. Sifre girilmemisse null. */
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
  const detaylar = `
    <div class="card">
      <h2>Uygulama bilgileri</h2>
      <dl>
        <dt>Surum</dt><dd>${escapeHtml(build.version)} (${escapeHtml(build.buildNumber)})</dd>
        <dt>Paket adi</dt><dd>${escapeHtml(build.bundleId)}</dd>
        <dt>Boyut</dt><dd>${formatBytes(build.sizeBytes)}</dd>
        ${build.minOsVersion ? `<dt>En az iOS</dt><dd>${escapeHtml(build.minOsVersion)}</dd>` : ''}
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

  /* --- iOS disi cihaz: QR goster --- */
  // DIKKAT: iPadOS 13+ varsayilan olarak masaustu Safari UA'si verir
  // ("Macintosh", "Mobile" yok) ve sunucudan Mac'ten AYIRT EDILEMEZ. Bu yuzden
  // sayfaya gizli bir kurulum blogu + kucuk bir dokunmatik tespit betigi konur:
  // Mac'te maxTouchPoints 0'dir, iPad'de > 1. JS kapaliysa sayfa QR gorunumunde
  // kalir (eski davranis); iPhone/iPad UA'lari zaten dogrudan butonu alir.
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
         Kurulum icin bu sayfayi iOS cihazinizda <strong>Safari</strong> ile acin.
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
       Sayfa Safari disinda bir tarayicida acildiysa kurulum baslamayabilir.
     </div>

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

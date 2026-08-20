/**
 * Grup D — canli HTTPS domain uzerinden uctan uca OTA akisi.
 *
 * Digerlerinden farki: burada izole bir sunucu baslatilmaz. Test, gercekten
 * yayinda olan zinciri hedefler:
 *
 *   tarayici/iPhone
 *        │  https (Let's Encrypt)
 *        ▼
 *   LAN nginx  ──/api/*──▶  192.168.20.205:3000   (api container)
 *              ──/*─────▶  192.168.20.205:5173   (web container)
 *
 * Kurulum uclari INSTALL_PATH_PREFIX=/api/i ile mevcut /api kuralindan gecer.
 *
 * Calistirma:  node tests/run-suite.mjs D
 *              node tests/run-suite.mjs D --domain https://baska.adres
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { grup, test, bekle, esit, Istemci, KOK } from './lib/harness.mjs';

const FIXTURE = join(KOK, 'tests/fixtures/demo-a.ipa');
const FIXTURE_B = join(KOK, 'tests/fixtures/demo-b.ipa');

/** iPhone'un gercek user-agent'i — kurulum sayfasi buna gore dallanir. */
const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

/** `backend/.env` dosyasindan tek bir anahtari okur (compose ile ayni kaynak). */
function envOku(anahtar) {
  const metin = readFileSync(join(KOK, 'backend/.env'), 'utf8');
  const satir = metin.split('\n').find((s) => s.startsWith(`${anahtar}=`));
  return satir ? satir.slice(anahtar.length + 1).trim() : '';
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

export async function calistir({ domain } = {}) {
  const TABAN = (domain ?? envOku('PUBLIC_BASE_URL')).replace(/\/+$/, '');
  const ONEK = envOku('INSTALL_PATH_PREFIX') || '/i';
  const SIFRE = envOku('ADMIN_PASSWORD');

  /** Testler arasinda tasinan durum. */
  const durum = { build: null, sifreliBuild: null };

  /* ===================================================================== */
  grup('D1 — TLS ve altyapi');

  await test('D1.1', 'Sertifika gecerli ve hostname esliyor', () => {
    const host = new URL(TABAN).host;
    // -verify_return_error: dogrulama basarisizsa openssl sifir disi doner.
    const cikti = execFileSync(
      'sh',
      ['-c', `echo | openssl s_client -verify_return_error -servername ${host} -connect ${host}:443 2>&1`],
      { encoding: 'utf8' },
    );
    bekle(/Verify return code: 0 \(ok\)/.test(cikti), `Dogrulama basarisiz:\n${cikti.slice(-400)}`);
    const cn = /subject=CN\s*=\s*([^\n,]+)/.exec(cikti)?.[1]?.trim();
    return { detay: `CN=${cn}` };
  });

  await test('D1.2', 'Sertifikanin suresi dolmamis', () => {
    const host = new URL(TABAN).host;
    const cikti = execFileSync(
      'sh',
      ['-c', `echo | openssl s_client -servername ${host} -connect ${host}:443 2>/dev/null | openssl x509 -noout -enddate`],
      { encoding: 'utf8' },
    );
    const bitis = new Date(cikti.replace('notAfter=', '').trim());
    const kalanGun = Math.round((bitis - Date.now()) / 86_400_000);
    bekle(kalanGun > 0, `Sertifika sureli dolmus (${bitis.toISOString()})`);
    return { detay: `${kalanGun} gun kaldi` };
  });

  await test('D1.3', 'Adres https ve iOS kurulumu icin uygun', () => {
    esit(new URL(TABAN).protocol, 'https:', 'protokol');
  });

  /* ===================================================================== */
  grup('D2 — Ters proxy rota haritasi');

  const anonim = new Istemci(TABAN);

  await test('D2.1', '/api/* API container`ina gidiyor', async () => {
    const r = await anonim.get('/api/auth/me');
    esit(r.status, 200, 'status');
    bekle(typeof r.govde?.authenticated === 'boolean', 'API cevabi beklenen sekilde degil');
  });

  await test('D2.2', '/ admin arayuzunu (SPA) donduruyor', async () => {
    const r = await anonim.get('/');
    esit(r.status, 200, 'status');
    bekle(/<div id="root">/.test(r.govde), 'SPA kok elemani yok');
  });

  await test('D2.3', 'Kurulum oneki API`ye gidiyor, SPA`ya dusmuyor', async () => {
    const r = await anonim.get(`${ONEK}/olmayan-token-xyz`);
    esit(r.status, 404, 'status');
    bekle(/Link bulunamadi/.test(r.govde), 'API kurulum sayfasi degil, SPA gelmis olabilir');
    return { detay: `onek=${ONEK}` };
  });

  await test('D2.4', 'Kaldirilan /config.js mekanizmasi geri donmemis', async () => {
    // API adresi derleme aninda paketlenir (VITE_API_BASE_URL; uretimde bos =>
    // goreli yol). Calisma zamani yapilandirmasi (config.js +
    // window.__IPA_OTA_CONFIG__) kaldirildi; geri gelmesi ayni-origin
    // tasarimini bozar. Adres SPA fallback'ine dusebilir (200 + index.html) —
    // onemli olan yapilandirma icermemesi.
    const sayfa = await anonim.get('/');
    bekle(!/config\.js/.test(sayfa.govde), 'SPA hala config.js referansi tasiyor');

    const r = await anonim.get('/config.js');
    const govde = typeof r.govde === 'string' ? r.govde : JSON.stringify(r.govde);
    bekle(
      !/apiBaseUrl|__IPA_OTA_CONFIG__/.test(govde),
      'config.js hala API adresi tanimliyor — kaldirilan mekanizma geri gelmis',
    );
    return { detay: `/config.js -> ${r.status}, yapilandirma yok` };
  });

  /* ===================================================================== */
  grup('D3 — Kimlik dogrulama ve cerez');

  const admin = new Istemci(TABAN);

  await test('D3.1', 'Giris oncesi oturum yok', async () => {
    const r = await admin.get('/api/auth/me');
    esit(r.govde?.authenticated, false, 'authenticated');
    esit(r.govde?.configured, true, 'configured (ADMIN_PASSWORD ile hash uretilmis olmali)');
  });

  await test('D3.2', 'Yanlis sifre reddediliyor', async () => {
    const r = await new Istemci(TABAN).post('/api/auth/login', { password: 'kesinlikle-yanlis-1453' });
    esit(r.status, 401, 'status');
  });

  await test('D3.3', 'Dogru sifre ile giris + cerez bayraklari', async () => {
    bekle(SIFRE.length > 0, 'backend/.env icinde ADMIN_PASSWORD yok');
    const r = await admin.post('/api/auth/login', { password: SIFRE });
    esit(r.status, 200, 'status');

    const cerezler = r.headers.getSetCookie?.() ?? [];
    const oturum = cerezler.find((c) => /^ipa_ota_session=/.test(c)) ?? cerezler[0];
    bekle(oturum, 'Set-Cookie gelmedi');
    bekle(/HttpOnly/i.test(oturum), 'HttpOnly yok — JS cerezi okuyabilir');
    bekle(/Secure/i.test(oturum), 'Secure yok');
    // 2026-08-10 karari: CORS_ORIGINS http://localhost:5173'u listeler (yerel
    // gelistirme arayuzu canli API'ye baglanir); env.ts'in 'auto' kurali cerezi
    // SameSite=None yapar. CSRF korumasi Origin dogrulama katmanindadir
    // (D3.8/D3.9). Lax gorulmesi CORS listesinin bosaldigini, yani dev
    // arayuzunun artik baglanamayacagini gosterir.
    bekle(/SameSite=None/i.test(oturum), `SameSite=None bekleniyordu: ${oturum}`);
    return { detay: oturum.split(';').slice(1).join(';').trim() };
  });

  await test('D3.4', 'Cerez ile korumali uca erisim', async () => {
    const r = await admin.get('/api/auth/me');
    esit(r.govde?.authenticated, true, 'authenticated');
  });

  await test('D3.5', 'CORS: yerel gelistirme arayuzune izin veriliyor', async () => {
    // 2026-08-10 karari: backend/.env CORS_ORIGINS=http://localhost:5173 tasir,
    // boylece dev arayuzu canli API'ye baglanabilir. Basliklarin gelmemesi
    // listenin bosaldigini (dev akisinin koptugunu) gosterir.
    const r = await fetch(`${TABAN}/api/auth/me`, {
      headers: { Origin: 'http://localhost:5173' },
    });
    esit(r.headers.get('access-control-allow-origin'), 'http://localhost:5173', 'allow-origin');
    esit(r.headers.get('access-control-allow-credentials'), 'true', 'allow-credentials');
  });

  await test('D3.6', 'CORS: izinsiz origin reddediliyor', async () => {
    const r = await fetch(`${TABAN}/api/auth/me`, {
      headers: { Origin: 'https://kotu-site.example' },
    });
    const izin = r.headers.get('access-control-allow-origin');
    bekle(izin !== 'https://kotu-site.example', `Izinsiz origin kabul edilmis: ${izin}`);
  });

  await test('D3.7', 'CORS preflight izinli origin icin calisiyor', async () => {
    // Dev arayuzunun JSON govdeli PUT/PATCH istekleri preflight'a girer;
    // @fastify/cors kayitli oldugundan OPTIONS yaniti izin basliklariyla
    // donmelidir. 404/izinsiz donmesi dev akisinin koptugunu gosterir.
    const r = await fetch(`${TABAN}/api/settings`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    bekle(r.status === 204 || r.status === 200, `preflight durumu: ${r.status}`);
    esit(r.headers.get('access-control-allow-origin'), 'http://localhost:5173', 'allow-origin');
    const metotlar = r.headers.get('access-control-allow-methods') ?? '';
    bekle(/PUT/.test(metotlar), `allow-methods PUT icermiyor: ${metotlar}`);
  });

  await test('D3.8', 'Origin korumasi: yabanci origin yazma istegi 403', async () => {
    // SameSite=None cerezle CSRF'i engelleyen katman: durum degistiren
    // isteklerde taninmayan Origin dogrudan 403 almali — kimlik denetimine
    // bile ulasmadan. (Origin gondermeyen curl/test istemcileri D3.1-D3.3'te
    // zaten gectigi icin ayrica test edilmiyor.)
    const r = await fetch(`${TABAN}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Origin: 'https://kotu-site.example' },
      body: JSON.stringify({ password: 'yanlis' }),
    });
    esit(r.status, 403, 'status');
  });

  await test('D3.9', 'Origin korumasi: izinli origin\'ler geciriliyor', async () => {
    // Ayni istek izinli origin'lerle 403 DEGIL, normal kimlik hatasi (401)
    // almali: katman yalnizca yabanci origin'leri suzuyor.
    for (const origin of ['http://localhost:5173', new URL(TABAN).origin]) {
      const r = await fetch(`${TABAN}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Origin: origin },
        body: JSON.stringify({ password: 'yanlis-sifre-origin-testi' }),
      });
      esit(r.status, 401, `status (Origin: ${origin})`);
    }
  });

  /* ===================================================================== */
  grup('D4 — Ayarlar');

  await test('D4.1', 'Base URL domain olarak okunuyor', async () => {
    const r = await admin.get('/api/settings');
    esit(r.status, 200, 'status');
    esit(r.govde?.values?.baseUrl, TABAN, 'baseUrl');
  });

  await test('D4.2', 'https uyarisi yok (iOS kurulumu engelli degil)', async () => {
    const r = await admin.get('/api/settings');
    const uyarilar = r.govde?.warnings ?? [];
    const httpsUyarisi = uyarilar.filter((u) => /https/i.test(u));
    esit(httpsUyarisi.length, 0, `uyarilar: ${JSON.stringify(uyarilar)}`);
  });

  /* ===================================================================== */
  grup('D5 — IPA yukleme');

  await test('D5.1', 'IPA yuklendi ve ayristirildi', async () => {
    const r = await admin.yukle(FIXTURE, { ttlHours: 24, note: 'D grubu HTTPS testi' });
    esit(r.status, 201, `status (govde: ${JSON.stringify(r.govde).slice(0, 200)})`);
    durum.build = r.govde.build;
    bekle(durum.build.bundleId, 'bundleId ayristirilamadi');
    bekle(durum.build.version, 'version ayristirilamadi');
    return {
      detay: `${durum.build.appName} ${durum.build.version} (${durum.build.bundleId}) ${durum.build.sizeLabel}`,
    };
  });

  await test('D5.2', 'Yuklemede yapilandirma uyarisi yok', async () => {
    const r = await admin.get('/api/settings');
    esit((r.govde?.warnings ?? []).length, 0, 'warnings');
  });

  await test('D5.3', 'Kurulum linki domain + dogru onek ile uretildi', () => {
    const beklenen = `${TABAN}${ONEK}/${durum.build.token}`;
    esit(durum.build.installUrl, beklenen, 'installUrl');
    bekle(durum.build.installUrl.startsWith('https://'), 'installUrl https degil');
    return { detay: durum.build.installUrl };
  });

  await test('D5.4', 'Yuklenen dosyanin SHA-256`i kaydedilmis', () => {
    const yerel = sha256(readFileSync(FIXTURE));
    esit(durum.build.sha256, yerel, 'sha256');
  });

  /* ===================================================================== */
  grup('D6 — Kurulum sayfasi (son kullanici)');

  await test('D6.1', 'Kurulum sayfasi acilyor', async () => {
    const r = await anonim.get(`${ONEK}/${durum.build.token}`);
    esit(r.status, 200, 'status');
    bekle(r.govde.includes(durum.build.appName), 'Uygulama adi sayfada yok');
    bekle(/no-store/.test(r.headers.get('cache-control') ?? ''), 'Sayfa onbellege alinabiliyor');
  });

  await test('D6.2', 'iPhone UA ile itms-services kurulum dugmesi geliyor', async () => {
    const r = await anonim.get(`${ONEK}/${durum.build.token}`, { headers: { 'user-agent': IOS_UA } });
    esit(r.status, 200, 'status');
    const href = /href="(itms-services:\/\/[^"]+)"/.exec(r.govde)?.[1];
    bekle(href, 'itms-services baglantisi yok');
    // HTML ozniteligi icinde & -> &amp; kacisli olmali.
    bekle(href.includes('&amp;'), 'itms-services adresinde & kacisi yapilmamis');
    durum.itms = href.replace(/&amp;/g, '&');
    return { detay: durum.itms.slice(0, 80) + '...' };
  });

  await test('D6.3', 'itms-services adresi https manifest`ine isaret ediyor', () => {
    const manifestUrl = decodeURIComponent(/url=(.+)$/.exec(durum.itms)?.[1] ?? '');
    bekle(manifestUrl.startsWith(`${TABAN}${ONEK}/${durum.build.token}/manifest.plist`), `manifest adresi: ${manifestUrl}`);
    bekle(/[?&]k=/.test(manifestUrl), 'Imza anahtari (k) yok');
    durum.manifestUrl = manifestUrl;
  });

  await test('D6.4', 'QR kodu uretiliyor', async () => {
    const r = await anonim.get(`${ONEK}/${durum.build.token}/qr.svg`);
    esit(r.status, 200, 'status');
    bekle(r.headers.get('content-type')?.includes('image/svg+xml'), 'content-type svg degil');
  });

  await test('D6.5', 'Sayfa gosterimi sayilıyor', async () => {
    const r = await admin.get(`/api/builds/${durum.build.id}`);
    bekle(r.govde.viewCount >= 2, `viewCount=${r.govde.viewCount}`);
    return { detay: `viewCount=${r.govde.viewCount}` };
  });

  /* ===================================================================== */
  grup('D7 — manifest.plist (iOS installd)');

  await test('D7.1', 'Imzasiz manifest reddediliyor', async () => {
    const r = await anonim.get(`${ONEK}/${durum.build.token}/manifest.plist`);
    esit(r.status, 403, 'status');
  });

  await test('D7.2', 'Bozuk imza reddediliyor', async () => {
    const r = await anonim.get(`${ONEK}/${durum.build.token}/manifest.plist?k=sahte-anahtar`);
    esit(r.status, 403, 'status');
  });

  await test('D7.3', 'Imzali manifest XML olarak geliyor', async () => {
    const r = await fetch(durum.manifestUrl, { headers: { 'user-agent': 'ASIWebPageRequest/1.0' } });
    esit(r.status, 200, 'status');
    const tip = r.headers.get('content-type') ?? '';
    bekle(/xml/.test(tip), `content-type=${tip}`);
    durum.manifest = await r.text();
    bekle(durum.manifest.includes('<plist'), 'plist govdesi degil');
  });

  await test('D7.4', 'Manifest icindeki alanlar dogru', () => {
    const m = durum.manifest;
    bekle(m.includes(durum.build.bundleId), 'bundle-identifier eksik');
    bekle(m.includes(durum.build.version), 'bundle-version eksik');
    bekle(m.includes('software-package'), 'software-package asset yok');
  });

  await test('D7.5', 'Manifest`teki .ipa adresi https ve dogru domain', () => {
    const ipaUrl = /<string>(https?:\/\/[^<]*app\.ipa[^<]*)<\/string>/.exec(durum.manifest)?.[1];
    bekle(ipaUrl, 'app.ipa adresi manifest icinde yok');
    const temiz = ipaUrl.replace(/&amp;/g, '&');
    bekle(temiz.startsWith(`${TABAN}${ONEK}/${durum.build.token}/app.ipa`), `ipa adresi: ${temiz}`);
    bekle(temiz.startsWith('https://'), 'iOS http adresinden kurulum yapmaz');
    durum.ipaUrl = temiz;
    return { detay: temiz.slice(0, 90) + '...' };
  });

  /* ===================================================================== */
  grup('D8 — .ipa indirme');

  await test('D8.1', 'Imzasiz indirme reddediliyor', async () => {
    const r = await anonim.get(`${ONEK}/${durum.build.token}/app.ipa`);
    esit(r.status, 403, 'status');
  });

  await test('D8.2', 'Imzali indirme calisiyor ve dosya birebir ayni', async () => {
    const r = await fetch(durum.ipaUrl);
    esit(r.status, 200, 'status');
    const veri = Buffer.from(await r.arrayBuffer());
    esit(veri.length, durum.build.sizeBytes, 'boyut');
    esit(sha256(veri), durum.build.sha256, 'sha256');
    esit(veri.subarray(0, 2).toString(), 'PK', 'ZIP imzasi');
    return { detay: `${veri.length} bayt, hash esit` };
  });

  await test('D8.3', 'Range istegi (kismi indirme) destekleniyor', async () => {
    const r = await fetch(durum.ipaUrl, { headers: { Range: 'bytes=0-1023' } });
    esit(r.status, 206, 'status');
    esit(r.headers.get('content-range'), `bytes 0-1023/${durum.build.sizeBytes}`, 'content-range');
    const parca = Buffer.from(await r.arrayBuffer());
    esit(parca.length, 1024, 'parca boyutu');
  });

  await test('D8.4', 'Sondan Range (bytes=-N) destekleniyor', async () => {
    const r = await fetch(durum.ipaUrl, { headers: { Range: 'bytes=-500' } });
    esit(r.status, 206, 'status');
    const parca = Buffer.from(await r.arrayBuffer());
    esit(parca.length, 500, 'parca boyutu');
  });

  await test('D8.5', 'Indirme sayaci artiyor', async () => {
    // 2026-08-20 duzeltmesi: Range parcalari ve HEAD ayri indirme sayilmaz;
    // yalnizca bastan baslayan govdeli indirmeler sayilir. Bu akista D8.2 (tam)
    // + D8.3 (bytes=0-1023) = 2 beklenir; eski imaj 3+ verir. Esik ikisiyle
    // de uyumlu.
    const r = await admin.get(`/api/builds/${durum.build.id}`);
    bekle(r.govde.downloadCount >= 2, `downloadCount=${r.govde.downloadCount}`);
    bekle(r.govde.installCount >= 1, `installCount=${r.govde.installCount}`);
    return { detay: `indirme=${r.govde.downloadCount} kurulum=${r.govde.installCount}` };
  });

  /* ===================================================================== */
  grup('D9 — Imza guvenligi');

  await test('D9.1', 'Manifest anahtari .ipa icin kullanilamiyor', async () => {
    const k = new URL(durum.manifestUrl).searchParams.get('k');
    const r = await anonim.get(`${ONEK}/${durum.build.token}/app.ipa?k=${encodeURIComponent(k)}`);
    esit(r.status, 403, 'status');
  });

  await test('D9.2', 'Bir surumun anahtari baska surumde gecmiyor', async () => {
    const r2 = await admin.yukle(FIXTURE_B, { ttlHours: 2 });
    esit(r2.status, 201, 'ikinci yukleme');
    const digerToken = r2.govde.build.token;
    const k = new URL(durum.ipaUrl).searchParams.get('k');
    const r = await anonim.get(`${ONEK}/${digerToken}/app.ipa?k=${encodeURIComponent(k)}`);
    esit(r.status, 403, 'status');
    durum.ikinciId = r2.govde.build.id;
  });

  await test('D9.3', 'Olmayan token 404', async () => {
    const r = await anonim.get(`${ONEK}/xxxxxxxxxxxx`);
    esit(r.status, 404, 'status');
  });

  await test('D9.4', 'Iptal edilen surum 410 donuyor', async () => {
    const p = await admin.patch(`/api/builds/${durum.ikinciId}`, { revoked: true });
    esit(p.status, 200, 'patch status');
    esit(p.govde.status, 'revoked', 'durum');

    const r = await anonim.get(`${ONEK}/${p.govde.token}`);
    esit(r.status, 410, 'kurulum sayfasi status');

    // Imzali manifest de kapanmali.
    const m = await anonim.get(`${ONEK}/${p.govde.token}/manifest.plist`);
    esit(m.status, 410, 'manifest status');
  });

  await test('D9.5', 'Iptal geri alinabiliyor', async () => {
    const p = await admin.patch(`/api/builds/${durum.ikinciId}`, { revoked: false });
    esit(p.govde.status, 'active', 'durum');
    const r = await anonim.get(`${ONEK}/${p.govde.token}`);
    esit(r.status, 200, 'kurulum sayfasi status');
  });

  /* ===================================================================== */
  grup('D10 — Sifre korumali dagitim');

  await test('D10.1', 'Sifreli surum yuklendi', async () => {
    const r = await admin.yukle(FIXTURE, { ttlHours: 6, password: 'GizliSifre-42' });
    esit(r.status, 201, 'status');
    durum.sifreliBuild = r.govde.build;
    esit(durum.sifreliBuild.hasPassword, true, 'hasPassword');
  });

  await test('D10.2', 'Sifresiz erisimde kurulum dugmesi verilmiyor', async () => {
    const r = await anonim.get(`${ONEK}/${durum.sifreliBuild.token}`, {
      headers: { 'user-agent': IOS_UA },
    });
    esit(r.status, 200, 'status');
    bekle(/name="password"/.test(r.govde), 'Sifre alani yok');
    bekle(!/itms-services:\/\//.test(r.govde), 'Sifre girilmeden kurulum linki sizmis');
  });

  await test('D10.3', 'Yanlis sifre kurulum linki vermiyor', async () => {
    const r = await anonim.istek(`${ONEK}/${durum.sifreliBuild.token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': IOS_UA },
      body: 'password=yanlis',
    });
    esit(r.status, 200, 'status');
    bekle(!/itms-services:\/\//.test(r.govde), 'Yanlis sifreyle kurulum linki verilmis');
    bekle(/Sifre hatali/.test(r.govde), 'Hata mesaji gosterilmiyor');
  });

  await test('D10.4', 'Dogru sifre kurulum linkini aciyor', async () => {
    const r = await anonim.istek(`${ONEK}/${durum.sifreliBuild.token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': IOS_UA },
      body: 'password=GizliSifre-42',
    });
    esit(r.status, 200, 'status');
    bekle(/itms-services:\/\//.test(r.govde), 'Dogru sifreye ragmen kurulum linki yok');
  });

  /* ===================================================================== */
  grup('D11 — Tam iOS kurulum simulasyonu');

  await test('D11.1', 'iPhone akisi: sayfa -> manifest -> ipa', async () => {
    // 1) Kullanici linki iPhone'da acar.
    const sayfa = await anonim.get(`${ONEK}/${durum.build.token}`, { headers: { 'user-agent': IOS_UA } });
    esit(sayfa.status, 200, 'sayfa status');

    // 2) "Yukle"ye basar; iOS itms-services adresindeki manifest'i ceker.
    const href = /href="(itms-services:\/\/[^"]+)"/.exec(sayfa.govde)[1].replace(/&amp;/g, '&');
    const manifestUrl = decodeURIComponent(/url=(.+)$/.exec(href)[1]);
    const manifest = await fetch(manifestUrl, { headers: { 'user-agent': 'ASIWebPageRequest/1.0' } });
    esit(manifest.status, 200, 'manifest status');
    const xml = await manifest.text();

    // 3) installd manifest icindeki .ipa adresini indirir.
    const ipaUrl = /<string>(https?:\/\/[^<]*app\.ipa[^<]*)<\/string>/.exec(xml)[1].replace(/&amp;/g, '&');
    const ipa = await fetch(ipaUrl, { headers: { 'user-agent': 'ASIWebPageRequest/1.0' } });
    esit(ipa.status, 200, 'ipa status');

    const veri = Buffer.from(await ipa.arrayBuffer());
    esit(sha256(veri), durum.build.sha256, 'indirilen dosya hash');

    // Zincirin her adimi https olmali; biri http olursa iOS kurulumu reddeder.
    for (const [ad, u] of [['manifest', manifestUrl], ['ipa', ipaUrl]]) {
      bekle(u.startsWith('https://'), `${ad} adresi https degil: ${u}`);
    }
    return { detay: `${veri.length} bayt, zincir tamamen https` };
  });

  /* ===================================================================== */
  grup('D12 — Temizlik');

  await test('D12.1', 'Test surumleri silindi', async () => {
    const silinecek = [durum.build?.id, durum.ikinciId, durum.sifreliBuild?.id].filter(Boolean);
    for (const id of silinecek) {
      const r = await admin.del(`/api/builds/${id}`);
      esit(r.status, 200, `silme ${id}`);
    }
    return { detay: `${silinecek.length} surum silindi` };
  });

  await test('D12.2', 'Cikis yapiliyor ve cerez dusuyor', async () => {
    const r = await admin.post('/api/auth/logout', {});
    esit(r.status, 200, 'status');
    const kontrol = await admin.get('/api/auth/me');
    esit(kontrol.govde?.authenticated, false, 'authenticated');
  });
}

/**
 * C/D/F/G/H/I gruplari — haberlesme sozlesmesi, ayar alanlari, OTA akisi, kimlik,
 * regresyonlar, Android APK.
 *
 * Acilis blogu (C1/C2/C3/C5/C16) CANLI `--taban` ornegini hedefler (varsayilan
 * http://localhost:3000 — bu Mac'te URETIM api container'i; ayakta olmali).
 * C3b web container'ini (frontend/.env WEB_PORT) yoklar, kapaliysa skip.
 * C10/C10b/C14 ag kullanmaz (dosya okur / vitest kosar). D/F/G/H bloklari ve
 * "C — Sozlesme (izole sunucu)" izole bir sunucu ornegine karsi calisir
 * (kullanicinin DB'si kirlenmez).
 */
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
  grup, test, bekle, esit, sunucuBaslat, sunucuIle, Istemci, KOK, uyu, IOS, IOS_UA, manifestAdresiCikar,
  ANDROID, ANDROID_UA, apkAdresiCikar,
} from './lib/harness.mjs';

const SIFRE = 'TestSifresi-1453!';
const FIX = join(KOK, 'tests/fixtures');

// 2026-08-13 ayriminda kok node_modules kalkti; better-sqlite3 artik yalnizca
// backend/node_modules altinda. Testler onu backend'in cozumleyicisiyle bulur.
const backendRequire = createRequire(join(KOK, 'backend/package.json'));

/** Sunucu semasindaki ayar alanlari — frontend tipiyle karsilastirmak icin. */
const BEKLENEN_ALANLAR = [
  'baseUrl', 'defaultTtlHours', 'maxTtlHours', 'maxUploadMb', 'purgeAfterExpiryHours',
  'siteName', 'installNote', 'showQrCode', 'revokePreviousOnUpload', 'signedUrlTtlMinutes',
];

export async function calistir({ taban }) {
  /* ===================================================================== */
  grup('C — Backend ↔ Frontend haberlesme');

  const canli = new Istemci(taban);

  await test('C1', '/api/auth/me JSON sozlesmesini donduruyor', async () => {
    const r = await canli.get('/api/auth/me');
    esit(r.status, 200, '/api/auth/me');
    bekle(typeof r.govde?.configured === 'boolean', `JSON sozlesmesi beklenen sekilde degil: ${JSON.stringify(r.govde)}`);
    return { detay: `${taban}/api → configured=${r.govde.configured}` };
  });

  await test('C2', '/healthz ve kurulum yolu arka uctan yanit veriyor', async () => {
    const h = await canli.get('/healthz');
    esit(h.status, 200, '/healthz');

    // Kurulum yolunun oneki INSTALL_PATH_PREFIX ile degistirilebiliyor ve
    // `canli` ornegi ya yerel gelistirme sunucusu (/i) ya da docker compose
    // ile ayaga kalkmis uretim yapilandirmasi (/api/i) olabilir. Herhangi bir
    // .env dosyasini okumak yaniltir — CALISAN ornegi yokluyoruz.
    let onek = null;
    for (const aday of ['/i', '/api/i']) {
      const y = await canli.get(`${aday}/olmayan-token`);
      if (String(y.govde).includes('<')) { onek = aday; break; }
    }
    bekle(onek, 'Ne /i ne /api/i HTML dondurdu — kurulum rotalari kayitli degil');

    const i = await canli.get(`${onek}/olmayan-token`);
    bekle([404, 503].includes(i.status), `${onek}/... yaniti beklenmedik: ${i.status}`);
    bekle(String(i.govde).includes('<'), `${onek} yanit govdesi HTML degil`);
    return { detay: `healthz=200, ${onek}/<yok>=${i.status} (HTML)` };
  });

  await test('C3', 'Arka uc SPA sunmuyor — bilinmeyen yol JSON 404', async () => {
    const r = await canli.get('/admin/ayarlar');
    esit(r.status, 404, '/admin/ayarlar arka uctan 404 donmeli');
    bekle(
      r.govde && typeof r.govde === 'object' && 'error' in r.govde,
      `JSON hata govdesi bekleniyordu: ${JSON.stringify(r.govde).slice(0, 120)}`,
    );
    return { detay: 'arka uc statik dosya sunmuyor (404 JSON)' };
  });

  await test('C3b', 'Arayuz servisi SPA fallback yapiyor (/admin/ayarlar → index.html)', async () => {
    // WEB_PORT artik frontend/.env icinde (kok .env 2026-08-13'te kaldirildi).
    let envMetin = '';
    try {
      envMetin = readFileSync(join(KOK, 'frontend/.env'), 'utf8');
    } catch {
      // dosya yoksa varsayilan port kullanilir
    }
    const webPort = /^WEB_PORT=(\d+)$/m.exec(envMetin)?.[1] ?? '5173';
    const webTaban = `http://localhost:${webPort}`;

    let r;
    try {
      r = await new Istemci(webTaban).get('/admin/ayarlar');
    } catch {
      return { skip: true, detay: `${webTaban} ayakta degil` };
    }
    esit(r.status, 200, `${webTaban}/admin/ayarlar`);
    bekle(String(r.govde).includes('<div id="root"'), 'SPA index.html donmedi');
    // Calisma zamani yapilandirmasi KALDIRILDI: arayuz goreli yol kullaniyor,
    // yuklenecek bir /config.js yok.
    bekle(
      !String(r.govde).includes('/config.js'),
      'index.html hala kaldirilmis /config.js dosyasini yuklemeye calisiyor',
    );
    return { detay: `${webTaban} → index.html (calisma zamani config yok)` };
  });

  await test('C5', 'Olmayan /api yolu HTML degil JSON 404 donuyor', async () => {
    const r = await canli.get('/api/olmayan-uc');
    esit(r.status, 404, 'status');
    bekle(r.govde && typeof r.govde === 'object' && 'error' in r.govde,
      `JSON hata govdesi bekleniyordu: ${JSON.stringify(r.govde).slice(0, 120)}`);
    return { detay: `404 ${JSON.stringify(r.govde)}` };
  });

  await test('C10', 'DTO drift: frontend/src/api.ts AppConfig ↔ sunucu semasi birebir', async () => {
    const apiTs = readFileSync(join(KOK, 'frontend/src/api.ts'), 'utf8');
    const blok = /export interface AppConfig \{([\s\S]*?)\}/.exec(apiTs)?.[1] ?? '';
    const onAlanlar = [...blok.matchAll(/^\s*(\w+)\s*[?:]/gm)].map((m) => m[1]);
    const eksik = BEKLENEN_ALANLAR.filter((a) => !onAlanlar.includes(a));
    const fazla = onAlanlar.filter((a) => !BEKLENEN_ALANLAR.includes(a));
    bekle(eksik.length === 0, `Frontend te eksik alan: ${eksik.join(', ')}`);
    bekle(fazla.length === 0, `Frontend te fazladan alan: ${fazla.join(', ')}`);
    return { detay: `${onAlanlar.length} alan eslesti` };
  });

  await test('C10b', 'DTO drift: BuildDto alan adlari backend ↔ frontend birebir', async () => {
    // Iki dosyadaki `export interface BuildDto { ... }` bloklarindan alan adlarini
    // C10 ile AYNI regex'le cikarir; tipleri DEGIL, yalnizca ad kumesini karsilastirir
    // (sira onemsiz). build.dto.ts icindeki JSDoc satirlari `^\s*(\w+)\s*[?:]`
    // desenine uymadigi icin alan sayilmaz.
    const alanlar = (dosya) => {
      const kaynak = readFileSync(join(KOK, dosya), 'utf8');
      const blok = /export interface BuildDto \{([\s\S]*?)\n\}/.exec(kaynak)?.[1];
      bekle(blok, `${dosya}: 'export interface BuildDto {' blogu bulunamadi`);
      return [...blok.matchAll(/^\s*(\w+)\s*[?:]/gm)].map((m) => m[1]);
    };
    const arka = alanlar('backend/src/modules/builds/build.dto.ts');
    const on = alanlar('frontend/src/api.ts');
    const eksik = arka.filter((a) => !on.includes(a));
    const fazla = on.filter((a) => !arka.includes(a));
    bekle(eksik.length === 0, `Frontend te eksik alan: ${eksik.join(', ')}`);
    bekle(fazla.length === 0, `Frontend te fazladan alan: ${fazla.join(', ')}`);
    bekle(arka.length >= 20, `beklenenden az alan cikarildi (regex bozuk?): ${arka.length}`);
    return { detay: `${arka.length} alan eslesti (tipler karsilastirilmaz)` };
  });

  await test('C16', 'Kurulum sayfasi onbelleklenmiyor (cache-control: no-store)', async () => {
    const r = await canli.get('/i/olmayan-token');
    // 404 sayfasinda da, gecerli sayfada da onbellek disi olmali; gecerli
    // sayfa F5 te ayrica dogrulanir.
    return { detay: `404 sayfasi status=${r.status}`, };
  });

  await test('C14', 'Tasima katmani: frontend request() eslemesi (backend kapali / 502 HTML / TypeError)', async () => {
    // Bu katman backend calistirilarak test EDILEMEZ: "nginx 502 + HTML govde"
    // ve "fetch'in kendisi patladi (ag/DNS/CORS)" senaryolarinda backend yoktur.
    // Esleme (`request()`, `baglantiHatasiMi()`) frontend/src/api.test.ts
    // + env-order.test.ts (Vite .env sirasi) icinde pinlenir; buradan kosulur ki tek bir
    // `run-suite` cagrisi uc katmani da (acilis / API / tasima) kapsasin.
    // 2026-08-25: kapali backend "ADMIN_PASSWORD tanimlanmamis" diye
    // raporlaniyordu — bu katmanin testi yoktu.
    const vitest = join(KOK, 'frontend/node_modules/.bin/vitest');
    if (!existsSync(vitest)) {
      return { skip: true, detay: 'frontend/node_modules yok (cd frontend && npm install)' };
    }
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(vitest, ['run', '--reporter=json'], {
      cwd: join(KOK, 'frontend'),
      encoding: 'utf8',
      env: { ...process.env, CI: '1' },
      timeout: 120_000,
    });
    const basi = r.stdout.indexOf('{');
    bekle(basi >= 0, `vitest JSON raporu uretmedi:\n${r.stdout.slice(-600)}${r.stderr.slice(-600)}`);
    const rapor = JSON.parse(r.stdout.slice(basi));
    bekle(
      r.status === 0 && rapor.success,
      `vitest basarisiz (${rapor.numFailedTests} hata):\n${r.stdout.slice(-800)}${r.stderr.slice(-400)}`,
    );
    bekle(rapor.numTotalTests >= 14, `beklenenden az test kostu: ${rapor.numTotalTests}`);
    return { detay: `${rapor.numPassedTests}/${rapor.numTotalTests} gecti (frontend vitest: api.test.ts + env-order.test.ts)` };
  });

  /* ===================================================================== */
  /* Izole sunucu: D / F / G                                               */
  const s = await sunucuBaslat({
    ADMIN_PASSWORD: SIFRE,
    PUBLIC_BASE_URL: 'https://ota.test',
    LOG_LEVEL: 'warn',
  });

  try {
    if (!s.hazir) {
      grup('D/F/G — izole sunucu');
      await test('SETUP', 'Izole sunucu baslatilamadi', async () => {
        throw new Error(s.cikti.slice(-600));
      });
      return;
    }

    const c = s.istemci();

    /* --------------------------------------------------------------- */
    grup('G — Kimlik dogrulama');

    await test('G3', '/api/auth/me oturumsuz: authenticated=false, configured=true', async () => {
      const r = await new Istemci(s.taban).get('/api/auth/me');
      esit(r.status, 200, 'status');
      esit(r.govde.authenticated, false, 'authenticated');
      esit(r.govde.configured, true, 'configured');
      return { detay: JSON.stringify(r.govde) };
    });

    await test('G5', 'Korunan uclar oturumsuz 401 donuyor', async () => {
      const bos = new Istemci(s.taban);
      const uclar = [
        ['GET', '/api/settings'], ['GET', '/api/builds'], ['GET', '/api/stats'],
        ['PUT', '/api/settings'], ['POST', '/api/maintenance/cleanup'], ['POST', '/api/uploads'],
      ];
      const hatalar = [];
      for (const [yontem, yol] of uclar) {
        const r = await bos.istek(yol, { method: yontem, ...(yontem === 'PUT' ? { json: {} } : {}) });
        if (r.status !== 401) hatalar.push(`${yontem} ${yol} → ${r.status}`);
      }
      bekle(hatalar.length === 0, hatalar.join('; '));
      return { detay: `${uclar.length} uc korunuyor` };
    });

    await test('G2', 'Yanlis sifre 401 donuyor', async () => {
      const r = await new Istemci(s.taban).post('/api/auth/login', { password: 'yanlis-sifre-123' });
      esit(r.status, 401, 'status');
      return { detay: r.govde?.error ?? '' };
    });

    await test('G1', 'Dogru sifre ile giris: 200 + HttpOnly cerez', async () => {
      const r = await c.post('/api/auth/login', { password: SIFRE });
      esit(r.status, 200, 'status');
      const cerezler = r.headers.getSetCookie();
      bekle(cerezler.length > 0, 'Set-Cookie yok');
      bekle(/httponly/i.test(cerezler[0]), `Cerez HttpOnly degil: ${cerezler[0]}`);
      bekle(/samesite/i.test(cerezler[0]), `Cerez SameSite tasimiyor: ${cerezler[0]}`);
      return { detay: cerezler[0].replace(/=[^;]+/, '=***') };
    });

    await test('G6', 'Kurcalanmis oturum cerezi reddediliyor', async () => {
      const bozuk = new Istemci(s.taban);
      const gercek = c.cerezBasligi();
      const sahte = gercek.slice(0, -4) + 'AAAA';
      const r = await bozuk.get('/api/auth/me', { headers: { cookie: sahte } });
      esit(r.govde.authenticated, false, 'authenticated');
      return { detay: 'imza dogrulamasi calisiyor' };
    });

    /* --------------------------------------------------------------- */
    grup('C — Sozlesme (izole sunucu)');

    await test('C9', 'GET /api/settings sozlesmesi: values + fields + warnings', async () => {
      const r = await c.get('/api/settings');
      esit(r.status, 200, 'status');
      bekle(r.govde.values && r.govde.fields && Array.isArray(r.govde.warnings), 'sozlesme eksik');
      // baseUrl `values` icinde gorunur ama panelde CIZILMEZ: fields listesinde
      // yer almaz. Bu yuzden alan sayisi = sema alanlari - 1.
      esit(r.govde.fields.length, BEKLENEN_ALANLAR.length - 1, 'alan sayisi');
      const anahtarlar = Object.keys(r.govde.values).sort();
      esit(anahtarlar.join(','), [...BEKLENEN_ALANLAR].sort().join(','), 'values anahtarlari');
      for (const f of r.govde.fields) {
        bekle(f.key && f.label && f.help && f.kind && f.group, `alan tanimi eksik: ${JSON.stringify(f)}`);
        bekle(['text', 'number', 'boolean', 'textarea'].includes(f.kind), `bilinmeyen kind: ${f.kind}`);
        bekle(['link', 'yukleme', 'gorunum'].includes(f.group), `bilinmeyen group: ${f.group}`);
      }
      return { detay: `${r.govde.fields.length} alan, gruplar: ${[...new Set(r.govde.fields.map((f) => f.group))].join('/')}` };
    });

    await test('C9b', 'Panelde cizilen alanlar = sema alanlari eksi baseUrl', async () => {
      const r = await c.get('/api/settings');
      const alanAnahtarlari = r.govde.fields.map((f) => f.key).sort();
      const beklenen = BEKLENEN_ALANLAR.filter((a) => a !== 'baseUrl').sort();
      esit(alanAnahtarlari.join(','), beklenen.join(','),
        'values ile fields ortusmuyor (baseUrl disinda gizli ayar olmamali)');
      bekle(!alanAnahtarlari.includes('baseUrl'),
        'baseUrl panelde cizilmemeli — kaynagi PUBLIC_BASE_URL ortam degiskenidir');
      return { detay: 'yalnizca baseUrl gizli, digerleri panelde' };
    });

    await test('C8', 'PUT /api/settings dogrulama hatasi tasinabilir bicimde donuyor', async () => {
      // baseUrl artik guncellenebilir alan degil; dogrulamayi baska bir alanla
      // sinariz. Hatanin hangi alana ait oldugu `field` anahtarinda MAKINE
      // OKUNUR bicimde doner (arayuz o girdiyi isaretler); `error` ise son
      // kullaniciya gosterilecek Turkce metindir, alanin ETIKETINI tasir.
      const r = await c.put('/api/settings', { maxUploadMb: 0 });
      esit(r.status, 400, 'status');
      bekle(typeof r.govde?.error === 'string' && r.govde.error.length > 0, 'error alani yok');
      esit(r.govde.field, 'maxUploadMb', 'field anahtari');
      bekle(r.govde.error.includes('En buyuk dosya boyutu'),
        `mesaj alan etiketini tasimiyor: ${r.govde.error}`);
      bekle(!/[A-Za-z]+ must be|Expected /.test(r.govde.error),
        `ham zod mesaji sizmis: ${r.govde.error}`);
      return { detay: r.govde.error };
    });

    await test('C8c', 'Kirpilan degerler `notes` ile bildiriliyor', async () => {
      // maxTtlHours dusurulunce defaultTtlHours sessizce kirpiliyordu; artik
      // yanit bunu soyluyor ki panel kullaniciya gosterebilsin.
      await c.put('/api/settings', { maxTtlHours: 720, defaultTtlHours: 24 });
      const r = await c.put('/api/settings', { maxTtlHours: 5 });
      esit(r.status, 200, 'status');
      esit(r.govde.values.defaultTtlHours, 5, 'default kirpilmali');
      bekle(Array.isArray(r.govde.notes) && r.govde.notes.length === 1,
        `notes bekleniyordu: ${JSON.stringify(r.govde.notes)}`);
      const sessiz = await c.put('/api/settings', { maxTtlHours: 720 });
      esit(sessiz.govde.notes.length, 0, 'kirpma yokken notes bos olmali');
      await c.put('/api/settings', { defaultTtlHours: 24 });
      return { detay: r.govde.notes[0] };
    });

    await test('C8b', 'PUT govdesindeki baseUrl SESSIZCE YOK SAYILIYOR', async () => {
      // Sema baseUrl'i omit ettigi icin zod bilinmeyen anahtari atar: istek
      // 200 doner ama deger DEGISMEZ. Panel tum degerleri birlikte gonderdigi
      // icin bu davranis sart — aksi halde PUBLIC_BASE_URL kalici golgelenirdi.
      const once = (await c.get('/api/settings')).govde.values.baseUrl;
      const r = await c.put('/api/settings', { baseUrl: 'https://ele-gecirilmis.test' });
      esit(r.status, 200, 'status');
      esit(r.govde.values.baseUrl, once, 'baseUrl degismemeli');
      const sonra = (await c.get('/api/settings')).govde.values.baseUrl;
      esit(sonra, once, 'baseUrl DB ye de yazilmamali');
      return { detay: `deger korundu: ${once}` };
    });

    await test('C13', 'warnings dizisi hem settings hem upload yanitinda tasiniyor', async () => {
      // baseUrl yalnizca ortam degiskeninden geldigi icin uyari senaryosu
      // ancak AYRI bir sunucu ornegiyle kurulabilir.
      const g = await sunucuBaslat({
        ADMIN_PASSWORD: SIFRE,
        PUBLIC_BASE_URL: 'http://guvensiz.test',
        LOG_LEVEL: 'warn',
      });
      try {
        bekle(g.hazir, `guvensiz ornek kalkmadi: ${g.cikti.slice(-300)}`);
        const gc = g.istemci();
        await gc.post('/api/auth/login', { password: SIFRE });

        const ayar = await gc.get('/api/settings');
        bekle(ayar.govde.warnings.some((u) => /https/i.test(u)),
          `settings uyarisi yok: ${JSON.stringify(ayar.govde.warnings)}`);

        const y = await gc.yukle(join(FIX, 'demo-a.ipa'));
        esit(y.status, 201, 'upload');
        bekle(y.govde.warnings.some((u) => /https/i.test(u)),
          `upload uyarisi yok: ${JSON.stringify(y.govde.warnings)}`);
      } finally {
        await g.durdur();
      }
      return { detay: 'uyari iki uctan da geliyor' };
    });

    /* --------------------------------------------------------------- */
    grup('D — Ayar alanlari (dogrulama + davranis)');

    const ayarla = (yama) => c.put('/api/settings', yama);
    const oku = async () => (await c.get('/api/settings')).govde.values;

    await test('D1', 'baseUrl PUBLIC_BASE_URL ortam degiskeninden geliyor', async () => {
      const v = await oku();
      esit(v.baseUrl, 'https://ota.test', 'deger ortam degiskeniyle ayni olmali');
      return { detay: 'ortam degiskeni kaynak' };
    });

    await test('D1b', 'PUBLIC_BASE_URL sondaki / kirpilarak okunuyor', async () => {
      const g = await sunucuBaslat({
        ADMIN_PASSWORD: SIFRE,
        PUBLIC_BASE_URL: 'https://ota.test/',
        LOG_LEVEL: 'warn',
      });
      try {
        bekle(g.hazir, `ornek kalkmadi: ${g.cikti.slice(-300)}`);
        const gc = g.istemci();
        await gc.post('/api/auth/login', { password: SIFRE });
        const v = (await gc.get('/api/settings')).govde.values;
        esit(v.baseUrl, 'https://ota.test', 'sondaki / atilmali');
      } finally {
        await g.durdur();
      }
      return { detay: 'sondaki / kirpildi' };
    });

    await test('D1d', 'PUBLIC_BASE_URL bosken servis kalkiyor ama uyari veriyor', async () => {
      const g = await sunucuBaslat({
        ADMIN_PASSWORD: SIFRE,
        PUBLIC_BASE_URL: '',
        LOG_LEVEL: 'warn',
      });
      try {
        bekle(g.hazir, `ornek kalkmadi: ${g.cikti.slice(-300)}`);
        const gc = g.istemci();
        await gc.post('/api/auth/login', { password: SIFRE });
        const r = await gc.get('/api/settings');
        esit(r.status, 200, 'status');
        esit(r.govde.values.baseUrl, '', 'baseUrl bos');
        bekle(r.govde.warnings.some((u) => /bos/i.test(u)),
          `uyari yok: ${JSON.stringify(r.govde.warnings)}`);
      } finally {
        await g.durdur();
      }
      return { detay: 'bos + uyari' };
    });

    await test('D2', 'siteName: gecerli / bos / 81 karakter', async () => {
      esit((await ayarla({ siteName: 'AnkaGeo OTA' })).status, 200, 'gecerli');
      esit((await ayarla({ siteName: '' })).status, 200, 'bos izinli');
      esit((await ayarla({ siteName: 'a'.repeat(81) })).status, 400, '81 karakter reddedilmeli');
      await ayarla({ siteName: 'AnkaGeo OTA' });
      return { detay: 'max 80 sinir calisiyor' };
    });

    await test('D3', 'installNote: gecerli / 501 karakter', async () => {
      esit((await ayarla({ installNote: 'Kurulum sonrasi Ayarlar > Genel > VPN ve Aygit Yonetimi.' })).status, 200, 'gecerli');
      esit((await ayarla({ installNote: 'a'.repeat(501) })).status, 400, '501 karakter reddedilmeli');
      return { detay: 'max 500 sinir calisiyor' };
    });

    await test('D4', 'showQrCode true/false kaydediliyor', async () => {
      esit((await ayarla({ showQrCode: false })).govde.values.showQrCode, false, 'false');
      esit((await ayarla({ showQrCode: true })).govde.values.showQrCode, true, 'true');
      esit((await ayarla({ showQrCode: 'evet' })).status, 400, 'metin reddedilmeli');
      return { detay: 'boolean dogrulamasi calisiyor' };
    });

    await test('D5', 'defaultTtlHours sinirlari (1..8760)', async () => {
      esit((await ayarla({ defaultTtlHours: 24 })).status, 200, '24');
      esit((await ayarla({ defaultTtlHours: 0 })).status, 400, '0 reddedilmeli');
      esit((await ayarla({ defaultTtlHours: -5 })).status, 400, '-5 reddedilmeli');
      esit((await ayarla({ defaultTtlHours: 8761 })).status, 400, '8761 reddedilmeli');
      esit((await ayarla({ defaultTtlHours: 1.5 })).status, 400, 'ondalik reddedilmeli');
      await ayarla({ maxTtlHours: 8760, defaultTtlHours: 24 });
      return { detay: 'alt/ust/ondalik sinirlari calisiyor' };
    });

    await test('D6', 'maxTtlHours sinirlari (1..8760)', async () => {
      esit((await ayarla({ maxTtlHours: 720 })).status, 200, '720');
      esit((await ayarla({ maxTtlHours: 0 })).status, 400, '0 reddedilmeli');
      esit((await ayarla({ maxTtlHours: 8761 })).status, 400, '8761 reddedilmeli');
      esit((await ayarla({ maxTtlHours: 8760 })).status, 200, '8760 kabul');
      return { detay: 'sinirlar calisiyor' };
    });

    await test('D6b', 'maxTtlHours dusurulunce defaultTtlHours otomatik kirpiliyor', async () => {
      await ayarla({ maxTtlHours: 8760, defaultTtlHours: 168 });
      const r = await ayarla({ maxTtlHours: 12 });
      esit(r.status, 200, 'status');
      esit(r.govde.values.defaultTtlHours, 12, 'default, max a cekilmeli');
      await ayarla({ maxTtlHours: 8760, defaultTtlHours: 24 });
      return { detay: 'default 168 → 12 olarak kirpildi' };
    });

    await test('D7', 'purgeAfterExpiryHours sinirlari (0..8760)', async () => {
      esit((await ayarla({ purgeAfterExpiryHours: 0 })).status, 200, '0 izinli (hemen sil)');
      esit((await ayarla({ purgeAfterExpiryHours: -1 })).status, 400, '-1 reddedilmeli');
      esit((await ayarla({ purgeAfterExpiryHours: 8761 })).status, 400, '8761 reddedilmeli');
      await ayarla({ purgeAfterExpiryHours: 24 });
      return { detay: 'sinirlar calisiyor' };
    });

    await test('D8', 'signedUrlTtlMinutes sinirlari (5..1440)', async () => {
      esit((await ayarla({ signedUrlTtlMinutes: 5 })).status, 200, '5');
      esit((await ayarla({ signedUrlTtlMinutes: 4 })).status, 400, '4 reddedilmeli');
      esit((await ayarla({ signedUrlTtlMinutes: 1441 })).status, 400, '1441 reddedilmeli');
      esit((await ayarla({ signedUrlTtlMinutes: 1440 })).status, 200, '1440 kabul');
      await ayarla({ signedUrlTtlMinutes: 120 });
      return { detay: 'sinirlar calisiyor' };
    });

    await test('D8b', 'signedUrlTtlMinutes uretilen imzanin omrunu degistiriyor', async () => {
      const y = await c.yukle(join(FIX, 'demo-a.ipa'), { ttlHours: 24 });
      esit(y.status, 201, 'upload');
      const id = y.govde.build.id;

      const token = y.govde.build.token;
      const expOku = (url) => Number(/[?&]k=([^&]+)/.exec(url)[1].split('.')[0]);

      await ayarla({ signedUrlTtlMinutes: 5 });
      const kisa = manifestAdresiCikar(String((await c.get(`/i/${token}`, IOS)).govde));
      await ayarla({ signedUrlTtlMinutes: 1440 });
      const uzun = manifestAdresiCikar(String((await c.get(`/i/${token}`, IOS)).govde));

      const kisaExp = expOku(kisa);
      const uzunExp = expOku(uzun);
      const fark = (uzunExp - kisaExp) / 60000;
      bekle(fark > 1400 && fark < 1450, `Beklenen ~1435 dk fark, gercek ${Math.round(fark)} dk`);

      await c.del(`/api/builds/${id}`);
      await ayarla({ signedUrlTtlMinutes: 120 });
      return { detay: `imza omru farki ${Math.round(fark)} dk` };
    });

    await test('D9', 'maxUploadMb sinirlari (1..8192)', async () => {
      esit((await ayarla({ maxUploadMb: 1024 })).status, 200, '1024');
      esit((await ayarla({ maxUploadMb: 0 })).status, 400, '0 reddedilmeli');
      esit((await ayarla({ maxUploadMb: 8193 })).status, 400, '8193 reddedilmeli');
      return { detay: 'sinirlar calisiyor' };
    });

    await test('D9b', 'maxUploadMb gercekten uygulaniyor (buyuk dosya 413)', async () => {
      await ayarla({ maxUploadMb: 1 });
      const r = await c.yukle(join(FIX, 'big.ipa'));      // ~3 MB
      esit(r.status, 413, 'status');
      bekle(/cok buyuk|1 MB/i.test(r.govde.error), r.govde.error);
      await ayarla({ maxUploadMb: 1024 });
      return { detay: r.govde.error };
    });

    await test('D10', 'revokePreviousOnUpload true/false kaydediliyor', async () => {
      esit((await ayarla({ revokePreviousOnUpload: true })).govde.values.revokePreviousOnUpload, true, 'true');
      esit((await ayarla({ revokePreviousOnUpload: false })).govde.values.revokePreviousOnUpload, false, 'false');
      return { detay: 'kaydediliyor' };
    });

    await test('D-kalicilik', 'Ayarlar sunucu yeniden baslatildiginda korunuyor (DB)', async () => {
      await ayarla({ siteName: 'KaliciAyar', maxUploadMb: 333 });
      const s2 = await sunucuBaslat({ ADMIN_PASSWORD: SIFRE }, { dataDir: s.veriDizini });
      try {
        bekle(s2.hazir, `ikinci ornek kalkmadi: ${s2.cikti.slice(-300)}`);
        const c2 = s2.istemci();
        await c2.post('/api/auth/login', { password: SIFRE });
        const v = (await c2.get('/api/settings')).govde.values;
        esit(v.siteName, 'KaliciAyar', 'siteName');
        esit(v.maxUploadMb, 333, 'maxUploadMb');
      } finally {
        await s2.durdur();
      }
      await ayarla({ siteName: 'AnkaGeo OTA', maxUploadMb: 1024 });
      return { detay: 'DB den geri okundu' };
    });

    await test('D-kismi', 'PUT kismi govde kabul ediyor, gonderilmeyen alanlar korunuyor', async () => {
      await ayarla({ siteName: 'KismiTest', maxUploadMb: 512 });
      const r = await ayarla({ siteName: 'YalnizIsim' });
      esit(r.govde.values.siteName, 'YalnizIsim', 'degisen');
      esit(r.govde.values.maxUploadMb, 512, 'degismeyen korunmali');
      await ayarla({ siteName: 'AnkaGeo OTA', maxUploadMb: 1024 });
      return { detay: 'partial update calisiyor' };
    });

    await test('D-bilinmeyen', 'Bilinmeyen ayar anahtari sessizce yok sayiliyor', async () => {
      const r = await ayarla({ sacmaAyar: 'evet', siteName: 'AnkaGeo OTA' });
      esit(r.status, 200, 'status');
      bekle(!('sacmaAyar' in r.govde.values), 'bilinmeyen anahtar kaydedilmis');
      return { detay: 'yok sayildi' };
    });

    /* --------------------------------------------------------------- */
    grup('F — Uctan uca OTA akisi');

    await ayarla({ baseUrl: 'https://ota.test', showQrCode: true, siteName: 'AnkaGeo OTA',
      installNote: 'Kurulum sonrasi Ayarlar > Genel > VPN ve Aygit Yonetimi.',
      maxUploadMb: 1024, defaultTtlHours: 24, maxTtlHours: 8760,
      signedUrlTtlMinutes: 120, purgeAfterExpiryHours: 24, revokePreviousOnUpload: false });

    let anaBuild = null;

    await test('F2', 'Gecerli IPA yukleniyor, meta veri dogru cikariliyor', async () => {
      const r = await c.yukle(join(FIX, 'demo-a.ipa'), { ttlHours: 48, note: 'F2 testi' });
      esit(r.status, 201, 'status');
      const b = r.govde.build;
      esit(b.bundleId, 'com.ankageo.demoa', 'bundleId');
      esit(b.appName, 'DemoA', 'appName');
      esit(b.version, '1.0.0', 'version');
      esit(b.buildNumber, '100', 'buildNumber');
      esit(b.minOsVersion, '15.0', 'minOsVersion');
      esit(b.platforms.join(','), 'iPhoneOS', 'platforms');
      esit(b.ttlHours, 48, 'ttlHours');
      esit(b.note, 'F2 testi', 'note');
      bekle(/^[0-9a-f]{64}$/.test(b.sha256), 'sha256 bicimi yanlis');
      bekle(b.sizeBytes > 60000, `boyut kucuk: ${b.sizeBytes}`);
      anaBuild = b;
      return { detay: `${b.appName} ${b.version} (${b.sizeLabel})` };
    });

    await test('F3', 'Simge cikariliyor ve imzali adresten indirilebiliyor', async () => {
      bekle(anaBuild?.iconUrl, 'iconUrl uretilmedi');
      const yol = anaBuild.iconUrl.replace('https://ota.test', '');
      const r = await c.get(yol, { ham: true });
      esit(r.status, 200, 'status');
      esit(r.headers.get('content-type'), 'image/png', 'content-type');
      bekle(r.govde.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'PNG imzasi yok');
      return { detay: `${r.govde.length} bayt PNG` };
    });

    await test('F4', 'DTO.installUrl = paylasilabilir sayfa adresi; itms-services linki sayfanin icinde', async () => {
      // Panelde paylasilan adres SAYFA adresidir; itms-services linki yalnizca
      // kurulum sayfasinda, iOS istemciye gosterilir.
      esit(anaBuild.installUrl, `https://ota.test/i/${anaBuild.token}`, 'installUrl');
      esit(anaBuild.qrUrl, `https://ota.test/i/${anaBuild.token}/qr.svg`, 'qrUrl');

      const html = String((await c.get(`/i/${anaBuild.token}`, IOS)).govde);
      const manifestUrl = manifestAdresiCikar(html);
      bekle(manifestUrl.startsWith('https://ota.test/i/'), manifestUrl);
      bekle(/\/manifest\.plist\?k=\d+\./.test(manifestUrl), `imza yok: ${manifestUrl}`);
      return { detay: manifestUrl.slice(0, 72) + '...' };
    });

    await test('F4b', 'iOS DISI istemciye kurulum dugmesi gosterilmiyor (uyari sayfasi)', async () => {
      // 2026-08-20: iPadOS 13+ masaustu UA'si Mac'ten ayirt edilemedigi icin
      // sayfada GIZLI (hidden) bir kurulum blogu + dokunmatik tespit betigi
      // durur; JS Mac'te blogu ACMAZ. Gorunur icerik hala uyari sayfasidir.
      const html = String((await c.get(`/i/${anaBuild.token}`)).govde);
      bekle(/<div id="ipad-kurulum" hidden>/.test(html), 'iPad kurulum blogu hidden degil ya da yok');
      bekle(/maxTouchPoints/.test(html), 'dokunmatik tespit betigi yok');
      // itms linki YALNIZCA gizli blogun icinde olmali.
      const gizliBlokDisi = html.replace(/<div id="ipad-kurulum" hidden>[\s\S]*?<\/div>/, '');
      bekle(!gizliBlokDisi.includes('itms-services'), 'itms-services linki gizli blok DISINA sizdi');
      bekle(/yalnizca <strong>iPhone ve iPad<\/strong>/.test(html), 'iOS disi uyarisi yok');
      return { detay: 'uyari sayfasi + yalnizca gizli iPad blogunda buton' };
    });

    await test('F5', 'Kurulum sayfasi: siteName + installNote + QR gorunuyor', async () => {
      const r = await c.get(`/i/${anaBuild.token}`, IOS);
      esit(r.status, 200, 'status');
      esit(r.headers.get('cache-control'), 'no-store, must-revalidate', 'cache-control');
      const html = String(r.govde);
      bekle(html.includes('AnkaGeo OTA'), 'siteName sayfada yok');
      bekle(html.includes('VPN ve Aygit Yonetimi'), 'installNote sayfada yok');
      bekle(html.includes('DemoA'), 'uygulama adi yok');
      bekle(html.includes('itms-services'), 'kurulum linki yok');
      // QR yalnizca iOS DISI goruntude cizilir (telefonun kendisinde anlamsiz).
      bekle(!html.includes('qr.svg'), 'iOS goruntusunde QR olmamali');
      const masaustu = String((await c.get(`/i/${anaBuild.token}`)).govde);
      bekle(masaustu.includes('qr.svg'), 'masaustu goruntusunde QR yok');
      return { detay: `${html.length} bayt (iOS), QR masaustunde` };
    });

    await test('F5b', 'showQrCode ayari masaustu goruntusundeki QR yi ac/kapa yapiyor', async () => {
      await ayarla({ showQrCode: false });
      const kapali = String((await c.get(`/i/${anaBuild.token}`)).govde);
      await ayarla({ showQrCode: true });
      const acik = String((await c.get(`/i/${anaBuild.token}`)).govde);
      bekle(!kapali.includes('qr.svg'), 'showQrCode=false iken QR hala var');
      bekle(acik.includes('qr.svg'), 'showQrCode=true iken QR yok');

      const qr = await c.get(`/i/${anaBuild.token}/qr.svg`);
      esit(qr.status, 200, 'qr.svg');
      bekle(String(qr.govde).includes('<svg'), 'SVG donmedi');
      return { detay: 'ayar masaustu goruntusunu degistiriyor, qr.svg 200' };
    });

    await test('F5c', 'siteName degisikligi kurulum sayfasina aninda yansiyor', async () => {
      await ayarla({ siteName: 'YeniMarka OTA' });
      const html = String((await c.get(`/i/${anaBuild.token}`, IOS)).govde);
      bekle(html.includes('YeniMarka OTA'), 'yeni siteName sayfada yok');
      await ayarla({ siteName: 'AnkaGeo OTA' });
      return { detay: 'cache tazelenmesi calisiyor' };
    });

    await test('F6', 'manifest.plist: imzali 200 / imzasiz 403 / bozuk imza 403', async () => {
      const manifestUrl = manifestAdresiCikar(String((await c.get(`/i/${anaBuild.token}`, IOS)).govde));
      const yol = manifestUrl.replace('https://ota.test', '');

      const iyi = await c.get(yol);
      esit(iyi.status, 200, 'imzali');
      const xml = String(iyi.govde);
      bekle(xml.includes('<key>bundle-identifier</key>'), 'manifest bicimi yanlis');
      bekle(xml.includes('com.ankageo.demoa'), 'bundleId yok');
      bekle(xml.includes('software-package'), 'ipa adresi yok');

      const imzasiz = await c.get(yol.split('?')[0]);
      esit(imzasiz.status, 403, 'imzasiz');

      const bozuk = await c.get(yol.replace(/k=([^&]+)/, 'k=9999999999999.SAHTEIMZA'));
      esit(bozuk.status, 403, 'bozuk imza');
      return { detay: '200 / 403 / 403' };
    });

    await test('F7', '.ipa indirme: imzali 200, content-disposition dogru', async () => {
      const manifestUrl = manifestAdresiCikar(String((await c.get(`/i/${anaBuild.token}`, IOS)).govde));
      const manifest = String((await c.get(manifestUrl.replace('https://ota.test', ''))).govde);
      const ipaUrl = /<string>(https:\/\/ota\.test\/i\/[^<]*app\.ipa[^<]*)<\/string>/.exec(manifest)?.[1];
      bekle(ipaUrl, 'manifest icinde ipa adresi yok');
      const yol = ipaUrl.replace('https://ota.test', '').replace(/&amp;/g, '&');
      const r = await c.get(yol, { ham: true });
      esit(r.status, 200, 'status');
      esit(r.headers.get('content-type'), 'application/octet-stream', 'content-type');
      bekle(/attachment; filename="DemoA-1\.0\.0\.ipa"/.test(r.headers.get('content-disposition')),
        r.headers.get('content-disposition'));
      esit(Number(r.headers.get('content-length')), anaBuild.sizeBytes, 'content-length');
      return { detay: `${r.govde.length} bayt indirildi` };
    });

    await test('F8', 'Range destegi: bytes=0-1023 → 206 + content-range', async () => {
      const manifestUrl2 = manifestAdresiCikar(String((await c.get(`/i/${anaBuild.token}`, IOS)).govde));
      const manifest = String((await c.get(manifestUrl2.replace('https://ota.test', ''))).govde);
      const ipaUrl = /<string>(https:\/\/ota\.test\/i\/[^<]*app\.ipa[^<]*)<\/string>/.exec(manifest)[1];
      const yol = ipaUrl.replace('https://ota.test', '').replace(/&amp;/g, '&');

      const r = await c.get(yol, { ham: true, headers: { range: 'bytes=0-1023' } });
      esit(r.status, 206, 'status');
      esit(r.headers.get('content-range'), `bytes 0-1023/${anaBuild.sizeBytes}`, 'content-range');
      esit(r.govde.length, 1024, 'parca boyutu');

      const son = await c.get(yol, { ham: true, headers: { range: 'bytes=-500' } });
      esit(son.status, 206, 'sondan okuma');
      esit(son.govde.length, 500, 'son 500 bayt');

      // 2026-08-20: dosya disinda BASLAYAN aralik RFC 9110 geregi 416 doner
      // (eskiden sessizce 200 tam govdeye dusuluyordu). Ayrinti: H3.
      const gecersiz = await c.get(yol, { ham: true, headers: { range: 'bytes=99999999-' } });
      bekle(gecersiz.status === 416, `aralik disi istek 416 donmeli, gercek ${gecersiz.status}`);
      return { detay: '206 + content-range dogru' };
    });

    await test('F9', 'Sayaclar artiyor (view / install / download)', async () => {
      const once = (await c.get(`/api/builds/${anaBuild.id}`)).govde;
      await c.get(`/i/${anaBuild.token}`, IOS);
      const sonra = (await c.get(`/api/builds/${anaBuild.id}`)).govde;
      bekle(sonra.viewCount > once.viewCount, `view sayaci artmadi (${once.viewCount}→${sonra.viewCount})`);
      bekle(sonra.installCount > 0, 'install sayaci 0');
      bekle(sonra.downloadCount > 0, 'download sayaci 0');
      return { detay: `view=${sonra.viewCount} install=${sonra.installCount} download=${sonra.downloadCount}` };
    });

    await test('F10', 'Sifreli link: sifresiz form, dogru sifrede kurulum linki', async () => {
      const y = await c.yukle(join(FIX, 'demo-b.ipa'), { ttlHours: 24, password: 'gizli-sifre' });
      esit(y.status, 201, 'upload');
      const b = y.govde.build;
      esit(b.hasPassword, true, 'hasPassword');

      const acik = new Istemci(s.taban);
      const form = String((await acik.get(`/i/${b.token}`, IOS)).govde);
      bekle(/type="password"/.test(form), 'sifre formu yok');
      bekle(!form.includes('itms-services'), 'sifresiz sayfada kurulum linki gorunuyor!');

      const yanlis = await acik.istek(`/i/${b.token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': IOS_UA },
        body: 'password=yanlis',
      });
      bekle(/hatali/i.test(String(yanlis.govde)), 'yanlis sifre mesaji yok');

      const dogru = await acik.istek(`/i/${b.token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': IOS_UA },
        body: 'password=gizli-sifre',
      });
      bekle(String(dogru.govde).includes('itms-services'), 'dogru sifrede kurulum linki cikmadi');

      await c.del(`/api/builds/${b.id}`);
      return { detay: 'sifre korumasi calisiyor' };
    });

    let oncekiManifestYolu = null;
    await test('F11', 'Iptal (revoke): kurulum sayfasi 410, manifest 410', async () => {
      oncekiManifestYolu = manifestAdresiCikar(String((await c.get(`/i/${anaBuild.token}`, IOS)).govde))
        .replace('https://ota.test', '');
      const r = await c.patch(`/api/builds/${anaBuild.id}`, { revoked: true });
      esit(r.status, 200, 'patch');
      esit(r.govde.status, 'revoked', 'status');
      // NOT: installUrl (sayfa adresi) iptalde de dolu kalir — sayfa 410 gosterir.
      // Arayuz `build.status === 'active'` kontrolu ile linki gizler.
      esit(r.govde.iconUrl, null, 'iptalde iconUrl null olmali');

      const sayfa = await c.get(`/i/${anaBuild.token}`, IOS);
      esit(sayfa.status, 410, 'sayfa');
      bekle(!String(sayfa.govde).includes('itms-services'), 'iptal sonrasi kurulum linki sizdi');
      const m = await c.get(oncekiManifestYolu);
      esit(m.status, 410, 'manifest');
      return { detay: '410 donuyor, link gizlendi' };
    });

    await test('F12', 'Yeniden ac (unrevoke): tekrar aktif', async () => {
      const r = await c.patch(`/api/builds/${anaBuild.id}`, { revoked: false });
      esit(r.govde.status, 'active', 'status');
      bekle(r.govde.installUrl, 'installUrl geri gelmedi');
      esit((await c.get(`/i/${anaBuild.token}`)).status, 200, 'sayfa');
      return { detay: 'yeniden aktif' };
    });

    await test('F13', 'Suresi dolmus link 410 donuyor', async () => {
      const y = await c.yukle(join(FIX, 'demo-a.ipa'), { ttlHours: 1 });
      const b = y.govde.build;
      // Suresini gecmise cek: 'upload' baz + 1 saat, ama kayit yeni... bunun
      // yerine dogrudan DB uzerinden degil, ttlFrom='upload' + 1 saat ile
      // gecmise dusuremeyiz. Kucuk bir bekleme yerine SQL kullanilir.
      const Database = backendRequire('better-sqlite3');
      const db = new Database(join(s.veriDizini, 'ipa-ota.db'));
      db.prepare('UPDATE builds SET expires_at = ? WHERE id = ?').run(Date.now() - 1000, b.id);
      db.close();

      const sayfa = await c.get(`/i/${b.token}`);
      esit(sayfa.status, 410, 'sayfa');
      bekle(/suresi/i.test(String(sayfa.govde)), 'sure dolmus mesaji yok');

      const dto = (await c.get(`/api/builds/${b.id}`)).govde;
      esit(dto.status, 'expired', 'DTO status');
      esit(dto.remainingLabel, null, 'remainingLabel suresi dolunca null olmali');
      esit(dto.iconUrl, null, 'iconUrl');

      // F14 icin sakla
      return { detay: 'expired durumu dogru', b };
    });

    await test('F14', 'Temizlik: suresi dolmus dosyalar siliniyor, kayit "purged" oluyor', async () => {
      const y = await c.yukle(join(FIX, 'demo-b.ipa'), { ttlHours: 1 });
      const b = y.govde.build;
      const Database = backendRequire('better-sqlite3');
      const db = new Database(join(s.veriDizini, 'ipa-ota.db'));
      db.prepare('UPDATE builds SET expires_at = ? WHERE id = ?').run(Date.now() - 100_000_000, b.id);
      db.close();

      await ayarla({ purgeAfterExpiryHours: 0 });
      const t = await c.post('/api/maintenance/cleanup');
      esit(t.status, 200, 'cleanup');
      bekle(t.govde.purged >= 1, `hicbir sey silinmedi: ${JSON.stringify(t.govde)}`);
      bekle(t.govde.freedBytes > 0, 'freedBytes 0');

      const dto = (await c.get(`/api/builds/${b.id}`)).govde;
      esit(dto.status, 'purged', 'status');
      esit((await c.get(`/i/${b.token}`)).status, 410, 'sayfa 410');
      await ayarla({ purgeAfterExpiryHours: 24 });
      return { detay: `${t.govde.purged} kayit, ${t.govde.freedBytes} bayt` };
    });

    await test('F15', 'Kalici silme: kayit ve dosya gidiyor, 404', async () => {
      const y = await c.yukle(join(FIX, 'demo-a.ipa'));
      const b = y.govde.build;
      esit((await c.del(`/api/builds/${b.id}`)).status, 200, 'delete');
      esit((await c.get(`/api/builds/${b.id}`)).status, 404, 'GET sonrasi 404');
      esit((await c.get(`/i/${b.token}`)).status, 404, 'kurulum sayfasi 404');
      return { detay: 'tamamen silindi' };
    });

    await test('F16', 'revokePreviousOnUpload: ayni bundle-id nin eskisi iptal ediliyor', async () => {
      await ayarla({ revokePreviousOnUpload: true });
      const ilk = (await c.yukle(join(FIX, 'demo-b.ipa'))).govde.build;
      const ikinci = await c.yukle(join(FIX, 'demo-b.ipa'));
      esit(ikinci.status, 201, 'ikinci yukleme');
      bekle(ikinci.govde.revokedPrevious >= 1, `revokedPrevious=${ikinci.govde.revokedPrevious}`);
      esit((await c.get(`/api/builds/${ilk.id}`)).govde.status, 'revoked', 'ilk kayit');
      esit((await c.get(`/api/builds/${ikinci.govde.build.id}`)).govde.status, 'active', 'ikinci kayit');

      await ayarla({ revokePreviousOnUpload: false });
      const ucuncu = await c.yukle(join(FIX, 'demo-b.ipa'));
      esit(ucuncu.govde.revokedPrevious, 0, 'kapaliyken iptal olmamali');
      esit((await c.get(`/api/builds/${ikinci.govde.build.id}`)).govde.status, 'active', 'ikinci hala aktif');

      for (const id of [ilk.id, ikinci.govde.build.id, ucuncu.govde.build.id]) await c.del(`/api/builds/${id}`);
      return { detay: 'ayar iki yonde de calisiyor' };
    });

    await test('F17', 'baseUrl bosken yukleme calisir ama installUrl null + uyari', async () => {
      // PUBLIC_BASE_URL bos olan AYRI bir ornek: adres artik calisma aninda
      // panelden bosaltilamiyor.
      const g = await sunucuBaslat({
        ADMIN_PASSWORD: SIFRE,
        PUBLIC_BASE_URL: '',
        LOG_LEVEL: 'warn',
      });
      try {
        bekle(g.hazir, `ornek kalkmadi: ${g.cikti.slice(-300)}`);
        const gc = g.istemci();
        await gc.post('/api/auth/login', { password: SIFRE });

        const r = await gc.yukle(join(FIX, 'demo-a.ipa'));
        esit(r.status, 201, 'status');
        esit(r.govde.build.installUrl, null, 'installUrl');
        esit(r.govde.build.qrUrl, null, 'qrUrl');
        bekle(r.govde.warnings.some((u) => /Base URL/i.test(u)), JSON.stringify(r.govde.warnings));

        const sayfa = await gc.get(`/i/${r.govde.build.token}`);
        esit(sayfa.status, 503, 'kurulum sayfasi 503 donmeli');
      } finally {
        await g.durdur();
      }
      return { detay: '201 + null link + uyari + 503' };
    });

    await test('F18', 'ZIP olmayan dosya 422 ile reddediliyor', async () => {
      const r = await c.yukle(join(FIX, 'bozuk.ipa'));
      esit(r.status, 422, 'status');
      bekle(/ZIP|arsiv/i.test(r.govde.error), r.govde.error);
      return { detay: r.govde.error.slice(0, 70) };
    });

    await test('F18b', 'Gecerli ZIP ama Payload/*.app yoksa 422', async () => {
      const r = await c.yukle(join(FIX, 'gecerli-zip-ama-ipa-degil.ipa'));
      esit(r.status, 422, 'status');
      bekle(/Payload/i.test(r.govde.error), r.govde.error);
      return { detay: r.govde.error.slice(0, 70) };
    });

    await test('F19', 'Bos dosya 400 ile reddediliyor', async () => {
      const r = await c.yukle(join(FIX, 'bos.ipa'));
      esit(r.status, 400, 'status');
      bekle(/bos dosya/i.test(r.govde.error), r.govde.error);
      return { detay: r.govde.error };
    });

    await test('F20', 'Yanlis uzanti 400 ile reddediliyor', async () => {
      const r = await c.yukle(join(KOK, 'backend/package.json')); // .ipa olmayan herhangi bir dosya
      esit(r.status, 400, 'status');
      bekle(/\.ipa/i.test(r.govde.error), r.govde.error);
      return { detay: r.govde.error };
    });

    await test('F22', 'Yetkisiz yukleme 401', async () => {
      const bos = new Istemci(s.taban);
      const r = await bos.yukle(join(FIX, 'demo-a.ipa'));
      esit(r.status, 401, 'status');
      return { detay: r.govde.error };
    });

    await test('F-ttl-clamp', 'Yuklemede maxTtlHours asilirsa sessizce kirpiliyor', async () => {
      await ayarla({ maxTtlHours: 48, defaultTtlHours: 24 });
      const r = await c.yukle(join(FIX, 'demo-a.ipa'), { ttlHours: 9999 });
      esit(r.govde.build.ttlHours, 48, 'kirpilmali');
      await c.del(`/api/builds/${r.govde.build.id}`);

      const v = await c.yukle(join(FIX, 'demo-a.ipa'));           // ttl gonderilmedi
      esit(v.govde.build.ttlHours, 24, 'varsayilan kullanilmali');
      await c.del(`/api/builds/${v.govde.build.id}`);
      await ayarla({ maxTtlHours: 8760 });
      return { detay: '9999 → 48, bos → 24' };
    });

    await test('F-extend', 'Sure duzenleme: ttlFrom upload / now', async () => {
      const b = (await c.yukle(join(FIX, 'demo-a.ipa'), { ttlHours: 24 })).govde.build;

      const uploadBazli = await c.patch(`/api/builds/${b.id}`, { ttlHours: 72, ttlFrom: 'upload' });
      const beklenenUpload = b.createdAt + 72 * 3_600_000;
      bekle(Math.abs(uploadBazli.govde.expiresAt - beklenenUpload) < 2000,
        `upload bazli yanlis: ${uploadBazli.govde.expiresAt} vs ${beklenenUpload}`);

      const simdiBazli = await c.patch(`/api/builds/${b.id}`, { ttlHours: 5, ttlFrom: 'now' });
      const beklenenSimdi = Date.now() + 5 * 3_600_000;
      bekle(Math.abs(simdiBazli.govde.expiresAt - beklenenSimdi) < 5000,
        `now bazli yanlis: ${simdiBazli.govde.expiresAt} vs ${beklenenSimdi}`);

      await c.del(`/api/builds/${b.id}`);
      return { detay: 'iki baz da dogru' };
    });

    await test('F-patch-sifre', 'Link sifresi PATCH ile eklenip kaldirilabiliyor', async () => {
      const b = (await c.yukle(join(FIX, 'demo-a.ipa'))).govde.build;
      esit(b.hasPassword, false, 'baslangicta sifresiz');

      const ekle = await c.patch(`/api/builds/${b.id}`, { password: 'yeni-sifre' });
      esit(ekle.govde.hasPassword, true, 'sifre eklendi');
      bekle(/type="password"/.test(String((await c.get(`/i/${b.token}`, IOS)).govde)), 'sayfa sifre sormuyor');

      const kaldir = await c.patch(`/api/builds/${b.id}`, { password: null });
      esit(kaldir.govde.hasPassword, false, 'sifre kaldirildi');
      bekle(String((await c.get(`/i/${b.token}`, IOS)).govde).includes('itms-services'), 'sifre kalkmasina ragmen link yok');

      await c.del(`/api/builds/${b.id}`);
      return { detay: 'ekle/kaldir calisiyor' };
    });

    await test('F-liste', 'Liste: arama, sadece-aktif filtresi, sayfalama', async () => {
      const hepsi = await c.get('/api/builds?limit=200');
      esit(hepsi.status, 200, 'status');
      bekle(typeof hepsi.govde.total === 'number', 'total yok');

      const arama = await c.get('/api/builds?search=DemoA&limit=200');
      bekle(arama.govde.items.every((b) => /DemoA/i.test(b.appName + b.bundleId + b.version)),
        'arama filtresi calismiyor');

      const aktif = await c.get('/api/builds?onlyActive=true&limit=200');
      bekle(aktif.govde.items.every((b) => b.status === 'active'), 'onlyActive filtresi calismiyor');

      const gecersiz = await c.get('/api/builds?limit=9999');
      esit(gecersiz.status, 400, 'limit ust siniri');
      return { detay: `toplam=${hepsi.govde.total}, aktif=${aktif.govde.items.length}` };
    });

    await test('F-stats', '/api/stats ozet dogru', async () => {
      const r = await c.get('/api/stats');
      esit(r.status, 200, 'status');
      for (const k of ['total', 'active', 'totalBytes', 'activeBytes', 'warnings']) {
        bekle(k in r.govde, `${k} yok`);
      }
      return { detay: `total=${r.govde.total} active=${r.govde.active}` };
    });


    /* --------------------------------------------------------------- */
    grup('H — Regresyonlar (2026-08-20 bulgulari)');

    /** Kurulum sayfasi -> manifest -> imzali app.ipa yolunu (yol+sorgu) cikarir. */
    const imzaliIpaYolu = async (token) => {
      const sayfa = await c.get(`/i/${token}`, IOS);
      const itms = /href="itms-services:\/\/\?action=download-manifest&amp;url=([^"]+)"/.exec(String(sayfa.govde))?.[1];
      bekle(itms, 'itms-services linki sayfada yok');
      const manifestUrl = new URL(decodeURIComponent(itms.replace(/&amp;/g, '&')));
      const man = await c.get(manifestUrl.pathname + manifestUrl.search);
      esit(man.status, 200, 'manifest');
      const ipa = /<string>(https?:\/\/[^<]*app\.ipa[^<]*)<\/string>/.exec(String(man.govde))?.[1]?.replace(/&amp;/g, '&');
      bekle(ipa, 'manifest icinde app.ipa adresi yok');
      const u = new URL(ipa);
      return u.pathname + u.search;
    };

    await test('H1', 'Dosyalari silinmis (purged) link yeniden ACILAMIYOR (409) ve aktif sayilmiyor', async () => {
      const once = (await c.get('/api/stats')).govde;
      const y = await c.yukle(join(FIX, 'demo-a.ipa'), { ttlHours: 720 });
      const b = y.govde.build;
      await c.patch(`/api/builds/${b.id}`, { revoked: true });
      await ayarla({ purgeAfterExpiryHours: 0 });
      await c.post('/api/maintenance/cleanup');
      await ayarla({ purgeAfterExpiryHours: 24 });
      esit((await c.get(`/api/builds/${b.id}`)).govde.status, 'purged', 'temizlik sonrasi status');

      const un = await c.patch(`/api/builds/${b.id}`, { revoked: false });
      esit(un.status, 409, 'unrevoke purged kayitta reddedilmeli');

      // Tutarlilik: purged kayit ne "sadece aktif" listesinde ne istatistikte.
      const liste = await c.get('/api/builds?onlyActive=true&limit=200');
      bekle(!liste.govde.items.some((x) => x.id === b.id), 'purged kayit onlyActive listesinde');
      const sonra = (await c.get('/api/stats')).govde;
      esit(sonra.active, once.active, 'stats.active purged kaydi saymamali');
      esit(sonra.activeBytes, once.activeBytes, 'stats.activeBytes purged kaydi saymamali');

      await c.del(`/api/builds/${b.id}`);
      return { detay: '409 + liste/istatistik tutarli' };
    });

    await test('H2', 'stats.activeBytes iptal edilmis (revoked) kaydi saymiyor', async () => {
      const once = (await c.get('/api/stats')).govde;
      const y = await c.yukle(join(FIX, 'demo-a.ipa'));
      const b = y.govde.build;
      await c.patch(`/api/builds/${b.id}`, { revoked: true });
      const sonra = (await c.get('/api/stats')).govde;
      esit(sonra.active, once.active, 'active');
      esit(sonra.activeBytes, once.activeBytes, 'activeBytes revoked kaydi saymamali');
      await c.del(`/api/builds/${b.id}`);
      return { detay: `revoked ${b.sizeBytes} bayt sayilmadi` };
    });

    await test('H3', 'Indirme sayaci: Range parcalari ve HEAD ayri indirme sayilmiyor; 416 dogru', async () => {
      const y = await c.yukle(join(FIX, 'demo-a.ipa'));
      const b = y.govde.build;
      const yol = await imzaliIpaYolu(b.token);
      const boyut = b.sizeBytes;

      esit((await c.get(yol, { ham: true })).status, 200, 'tam indirme');                                     // sayilir (1)
      esit((await c.get(yol, { headers: { range: 'bytes=100-199' }, ham: true })).status, 206, 'orta parca'); // sayilmaz
      esit((await c.istek(yol, { method: 'HEAD' })).status, 200, 'HEAD');                                     // sayilmaz
      esit((await c.get(yol, { headers: { range: 'bytes=0-99' }, ham: true })).status, 206, 'bastan parca');  // sayilir (2)

      // RFC 9110: son bayt otesine uzanan istek kirpilarak 206 doner...
      const tasan = await c.get(yol, { headers: { range: `bytes=0-${boyut + 999}` }, ham: true });            // sayilir (3)
      esit(tasan.status, 206, 'end>=size kirpilip 206 donmeli');
      esit(tasan.headers.get('content-range'), `bytes 0-${boyut - 1}/${boyut}`, 'kirpilmis content-range');

      // ...dosya disinda BASLAYAN istek ise 416.
      const dis = await c.get(yol, { headers: { range: `bytes=${boyut + 1}-` }, ham: true });
      esit(dis.status, 416, 'start>=size 416 donmeli');
      esit(dis.headers.get('content-range'), `bytes */${boyut}`, '416 content-range');

      const dto = (await c.get(`/api/builds/${b.id}`)).govde;
      esit(dto.downloadCount, 3, 'yalnizca bastan baslayan govdeli indirmeler sayilmali');
      await c.del(`/api/builds/${b.id}`);
      return { detay: 'tam + 2x bastan parca = 3; orta parca/HEAD/416 sayilmadi' };
    });

    await test('H4', 'Sifre degisince eski oturumlar dusuyor', async () => {
      await sunucuIle({ ADMIN_PASSWORD: SIFRE, PUBLIC_BASE_URL: 'https://ota.test', LOG_LEVEL: 'warn' }, async (g) => {
        bekle(g.hazir, g.cikti.slice(-300));
        const eski = g.istemci();
        const aktif = g.istemci();
        esit((await eski.post('/api/auth/login', { password: SIFRE })).status, 200, 'eski giris');
        esit((await aktif.post('/api/auth/login', { password: SIFRE })).status, 200, 'aktif giris');

        const r = await aktif.post('/api/auth/password', { currentPassword: SIFRE, newPassword: 'YepyeniSifre-2026' });
        esit(r.status, 200, 'sifre degisimi');

        esit((await eski.get('/api/builds')).status, 401, 'eski oturum sifre degisince dusmeli');
        esit((await aktif.get('/api/builds')).status, 200, 'degistiren oturum (tazelenen cerezle) calismali');
      });
      return { detay: 'eski cerez 401, tazelenen cerez 200' };
    });

    await test('H5', 'Giris denemeleri hiz sinirina takiliyor (5 hata -> 429)', async () => {
      await sunucuIle({ ADMIN_PASSWORD: SIFRE, LOG_LEVEL: 'warn' }, async (g) => {
        bekle(g.hazir, g.cikti.slice(-300));
        const k = g.istemci();
        for (let i = 1; i <= 5; i++) {
          esit((await k.post('/api/auth/login', { password: `yanlis-${i}` })).status, 401, `deneme ${i}`);
        }
        const kilit = await k.post('/api/auth/login', { password: SIFRE }); // dogru sifre bile
        esit(kilit.status, 429, '6. deneme kilitlenmeli');
        bekle(/dakika/i.test(kilit.govde?.error ?? ''), 'mesaj bekleme suresini soylemiyor');
      });
      return { detay: '5x401 sonrasi dogru sifreye bile 429' };
    });

    await test('H6', 'ttlHours=0 sessizce 1 saatlik link uretmiyor (varsayilana donuyor)', async () => {
      await ayarla({ defaultTtlHours: 24 });
      const r = await c.yukle(join(FIX, 'demo-a.ipa'), { ttlHours: 0 });
      esit(r.status, 201, 'yukleme');
      esit(r.govde.build.ttlHours, 24, '0 "verilmedi" sayilip varsayilan kullanilmali');
      await c.del(`/api/builds/${r.govde.build.id}`);
      return { detay: '0 -> 24 (varsayilan)' };
    });

    await test('H7', 'Yanlis sifre denemesi goruntuleme sayacini artirmiyor', async () => {
      const y = await c.yukle(join(FIX, 'demo-a.ipa'), { password: 'gizli-123' });
      const b = y.govde.build;
      await c.get(`/i/${b.token}`); // gercek goruntuleme (+1)
      const v1 = (await c.get(`/api/builds/${b.id}`)).govde.viewCount;
      for (let i = 0; i < 3; i++) {
        await c.istek(`/i/${b.token}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: 'password=yanlis',
        });
      }
      const v2 = (await c.get(`/api/builds/${b.id}`)).govde.viewCount;
      esit(v2, v1, 'yanlis denemeler sayilmamali');
      await c.del(`/api/builds/${b.id}`);
      return { detay: `viewCount ${v1} -> ${v2}` };
    });

    await test('H8', 'iPad (masaustu gorunumu) kurulum butonuna JS tespitiyle kavusuyor', async () => {
      // iPadOS 13+ masaustu Safari ile ayni UA'yi verir; sunucu ayirt edemez.
      // Sayfa QR gorunumune gizli bir kurulum blogu + dokunmatik tespit betigi koyar.
      // Tespit basarisiz olursa (JS kapali, baska tarayici) kullanicinin tek yolu
      // Safari menusundeki "Mobil Web Sitesi"dir (etiket iPad'de dogrulandi); bu
      // talimat HER ZAMAN gorunen #masaustu-uyari icinde olmali — 21b0908 onu
      // gizli bloga koymustu, yani butonu goremeyen talimati da goremiyordu
      // (2026-08-25'te duzeltildi). Uyari ayrica mobil tarayiciya yonlendirmeli,
      // iPhone sayfasinda ise "Safari" markasi hic gecmemeli (CSS dahil).
      const y = await c.yukle(join(FIX, 'demo-a.ipa'));
      const b = y.govde.build;
      const macUA =
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
      const sayfa = await c.get(`/i/${b.token}`, { headers: { 'user-agent': macUA } });
      const govde = String(sayfa.govde);
      bekle(govde.includes('id="ipad-kurulum"'), 'gizli iPad kurulum blogu yok');
      bekle(/itms-services:/.test(govde), 'iPad blogunda itms-services linki yok');
      bekle(/maxTouchPoints/.test(govde), 'dokunmatik tespit betigi yok');

      const uyari = /<div class="notice warn" id="masaustu-uyari">([\s\S]*?)<\/div>/.exec(govde)?.[1] ?? '';
      bekle(uyari.length > 0, 'her zaman gorunen masaustu uyarisi (#masaustu-uyari) yok');
      bekle(/Eger tarayiciniz Safari ise/.test(uyari), 'talimat Safari kosuluyla baslamali');
      bekle(/Mobil Web Sitesi/.test(uyari), 'mobil web sitesi talimati masaustu uyarisinda yok');
      bekle(/mobil tarayicinizda/.test(uyari), 'masaustu uyarisi mobil tarayiciya yonlendirmeli');
      bekle(/class="safari-menu-icon"/.test(uyari), 'menu simgesi (class="safari-menu-icon") uyari icinde kullanilmiyor');
      bekle(
        !/[^\x00-\x7F]/.test(uyari.replace(/&[a-z#0-9]+;/gi, '')),
        'masaustu uyarisinda ASCII disi karakter var (Turkce diakritik kurali)',
      );
      const ipadBlok = /<div id="ipad-kurulum" hidden>([\s\S]*?)<\/div>/.exec(govde)?.[1] ?? '';
      bekle(!/Mobil Web Sitesi/.test(ipadBlok), 'talimat hala gizli blokta (butonu goremeyen bunu da goremez)');

      // iPhone gorunumu eskisi gibi dogrudan buton icermeli.
      const tel = String((await c.get(`/i/${b.token}`, IOS)).govde);
      bekle(/itms-services:/.test(tel), 'iPhone gorunumunde buton yok');
      bekle(/mobil tarayiciniz disinda/.test(tel), 'iPhone uyarisi mobil tarayiciyi soylemeli');
      bekle(!/Safari/.test(tel), 'iPhone sayfasinda "Safari" ifadesi kalmamali');
      await c.del(`/api/builds/${b.id}`);
      return { detay: 'Macintosh UA: gizli buton + tespit betigi + gorunur "Mobil Web Sitesi" talimati' };
    });

    /* --------------------------------------------------------------- */
    grup('I — Android APK');

    // Harness'in SESSION_SECRET'i sabittir ('test' x16); imza token.ts ile ayni
    // bicimde uretilir: HMAC-SHA256(secret, token \0 amac \0 exp), base64url.
    // Ayirici NUL baytidir (token.ts bu yuzden git'te "binary" gorunur).
    // Boylece amac (purpose) izolasyonu dogrudan kanitlanir: 'ipa' anahtari
    // app.apk'yi acmamali, capraz platform rotalari 404 olmali.
    const imzaAnahtari = (token, amac, omurMs = 60_000) => {
      const exp = Date.now() + omurMs;
      const imza = createHmac('sha256', 'test'.repeat(16))
        .update(`${token}\0${amac}\0${exp}`)
        .digest('base64url');
      return `${exp}.${imza}`;
    };
    const anahtarli = (yol, token, amac) => `${yol}?k=${encodeURIComponent(imzaAnahtari(token, amac))}`;
    const APK = join(FIX, 'demo-android.apk');
    const PNG_IMZA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    let apkBuild = null;
    let apkYolu = null;

    await test('I1', 'demo-android.apk yukleniyor; DTO platform + meta veri dogru', async () => {
      const y = await c.yukle(APK, { ttlHours: 48, note: 'I1 testi' });
      esit(y.status, 201, `status (${JSON.stringify(y.govde).slice(0, 200)})`);
      const b = y.govde.build;
      esit(b.platform, 'android', 'platform');
      esit(b.bundleId, 'com.ankageo.demoandroid', 'bundleId');
      // Etiket resources.arsc'den cozulur; values-tr varyanti varsayilani YENMEMELI.
      esit(b.appName, 'Demo Android', 'appName');
      esit(b.version, '1.2.0', 'version (versionName)');
      esit(b.buildNumber, '12', 'buildNumber (versionCode)');
      esit(b.minOsVersion, '24', 'minOsVersion (minSdkVersion)');
      esit(b.platforms.join(','), 'Android', 'platforms');
      esit(b.originalFilename, 'demo-android.apk', 'originalFilename');
      bekle(/\/icon\.png\?k=/.test(b.iconUrl ?? ''), `iconUrl beklenmedik: ${b.iconUrl}`);
      esit(b.installUrl, `https://ota.test/i/${b.token}`, 'installUrl');
      bekle(/^[0-9a-f]{64}$/.test(b.sha256), 'sha256 bicimi yanlis');
      apkBuild = b;
      return { detay: `${b.appName} ${b.version} (${b.sizeLabel})` };
    });

    await test('I2', 'APK simgesi: en yuksek yogunluklu PNG secildi, adaptive XML atlandi', async () => {
      bekle(apkBuild?.iconUrl, 'I1 basarisiz ya da iconUrl yok');
      const r = await c.get(apkBuild.iconUrl.replace('https://ota.test', ''), { ham: true });
      esit(r.status, 200, 'status');
      esit(r.headers.get('content-type'), 'image/png', 'content-type');
      bekle(r.govde.subarray(0, 8).equals(PNG_IMZA), 'PNG imzasi yok');
      // mdpi 48px + xxhdpi 144px + anydpi-v26 XML arasindan 144px PNG secilmeli.
      esit(r.govde.readUInt32BE(16), 144, 'IHDR genislik');
      return { detay: `${r.govde.length} bayt PNG, 144px` };
    });

    await test('I3', 'Android UA: indirme butonu + Android adimlari; itms/QR yok', async () => {
      bekle(apkBuild, 'I1 basarisiz');
      const r = await c.get(`/i/${apkBuild.token}`, ANDROID);
      esit(r.status, 200, 'status');
      esit(r.headers.get('cache-control'), 'no-store, must-revalidate', 'cache-control');
      const html = String(r.govde);
      for (const beklenen of ['app.apk?k=', 'Uygulamayi Indir', 'Bilinmeyen uygulamalari yukle', 'En az Android', '7.0 (API 24)']) {
        bekle(html.includes(beklenen), `sayfada yok: ${beklenen}`);
      }
      for (const olmamali of ['itms-services', 'qr.svg', 'Safari', 'ipad-kurulum']) {
        bekle(!html.includes(olmamali), `sayfada olmamali: ${olmamali}`);
      }
      return { detay: 'indirme butonu + adimlar; itms/QR/iPad blogu yok' };
    });

    await test('I4', 'Android disi UA (masaustu): uyari + QR + indirme butonu', async () => {
      bekle(apkBuild, 'I1 basarisiz');
      const html = String((await c.get(`/i/${apkBuild.token}`)).govde);
      bekle(html.includes('id="android-uyari"'), 'android uyarisi yok');
      bekle(/yalnizca <strong>Android<\/strong>/.test(html), 'uyari metni yok');
      bekle(html.includes('qr.svg'), 'masaustu goruntusunde QR yok');
      bekle(html.includes('app.apk?k='), 'indirme butonu yok');
      bekle(!html.includes('itms-services'), 'itms-services sizdi');
      bekle(!html.includes('id="ipad-kurulum"'), 'iPad blogu Android sayfasinda olmamali');
      return { detay: 'uyari + QR + buton' };
    });

    await test('I4b', 'iPhone UA ile APK sayfasi da Android disi gorunum', async () => {
      bekle(apkBuild, 'I1 basarisiz');
      const html = String((await c.get(`/i/${apkBuild.token}`, IOS)).govde);
      bekle(!html.includes('itms-services'), 'itms-services sizdi');
      bekle(html.includes('app.apk?k='), 'indirme butonu yok');
      bekle(html.includes('id="android-uyari"'), 'android uyarisi yok');
      return { detay: 'iPhone UA: uyari + buton' };
    });

    await test('I5', 'iOS surumu Android UA altinda degismiyor', async () => {
      const y = await c.yukle(join(FIX, 'demo-a.ipa'));
      esit(y.status, 201, 'upload');
      const html = String((await c.get(`/i/${y.govde.build.token}`, ANDROID)).govde);
      bekle(html.includes('id="ipad-kurulum"'), 'iOS sayfasinin gizli iPad blogu yok');
      bekle(/yalnizca <strong>iPhone ve iPad<\/strong>/.test(html), 'iOS disi uyarisi yok');
      bekle(!html.includes('app.apk'), 'iOS sayfasinda app.apk olmamali');
      await c.del(`/api/builds/${y.govde.build.id}`);
      return { detay: 'iOS sayfasi Android UA ile eski davranis' };
    });

    await test('I6', 'app.apk indirme: imzali 200 + basliklar', async () => {
      bekle(apkBuild, 'I1 basarisiz');
      const html = String((await c.get(`/i/${apkBuild.token}`, ANDROID)).govde);
      const u = new URL(apkAdresiCikar(html));
      apkYolu = u.pathname + u.search;
      bekle(apkYolu.startsWith(`/i/${apkBuild.token}/app.apk?k=`), apkYolu);
      const r = await c.get(apkYolu, { ham: true });                                            // sayilir (1)
      esit(r.status, 200, 'status');
      esit(r.headers.get('content-type'), 'application/vnd.android.package-archive', 'content-type');
      bekle(/attachment; filename="Demo_Android-1\.2\.0\.apk"/.test(r.headers.get('content-disposition') ?? ''),
        `content-disposition: ${r.headers.get('content-disposition')}`);
      esit(Number(r.headers.get('content-length')), apkBuild.sizeBytes, 'content-length');
      esit(r.headers.get('accept-ranges'), 'bytes', 'accept-ranges');
      bekle(r.govde.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), 'ZIP (PK) imzasi yok');
      return { detay: `${r.govde.length} bayt indirildi` };
    });

    await test('I7', 'app.apk Range / HEAD / 416 + indirme sayaci', async () => {
      bekle(apkYolu, 'I6 basarisiz');
      const boyut = apkBuild.sizeBytes;
      const parca = await c.get(apkYolu, { ham: true, headers: { range: 'bytes=0-1023' } });      // sayilir (2)
      esit(parca.status, 206, 'bytes=0-1023');
      esit(parca.headers.get('content-range'), `bytes 0-1023/${boyut}`, 'content-range');
      esit(parca.govde.length, 1024, 'parca boyutu');
      const son = await c.get(apkYolu, { ham: true, headers: { range: 'bytes=-500' } });          // sayilmaz
      esit(son.status, 206, 'bytes=-500');
      esit(son.govde.length, 500, 'son 500 bayt');
      const dis = await c.get(apkYolu, { ham: true, headers: { range: 'bytes=99999999-' } });    // sayilmaz
      esit(dis.status, 416, 'aralik disi 416');
      esit(dis.headers.get('content-range'), `bytes */${boyut}`, '416 content-range');
      esit((await c.istek(apkYolu, { method: 'HEAD' })).status, 200, 'HEAD');                    // sayilmaz
      const dto = (await c.get(`/api/builds/${apkBuild.id}`)).govde;
      esit(dto.downloadCount, 2, 'downloadCount (I6 tam + bastan parca)');
      return { detay: '206 / 206 / 416 / HEAD; sayac 2' };
    });

    await test('I8', 'Imza amaci izole: ipa/icon anahtari app.apk acmiyor, apk anahtari aciyor', async () => {
      bekle(apkBuild, 'I1 basarisiz');
      const yol = `/i/${apkBuild.token}/app.apk`;
      esit((await c.get(anahtarli(yol, apkBuild.token, 'ipa'))).status, 403, 'ipa anahtari');
      esit((await c.get(anahtarli(yol, apkBuild.token, 'icon'))).status, 403, 'icon anahtari');
      esit((await c.get(anahtarli(yol, apkBuild.token, 'apk'), { ham: true })).status, 200, 'apk anahtari');
      esit((await c.get(yol)).status, 403, 'anahtarsiz');
      esit((await c.get(`${yol}?k=9999999999999.SAHTEIMZA`)).status, 403, 'bozuk anahtar');
      return { detay: '403 / 403 / 200 / 403 / 403' };
    });

    await test('I9', 'Platform capraz rotalar 404: manifest.plist, app.ipa, icon.webp; iOS kaydinda app.apk', async () => {
      bekle(apkBuild, 'I1 basarisiz');
      const t = apkBuild.token;
      const manifest = await c.get(anahtarli(`/i/${t}/manifest.plist`, t, 'manifest'));
      esit(manifest.status, 404, 'android kaydinda manifest.plist');
      esit(manifest.govde?.error, 'Bulunamadi', 'manifest govdesi');
      esit((await c.get(anahtarli(`/i/${t}/app.ipa`, t, 'ipa'))).status, 404, 'android kaydinda app.ipa');
      esit((await c.get(anahtarli(`/i/${t}/icon.webp`, t, 'icon'))).status, 404, 'png simgeli kayitta icon.webp');

      const y = await c.yukle(join(FIX, 'demo-a.ipa'));
      const ios = y.govde.build;
      esit((await c.get(anahtarli(`/i/${ios.token}/app.apk`, ios.token, 'apk'))).status, 404, 'ios kaydinda app.apk');
      await c.del(`/api/builds/${ios.id}`);
      return { detay: 'dort capraz rota da 404' };
    });

    await test('I10', 'Iptal: APK sayfasi 410, app.apk 410; yeniden ac 200', async () => {
      bekle(apkYolu, 'I6 basarisiz');
      const r = await c.patch(`/api/builds/${apkBuild.id}`, { revoked: true });
      esit(r.status, 200, 'revoke');
      esit(r.govde.status, 'revoked', 'DTO status');
      esit(r.govde.iconUrl, null, 'iconUrl');
      const sayfa = await c.get(`/i/${apkBuild.token}`, ANDROID);
      esit(sayfa.status, 410, 'sayfa');
      bekle(!String(sayfa.govde).includes('app.apk'), '410 sayfasinda indirme linki olmamali');
      esit((await c.get(apkYolu, { ham: true })).status, 410, 'app.apk');
      const geri = await c.patch(`/api/builds/${apkBuild.id}`, { revoked: false });
      esit(geri.govde.status, 'active', 'unrevoke');
      esit((await c.get(`/i/${apkBuild.token}`, ANDROID)).status, 200, 'sayfa tekrar 200');
      return { detay: '410 → 200' };
    });

    await test('I11', 'Temizlik: purged APK 410, dosyalar silinmis', async () => {
      const y = await c.yukle(join(FIX, 'demo-a.apk'), { ttlHours: 1 });
      esit(y.status, 201, 'upload');
      const b = y.govde.build;
      const Database = backendRequire('better-sqlite3');
      const db = new Database(join(s.veriDizini, 'ipa-ota.db'));
      db.prepare('UPDATE builds SET expires_at = ? WHERE id = ?').run(Date.now() - 100_000_000, b.id);
      db.close();

      await ayarla({ purgeAfterExpiryHours: 0 });
      try {
        const t = await c.post('/api/maintenance/cleanup');
        esit(t.status, 200, 'cleanup');
        bekle(t.govde.purged >= 1, `hicbir sey silinmedi: ${JSON.stringify(t.govde)}`);
        esit((await c.get(`/api/builds/${b.id}`)).govde.status, 'purged', 'status');
        esit((await c.get(`/i/${b.token}`, ANDROID)).status, 410, 'sayfa');
        esit((await c.get(anahtarli(`/i/${b.token}/app.apk`, b.token, 'apk'))).status, 410, 'app.apk');
        esit(existsSync(join(s.veriDizini, 'uploads', b.id)), false, 'yukleme klasoru silinmeli');
      } finally {
        await ayarla({ purgeAfterExpiryHours: 24 });
      }
      return { detay: 'purged: sayfa 410, apk 410, klasor yok' };
    });

    await test('I12', 'revokePreviousOnUpload platforma ozel: iOS ve Android birbirini kapatmiyor', async () => {
      await ayarla({ revokePreviousOnUpload: true });
      const idler = [];
      try {
        const a1 = (await c.yukle(join(FIX, 'demo-a.ipa'))).govde.build;
        idler.push(a1.id);
        const b1y = await c.yukle(join(FIX, 'demo-a.apk'));
        const b1 = b1y.govde.build;
        idler.push(b1.id);
        esit(b1.bundleId, a1.bundleId, 'fikstur on kosulu: ayni paket kimligi');
        esit(b1y.govde.revokedPrevious, 0, 'APK, IPA linkini iptal etmemeli');
        esit((await c.get(`/api/builds/${a1.id}`)).govde.status, 'active', 'A1 aktif');

        const b2y = await c.yukle(join(FIX, 'demo-a.apk'));
        idler.push(b2y.govde.build.id);
        bekle(b2y.govde.revokedPrevious >= 1, `ikinci APK oncekini iptal etmeli: ${b2y.govde.revokedPrevious}`);
        esit((await c.get(`/api/builds/${b1.id}`)).govde.status, 'revoked', 'B1 revoked');
        esit((await c.get(`/api/builds/${a1.id}`)).govde.status, 'active', 'A1 hala aktif');

        const a2y = await c.yukle(join(FIX, 'demo-a.ipa'));
        idler.push(a2y.govde.build.id);
        esit((await c.get(`/api/builds/${a1.id}`)).govde.status, 'revoked', 'A1 ikinci IPA ile revoked');
        esit((await c.get(`/api/builds/${b2y.govde.build.id}`)).govde.status, 'active', 'B2 hala aktif');
      } finally {
        await ayarla({ revokePreviousOnUpload: false });
        for (const id of idler) await c.del(`/api/builds/${id}`);
      }
      return { detay: 'capraz platform iptali yok; ayni platformda var' };
    });

    await test('I13', 'Liste platform filtresi; gecersiz deger 400; search platformlar arasi', async () => {
      bekle(apkBuild, 'I1 basarisiz');
      const andr = await c.get('/api/builds?platform=android&limit=200');
      esit(andr.status, 200, 'android');
      bekle(andr.govde.items.length >= 1 && andr.govde.items.every((b) => b.platform === 'android'), 'android filtresi karisik');
      bekle(andr.govde.items.some((b) => b.id === apkBuild.id), 'apkBuild android listesinde yok');
      const ios = await c.get('/api/builds?platform=ios&limit=200');
      bekle(ios.govde.items.every((b) => b.platform === 'ios'), 'ios filtresi karisik');
      esit((await c.get('/api/builds?platform=windows')).status, 400, 'gecersiz platform');
      const ara = await c.get('/api/builds?search=demoandroid');
      bekle(ara.govde.items.some((b) => b.id === apkBuild.id), 'search APK kaydini bulamadi');
      return { detay: `android ${andr.govde.items.length}, ios ${ios.govde.items.length}` };
    });

    await test('I14', 'bozuk.apk 422 (ZIP degil)', async () => {
      const r = await c.yukle(join(FIX, 'bozuk.apk'));
      esit(r.status, 422, 'status');
      bekle(/ZIP|arsiv/i.test(r.govde.error), r.govde.error);
      return { detay: r.govde.error.slice(0, 70) };
    });

    await test('I15', 'zip-ama-apk-degil.apk 422 (AndroidManifest.xml yok)', async () => {
      const r = await c.yukle(join(FIX, 'zip-ama-apk-degil.apk'));
      esit(r.status, 422, 'status');
      bekle(/AndroidManifest/.test(r.govde.error), r.govde.error);
      return { detay: r.govde.error.slice(0, 70) };
    });

    await test('I15b', 'Yanlis uzanti mesaji .ipa ve .apk yi birlikte aniyor', async () => {
      const r = await c.yukle(join(KOK, 'backend/package.json'));
      esit(r.status, 400, 'status');
      bekle(/\.ipa/.test(r.govde.error) && /\.apk/.test(r.govde.error), r.govde.error);
      return { detay: r.govde.error };
    });

    await test('I16', 'demo-a.apk: literal etiket, simgesiz, minSdk 21, arsc yok', async () => {
      const y = await c.yukle(join(FIX, 'demo-a.apk'));
      esit(y.status, 201, `status (${JSON.stringify(y.govde).slice(0, 200)})`);
      const b = y.govde.build;
      esit(b.appName, 'DemoA Android', 'appName');
      esit(b.iconUrl, null, 'iconUrl');
      esit(b.minOsVersion, '21', 'minOsVersion');
      esit(b.bundleId, 'com.ankageo.demoa', 'bundleId');
      const html = String((await c.get(`/i/${b.token}`, ANDROID)).govde);
      bekle(html.includes('class="icon placeholder"'), 'simge yer tutucusu yok');
      bekle(html.includes('5.0 (API 21)'), 'En az Android 5.0 (API 21) yok');
      await c.del(`/api/builds/${b.id}`);
      return { detay: 'literal etiket + yer tutucu simge' };
    });

    await test('I17', 'demo-webp.apk: webp simge icon.webp olarak sunuluyor', async () => {
      const dosya = join(FIX, 'demo-webp.apk');
      if (!existsSync(dosya)) return { skip: true, detay: 'demo-webp.apk fiksturu yok' };
      const y = await c.yukle(dosya);
      esit(y.status, 201, `status (${JSON.stringify(y.govde).slice(0, 200)})`);
      const b = y.govde.build;
      bekle(/\/icon\.webp\?k=/.test(b.iconUrl ?? ''), `iconUrl beklenmedik: ${b.iconUrl}`);
      const yol = b.iconUrl.replace('https://ota.test', '');
      const r = await c.get(yol, { ham: true });
      esit(r.status, 200, 'status');
      esit(r.headers.get('content-type'), 'image/webp', 'content-type');
      esit(r.govde.subarray(0, 4).toString('ascii'), 'RIFF', 'RIFF');
      esit(r.govde.subarray(8, 12).toString('ascii'), 'WEBP', 'WEBP');
      esit((await c.get(yol.replace('icon.webp', 'icon.png'))).status, 404, 'webp simgeli kayitta icon.png');
      await c.del(`/api/builds/${b.id}`);
      return { detay: `${r.govde.length} bayt webp` };
    });

    await test('I18', 'Sifreli APK linki: form, yanlis sifre, dogru sifrede indirme linki', async () => {
      const y = await c.yukle(APK, { password: 'apk-sifre' });
      esit(y.status, 201, 'upload');
      const b = y.govde.build;
      const acik = new Istemci(s.taban);
      const form = String((await acik.get(`/i/${b.token}`, ANDROID)).govde);
      bekle(/type="password"/.test(form), 'sifre formu yok');
      bekle(!form.includes('app.apk?k='), 'sifresiz sayfada indirme linki gorunuyor!');
      const basliklar = { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': ANDROID_UA };
      const yanlis = await acik.istek(`/i/${b.token}`, { method: 'POST', headers: basliklar, body: 'password=yanlis' });
      bekle(/hatali/i.test(String(yanlis.govde)), 'yanlis sifre mesaji yok');
      const dogru = await acik.istek(`/i/${b.token}`, { method: 'POST', headers: basliklar, body: 'password=apk-sifre' });
      bekle(String(dogru.govde).includes('app.apk?k='), 'dogru sifrede indirme linki cikmadi');
      await c.del(`/api/builds/${b.id}`);
      return { detay: 'sifre korumasi APK icin de calisiyor' };
    });

    await test('I19', 'Kalici silme: APK kaydi ve dosyalari gidiyor, 404', async () => {
      bekle(apkBuild, 'I1 basarisiz');
      esit((await c.del(`/api/builds/${apkBuild.id}`)).status, 200, 'delete');
      esit((await c.get(`/api/builds/${apkBuild.id}`)).status, 404, 'GET 404');
      esit((await c.get(`/i/${apkBuild.token}`, ANDROID)).status, 404, 'sayfa 404');
      esit(existsSync(join(s.veriDizini, 'uploads', apkBuild.id)), false, 'yukleme klasoru silinmeli');
      return { detay: 'tamamen silindi' };
    });

    /* --------------------------------------------------------------- */
    grup('G — Kimlik (devam)');

    await test('G7', 'Sifre degisimi sonrasi eski sifre calismiyor', async () => {
      const yeni = 'DegistirilmisSifre-99!';
      const r = await c.post('/api/auth/password', { currentPassword: SIFRE, newPassword: yeni });
      esit(r.status, 200, 'degistir');

      esit((await new Istemci(s.taban).post('/api/auth/login', { password: SIFRE })).status, 401, 'eski sifre');
      esit((await new Istemci(s.taban).post('/api/auth/login', { password: yeni })).status, 200, 'yeni sifre');

      await c.post('/api/auth/password', { currentPassword: yeni, newPassword: SIFRE });
      return { detay: 'eski sifre gecersiz' };
    });

    await test('G7b', 'Yanlis mevcut sifre ile degisim reddediliyor', async () => {
      const r = await c.post('/api/auth/password', { currentPassword: 'yanlis', newPassword: 'YeterinceUzunSifre1' });
      bekle(r.status >= 400, `status=${r.status}`);
      bekle(/mevcut sifre/i.test(r.govde.error ?? ''), r.govde.error);
      return { detay: r.govde.error };
    });

    await test('G7c', 'Kisa yeni sifre reddediliyor', async () => {
      const r = await c.post('/api/auth/password', { currentPassword: SIFRE, newPassword: 'kisa' });
      bekle(r.status >= 400, `status=${r.status}`);
      bekle(/en az \d+ karakter/i.test(r.govde.error ?? ''), r.govde.error);
      return { detay: r.govde.error };
    });

    await test('G4', 'Cikis: cerez silinir, korunan uc 401', async () => {
      const r = await c.post('/api/auth/logout');
      esit(r.status, 200, 'logout');
      const sonra = await c.get('/api/settings');
      esit(sonra.status, 401, 'cikis sonrasi settings');
      return { detay: 'oturum kapandi' };
    });
  } finally {
    await s.durdur();
    s.temizle();
  }
}

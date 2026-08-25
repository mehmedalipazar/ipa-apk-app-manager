/**
 * A grubu — Ortam degiskeni okuma testleri.
 *
 * Her test izole bir sunucu ornegi (kendi DATA_DIR + portu) baslatir ve
 * degiskenin GOZLEMLENEBILIR bir etkisi olup olmadigini dogrular.
 */
import { join } from 'node:path';
import { chmodSync, existsSync } from 'node:fs';
import {
  grup, test, bekle, esit, sunucuIle, sunucuBaslat, geciciDizin, dizinSil,
  bosPort, Istemci, KOK, IOS, manifestAdresiCikar,
} from './lib/harness.mjs';

const SIFRE = 'TestSifresi-1453!';
const FIX = join(KOK, 'tests/fixtures');

/**
 * Acilis hatasi beklenen senaryolarin ortak sozlesmesi. "Kalkmadi" yetmez;
 * operatorun gorecegi cikti da sinanir:
 *   - exit kodu 1 (docker/systemd yeniden baslatma dongusu bunu gorur),
 *   - mesaj TEK bicimde: "Yapilandirma hatasi: ..." (env.ts, index.ts ve
 *     AuthError dallari ayni satiri basar),
 *   - Node stack trace'i YOK ("    at ModuleJob.run ..." satirlari). 2026-08-25
 *     oncesinde SESSION_SECRET/zod/DATA_DIR hatalari dogru mesaji 10 satir
 *     stack trace arasinda basiyordu; ADMIN_PASSWORD ise temizdi.
 */
async function acilisHatasi(env, mesajDeseni, secenekler = {}) {
  const s = await sunucuBaslat(env, secenekler);
  await s.durdur();
  s.temizle();
  bekle(!s.hazir, `sunucu kalkmamaliydi. Cikti: ${s.cikti.slice(-300)}`);
  esit(s.cikisKodu, 1, 'cikis kodu');
  bekle(mesajDeseni.test(s.cikti), `beklenen mesaj yok:\n${s.cikti.slice(-400)}`);
  bekle(/Yapilandirma hatasi:/.test(s.cikti), `mesaj "Yapilandirma hatasi:" bicimiyle basilmadi:\n${s.cikti.slice(-400)}`);
  bekle(!/^\s+at .+\(.+:\d+:\d+\)/m.test(s.cikti), `ciktida stack trace var:\n${s.cikti.slice(-400)}`);
  return s.cikti;
}

export async function calistir() {
  grup('A — Ortam degiskeni okuma');

  /* A2 — PORT */
  await test('A2', 'PORT okunuyor (belirtilen portta dinliyor)', async () => {
    const port = await bosPort();
    return sunucuIle({ PORT: String(port) }, async (s) => {
      bekle(s.hazir, `Sunucu ${port} portunda kalkmadi. Cikti: ${s.cikti.slice(-400)}`);
      const r = await fetch(`http://127.0.0.1:${port}/healthz`);
      esit(r.status, 200, 'healthz');
      return { detay: `port ${port} dinleniyor` };
    });
  });

  /* A3 — HOST */
  await test('A3', 'HOST okunuyor (127.0.0.1 disina acilmiyor)', async () => {
    return sunucuIle({ HOST: '127.0.0.1' }, async (s) => {
      bekle(s.hazir, 'kalkmadi');
      // Makinenin LAN adresinden erisilememeli.
      const { networkInterfaces } = await import('node:os');
      const lan = Object.values(networkInterfaces())
        .flat()
        .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
      if (!lan) return { detay: 'LAN adresi yok, yalnizca loopback dogrulandi' };
      let erisildi = false;
      try {
        const r = await fetch(`http://${lan}:${s.port}/healthz`, { signal: AbortSignal.timeout(1500) });
        erisildi = r.ok;
      } catch {
        erisildi = false;
      }
      bekle(!erisildi, `HOST=127.0.0.1 olmasina ragmen ${lan} uzerinden erisildi`);
      return { detay: `${lan}:${s.port} kapali, loopback acik` };
    });
  });

  /* A4 — DATA_DIR */
  await test('A4', 'DATA_DIR okunuyor (DB ve uploads orada olusuyor)', async () => {
    const dizin = geciciDizin();
    try {
      return await sunucuIle({}, async (s) => {
        bekle(s.hazir, 'kalkmadi');
        bekle(existsSync(join(dizin, 'ipa-ota.db')), `${dizin}/ipa-ota.db olusmadi`);
        return { detay: `${s.dosyalar().join(', ')}` };
      }, { dataDir: dizin });
    } finally {
      dizinSil(dizin);
    }
  });

  /* A5 — LOG_LEVEL */
  await test('A5', 'LOG_LEVEL okunuyor (debug vs fatal cikti farki)', async () => {
    const debugCikti = await sunucuIle({ LOG_LEVEL: 'debug' }, async (s) => {
      bekle(s.hazir, 'kalkmadi');
      await s.istemci().get('/healthz');
      await new Promise((r) => setTimeout(r, 400));
      return s.cikti;
    });
    const fatalCikti = await sunucuIle({ LOG_LEVEL: 'fatal' }, async (s) => {
      bekle(s.hazir, 'kalkmadi');
      await s.istemci().get('/healthz');
      await new Promise((r) => setTimeout(r, 400));
      return s.cikti;
    });
    bekle(
      debugCikti.length > fatalCikti.length,
      `debug ciktisi (${debugCikti.length}B) fatal ciktisindan (${fatalCikti.length}B) buyuk degil`,
    );
    return { detay: `debug=${debugCikti.length}B  fatal=${fatalCikti.length}B` };
  });

  /* A6 — TRUST_PROXY */
  await test('A6', 'TRUST_PROXY okunuyor (X-Forwarded-For yorumlaniyor)', async () => {
    const oku = (deger) =>
      sunucuIle({ TRUST_PROXY: deger, LOG_LEVEL: 'info' }, async (s) => {
        bekle(s.hazir, 'kalkmadi');
        await s.istemci().get('/healthz', { headers: { 'x-forwarded-for': '203.0.113.77' } });
        await new Promise((r) => setTimeout(r, 500));
        return s.cikti;
      });
    const acik = await oku('true');
    const kapali = await oku('false');
    const acikVar = acik.includes('203.0.113.77');
    const kapaliVar = kapali.includes('203.0.113.77');
    bekle(acikVar, 'TRUST_PROXY=true iken X-Forwarded-For IP log a yansimadi');
    bekle(!kapaliVar, 'TRUST_PROXY=false iken IP yine de guvenilmis gorunuyor');
    return { detay: 'true→203.0.113.77 loglandi, false→loglanmadi' };
  });

  /* A7 — PUBLIC_BASE_URL, temiz DB */
  await test('A7', 'PUBLIC_BASE_URL temiz DB de config.baseUrl a aktariliyor', async () => {
    return sunucuIle({ PUBLIC_BASE_URL: 'https://a7.test', ADMIN_PASSWORD: SIFRE }, async (s) => {
      bekle(s.hazir, 'kalkmadi');
      const c = s.istemci();
      await c.post('/api/auth/login', { password: SIFRE });
      const r = await c.get('/api/settings');
      esit(r.status, 200, 'settings');
      esit(r.govde.values.baseUrl, 'https://a7.test', 'baseUrl');
      return { detay: 'env → DB bosken okundu' };
    });
  });

  /* A8 — DB doluyken env yok sayiliyor */
  await test('A8', 'PUBLIC_BASE_URL her aciliste DB deki degeri EZIYOR', async () => {
    // baseUrl bilincli olarak asimetriktir: panelden degistirilemez, DB'ye
    // yazilmaz ve her aciliste ortam degiskeninden yeniden okunur. Aksi halde
    // panelden bir kez kaydedilen adres, .env guncellense bile yapisirdi.
    const dizin = geciciDizin();
    try {
      // 1. acilis: env'den gelir; panelden degistirmeye calis -> yok sayilmali
      await sunucuIle({ PUBLIC_BASE_URL: 'https://ilk.test', ADMIN_PASSWORD: SIFRE }, async (s) => {
        bekle(s.hazir, 'kalkmadi');
        const c = s.istemci();
        await c.post('/api/auth/login', { password: SIFRE });
        const r = await c.put('/api/settings', { baseUrl: 'https://panelden.test' });
        esit(r.status, 200, 'PUT settings');
        esit(r.govde.values.baseUrl, 'https://ilk.test', 'panelden degisiklik yok sayilmali');
      }, { dataDir: dizin });

      // 2. acilis: env baska bir deger -> ENV kazanmali
      return await sunucuIle({ PUBLIC_BASE_URL: 'https://degisti.test', ADMIN_PASSWORD: SIFRE }, async (s) => {
        bekle(s.hazir, 'kalkmadi');
        const c = s.istemci();
        await c.post('/api/auth/login', { password: SIFRE });
        const r = await c.get('/api/settings');
        esit(r.govde.values.baseUrl, 'https://degisti.test', 'baseUrl (env kazanmali)');
        return { detay: 'env > DB onceligi dogru' };
      }, { dataDir: dizin });
    } finally {
      dizinSil(dizin);
    }
  });

  /* A9 — sondaki / kirpma */
  await test('A9', 'PUBLIC_BASE_URL sondaki / karakterleri kirpiliyor', async () => {
    return sunucuIle({ PUBLIC_BASE_URL: 'https://a9.test///', ADMIN_PASSWORD: SIFRE }, async (s) => {
      bekle(s.hazir, 'kalkmadi');
      const c = s.istemci();
      await c.post('/api/auth/login', { password: SIFRE });
      const r = await c.get('/api/settings');
      esit(r.govde.values.baseUrl, 'https://a9.test', 'baseUrl');
      return { detay: 'kirpma calisiyor' };
    });
  });

  /* A10 — ADMIN_PASSWORD ilk acilis */
  await test('A10', 'ADMIN_PASSWORD ilk acilista okunuyor (giris yapilabiliyor)', async () => {
    return sunucuIle({ ADMIN_PASSWORD: SIFRE }, async (s) => {
      bekle(s.hazir, 'kalkmadi');
      const c = s.istemci();
      const r = await c.post('/api/auth/login', { password: SIFRE });
      esit(r.status, 200, 'login');
      const me = await c.get('/api/auth/me');
      esit(me.govde.authenticated, true, 'authenticated');
      return { detay: 'giris basarili' };
    });
  });

  /* A11 — sonraki aciliste yok sayiliyor */
  await test('A11', 'ADMIN_PASSWORD sonraki aciliste YOK SAYILIYOR (panelden degisen sifre korunur)', async () => {
    const dizin = geciciDizin();
    const yeniSifre = 'YeniSifre-2024!';
    try {
      await sunucuIle({ ADMIN_PASSWORD: SIFRE }, async (s) => {
        bekle(s.hazir, 'kalkmadi');
        const c = s.istemci();
        await c.post('/api/auth/login', { password: SIFRE });
        const r = await c.post('/api/auth/password', { currentPassword: SIFRE, newPassword: yeniSifre });
        esit(r.status, 200, 'sifre degistir');
      }, { dataDir: dizin });

      return await sunucuIle({ ADMIN_PASSWORD: SIFRE }, async (s) => {
        bekle(s.hazir, 'kalkmadi');
        const c = s.istemci();
        const eski = await c.post('/api/auth/login', { password: SIFRE });
        esit(eski.status, 401, 'eski (env) sifre reddedilmeli');
        const yeni = await new Istemci(s.taban).post('/api/auth/login', { password: yeniSifre });
        esit(yeni.status, 200, 'yeni sifre kabul edilmeli');
        return { detay: 'env sifre restart ta geri gelmiyor' };
      }, { dataDir: dizin });
    } finally {
      dizinSil(dizin);
    }
  });

  /* A12 — FORCE_RESET */
  await test('A12', 'ADMIN_PASSWORD_FORCE_RESET=true env sifresini geri yukluyor', async () => {
    const dizin = geciciDizin();
    const yeniSifre = 'YeniSifre-2024!';
    try {
      await sunucuIle({ ADMIN_PASSWORD: SIFRE }, async (s) => {
        const c = s.istemci();
        await c.post('/api/auth/login', { password: SIFRE });
        await c.post('/api/auth/password', { currentPassword: SIFRE, newPassword: yeniSifre });
      }, { dataDir: dizin });

      return await sunucuIle({ ADMIN_PASSWORD: SIFRE, ADMIN_PASSWORD_FORCE_RESET: 'true' }, async (s) => {
        bekle(s.hazir, 'kalkmadi');
        const r = await s.istemci().post('/api/auth/login', { password: SIFRE });
        esit(r.status, 200, 'env sifresi FORCE_RESET ile gecerli olmali');
        return { detay: 'sifirlama calisiyor' };
      }, { dataDir: dizin });
    } finally {
      dizinSil(dizin);
    }
  });

  /* A13 — kisa sifre */
  await test('A13', 'ADMIN_PASSWORD 12 karakterden kisa ise acilista hata', async () => {
    await acilisHatasi({ ADMIN_PASSWORD: 'kisa' }, /ADMIN_PASSWORD en az \d+ karakter/i);
    return { detay: 'acilista reddedildi (temiz mesaj, exit 1)' };
  });

  /* A14 — SESSION_SECRET degisimi oturumu dusurur */
  await test('A14', 'SESSION_SECRET degisimi aktif oturumlari dusuruyor', async () => {
    const dizin = geciciDizin();
    try {
      let cerez;
      await sunucuIle({ SESSION_SECRET: 'a'.repeat(64), ADMIN_PASSWORD: SIFRE }, async (s) => {
        bekle(s.hazir, 'kalkmadi');
        const c = s.istemci();
        await c.post('/api/auth/login', { password: SIFRE });
        const me = await c.get('/api/auth/me');
        esit(me.govde.authenticated, true, 'once giris olmali');
        cerez = c.cerezBasligi();
      }, { dataDir: dizin });

      return await sunucuIle({ SESSION_SECRET: 'b'.repeat(64), ADMIN_PASSWORD: SIFRE }, async (s) => {
        bekle(s.hazir, 'kalkmadi');
        const r = await s.istemci().get('/api/auth/me', { headers: { cookie: cerez } });
        esit(r.govde.authenticated, false, 'secret degisince oturum dusmeli');
        return { detay: 'oturum gecersiz kilindi' };
      }, { dataDir: dizin });
    } finally {
      dizinSil(dizin);
    }
  });

  /* A16 — prod + secret yok */
  await test('A16', 'NODE_ENV=production + SESSION_SECRET yok → acilista hata', async () => {
    await acilisHatasi(
      { NODE_ENV: 'production', SESSION_SECRET: '', ADMIN_PASSWORD: SIFRE },
      /SESSION_SECRET tanimli degil.*openssl rand -hex 32/s,
    );
    return { detay: 'prod korumasi calisiyor (temiz mesaj, exit 1)' };
  });

  /* A17 — dev + secret yok */
  await test('A17', 'NODE_ENV=development + SESSION_SECRET yok → uyari ile kalkiyor', async () => {
    return sunucuIle({ NODE_ENV: 'development', SESSION_SECRET: '' }, async (s) => {
      bekle(s.hazir, `dev de kalkmali: ${s.cikti.slice(-300)}`);
      bekle(/gecici anahtar/i.test(s.cikti), 'Gecici anahtar uyarisi yok');
      return { detay: 'gecici anahtar uretildi' };
    });
  });

  /* A16b — prod + ADMIN_PASSWORD yok */
  await test('A16b', 'NODE_ENV=production + ADMIN_PASSWORD yok → acilista hata', async () => {
    await acilisHatasi({ NODE_ENV: 'production', ADMIN_PASSWORD: '' }, /ADMIN_PASSWORD tanimli degil/i);
    return { detay: 'prod korumasi calisiyor (temiz mesaj, exit 1)' };
  });

  /* A18 — gecersiz LOG_LEVEL */
  await test('A18', 'Gecersiz LOG_LEVEL acilista reddediliyor', async () => {
    await acilisHatasi({ LOG_LEVEL: 'verbose' }, /Ortam degiskenleri gecersiz:[\s\S]*LOG_LEVEL/);
    return { detay: 'zod dogrulamasi calisiyor; hata degiskeni adiyla soyluyor' };
  });
  await test('A18b', 'Gecersiz NODE_ENV (orn. staging) acilista reddediliyor', async () => {
    // Uc deger vardir: development | production | test. "staging" gibi bir
    // deger prod korumalarini SESSIZCE devre disi birakmamali, durmali.
    await acilisHatasi({ NODE_ENV: 'staging' }, /Ortam degiskenleri gecersiz:[\s\S]*NODE_ENV/);
    return { detay: 'staging reddedildi' };
  });

  /* A19 — gecersiz PORT */
  await test('A19', 'Gecersiz PORT acilista reddediliyor', async () => {
    await acilisHatasi({ PORT: '99999' }, /Ortam degiskenleri gecersiz:[\s\S]*PORT/);
    return { detay: 'aralik dogrulamasi calisiyor' };
  });

  /* A20 — NODE_ENV log bicimi */
  await test('A20', 'NODE_ENV log bicimini degistiriyor (dev: pretty, prod: JSON)', async () => {
    const dev = await sunucuIle({ NODE_ENV: 'development' }, async (s) => {
      bekle(s.hazir, 'dev kalkmadi');
      return s.cikti;
    });
    const prod = await sunucuIle(
      { NODE_ENV: 'production', SESSION_SECRET: 'c'.repeat(64), ADMIN_PASSWORD: SIFRE },
      async (s) => {
        bekle(s.hazir, `prod kalkmadi: ${s.cikti.slice(-300)}`);
        return s.cikti;
      },
    );
    const prodJson = prod.split('\n').some((l) => l.trim().startsWith('{') && l.includes('"level"'));
    bekle(prodJson, 'production ciktisi JSON degil');
    bekle(!dev.split('\n').some((l) => l.trim().startsWith('{') && l.includes('"level"')), 'dev ciktisi JSON');
    return { detay: 'prod=JSON, dev=pretty' };
  });

  /* A21 — CORS_ORIGINS okunuyor mu */
  await test('A21', 'CORS_ORIGINS okunuyor (izinli origin CORS basligi aliyor)', async () => {
    return sunucuIle({ CORS_ORIGINS: 'http://localhost:5173' }, async (s) => {
      bekle(s.hazir, `kalkmadi: ${s.cikti.slice(-300)}`);
      bekle(/CORS acik/i.test(s.cikti), `CORS acik logu yok: ${s.cikti.slice(-300)}`);

      const izinli = await s
        .istemci()
        .get('/healthz', { headers: { origin: 'http://localhost:5173' } });
      esit(
        izinli.headers.get('access-control-allow-origin'),
        'http://localhost:5173',
        'izinli origin yansitilmali',
      );
      esit(
        izinli.headers.get('access-control-allow-credentials'),
        'true',
        'cerez gonderimi icin credentials basligi sart',
      );

      const izinsiz = await s
        .istemci()
        .get('/healthz', { headers: { origin: 'http://kotu.example' } });
      bekle(
        izinsiz.headers.get('access-control-allow-origin') === null,
        `izinsiz origin'e ACAO verildi: ${izinsiz.headers.get('access-control-allow-origin')}`,
      );
      return { detay: 'izinli origin yansitildi, izinsiz reddedildi' };
    });
  });

  /* A21b — gecersiz CORS_ORIGINS bicimi sunucuyu dusurmeli */
  await test('A21b', 'Gecersiz CORS_ORIGINS (yol iceren adres) sunucuyu dusuruyor', async () => {
    await acilisHatasi({ CORS_ORIGINS: 'http://localhost:5173/admin' }, /CORS_ORIGINS gecersiz/i);
    return { detay: 'baslangicta reddedildi' };
  });

  /* A21c — ayri origin varsa cerez SameSite=None + Secure olmali */
  await test('A21c', 'CORS_ORIGINS doluysa oturum cerezi SameSite=None; Secure oluyor', async () => {
    return sunucuIle(
      { CORS_ORIGINS: 'http://localhost:5173', ADMIN_PASSWORD: 'TestSifresi-1453!' },
      async (s) => {
        bekle(s.hazir, `kalkmadi: ${s.cikti.slice(-300)}`);
        const r = await s
          .istemci()
          .post('/api/auth/login', { password: 'TestSifresi-1453!' }, {
            headers: { origin: 'http://localhost:5173' },
          });
        esit(r.status, 200, 'giris');
        const cerez = (r.headers.getSetCookie?.() ?? []).join(' | ');
        bekle(/SameSite=None/i.test(cerez), `SameSite=None yok: ${cerez}`);
        bekle(/Secure/i.test(cerez), `Secure yok: ${cerez}`);
        bekle(/HttpOnly/i.test(cerez), `HttpOnly yok: ${cerez}`);
        return { detay: 'HttpOnly; Secure; SameSite=None' };
      },
    );
  });

  /* A22 — bilinmeyen degisken */
  await test('A22', 'Bilinmeyen ortam degiskeni yok sayiliyor', async () => {
    return sunucuIle({ SACMA_DEGISKEN: 'evet' }, async (s) => {
      bekle(s.hazir, `bilinmeyen degisken sunucuyu dusurdu: ${s.cikti.slice(-300)}`);
      return { detay: 'yok sayildi' };
    });
  });

  /* A1 — yukleme sirasi (.env -> .env.local -> shell) */
  await test('A1', 'Yukleme sirasi: .env → .env.local → shell (sonuncu kazanir)', async () => {
    const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { spawn } = await import('node:child_process');

    const dizin = mkdtempSync(join((await import('node:os')).tmpdir(), 'env-sira-'));
    try {
      writeFileSync(join(dizin, '.env'), 'A_DEGER=env\nB_DEGER=env\nC_DEGER=env\n');
      writeFileSync(join(dizin, '.env.local'), 'B_DEGER=local\nC_DEGER=local\n');

      // backend/package.json ile AYNI bayrak sirasi
      const cikti = await new Promise((res, rej) => {
        const p = spawn(
          process.execPath,
          [
            `--env-file-if-exists=${join(dizin, '.env')}`,
            `--env-file-if-exists=${join(dizin, '.env.local')}`,
            '-e',
            'console.log(JSON.stringify({A:process.env.A_DEGER,B:process.env.B_DEGER,C:process.env.C_DEGER}))',
          ],
          { env: { PATH: process.env.PATH, C_DEGER: 'shell' } },
        );
        let out = '';
        p.stdout.on('data', (d) => (out += d));
        p.stderr.on('data', (d) => (out += d));
        p.on('exit', () => res(out));
        p.on('error', rej);
      });

      const sonuc = JSON.parse(cikti.trim().split('\n').pop());
      esit(sonuc.A, 'env', 'yalnizca .env te tanimli');
      esit(sonuc.B, 'local', '.env.local, .env i ezmeli');
      esit(sonuc.C, 'shell', 'kabuk degiskeni her ikisini de ezmeli');

      // Uygulamanin script leri ayni sirayi kullaniyor mu?
      //
      // Yeni yapida her ortamin kendi dosyasi var ve .env.local HER IKISINI de
      // ezmeli:  .env.development | .env.production  ->  .env.local  ->  kabuk
      const { readFileSync } = await import('node:fs');
      const pkg = JSON.parse(readFileSync(join(KOK, 'backend/package.json'), 'utf8'));
      const ortamDosyasi = { dev: '.env.development', start: '.env.production' };
      for (const [ad, taban] of Object.entries(ortamDosyasi)) {
        const komut = pkg.scripts[ad];
        bekle(komut.includes(taban), `${ad} script i ${taban} okumuyor: ${komut}`);
        bekle(
          komut.indexOf('.env.local') > komut.indexOf(taban),
          `${ad} script inde .env.local, ${taban} ten SONRA gelmiyor: ${komut}`,
        );
      }
      return { detay: 'A=env, B=local, C=shell — sira dogru; dev+start scriptleri de ayni' };
    } finally {
      rmSync(dizin, { recursive: true, force: true });
    }
  });

  await test('A-baseurl-bicim', 'Gecersiz PUBLIC_BASE_URL aciliste reddediliyor (sessizce bosa dusmuyor)', async () => {
    // Sema olmadan verilen adres ("alan.adi" gibi) eskiden ayar yuklenirken
    // sessizce ATILIYOR ve uyari "PUBLIC_BASE_URL ayarlayin" diyordu — deger
    // ayarli ama gecersizken yanlis teshis. Artik acilista acikca durmali.
    await acilisHatasi({ ADMIN_PASSWORD: SIFRE, PUBLIC_BASE_URL: 'ipa-ios.ornek.local' }, /PUBLIC_BASE_URL/);
    return { detay: 'acilis hatasi + mesajda degisken adi' };
  });

  /* --- 2026-08-25: env senaryo matrisindeki bosluklar ---------------------- */

  await test('A23', 'COOKIE_SAMESITE=none + COOKIE_SECURE=false acilista reddediliyor', async () => {
    // Tarayici SameSite=None cerezini Secure olmadan yok sayar; sonuc
    // kullaniciya "giris yapilamiyor" olarak gorunurdu. Acilista durmali.
    await acilisHatasi(
      { COOKIE_SAMESITE: 'none', COOKIE_SECURE: 'false' },
      /COOKIE_SAMESITE=none ile COOKIE_SECURE=false birlikte kullanilamaz/,
    );
    return { detay: 'cerez kombinasyonu reddedildi' };
  });

  await test('A24', 'DATA_DIR yazilabilir degilse acilista temiz hata (ham EACCES stack trace yok)', async () => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      return { skip: true, detay: 'root olarak kosuyor; dizin izni engel olmaz' };
    }
    const kok = geciciDizin();
    const veri = join(kok, 'veri');
    chmodSync(kok, 0o500); // icine dizin olusturulamaz
    try {
      await acilisHatasi({}, /DATA_DIR yazilabilir degil .*EACCES/, { dataDir: veri });
      return { detay: 'EACCES → "DATA_DIR yazilabilir degil (..., EACCES)"' };
    } finally {
      chmodSync(kok, 0o700);
      dizinSil(kok);
    }
  });

  await test('A25', 'ADMIN_PASSWORD yokken (dev): kalkar, /api/auth/me configured=false, login 503 + mesaj', async () => {
    // Frontend'in "yapilandirilmamis" teshisini dayandirdigi TEK sinyal budur:
    // sunucuya ulasildi VE configured=false. (Ulasilamama ise hic yanit yok /
    // nginx 502 HTML — bkz. C14 ve frontend/src/api.test.ts.)
    return sunucuIle({ ADMIN_PASSWORD: '' }, async (s) => {
      bekle(s.hazir, `dev'de sifresiz kalkmali: ${s.cikti.slice(-300)}`);
      const c = s.istemci();
      const me = await c.get('/api/auth/me');
      esit(me.status, 200, '/api/auth/me');
      esit(me.govde.configured, false, 'configured');
      esit(me.govde.authenticated, false, 'authenticated');

      const giris = await c.post('/api/auth/login', { password: 'herhangi-bir-sey' });
      esit(giris.status, 503, 'login');
      bekle(/ADMIN_PASSWORD/.test(giris.govde?.error ?? ''), `503 mesaji degiskeni soylemiyor: ${JSON.stringify(giris.govde)}`);

      // Yapilandirma eksikligi yetki katmanini GEVSETMEZ: korunan uclar 401.
      esit((await c.get('/api/builds')).status, 401, '/api/builds');

      await new Promise((r) => setTimeout(r, 300));
      bekle(/Admin sifresi tanimli degil/.test(s.cikti), 'acilis loguna uyari dusmedi');
      return { detay: 'configured=false, login 503 (ADMIN_PASSWORD), korunan uc 401, log uyarisi var' };
    });
  });

  await test('A15', 'SESSION_SECRET degisimi imzali kurulum linklerini (manifest) dusuruyor', async () => {
    // A14 oturum cerezini sinar; imzali URL'ler de ayni anahtarla HMAC'lenir
    // (domain/links/token.ts). installd cerez tasimadigi icin kurulumun tek
    // yetkisi bu imzadir — secret degisince eski linkler 403 olmali.
    const dizin = geciciDizin();
    const ortak = { ADMIN_PASSWORD: SIFRE, PUBLIC_BASE_URL: 'https://ota.test' };
    try {
      let yol;
      await sunucuIle({ ...ortak, SESSION_SECRET: 'a'.repeat(64) }, async (s) => {
        bekle(s.hazir, 'kalkmadi');
        const c = s.istemci();
        await c.post('/api/auth/login', { password: SIFRE });
        const y = await c.yukle(join(FIX, 'demo-a.ipa'), { ttlHours: 24 });
        esit(y.status, 201, 'yukleme');
        const html = String((await c.get(`/i/${y.govde.build.token}`, IOS)).govde);
        yol = manifestAdresiCikar(html).replace('https://ota.test', '');
        esit((await c.get(yol)).status, 200, 'ayni secret ile manifest');
      }, { dataDir: dizin });

      return await sunucuIle({ ...ortak, SESSION_SECRET: 'b'.repeat(64) }, async (s) => {
        bekle(s.hazir, 'kalkmadi');
        const r = await s.istemci().get(yol);
        esit(r.status, 403, 'farkli secret ile manifest');
        return { detay: 'ayni imzali adres: eski secret 200, yeni secret 403' };
      }, { dataDir: dizin });
    } finally {
      dizinSil(dizin);
    }
  });
}

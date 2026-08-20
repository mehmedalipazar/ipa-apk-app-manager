/**
 * A grubu — Ortam degiskeni okuma testleri.
 *
 * Her test izole bir sunucu ornegi (kendi DATA_DIR + portu) baslatir ve
 * degiskenin GOZLEMLENEBILIR bir etkisi olup olmadigini dogrular.
 */
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import {
  grup, test, bekle, esit, sunucuIle, sunucuBaslat, geciciDizin, dizinSil,
  bosPort, Istemci, KOK,
} from './lib/harness.mjs';

const SIFRE = 'TestSifresi-1453!';

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
    const s = await sunucuBaslat({ ADMIN_PASSWORD: 'kisa' });
    await s.durdur();
    s.temizle();
    bekle(!s.hazir, 'Kisa sifreye ragmen sunucu kalkti');
    bekle(/en az \d+ karakter/i.test(s.cikti), `Beklenen hata mesaji yok: ${s.cikti.slice(-300)}`);
    return { detay: 'acilista reddedildi' };
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
    const s = await sunucuBaslat({ NODE_ENV: 'production', SESSION_SECRET: '', ADMIN_PASSWORD: SIFRE });
    await s.durdur();
    s.temizle();
    bekle(!s.hazir, 'SESSION_SECRET olmadan production kalkti');
    bekle(/SESSION_SECRET/i.test(s.cikti), `Beklenen hata yok: ${s.cikti.slice(-300)}`);
    return { detay: 'prod korumasi calisiyor' };
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
    const s = await sunucuBaslat({ NODE_ENV: 'production', ADMIN_PASSWORD: '' });
    await s.durdur();
    s.temizle();
    bekle(!s.hazir, 'ADMIN_PASSWORD olmadan production kalkti');
    bekle(/ADMIN_PASSWORD/i.test(s.cikti), `Beklenen hata yok: ${s.cikti.slice(-300)}`);
    return { detay: 'prod korumasi calisiyor' };
  });

  /* A18 — gecersiz LOG_LEVEL */
  await test('A18', 'Gecersiz LOG_LEVEL acilista reddediliyor', async () => {
    const s = await sunucuBaslat({ LOG_LEVEL: 'verbose' });
    await s.durdur();
    s.temizle();
    bekle(!s.hazir, 'Gecersiz LOG_LEVEL ile kalkti');
    bekle(/Ortam degiskenleri gecersiz/i.test(s.cikti), `Beklenen zod hatasi yok: ${s.cikti.slice(-300)}`);
    return { detay: 'zod dogrulamasi calisiyor' };
  });

  /* A19 — gecersiz PORT */
  await test('A19', 'Gecersiz PORT acilista reddediliyor', async () => {
    const s = await sunucuBaslat({ PORT: '99999' });
    await s.durdur();
    s.temizle();
    bekle(!s.hazir, 'PORT=99999 ile kalkti');
    bekle(/Ortam degiskenleri gecersiz|PORT/i.test(s.cikti), `Beklenen hata yok: ${s.cikti.slice(-300)}`);
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
    return sunucuIle({ CORS_ORIGINS: 'http://localhost:5173/admin' }, async (s) => {
      bekle(!s.hazir, 'Gecersiz CORS_ORIGINS ile kalkti');
      bekle(/CORS_ORIGINS gecersiz/i.test(s.cikti), `Beklenen hata mesaji yok: ${s.cikti.slice(-300)}`);
      return { detay: 'baslangicta reddedildi' };
    });
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
    const s = await sunucuBaslat({ ADMIN_PASSWORD: 'TestSifresi-1453!', PUBLIC_BASE_URL: 'ipa-ios.ornek.local' });
    try {
      bekle(!s.hazir, 'sunucu gecersiz PUBLIC_BASE_URL ile ayaga kalkmamaliydi');
      bekle(/PUBLIC_BASE_URL/.test(s.cikti), `hata mesaji degiskeni soylemiyor:\n${s.cikti.slice(-300)}`);
    } finally {
      await s.durdur();
      s.temizle();
    }
    return { detay: 'acilis hatasi + mesajda degisken adi' };
  });
}

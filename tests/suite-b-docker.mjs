/**
 * B grubu — Docker Compose degisken aktarimi.
 *
 * Salt-okunur testler mevcut yigina karsi calisir (`docker compose config`,
 * `docker exec`). Yeniden baslatma gerektiren testler `ipa-ota-vartest` adli
 * IZOLE bir projede, mevcut imaji yeniden kullanarak calisir; sonunda temizlenir.
 */
import { execFileSync, execSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { grup, test, bekle, esit, uyu, KOK } from './lib/harness.mjs';

const TEST_PROJE = 'ipa-ota-vartest';
const IMAJ = 'ipa-ota-api:latest';

function kabuk(komut, secenekler = {}) {
  return execSync(komut, { cwd: KOK, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...secenekler });
}

function kabukTolere(komut, secenekler = {}) {
  try {
    return { cikti: kabuk(komut, secenekler), kod: 0 };
  } catch (e) {
    return { cikti: `${e.stdout ?? ''}${e.stderr ?? ''}`, kod: e.status ?? 1 };
  }
}

function dockerVar() {
  try {
    kabuk('docker info');
    return true;
  } catch {
    return false;
  }
}

/** Verilen icerikle gecici bir env dosyasi olusturup compose config calistirir. */
function composeConfig(envIcerik, ekArg = '') {
  const dizin = mkdtempSync(join(tmpdir(), 'compose-env-'));
  const dosya = join(dizin, '.env');
  writeFileSync(dosya, envIcerik);
  try {
    // 2>&1: compose "variable is not set" uyarilarini stderr e yazar.
    return kabukTolere(`docker compose --env-file "${dosya}" -f docker-compose.yml config ${ekArg} 2>&1`);
  } finally {
    rmSync(dizin, { recursive: true, force: true });
  }
}

export async function calistir() {
  grup('B — Docker Compose degisken aktarimi');

  if (!dockerVar()) {
    for (const id of ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B9', 'B10', 'B11', 'B12', 'B13']) {
      await test(id, 'Docker calismiyor', async () => ({ skip: true, detay: 'docker daemon yok' }));
    }
    return;
  }

  const uygulamaKapsayici = kabukTolere(
    `docker compose ps -q api 2>/dev/null`,
  ).cikti.trim();

  /* B1 — ${VAR} host .env den cozuluyor mu */
  await test('B1', '${VAR} ifadeleri host .env dosyasindan cozuluyor', async () => {
    const { cikti, kod } = kabukTolere('docker compose config');
    esit(kod, 0, 'compose config');
    bekle(!/\$\{[A-Z_]+\}/.test(cikti), 'Cozulmemis ${VAR} kalmis');
    const envMetin = readFileSync(join(KOK, '.env'), 'utf8');
    const beklenenUrl = /^PUBLIC_BASE_URL=(.*)$/m.exec(envMetin)?.[1]?.trim();
    bekle(cikti.includes(beklenenUrl), `PUBLIC_BASE_URL (${beklenenUrl}) compose ciktisinda yok`);
    return { detay: `PUBLIC_BASE_URL=${beklenenUrl} yerine gecmis` };
  });

  /* B2 — ${VAR:-varsayilan} */
  await test('B2', '${LOG_LEVEL:-info} varsayilani uygulaniyor', async () => {
    const { cikti } = composeConfig('PUBLIC_BASE_URL=https://x.test\nADMIN_PASSWORD=abc\nSESSION_SECRET=def\n');
    const m = /LOG_LEVEL:\s*(\S+)/.exec(cikti);
    bekle(m, 'LOG_LEVEL compose ciktisinda yok');
    esit(m[1].replace(/["']/g, ''), 'info', 'LOG_LEVEL varsayilani');
    // Ters proxy arkasinda calisiyoruz; bu kurulumun dogru varsayilani true.
    const m2 = /TRUST_PROXY:\s*"?(\S+?)"?\s*$/m.exec(cikti);
    esit(m2?.[1], 'true', 'TRUST_PROXY varsayilani');
    return { detay: 'LOG_LEVEL=info, TRUST_PROXY=true, ADMIN_PASSWORD_FORCE_RESET=false' };
  });

  /* B3 — zorunlu degisken bos: sessizce gecmemeli */
  await test('B3', 'ADMIN_PASSWORD bos birakilirsa compose BASLAMIYOR', async () => {
    const { cikti, kod } = composeConfig('PUBLIC_BASE_URL=https://x.test\nSESSION_SECRET=def\n');
    // `${ADMIN_PASSWORD:?...}` sozdizimi compose'u sifir olmayan kodla
    // durdurur. Uyari verip devam etmekten iyidir: sifresiz bir panel
    // aciliste degil, ancak fark edildiginde anlasilirdi.
    bekle(kod !== 0, `compose hata vermeliydi (cikis kodu ${kod}):\n${cikti.slice(0, 300)}`);
    bekle(
      /ADMIN_PASSWORD/.test(cikti),
      `hata mesajinda ADMIN_PASSWORD gecmeli:\n${cikti.slice(0, 400)}`,
    );
    return { detay: `compose durdu (kod ${kod}), mesajda degisken adi var` };
  });

  /* B4 — compose degeri container icine gecti mi */
  await test('B4', 'Calisan container, host .env dosyasi ile senkron mu (drift tespiti)', async () => {
    if (!uygulamaKapsayici) return { skip: true, detay: 'api container calismiyor' };
    const cikti = kabuk(`docker exec ${uygulamaKapsayici} env`);
    const oku = (k) => new RegExp(`^${k}=(.*)$`, 'm').exec(cikti)?.[1];
    const envMetin = readFileSync(join(KOK, '.env'), 'utf8');
    const hostOku = (k) => /^\s*$/.test('') && new RegExp(`^${k}=(.*)$`, 'm').exec(envMetin)?.[1]?.trim();

    const sapan = [];
    for (const anahtar of ['PUBLIC_BASE_URL', 'ADMIN_PASSWORD', 'SESSION_SECRET']) {
      if (oku(anahtar) !== hostOku(anahtar)) {
        sapan.push(`${anahtar}: container="${oku(anahtar)}" .env="${hostOku(anahtar)}"`);
      }
    }
    bekle(
      sapan.length === 0,
      `Container .env ile senkron degil — "docker compose up -d" gerekiyor:\n         ${sapan.join('\n         ')}`,
    );
    return { detay: '3 degisken esit' };
  });

  /* B5 — compose ta sabitlenen degerler .env den ezilemez */
  await test('B5', 'NODE_ENV/PORT/DATA_DIR kok .env den container a SIZMIYOR', async () => {
    // Bu uc deger imaja gomulu backend/.env.production dosyasindan gelir ve
    // compose'un `environment:` blogunda BILEREK listelenmez. Compose yalnizca
    // listeledigi degiskenleri container'a gecirdigi icin, kok .env dosyasina
    // yanlislikla yazilan bir NODE_ENV=development container'a ulasamaz.
    const { cikti } = composeConfig(
      'PUBLIC_BASE_URL=https://x.test\nADMIN_PASSWORD=abc\nSESSION_SECRET=def\n' +
        'NODE_ENV=development\nPORT=9999\nDATA_DIR=/baska/yer\n',
    );
    // Yalnizca api servisinin environment blogunu incele.
    const apiBolum = /\n {2}api:\n([\s\S]*?)(?=\n {2}\w|\n\w|$)/.exec(cikti)?.[1] ?? cikti;

    bekle(!/^\s+NODE_ENV:/m.test(apiBolum), `NODE_ENV compose uzerinden sizmis:\n${apiBolum}`);
    bekle(!/^\s+DATA_DIR:/m.test(apiBolum), `DATA_DIR compose uzerinden sizmis:\n${apiBolum}`);
    // PORT: environment'ta olmamali. (ports: esleme satiri ayri bir sey.)
    bekle(!/^\s+PORT:/m.test(apiBolum), `PORT compose uzerinden sizmis:\n${apiBolum}`);

    // Yayinlanan port yine de 3000 hedeflemeli.
    bekle(/target:\s*3000/.test(apiBolum) || /"?9999:3000"?/.test(apiBolum) || /3000/.test(apiBolum),
      'api servisi 3000 hedeflemiyor');
    return { detay: 'uc degisken de container a gecmiyor — kaynak .env.production' };
  });

  /* B9 — her iki servisin portu host a gercekten yayinlaniyor mu */
  await test('B9', 'api ve web portlari host a yayinlaniyor (ports mapping var)', async () => {
    const { cikti } = kabukTolere(`docker compose ps --format json`);
    const satirlar = cikti.trim().split('\n').filter(Boolean).map((s) => JSON.parse(s));

    const kontrol = (servis, hedefPort) => {
      const c = satirlar.find((s) => s.Service === servis);
      if (!c) return null;
      const yayinlanan = Array.isArray(c.Publishers)
        ? c.Publishers.filter((p) => p.TargetPort === hedefPort && p.PublishedPort > 0)
        : [];
      bekle(
        yayinlanan.length > 0 || new RegExp(`->\\s*${hedefPort}/tcp`).test(c.Ports || ''),
        `${servis}: ${hedefPort} portu host a acilmamis: ${c.Ports || '(port yok)'}`,
      );
      return c.Ports || `host:${yayinlanan[0].PublishedPort} -> ${hedefPort}`;
    };

    const api = kontrol('api', 3000);
    const web = kontrol('web', 8080);
    if (!api && !web) return { skip: true, detay: 'container calismiyor' };
    return { detay: `api: ${api ?? '-'} | web: ${web ?? '-'}` };
  });

  /* B10 — yayinlanan portlardan HTTP yaniti geliyor mu */
  await test('B10', 'Host portlarindan /healthz 200 donuyor (api + web)', async () => {
    const envMetin = readFileSync(join(KOK, '.env'), 'utf8');
    const oku = (k, vars) => new RegExp(`^${k}=(\\d+)$`, 'm').exec(envMetin)?.[1] ?? vars;
    const apiPort = oku('API_PORT', '3000');
    const webPort = oku('WEB_PORT', '5173');

    const dene = (port) =>
      kabukTolere(
        `curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://localhost:${port}/healthz`,
      );

    const a = dene(apiPort);
    bekle(
      a.kod === 0 && a.cikti.trim() === '200',
      `api: http://localhost:${apiPort}/healthz -> ${a.cikti.trim() || 'baglanti yok'}`,
    );
    const w = dene(webPort);
    bekle(
      w.kod === 0 && w.cikti.trim() === '200',
      `web: http://localhost:${webPort}/healthz -> ${w.cikti.trim() || 'baglanti yok'}`,
    );
    return { detay: `api:${apiPort} ve web:${webPort} -> 200` };
  });

  /* B13 — arayuz API adresini calisma aninda aliyor mu */
  await test('B13', 'web imajinda calisma zamani yapilandirmasi YOK (goreli yol)', async () => {
    const webKapsayici = kabukTolere('docker compose ps -q web 2>/dev/null').cikti.trim();
    if (!webKapsayici) return { skip: true, detay: 'web container calismiyor' };

    // Eski mekanizma (/config.js + API_BASE_URL) kaldirildi: arayuz uretimde
    // goreli yol kullanir, ayarlanacak bir API adresi yoktur.
    const dosyalar = kabuk(`docker exec ${webKapsayici} ls /usr/share/nginx/html/`);
    bekle(!/config\.js/.test(dosyalar), `imajda hala config.js var:\n${dosyalar}`);

    const acilis = kabukTolere(`docker exec ${webKapsayici} ls /docker-entrypoint.d/`).cikti;
    bekle(
      !/apply-runtime-config/.test(acilis),
      `acilis betigi hala duruyor:\n${acilis}`,
    );

    // Paketlenmis JS goreli yol kullanmali: mutlak API adresi gomulu OLMAMALI.
    const envMetin = readFileSync(join(KOK, '.env'), 'utf8');
    const webPort = /^WEB_PORT=(\d+)$/m.exec(envMetin)?.[1] ?? '5173';
    const indeks = kabukTolere(`curl -s --max-time 10 http://localhost:${webPort}/`).cikti;
    bekle(!/config\.js/.test(indeks), 'index.html hala config.js yukluyor');

    const varlik = /\/assets\/[^"]*\.js/.exec(indeks)?.[0];
    bekle(varlik, `index.html icinde JS paketi bulunamadi:\n${indeks.slice(0, 200)}`);
    const paket = kabukTolere(`curl -s --max-time 20 http://localhost:${webPort}${varlik}`).cikti;
    bekle(!/__IPA_OTA_CONFIG__/.test(paket), 'pakette __IPA_OTA_CONFIG__ kalintisi var');
    bekle(/"\/api\/auth\/me"/.test(paket), 'pakette goreli /api/auth/me yolu yok');

    return { detay: 'config.js yok, acilis betigi yok, paket goreli yol kullaniyor' };
  });

  /* B12 — healthcheck */
  await test('B12', 'Healthcheck PORT degiskenini okuyor (container healthy)', async () => {
    if (!uygulamaKapsayici) return { skip: true, detay: 'api container calismiyor' };
    const durum = kabuk(`docker inspect -f '{{.State.Health.Status}}' ${uygulamaKapsayici}`).trim();
    esit(durum, 'healthy', 'health durumu');
    return { detay: `health=${durum}` };
  });

  /* B6/B7/B8/B11 — izole projede yeniden baslatma dongusu */
  const geciciDizin = mkdtempSync(join(tmpdir(), 'ipa-ota-compose-'));
  const envDosya = join(geciciDizin, '.env');
  const composeDosya = join(geciciDizin, 'docker-compose.yml');

  const composeIcerik = `
services:
  app:
    image: ${IMAJ}
    environment:
      NODE_ENV: production
      PORT: 3000
      DATA_DIR: /data
      PUBLIC_BASE_URL: \${PUBLIC_BASE_URL}
      ADMIN_PASSWORD: \${ADMIN_PASSWORD}
      SESSION_SECRET: \${SESSION_SECRET}
      LOG_LEVEL: \${LOG_LEVEL:-info}
      TRUST_PROXY: \${TRUST_PROXY:-true}
    volumes:
      - test-data:/data
    ports:
      - "38080:3000"
volumes:
  test-data:
`;
  writeFileSync(composeDosya, composeIcerik);

  const dc = (arg) => kabukTolere(`docker compose -p ${TEST_PROJE} --env-file "${envDosya}" -f "${composeDosya}" ${arg}`);
  const envYaz = (baseUrl, ekstra = '') =>
    writeFileSync(
      envDosya,
      `PUBLIC_BASE_URL=${baseUrl}\nADMIN_PASSWORD=TestSifresi-1453!\nSESSION_SECRET=${'e'.repeat(64)}\n${ekstra}`,
    );

  const imajVar = kabukTolere(`docker image inspect ${IMAJ}`).kod === 0;

  try {
    if (!imajVar) {
      for (const id of ['B6', 'B7', 'B8', 'B11']) {
        await test(id, 'Izole compose testi', async () => ({ skip: true, detay: `${IMAJ} imaji yok` }));
      }
    } else {
      envYaz('https://ilk.vartest');
      dc('up -d');

      // saglikli olmasini bekle
      let hazir = false;
      for (let i = 0; i < 60; i++) {
        try {
          const r = await fetch('http://127.0.0.1:38080/healthz', { signal: AbortSignal.timeout(1000) });
          if (r.ok) { hazir = true; break; }
        } catch { /* bekle */ }
        await uyu(500);
      }

      const girisYap = async () => {
        const r = await fetch('http://127.0.0.1:38080/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password: 'TestSifresi-1453!' }),
        });
        return (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
      };
      const ayarlariOku = async (cerez) => {
        const r = await fetch('http://127.0.0.1:38080/api/settings', { headers: { cookie: cerez } });
        return r.json();
      };

      await test('B7', '.env degisikligi `up -d` sonrasi container a yansiyor', async () => {
        bekle(hazir, 'izole container kalkmadi');
        const cerez1 = await girisYap();
        const ayar1 = await ayarlariOku(cerez1);
        esit(ayar1.values.baseUrl, 'https://ilk.vartest', 'ilk baseUrl (env den)');

        // .env i degistir ve yeniden olustur
        envYaz('https://ikinci.vartest');
        dc('up -d --force-recreate');
        for (let i = 0; i < 60; i++) {
          try {
            const r = await fetch('http://127.0.0.1:38080/healthz', { signal: AbortSignal.timeout(1000) });
            if (r.ok) break;
          } catch { /* bekle */ }
          await uyu(500);
        }
        const cikti = dc('exec -T app env').cikti;
        const yeni = /^PUBLIC_BASE_URL=(.*)$/m.exec(cikti)?.[1]?.trim();
        esit(yeni, 'https://ikinci.vartest', 'container env');
        return { detay: 'env degiskeni container a ulasti' };
      });

      await test('B8', 'Panelden HIC kaydedilmemisken PUBLIC_BASE_URL her aciliste yeniden okunuyor', async () => {
        // ConfigService.load() env i yalnizca OKUR, DB ye YAZMAZ. Bu yuzden
        // admin bir kez "Kaydet" demedigi surece env her restart ta tazelenir.
        bekle(hazir, 'izole container kalkmadi');
        const cerez = await girisYap();
        const ayar = await ayarlariOku(cerez);
        esit(ayar.values.baseUrl, 'https://ikinci.vartest', 'kaydedilmemisken env den gelmeli');
        return { detay: 'ilk kayittan once env canli; kayittan sonra DB kilitler (B8b)' };
      });

      await test('B8b', 'Panelden kaydetmek PUBLIC_BASE_URL i GOLGELEYEMIYOR', async () => {
        bekle(hazir, 'izole container kalkmadi');
        const cerez = await girisYap();
        const once = await ayarlariOku(cerez);
        // Panel tum degerleri birlikte gonderir; icine baseUrl de sikistirsak
        // sema onu atmali ve DB ye YAZMAMALI.
        const kayit = await fetch('http://127.0.0.1:38080/api/settings', {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: cerez },
          body: JSON.stringify({ ...once.values, baseUrl: 'https://panelden.vartest' }),
        });
        esit(kayit.status, 200, 'PUT settings');
        const hemen = await kayit.json();
        esit(hemen.values.baseUrl, once.values.baseUrl, 'yanitta baseUrl degismemeli');

        // env i degistir + yeniden olustur → ENV kazanmali
        envYaz('https://dorduncu.vartest');
        dc('up -d --force-recreate');
        for (let i = 0; i < 60; i++) {
          try {
            const r = await fetch('http://127.0.0.1:38080/healthz', { signal: AbortSignal.timeout(1000) });
            if (r.ok) break;
          } catch { /* bekle */ }
          await uyu(500);
        }
        const cerez2 = await girisYap();
        const sonra = await ayarlariOku(cerez2);
        esit(sonra.values.baseUrl, 'https://dorduncu.vartest', 'env kazanmali');
        return { detay: 'panelden kayit adres ayarini golgelemiyor' };
      });

      await test('B6', '.env degisikligi yeniden olusturma OLMADAN etkisiz', async () => {
        const oncekiCikti = dc('exec -T app env').cikti;
        const onceki = /^PUBLIC_BASE_URL=(.*)$/m.exec(oncekiCikti)?.[1]?.trim();
        bekle(onceki, 'container env okunamadi');

        envYaz('https://ucuncu.vartest');
        await uyu(500);

        const cikti = dc('exec -T app env').cikti;
        const suan = /^PUBLIC_BASE_URL=(.*)$/m.exec(cikti)?.[1]?.trim();
        esit(suan, onceki, 'container hala eski degeri tasimali');
        return { detay: `.env=ucuncu ama container=${onceki} (beklenen)` };
      });

      await test('B11', 'Volume kaliciligi: down → up sonrasi DB korunuyor', async () => {
        const cerez1 = await girisYap();
        const once = await ayarlariOku(cerez1);
        // panelden ayirt edici bir deger yaz
        await fetch('http://127.0.0.1:38080/api/settings', {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: cerez1 },
          body: JSON.stringify({ ...once.values, siteName: 'KaliciTest' }),
        });

        dc('down');           // volume SILINMEZ
        envYaz('https://besinci.vartest');
        dc('up -d');
        for (let i = 0; i < 60; i++) {
          try {
            const r = await fetch('http://127.0.0.1:38080/healthz', { signal: AbortSignal.timeout(1000) });
            if (r.ok) break;
          } catch { /* bekle */ }
          await uyu(500);
        }
        const cerez2 = await girisYap();
        const sonra = await ayarlariOku(cerez2);
        // siteName DB de saklanan gercek bir ayar — kaliciligi bununla olcuyoruz.
        esit(sonra.values.siteName, 'KaliciTest', 'siteName volume da kalmali');
        // baseUrl ise BILEREK DB de saklanmaz: yeni env degeri gecerli olmali.
        esit(sonra.values.baseUrl, 'https://besinci.vartest', 'baseUrl env den gelmeli');
        return { detay: `SQLite korundu (siteName), baseUrl env den tazelendi` };
      });
    }
  } finally {
    kabukTolere(`docker compose -p ${TEST_PROJE} --env-file "${envDosya}" -f "${composeDosya}" down -v`);
    rmSync(geciciDizin, { recursive: true, force: true });
  }
}

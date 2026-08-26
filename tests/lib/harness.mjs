/**
 * Test kosum altyapisi: izole sunucu ornekleri, HTTP yardimcilari, raporlama.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

export const KOK = resolve(import.meta.dirname, '../..');

/* --- Raporlama ----------------------------------------------------------- */

export const sonuclar = [];
let aktifGrup = '';

export function grup(ad) {
  aktifGrup = ad;
  console.log(`\n\x1b[1m\x1b[36m── ${ad}\x1b[0m`);
}

export function kaydet(id, baslik, gecti, detay = '') {
  sonuclar.push({ grup: aktifGrup, id, baslik, gecti, detay });
  const isaret = gecti === true ? '\x1b[32mPASS\x1b[0m' : gecti === 'skip' ? '\x1b[33mSKIP\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`  ${isaret}  ${id}  ${baslik}${detay ? `\n         \x1b[90m${detay}\x1b[0m` : ''}`);
}

/** Bir kontrolu calistirir; firlarsa FAIL olarak kaydeder. */
export async function test(id, baslik, fn) {
  try {
    const sonuc = await fn();
    if (sonuc && sonuc.skip) return kaydet(id, baslik, 'skip', sonuc.detay ?? '');
    kaydet(id, baslik, true, sonuc?.detay ?? '');
  } catch (e) {
    kaydet(id, baslik, false, e instanceof Error ? e.message : String(e));
  }
}

export function bekle(kosul, mesaj) {
  if (!kosul) throw new Error(mesaj);
}

export function esit(gercek, beklenen, etiket = '') {
  if (gercek !== beklenen) {
    throw new Error(`${etiket} beklenen=${JSON.stringify(beklenen)} gercek=${JSON.stringify(gercek)}`);
  }
}

/* --- Ag yardimcilari ------------------------------------------------------ */

export function bosPort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });
}

export const uyu = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Cerez tasiyan minik HTTP istemcisi.
 */
export class Istemci {
  constructor(taban) {
    this.taban = taban.replace(/\/+$/, '');
    this.cerezler = new Map();
  }

  cerezBasligi() {
    return [...this.cerezler].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  cerezleriYut(response) {
    const ham = response.headers.getSetCookie?.() ?? [];
    for (const satir of ham) {
      const [cift] = satir.split(';');
      const i = cift.indexOf('=');
      if (i > 0) {
        const ad = cift.slice(0, i).trim();
        const deger = cift.slice(i + 1).trim();
        if (deger === '' || /expires=thu, 01 jan 1970/i.test(satir)) this.cerezler.delete(ad);
        else this.cerezler.set(ad, deger);
      }
    }
  }

  /**
   * TASIMA katmani hatasinda (HTTP durum kodunda DEGIL) bir kez yeniden dener.
   *
   * Neden gerekli: boyut sinirini asan bir yukleme reddedilirken sunucu, istemci
   * hala govdeyi gonderirken baglantiyi kapatir (dogru HTTP davranisi). Node'un
   * keep-alive havuzu bu olmus soketi bir SONRAKI istege verebiliyor ve istek
   * ECONNRESET ile duser — testler bu yuzden sirali kosumda kararsizlasiyordu
   * (orn. D9b'den sonra D10). Tarayicilar bu durumu kendiliginden ele aldigi
   * icin bu bir urun hatasi degil, Node istemcisinin havuz davranisidir.
   *
   * DIKKAT: yalnizca baglanti kurulamama/kopma yakalanir. 4xx/5xx yanitlar
   * normal donus sayilir ve ASLA yeniden denenmez; aksi halde gercek hatalar
   * gizlenirdi.
   */
  async tasimaHatasindaBirKezYinele(istekFn) {
    try {
      return await istekFn();
    } catch (e) {
      const sebep = e?.cause?.code ?? '';
      const kopma = ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'UND_ERR_SOCKET'].includes(sebep);
      if (!kopma) throw e;
      await uyu(60);
      return istekFn();
    }
  }

  async istek(yol, secenekler = {}) {
    const basliklar = { ...(secenekler.headers ?? {}) };
    const cerez = this.cerezBasligi();
    if (cerez) basliklar['cookie'] = cerez;
    if (secenekler.json !== undefined) {
      basliklar['content-type'] = 'application/json';
      secenekler.body = JSON.stringify(secenekler.json);
      secenekler.method = secenekler.method ?? 'POST';
    }
    const response = await this.tasimaHatasindaBirKezYinele(() =>
      fetch(`${this.taban}${yol}`, { ...secenekler, headers: basliklar, redirect: 'manual' }),
    );
    this.cerezleriYut(response);

    const tip = response.headers.get('content-type') ?? '';
    let govde = null;
    if (secenekler.ham) govde = Buffer.from(await response.arrayBuffer());
    else if (tip.includes('application/json')) govde = await response.json().catch(() => null);
    else govde = await response.text();

    return { status: response.status, headers: response.headers, govde };
  }

  get = (yol, s) => this.istek(yol, { ...s, method: 'GET' });
  post = (yol, json, s) => this.istek(yol, { ...s, method: 'POST', json });
  put = (yol, json, s) => this.istek(yol, { ...s, method: 'PUT', json });
  patch = (yol, json, s) => this.istek(yol, { ...s, method: 'PATCH', json });
  del = (yol, s) => this.istek(yol, { ...s, method: 'DELETE' });

  /** multipart/form-data ile paket (IPA / APK) yukler; dosya adi yolun son parcasidir. */
  async yukle(dosyaYolu, alanlar = {}) {
    const { readFile } = await import('node:fs/promises');
    const { basename } = await import('node:path');
    const form = new FormData();
    for (const [k, v] of Object.entries(alanlar)) form.append(k, String(v));
    const veri = await readFile(dosyaYolu);
    form.append('file', new Blob([veri]), basename(dosyaYolu));
    return this.istek('/api/uploads', { method: 'POST', body: form });
  }
}

/* --- Kurulum sayfasi yardimcilari ---------------------------------------- */

/**
 * Kurulum sayfasi User-Agent e gore IKI FARKLI icerik uretir:
 * iOS disi istemcide "yalnizca iPhone/iPad" uyarisi ve kurulum dugmesi YOK.
 * itms-services linkini gorebilmek icin iOS UA sart.
 */
export const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
export const IOS = { headers: { 'user-agent': IOS_UA } };

/** Kurulum sayfasindan (iOS goruntusu) imzali manifest adresini cikarir. */
export function manifestAdresiCikar(html) {
  const m = /href="itms-services:\/\/\?action=download-manifest&amp;url=([^"]+)"/.exec(html);
  if (!m) throw new Error('Kurulum sayfasinda itms-services linki bulunamadi');
  return decodeURIComponent(m[1].replace(/&amp;/g, '&'));
}

/**
 * Android goruntusu: APK kayitlarinda manifest/itms zinciri yoktur; sayfadaki
 * buton dogrudan imzali app.apk adresine gider. Android UA sart degil (buton
 * her goruntude var) ama adimlar/uyari UA'ya gore degisir.
 */
export const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
export const ANDROID = { headers: { 'user-agent': ANDROID_UA } };

/** Kurulum sayfasindan imzali app.apk adresini (tam URL) cikarir. */
export function apkAdresiCikar(html) {
  const m = /href="([^"]*\/app\.apk\?k=[^"]+)"/.exec(html);
  if (!m) throw new Error('Kurulum sayfasinda app.apk linki bulunamadi');
  return m[1].replace(/&amp;/g, '&');
}

/* --- Izole sunucu ornegi -------------------------------------------------- */

/**
 * Kendi DATA_DIR'i ve portu olan bir sunucu baslatir.
 * `env` icindeki degerler process.env'in UZERINE yazilir; `.env` dosyalari
 * OKUNMAZ — boylece hangi degiskenin ne yaptigi net olur.
 */
export async function sunucuBaslat(env = {}, secenekler = {}) {
  const port = env.PORT ?? (await bosPort());
  const veriDizini = secenekler.dataDir ?? mkdtempSync(join(tmpdir(), 'ipa-ota-test-'));

  const cocuk = spawn(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', 'src/index.ts'],
    {
      cwd: join(KOK, 'backend'),
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: 'development',
        HOST: '127.0.0.1',
        DATA_DIR: veriDizini,
        LOG_LEVEL: 'info',
        SESSION_SECRET: 'test'.repeat(16),
        ...env,
        PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let cikti = '';
  cocuk.stdout.on('data', (d) => (cikti += d));
  cocuk.stderr.on('data', (d) => (cikti += d));

  let cikisKodu = null;
  cocuk.on('exit', (kod) => (cikisKodu = kod));

  const taban = `http://127.0.0.1:${port}`;
  const bitis = Date.now() + 15000;
  let hazir = false;
  while (Date.now() < bitis) {
    if (cikisKodu !== null) break;
    try {
      const r = await fetch(`${taban}/healthz`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) {
        hazir = true;
        break;
      }
    } catch {
      /* henuz kalkmadi */
    }
    await uyu(150);
  }

  return {
    port,
    taban,
    veriDizini,
    hazir,
    // Getter: `durdur()` sonrasinda da guncel kalsin (snapshot degil).
    get cikisKodu() {
      return cikisKodu;
    },
    get cikti() {
      return cikti;
    },
    istemci: () => new Istemci(taban),
    async durdur() {
      if (cikisKodu === null) {
        cocuk.kill('SIGTERM');
        const son = Date.now() + 5000;
        while (cikisKodu === null && Date.now() < son) await uyu(50);
        if (cikisKodu === null) cocuk.kill('SIGKILL');
      }
      return cikti;
    },
    temizle() {
      if (!secenekler.dataDir && existsSync(veriDizini)) rmSync(veriDizini, { recursive: true, force: true });
    },
    dosyalar() {
      return existsSync(veriDizini) ? readdirSync(veriDizini) : [];
    },
  };
}

/** Bir sunucuyu baslat, blogu calistir, her halukarda kapat. */
export async function sunucuIle(env, fn, secenekler = {}) {
  const s = await sunucuBaslat(env, secenekler);
  try {
    return await fn(s);
  } finally {
    await s.durdur();
    s.temizle();
  }
}

/** Ayni DATA_DIR ile yeniden baslatma senaryolari icin. */
export function geciciDizin() {
  return mkdtempSync(join(tmpdir(), 'ipa-ota-test-'));
}

export function dizinSil(d) {
  rmSync(d, { recursive: true, force: true });
}

/* --- Rapor ---------------------------------------------------------------- */

export function ozet() {
  const gecen = sonuclar.filter((s) => s.gecti === true).length;
  const kalan = sonuclar.filter((s) => s.gecti === false);
  const atlanan = sonuclar.filter((s) => s.gecti === 'skip').length;

  console.log(`\n\x1b[1m═══ Ozet ═══\x1b[0m`);
  console.log(`  Toplam : ${sonuclar.length}`);
  console.log(`  \x1b[32mGecen  : ${gecen}\x1b[0m`);
  console.log(`  \x1b[31mKalan  : ${kalan.length}\x1b[0m`);
  console.log(`  \x1b[33mAtlanan: ${atlanan}\x1b[0m`);

  if (kalan.length) {
    console.log(`\n\x1b[31m\x1b[1mBASARISIZ:\x1b[0m`);
    for (const k of kalan) console.log(`  ${k.id}  ${k.baslik}\n      ${k.detay}`);
  }
  return kalan.length;
}

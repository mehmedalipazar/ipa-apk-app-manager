/**
 * Tasima katmani testi — backend'in HIC goremedigi hatalar.
 *
 * Suite A/C (tests/) backend'i gercekten calistirir; ama "backend kapali,
 * nginx 502 HTML dondu" ya da "fetch'in kendisi patladi (ag/DNS/CORS)"
 * durumlarinda backend ortada yoktur, dolayisiyla orada test edilemezler.
 * Bu dosya `request()` + `baglantiHatasiMi()` eslemesini `fetch`'i taklit
 * ederek pinler. 2026-08-25 bulgusu: kapali backend, "ADMIN_PASSWORD
 * tanimlanmamis" olarak raporlaniyordu — eslemenin testi yoktu.
 *
 * tests/suite-c-api.mjs C14 bu dosyayi `vitest run` ile kosar.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_BASE, ApiError, api, baglantiHatasiMetni, baglantiHatasiMi } from './api.ts';

type Yanit = { status: number; body: string; contentType?: string };

function fetchTaklidi(yanit: Yanit | Error) {
  const fn = vi.fn<(girdi: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => {
    if (yanit instanceof Error) throw yanit;
    return new Response(yanit.body, {
      status: yanit.status,
      headers: { 'content-type': yanit.contentType ?? 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('API adresi', () => {
  it('VITE_API_BASE_URL bosken goreli yol kullanir (uretim: ayni origin, CORS yok)', async () => {
    const fn = fetchTaklidi({ status: 200, body: '{"authenticated":false,"configured":true,"expiresAt":null}' });
    await api.me();
    expect(API_BASE).toBe('');
    expect(fn.mock.calls[0]?.[0]).toBe('/api/auth/me');
    // Ayri origin'de oturum cerezinin gitmesi icin sart.
    expect(fn.mock.calls[0]?.[1]?.credentials).toBe('include');
  });
});

describe('request() — sunucuya ULASILDI', () => {
  it('2xx JSON govdeyi oldugu gibi dondurur', async () => {
    fetchTaklidi({ status: 200, body: '{"authenticated":true,"configured":true,"expiresAt":1}' });
    await expect(api.me()).resolves.toEqual({ authenticated: true, configured: true, expiresAt: 1 });
  });

  it('4xx JSON {error}: mesaj BIREBIR tasinir, baglanti hatasi DEGILDIR', async () => {
    fetchTaklidi({ status: 401, body: '{"error":"Sifre hatali."}' });
    const err = await api.login('x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, message: 'Sifre hatali.', sunucudan: true });
    expect(baglantiHatasiMi(err)).toBe(false);
  });

  it('PUT /api/settings dogrulama hatasi `field` ile gelir (mesaj dogru girdinin altina duser)', async () => {
    fetchTaklidi({ status: 400, body: '{"error":"En fazla 8760 olabilir.","field":"maxTtlHours"}' });
    const err = await api.putSettings({ maxTtlHours: 99999 }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 400, field: 'maxTtlHours' });
  });

  it('backend 503 {error:"Admin sifresi tanimlanmamis"}: YAPILANDIRMA mesajidir, ulasilamama degil', async () => {
    // auth.module.ts, ADMIN_PASSWORD yokken login'e bunu doner. Ayni 503
    // kodunu nginx de backend kapaliyken doner; fark JSON govdededir.
    fetchTaklidi({
      status: 503,
      body: '{"error":"Admin sifresi tanimlanmamis. Sunucuda ADMIN_PASSWORD ortam degiskenini ayarlayin."}',
    });
    const err = await api.login('x').catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 503, sunucudan: true });
    expect(baglantiHatasiMi(err)).toBe(false);
    expect((err as ApiError).message).toContain('ADMIN_PASSWORD');
  });
});

describe('request() — sunucuya ULASILAMADI', () => {
  it('ters proxy 502 + HTML govde (backend kapali): genel metin, baglanti hatasi', async () => {
    fetchTaklidi({ status: 502, body: '<html><body><h1>502 Bad Gateway</h1></body></html>', contentType: 'text/html' });
    const err = await api.me().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 502, message: 'Istek basarisiz (HTTP 502)', sunucudan: false });
    expect(baglantiHatasiMi(err)).toBe(true);
    expect(baglantiHatasiMetni(err)).toBe('Sunucuya ulasilamiyor (HTTP 502). API servisi calismiyor olabilir.');
  });

  it('ters proxy 503/504 (HTML, JSON degil) da ulasilamama sayilir', async () => {
    for (const status of [503, 504]) {
      fetchTaklidi({ status, body: 'Service Unavailable', contentType: 'text/plain' });
      const err = await api.me().catch((e: unknown) => e);
      expect(baglantiHatasiMi(err), `HTTP ${status}`).toBe(true);
      expect(baglantiHatasiMetni(err)).toContain(`HTTP ${status}`);
    }
  });

  it('500 JSON {error} (backend ayakta ama patladi): ulasilamama DEGIL, mesaj gosterilir', async () => {
    fetchTaklidi({ status: 500, body: '{"error":"Beklenmeyen sunucu hatasi"}' });
    const err = await api.me().catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 500, message: 'Beklenmeyen sunucu hatasi' });
    expect(baglantiHatasiMi(err)).toBe(false);
  });

  it('fetch kendisi firlatirsa (ag yok / DNS / CORS / TLS): ham TypeError, ApiError bile yok', async () => {
    fetchTaklidi(new TypeError('Failed to fetch'));
    const err = await api.me().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(err).not.toBeInstanceOf(ApiError);
    expect(baglantiHatasiMi(err)).toBe(true);
    expect(baglantiHatasiMetni(err)).toBe(
      'Sunucuya baglanilamadi. API servisi kapali olabilir veya ag baglantinizda sorun var.',
    );
  });

  it('baska hatalar (ornegin kod hatasi) baglanti hatasi sayilmaz', () => {
    expect(baglantiHatasiMi(new Error('x'))).toBe(false);
    expect(baglantiHatasiMi(new ApiError('Istek basarisiz (HTTP 404)', 404))).toBe(false);
    expect(baglantiHatasiMi(null)).toBe(false);
  });
});

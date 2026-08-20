/**
 * Admin oturum ucu.
 *
 *   GET  /api/auth/me        oturum durumu (koruma yok — arayuz aciliste sorar)
 *   POST /api/auth/login     sifre -> oturum cerezi
 *   POST /api/auth/logout    cerezi siler
 *   POST /api/auth/password  sifre degistirir (oturum ister)
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContainer } from '../../container.ts';
import type { AppModule } from '../../shared/module.types.ts';
import { env } from '../../config/env.ts';
import { AuthError } from '../../shared/errors.ts';
import { SESSION_TTL_MS } from './auth.service.ts';
import { SESSION_COOKIE } from './session.ts';
import { currentSession } from './auth.guard.ts';

const LoginSchema = z.object({ password: z.string().min(1, 'Sifre girin.') });
const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Yeni sifre en az 8 karakter olmali.'),
});

/**
 * JS'den okunamayan oturum cerezi.
 *
 * SameSite/Secure ortamdan gelir ve `config/env.ts` icinde cozulur: arayuz
 * API'den ayri bir origin'de calisiyorsa tarayicinin cerezi gondermesi icin
 * SameSite=None + Secure sarttir. Uretimde arayuz ayni origin'den sunuldugu
 * icin bu deger 'lax' olur.
 */
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: env.cookieSameSite,
  secure: env.cookieSecure,
  path: '/',
} as const;

/* --- Giris hiz siniri ------------------------------------------------------ */
// Panel internete acik; sifre denemesini sinirsiz birakmamak icin IP basina
// basit bir bellek ici esik: GIRIS_LIMIT basarisiz denemeden sonra ayni IP
// GIRIS_PENCERE_MS boyunca 429 alir. Basarili giris sayaci sifirlar; yeniden
// baslatma da sifirlar (kalicilik gerekmez, amac otomatik taramayi kirmak).
const GIRIS_LIMIT = 5;
const GIRIS_PENCERE_MS = 15 * 60_000;

interface GirisDenemesi {
  sayi: number;
  kilitBitis: number;
  son: number;
}

async function register(app: FastifyInstance, ctx: AppContainer): Promise<void> {
  const girisDenemeleri = new Map<string, GirisDenemesi>();

  /** Kilitliyse kalan saniye, degilse 0. Suresi gecen kayitlari dusurur. */
  const girisKilidi = (ip: string, simdi: number): number => {
    const d = girisDenemeleri.get(ip);
    if (!d) return 0;
    if (d.kilitBitis > simdi) return Math.ceil((d.kilitBitis - simdi) / 1000);
    if (simdi - d.son > GIRIS_PENCERE_MS) girisDenemeleri.delete(ip);
    return 0;
  };

  const girisBasarisiz = (ip: string, simdi: number): void => {
    // Harita buyurse suresi dolmus girisleri supur (bellek supabi).
    if (girisDenemeleri.size > 10_000) {
      for (const [k, v] of girisDenemeleri) {
        if (v.kilitBitis <= simdi && simdi - v.son > GIRIS_PENCERE_MS) girisDenemeleri.delete(k);
      }
    }
    const d = girisDenemeleri.get(ip) ?? { sayi: 0, kilitBitis: 0, son: simdi };
    if (simdi - d.son > GIRIS_PENCERE_MS) d.sayi = 0; // eski seri, bastan say
    d.sayi += 1;
    d.son = simdi;
    if (d.sayi >= GIRIS_LIMIT) {
      d.kilitBitis = simdi + GIRIS_PENCERE_MS;
      d.sayi = 0; // kilit acilinca temiz sayfa
    }
    girisDenemeleri.set(ip, d);
  };

  app.get('/api/auth/me', async (request) => {
    const oturum = currentSession(ctx, request);
    return {
      authenticated: oturum !== null,
      configured: ctx.auth.isConfigured(),
      expiresAt: oturum?.expiresAt ?? null,
    };
  });

  app.post('/api/auth/login', async (request, reply) => {
    const simdi = Date.now();
    const kalanSn = girisKilidi(request.ip, simdi);
    if (kalanSn > 0) {
      request.log.warn({ ip: request.ip, kalanSn }, 'Giris hiz sinirina takildi');
      return reply.code(429).send({
        error: `Cok fazla basarisiz deneme. ${Math.ceil(kalanSn / 60)} dakika sonra tekrar deneyin.`,
      });
    }

    const govde = LoginSchema.safeParse(request.body);
    if (!govde.success) {
      return reply.code(400).send({ error: 'Sifre girin.' });
    }

    if (!ctx.auth.isConfigured()) {
      return reply.code(503).send({
        error: 'Admin sifresi tanimlanmamis. Sunucuda ADMIN_PASSWORD ortam degiskenini ayarlayin.',
      });
    }

    const token = await ctx.auth.login(govde.data.password);
    if (!token) {
      girisBasarisiz(request.ip, simdi);
      request.log.warn({ ip: request.ip }, 'Basarisiz admin girisi');
      return reply.code(401).send({ error: 'Sifre hatali.' });
    }

    girisDenemeleri.delete(request.ip);
    return reply
      .setCookie(SESSION_COOKIE, token, { ...COOKIE_OPTIONS, maxAge: SESSION_TTL_MS / 1000 })
      .send({ ok: true });
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    return reply.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS).send({ ok: true });
  });

  app.post('/api/auth/password', async (request, reply) => {
    if (!currentSession(ctx, request)) {
      return reply.code(401).send({ error: 'Oturum gerekli.' });
    }

    const govde = ChangePasswordSchema.safeParse(request.body);
    if (!govde.success) {
      return reply.code(400).send({ error: govde.error.issues[0]?.message ?? 'Gecersiz istek.' });
    }

    try {
      await ctx.auth.changePassword(govde.data.currentPassword, govde.data.newPassword);
    } catch (e) {
      if (e instanceof AuthError) return reply.code(e.statusCode).send({ error: e.message });
      throw e;
    }

    // Sifre degisti — mevcut oturumu tazele ki kullanici disari dusmesin.
    const yeni = await ctx.auth.login(govde.data.newPassword);
    if (yeni) {
      return reply
        .setCookie(SESSION_COOKIE, yeni, { ...COOKIE_OPTIONS, maxAge: SESSION_TTL_MS / 1000 })
        .send({ ok: true });
    }
    return reply.send({ ok: true });
  });
}

export const authModule: AppModule = {
  name: 'auth',
  description: 'Admin oturumu (/api/auth/*)',
  register,
};

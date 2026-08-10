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

async function register(app: FastifyInstance, ctx: AppContainer): Promise<void> {
  app.get('/api/auth/me', async (request) => {
    const oturum = currentSession(ctx, request);
    return {
      authenticated: oturum !== null,
      configured: ctx.auth.isConfigured(),
      expiresAt: oturum?.expiresAt ?? null,
    };
  });

  app.post('/api/auth/login', async (request, reply) => {
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
      request.log.warn({ ip: request.ip }, 'Basarisiz admin girisi');
      return reply.code(401).send({ error: 'Sifre hatali.' });
    }

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

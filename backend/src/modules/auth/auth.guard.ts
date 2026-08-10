/**
 * Admin oturumu dogrulama yardimcilari.
 *
 * DIKKAT: bu koruma yalnizca /api/* uclarina uygulanir. Kurulum yollari
 * (`install` modulu) cerez ile KORUNAMAZ — iOS'un `installd` sureci Safari'nin
 * cerezlerini paylasmaz. Orada yetki URL icindeki HMAC imzasindadir.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppContainer } from '../../container.ts';
import { SESSION_COOKIE } from './session.ts';

export function currentSession(ctx: AppContainer, request: FastifyRequest) {
  const token = request.cookies[SESSION_COOKIE];
  return ctx.auth.verify(token);
}

export function isAuthenticated(ctx: AppContainer, request: FastifyRequest): boolean {
  return currentSession(ctx, request) !== null;
}

/**
 * Rota oncesi calisir; oturum yoksa 401 dondurup zinciri keser.
 * Kullanim:  { preHandler: requireAuth(ctx) }
 */
export function requireAuth(ctx: AppContainer) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!isAuthenticated(ctx, request)) {
      await reply.code(401).send({ error: 'Oturum gerekli. Lutfen giris yapin.' });
    }
  };
}

/** Kisayol: tum rotaya oturum sarti koyan Fastify secenek nesnesi. */
export function guarded(ctx: AppContainer) {
  return { preHandler: requireAuth(ctx) };
}

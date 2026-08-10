/**
 * Durumsuz (stateless) oturum belirteci — HMAC imzali.
 *
 * Sunucuda oturum tablosu tutulmaz; belirtecin kendisi son kullanma tarihini
 * ve imzasini tasir. SESSION_SECRET degistirilirse tum oturumlar duser.
 */
import { createHmac } from 'node:crypto';
import { sabitZamandaKarsilastir } from '../../domain/links/token.ts';

export const SESSION_COOKIE = 'ipa_ota_session';

export interface SessionPayload {
  readonly subject: string;
  readonly expiresAt: number;
}

export function createSession(secret: string, subject: string, ttlMs: number): string {
  const exp = Date.now() + ttlMs;
  const govde = `${exp}.${Buffer.from(subject, 'utf8').toString('base64url')}`;
  return `${govde}.${imzala(secret, govde)}`;
}

export function verifySession(secret: string, token: string | undefined): SessionPayload | null {
  if (!token) return null;

  const sonNokta = token.lastIndexOf('.');
  if (sonNokta <= 0) return null;

  const govde = token.slice(0, sonNokta);
  const imza = token.slice(sonNokta + 1);

  if (!sabitZamandaKarsilastir(imza, imzala(secret, govde))) return null;

  const [expStr, subjectB64] = govde.split('.');
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now() || !subjectB64) return null;

  return { subject: Buffer.from(subjectB64, 'base64url').toString('utf8'), expiresAt: exp };
}

function imzala(secret: string, govde: string): string {
  return createHmac('sha256', secret).update(govde).digest('base64url');
}

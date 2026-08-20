/**
 * Admin kimlik dogrulama.
 *
 * Tek yonetici hesabi vardir. Sifre ILK aciliste ADMIN_PASSWORD ortam
 * degiskeninden alinip ozetlenir ve veritabanina yazilir. Sonraki acilislarda
 * ortam degiskeni yok sayilir — boylece panelden degistirilen sifre yeniden
 * baslatmada eski haline donmez.
 *
 * Sifre unutulursa: ADMIN_PASSWORD_FORCE_RESET=true ile bir kez baslatin.
 */
import type { SettingsRepository } from '../../db/repositories/settings.repository.ts';
import { AuthError } from '../../shared/errors.ts';
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from './password.ts';
import { createSession, verifySession, type SessionPayload } from './session.ts';

const HASH_KEY = 'auth.adminPasswordHash';
export const ADMIN_SUBJECT = 'admin';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 saat

/*
 * Oturum imzasi SESSION_SECRET + guncel sifre ozetiyle atilir. Boylece sifre
 * degistiginde onceki TUM oturumlar kendiliginden gecersizlesir — calinmis bir
 * cerez, sifre degistirilerek etkisiz kilinabilir (2026-08-20 duzeltmesi). Imzali kurulum
 * linkleri BUNDAN ETKILENMEZ — onlar LinkService icinde ham SESSION_SECRET
 * ile imzalanir.
 */

export class AuthService {
  private readonly repo: SettingsRepository;
  private readonly secret: string;

  constructor(repo: SettingsRepository, secret: string) {
    this.repo = repo;
    this.secret = secret;
  }

  /** Ilk acilista sifreyi kurar. Uygulama baslarken bir kez cagrilir. */
  async bootstrap(envPassword: string, forceReset: boolean, isProd: boolean): Promise<void> {
    const mevcut = this.repo.get<string>(HASH_KEY);

    if (mevcut && !forceReset) return;

    if (!envPassword) {
      if (isProd) {
        throw new AuthError(
          'ADMIN_PASSWORD tanimli degil. Admin paneline giris icin ortam dosyasinda bir sifre belirleyin.',
        );
      }
      return; // Gelistirme: sifre yoksa panel kapali kalir.
    }

    if (envPassword.length < MIN_PASSWORD_LENGTH) {
      throw new AuthError(`ADMIN_PASSWORD en az ${MIN_PASSWORD_LENGTH} karakter olmali.`);
    }

    this.repo.set(HASH_KEY, await hashPassword(envPassword));
  }

  isConfigured(): boolean {
    return Boolean(this.repo.get<string>(HASH_KEY));
  }

  /** Oturum imza anahtari: SESSION_SECRET + kayitli sifre ozeti. */
  private oturumAnahtari(): string {
    const hash = this.repo.get<string>(HASH_KEY) ?? '';
    return `${this.secret}\n${hash}`;
  }

  /** Dogruysa oturum belirteci, degilse null doner. */
  async login(password: string): Promise<string | null> {
    const hash = this.repo.get<string>(HASH_KEY);
    if (!hash) return null;
    if (!(await verifyPassword(password, hash))) return null;
    return createSession(this.oturumAnahtari(), ADMIN_SUBJECT, SESSION_TTL_MS);
  }

  verify(token: string | undefined): SessionPayload | null {
    return verifySession(this.oturumAnahtari(), token);
  }

  async changePassword(current: string, next: string): Promise<void> {
    const hash = this.repo.get<string>(HASH_KEY);
    if (!hash || !(await verifyPassword(current, hash))) {
      throw new AuthError('Mevcut sifre hatali.');
    }
    if (next.length < MIN_PASSWORD_LENGTH) {
      throw new AuthError(`Yeni sifre en az ${MIN_PASSWORD_LENGTH} karakter olmali.`);
    }
    this.repo.set(HASH_KEY, await hashPassword(next));
  }
}

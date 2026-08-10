/**
 * Giris noktasi: kabi kur, sifreyi hazirla, sunucuyu baslat.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from './config/env.ts';
import { createContainer } from './container.ts';
import { buildServer } from './server.ts';
import { closeDb, dbPath } from './db/client.ts';
import { AuthError } from './shared/errors.ts';

async function main(): Promise<void> {
  mkdirSync(env.DATA_DIR, { recursive: true });

  // Kap, logger hazir olmadan once kuruluyor; gecici log fonksiyonu.
  const gecici = (msg: string, extra?: unknown) => {
    if (extra) console.warn(`[cleanup] ${msg}`, extra);
    else console.info(`[cleanup] ${msg}`);
  };

  const ctx = createContainer(gecici);

  try {
    await ctx.auth.bootstrap(
      env.ADMIN_PASSWORD,
      env.ADMIN_PASSWORD_FORCE_RESET,
      env.NODE_ENV === 'production',
    );
  } catch (e) {
    if (e instanceof AuthError) {
      console.error(`\n  Yapilandirma hatasi: ${e.message}\n`);
      process.exit(1);
    }
    throw e;
  }

  const app = await buildServer(ctx);

  ctx.cleanup.start();

  const kapat = async (signal: string) => {
    app.log.info(`${signal} alindi, kapatiliyor...`);
    ctx.cleanup.stop();
    await app.close();
    closeDb();
    process.exit(0);
  };
  process.on('SIGTERM', () => void kapat('SIGTERM'));
  process.on('SIGINT', () => void kapat('SIGINT'));

  await app.listen({ port: env.PORT, host: env.HOST });

  /* --- Acilis tanilamasi --------------------------------------------------- */
  // Veritabaninin TAM YOLU loga yazilir: "verilerimi nerede goreceğim"
  // sorusunun cevabi her aciliste ekranda dursun.
  app.log.info(
    { dosya: resolve(dbPath()), dataDir: resolve(env.DATA_DIR) },
    'SQLite veritabani',
  );

  const cfg = ctx.config.get();
  for (const uyari of ctx.config.warnings()) {
    app.log.warn(uyari);
  }
  if (cfg.baseUrl) {
    app.log.info(
      { baseUrl: cfg.baseUrl, kurulumOneki: env.INSTALL_PATH_PREFIX },
      `Kurulum linkleri: ${cfg.baseUrl}${env.INSTALL_PATH_PREFIX}/<token>`,
    );
  }

  if (!ctx.auth.isConfigured()) {
    app.log.warn('Admin sifresi tanimli degil — admin paneline giris yapilamaz.');
  }

  if (env.CORS_ORIGINS.length === 0) {
    app.log.info(
      'CORS_ORIGINS bos — arayuz bu API ile ayni origin uzerinden sunulmali ' +
        '(ters proxy: /api/* -> bu servis). Ayri bir adreste calisiyorsa adresini ekleyin.',
    );
  } else if (env.cookieSecure && env.CORS_ORIGINS.some((o) => o.startsWith('http://'))) {
    // Secure cerez yalnizca guvenli baglamda saklanir. Tarayicilar localhost'u
    // guvenli sayar, digerlerini saymaz — orada giris SESSIZCE basarisiz olur.
    const guvensiz = env.CORS_ORIGINS.filter(
      (o) => o.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(o),
    );
    if (guvensiz.length > 0) {
      app.log.warn(
        { origins: guvensiz },
        'Secure oturum cerezi kullaniliyor ama bu origin`ler https degil — ' +
          'admin girisi bu adreslerden calismaz. HTTPS kullanin.',
      );
    }
  }
}

main().catch((e: unknown) => {
  console.error('Sunucu baslatilamadi:', e);
  process.exit(1);
});

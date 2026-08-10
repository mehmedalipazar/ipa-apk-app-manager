/**
 * Fastify uygulamasinin montaji.
 *
 * Bu surec YALNIZCA API'yi (/api/*) ve OTA kurulum uclarini sunar; admin
 * arayuzu ayri bir serviste (nginx) yayinlanir. Ikisi uretimde ayni alan adi
 * altinda birlestirilir (ters proxy: `/api/*` -> bu servis, `/` -> arayuz),
 * boylece tarayici goreli yol kullanir ve CORS'a hic gerek kalmaz.
 *
 * Rotalar burada tek tek yazilmaz: `modules/index.ts` icindeki kayit defteri
 * gezilir. Yeni modul eklemek bu dosyayi degistirmez.
 */
import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import { env, isProd } from './config/env.ts';
import type { AppContainer } from './container.ts';
import { MODULES } from './modules/index.ts';
import { AppError } from './shared/errors.ts';

/**
 * Multipart katmaninin sert ust siniri. Asil sinir ayarlardan (maxUploadMb)
 * gelir ve akis sirasinda uygulanir; bu yalnizca son emniyet supabi.
 */
const HARD_UPLOAD_LIMIT = 8 * 1024 * 1024 * 1024;

export async function buildServer(ctx: AppContainer): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport: isProd
        ? undefined
        : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } },
    },
    trustProxy: env.TRUST_PROXY,
    // Yukleme uzun surebilir; ters proxy arkasinda zaman asimi bize dusmesin.
    bodyLimit: 1024 * 1024,
    requestTimeout: 0,
  });

  /* --- CORS ---------------------------------------------------------------- */
  // Liste bosken CORS basligi HIC yazilmaz: arayuz ile API ayni origin
  // uzerindedir varsayilir (uretimdeki dogru kurulum budur). Liste doldugu
  // anda oturum cerezi SameSite=None'a duser — yalnizca gercekten ayri
  // origin kullaniyorsaniz doldurun.
  if (env.CORS_ORIGINS.length > 0) {
    await app.register(cors, {
      origin: env.CORS_ORIGINS,
      // Oturum cerezinin gonderilebilmesi icin sart.
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      // Preflight sonucunu onbellege al — her istekte OPTIONS turu olmasin.
      maxAge: 600,
    });
    app.log.info({ origins: env.CORS_ORIGINS }, 'CORS acik (ayri origin modu)');
  } else {
    app.log.info('CORS kapali — arayuz ayni origin uzerinden sunuluyor varsayiliyor.');
  }

  await app.register(cookie);
  await app.register(formbody);
  await app.register(multipart, {
    limits: { fileSize: HARD_UPLOAD_LIMIT, files: 1, fields: 10 },
  });

  /* --- Moduller ------------------------------------------------------------ */
  for (const modul of MODULES) {
    await modul.register(app, ctx);
    app.log.debug({ modul: modul.name }, 'Modul kaydedildi');
  }
  app.log.info(
    { moduller: MODULES.map((m) => m.name) },
    `${MODULES.length} modul kaydedildi`,
  );

  app.setNotFoundHandler(async (_request, reply) => reply.code(404).send({ error: 'Bulunamadi' }));

  /* --- Hata yakalayici ----------------------------------------------------- */
  // 4xx: mesaj oldugu gibi istemciye gider (kullaniciya yol gosterir).
  // 5xx: yalnizca genel metin doner, ayrinti loga yazilir.
  app.setErrorHandler(async (error: FastifyError, request, reply) => {
    const status = error instanceof AppError ? error.statusCode : (error.statusCode ?? 500);
    if (status >= 500) {
      request.log.error({ err: error }, 'Islenmemis hata');
      return reply.code(status).send({ error: 'Sunucu hatasi.' });
    }
    return reply.code(status).send({ error: error.message });
  });

  return app;
}

/**
 * Fastify uygulamasinin montaji.
 *
 * Bu surec YALNIZCA API'yi (/api/*) ve OTA kurulum uclarini sunar; admin
 * arayuzu ayri bir serviste (nginx) yayinlanir. Uretimde ikisi ayni alan adi
 * altinda birlesir (ters proxy: `/api/*` -> bu servis, `/` -> arayuz); ayrica
 * CORS_ORIGINS ile listelenen ayri origin'ler (orn. yerel gelistirme arayuzu
 * http://localhost:5173) API'ye dogrudan baglanabilir. CORS acikken cerez
 * SameSite=None oldugu icin CSRF korumasi asagidaki Origin dogrulama
 * katmaniyla saglanir.
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

  /* --- Origin dogrulamasi (CSRF korumasi) ----------------------------------- */
  // CORS acikken oturum cerezi SameSite=None olur ve tarayici cerezi yabanci
  // sitelerin tetikledigi isteklere de ekler. Preflight'a girmeyen "basit"
  // istekler (orn. multipart form POST) CORS'a ragmen sunucuda CALISIR — CORS
  // yalnizca yanitin okunmasini engeller. Bu kapiyi Origin dogrulamasi kapatir:
  // durum degistiren isteklerde Origin basligi varsa izinli listede olmali.
  // Origin gondermeyen istemciler (curl, testler, installd) etkilenmez; onlar
  // tarayici degildir, uzerlerinde tasinan ortam cerezi de yoktur.
  {
    const izinliOriginler = new Set<string>(env.CORS_ORIGINS);
    try {
      izinliOriginler.add(new URL(env.PUBLIC_BASE_URL).origin);
    } catch {
      // PUBLIC_BASE_URL bos/gecersizse ayni-origin girisi eklenemez; CORS
      // listesi yine gecerlidir.
    }
    const korunanMetotlar = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

    app.addHook('onRequest', async (request, reply) => {
      if (!korunanMetotlar.has(request.method)) return;
      const origin = request.headers.origin;
      if (origin === undefined) return;
      if (!izinliOriginler.has(origin)) {
        request.log.warn({ origin, yol: request.url }, 'Yabanci Origin reddedildi');
        return reply.code(403).send({ error: 'Origin dogrulanamadi.' });
      }
    });
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

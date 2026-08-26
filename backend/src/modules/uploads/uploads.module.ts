/**
 * Paket (IPA / APK) yukleme ucu — POST /api/uploads
 *
 * ROL KURALI: yukleme YALNIZCA yonetici oturumuyla yapilir. Bu kural
 * ayarlarla gevsetilemez — son kullanicinin servisle tek temasi kendisine
 * verilen kurulum linkidir.
 *
 * multipart/form-data bekler:
 *   file      — .ipa ya da .apk dosyasi (zorunlu; platform uzantidan anlasilir)
 *   ttlHours  — link omru, saat (opsiyonel)
 *   note      — serbest not (opsiyonel)
 *   password  — link sifresi (opsiyonel)
 *
 * Alanlarin dosyadan once ya da sonra gelmesi fark etmez: dosya akisi
 * gorulur gorulmez diske alinir, kayit ise tum parcalar bittikten sonra
 * olusturulur (bkz. BuildService.ingest / finalize).
 */
import type { FastifyInstance, FastifyReply, FastifyBaseLogger } from 'fastify';
import type { AppContainer } from '../../container.ts';
import type { AppModule } from '../../shared/module.types.ts';
import { requireAuth } from '../auth/auth.guard.ts';
import { UploadError } from '../../shared/errors.ts';
import type { IngestedUpload } from '../builds/build.service.ts';
import { toBuildDto } from '../builds/build.dto.ts';

async function register(app: FastifyInstance, ctx: AppContainer): Promise<void> {
  // Oturum yoksa istek govdesi HIC OKUNMADAN 401 doner; yetkisiz bir istemci
  // 1 GB'lik dosyayi bosuna yollamaya baslamaz.
  app.post('/api/uploads', { preHandler: requireAuth(ctx) }, async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.code(400).send({ error: 'Istek multipart/form-data olmali.' });
    }

    const alanlar: Record<string, string> = {};
    let ingested: IngestedUpload | null = null;

    try {
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          if (ingested) {
            // Ikinci bir dosya: akisi bosalt, yoksa istek asili kalir.
            part.file.resume();
            continue;
          }
          ingested = await ctx.buildService.ingest(part.file, part.filename ?? 'yukleme.ipa');
        } else {
          const deger = part.value;
          alanlar[part.fieldname] = typeof deger === 'string' ? deger : String(deger ?? '');
        }
      }
    } catch (e) {
      if (ingested) await ctx.buildService.discard(ingested);
      return hataYanitla(reply, e, request.log);
    }

    if (!ingested) {
      return reply.code(400).send({ error: 'Dosya bulunamadi. "file" alaniyla bir .ipa ya da .apk gonderin.' });
    }

    try {
      const ttlRaw = alanlar['ttlHours'];
      const ttlHours = ttlRaw !== undefined && ttlRaw !== '' ? Number(ttlRaw) : undefined;

      const { build, revokedPrevious } = await ctx.buildService.finalize(ingested, {
        ttlHours: Number.isFinite(ttlHours) ? ttlHours : undefined,
        note: alanlar['note'],
        password: alanlar['password'],
        uploadedBy: 'admin',
      });

      request.log.info(
        { buildId: build.id, platform: build.platform, bundleId: build.bundleId, size: build.sizeBytes },
        'Yeni surum yuklendi',
      );

      return reply.code(201).send({
        build: toBuildDto(build, ctx.links),
        revokedPrevious,
        warnings: ctx.config.warnings(),
      });
    } catch (e) {
      await ctx.buildService.discard(ingested);
      return hataYanitla(reply, e, request.log);
    }
  });
}

function hataYanitla(reply: FastifyReply, e: unknown, log: FastifyBaseLogger) {
  if (e instanceof UploadError) {
    return reply.code(e.statusCode).send({ error: e.message });
  }
  if (e instanceof Error && e.name === 'StorageLimitError') {
    return reply.code(413).send({ error: e.message });
  }
  // Fastify multipart boyut sinirini kendi hatasiyla bildirir.
  if (e instanceof Error && /request file too large|FST_REQ_FILE_TOO_LARGE/i.test(e.message)) {
    return reply.code(413).send({ error: 'Dosya boyut sinirini asiyor.' });
  }
  log.error({ err: e }, 'Yukleme basarisiz');
  return reply.code(500).send({ error: 'Yukleme sirasinda beklenmeyen bir hata olustu.' });
}

export const uploadsModule: AppModule = {
  name: 'uploads',
  description: 'Paket yukleme — .ipa/.apk (/api/uploads)',
  register,
};

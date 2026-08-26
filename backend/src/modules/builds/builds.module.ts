/**
 * Surum yonetimi — listeleme, duzenleme, silme. Tumu oturum ister.
 *
 *   GET    /api/builds       listele (limit/offset/search/onlyActive/platform)
 *   GET    /api/builds/:id   tek kayit
 *   PATCH  /api/builds/:id   sure / iptal / not / sifre duzenle
 *   DELETE /api/builds/:id   kaydi ve dosyalarini sil
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContainer } from '../../container.ts';
import type { AppModule } from '../../shared/module.types.ts';
import { guarded } from '../auth/auth.guard.ts';
import { MAX_TTL_HOURS } from '../../config/settings.schema.ts';
import { PLATFORMS } from '../../domain/package/types.ts';
import { UploadError } from '../../shared/errors.ts';
import { hashPassword } from '../auth/password.ts';
import { toBuildDto } from './build.dto.ts';

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().optional(),
  /** 'ios' | 'android' — verilmezse iki platform da listelenir. */
  platform: z.enum(PLATFORMS).optional(),
  onlyActive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

/**
 * Link ayarlarinin duzenlenmesi. Gonderilmeyen alanlar oldugu gibi kalir.
 */
const PatchSchema = z.object({
  /** Yeni link omru (saat). Ayarlardaki maxTtlHours ile ayrica kirpilir. */
  ttlHours: z.number().int().min(1).max(MAX_TTL_HOURS).optional(),
  /** Sure neyin uzerine eklensin: yukleme ani mi, su an mi? */
  ttlFrom: z.enum(['upload', 'now']).optional(),
  revoked: z.boolean().optional(),
  note: z.string().max(1000).nullable().optional(),
  /** null gonderilirse sifre korumasi kaldirilir. */
  password: z.string().nullable().optional(),
});

async function register(app: FastifyInstance, ctx: AppContainer): Promise<void> {
  const guard = guarded(ctx);

  app.get('/api/builds', guard, async (request, reply) => {
    const q = ListQuerySchema.safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: 'Gecersiz sorgu parametresi.' });

    const { items, total } = ctx.builds.list({
      limit: q.data.limit,
      offset: q.data.offset,
      search: q.data.search,
      platform: q.data.platform,
      includeInactive: !q.data.onlyActive,
    });

    return {
      items: items.map((b) => toBuildDto(b, ctx.links)),
      total,
      limit: q.data.limit,
      offset: q.data.offset,
    };
  });

  app.get<{ Params: { id: string } }>('/api/builds/:id', guard, async (request, reply) => {
    const build = ctx.builds.findById(request.params.id);
    if (!build) return reply.code(404).send({ error: 'Surum bulunamadi.' });
    return toBuildDto(build, ctx.links);
  });

  app.patch<{ Params: { id: string } }>('/api/builds/:id', guard, async (request, reply) => {
    const govde = PatchSchema.safeParse(request.body);
    if (!govde.success) {
      return reply.code(400).send({ error: govde.error.issues[0]?.message ?? 'Gecersiz istek.' });
    }

    const mevcut = ctx.builds.findById(request.params.id);
    if (!mevcut) return reply.code(404).send({ error: 'Surum bulunamadi.' });

    const { ttlHours, ttlFrom, revoked, note, password } = govde.data;

    try {
      if (ttlHours !== undefined) {
        ctx.buildService.extend(request.params.id, ttlHours, ttlFrom ?? 'now');
      }
      // Iptal durumu sureden bagimsiz yonetilir; ikisi ayni istekte gelebilir.
      if (revoked === true) {
        ctx.buildService.revoke(request.params.id);
      } else if (revoked === false) {
        ctx.buildService.unrevoke(request.params.id);
      }
    } catch (e) {
      if (e instanceof UploadError) return reply.code(e.statusCode).send({ error: e.message });
      throw e;
    }

    if (note !== undefined) {
      ctx.builds.update(request.params.id, { note: note?.trim() || null });
    }
    if (password !== undefined) {
      const hash = password && password.trim() ? await hashPassword(password.trim()) : null;
      ctx.builds.update(request.params.id, { passwordHash: hash });
    }

    const guncel = ctx.builds.findById(request.params.id);
    return guncel ? toBuildDto(guncel, ctx.links) : reply.code(404).send({ error: 'Bulunamadi.' });
  });

  app.delete<{ Params: { id: string } }>('/api/builds/:id', guard, async (request, reply) => {
    const build = ctx.builds.findById(request.params.id);
    if (!build) return reply.code(404).send({ error: 'Surum bulunamadi.' });

    await ctx.buildService.destroy(request.params.id);
    request.log.info({ buildId: build.id }, 'Surum silindi');
    return reply.send({ ok: true });
  });
}

export const buildsModule: AppModule = {
  name: 'builds',
  description: 'Surum yonetimi (/api/builds)',
  register,
};

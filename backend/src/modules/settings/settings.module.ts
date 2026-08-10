/**
 * Ayarlar ucu — GET/PUT /api/settings. Oturum ister.
 *
 * Yanit `fields` dizisini de tasir: panel formu bu listeden uretir, arayuzde
 * elle alan tanimlanmaz. Semaya alan eklemek panelde de kendiliginden gorunur
 * (bkz. config/settings.schema.ts).
 *
 * `baseUrl` bu ucun `values` alaninda gorunur ama `fields` icinde YOKTUR ve
 * PUT ile degistirilemez — kaynagi PUBLIC_BASE_URL ortam degiskenidir.
 */
import type { FastifyInstance } from 'fastify';
import type { AppContainer } from '../../container.ts';
import type { AppModule } from '../../shared/module.types.ts';
import { guarded } from '../auth/auth.guard.ts';
import {
  AppConfigUpdateSchema,
  CONFIG_FIELDS,
  describeConfigIssue,
} from '../../config/settings.schema.ts';

async function register(app: FastifyInstance, ctx: AppContainer): Promise<void> {
  const guard = guarded(ctx);

  app.get('/api/settings', guard, async () => ({
    values: ctx.config.get(),
    fields: CONFIG_FIELDS,
    warnings: ctx.config.warnings(),
    // Sozlesme PUT ile ayni kalsin diye bos dizi: arayuz tek tip okur.
    notes: [],
  }));

  app.put('/api/settings', guard, async (request, reply) => {
    const govde = AppConfigUpdateSchema.safeParse(request.body);
    if (!govde.success) {
      const ilk = govde.error.issues[0];
      // `field` ayrica doner: arayuz hatayi dogru girdinin altinda gosterebilsin.
      const sorun = ilk ? describeConfigIssue(ilk) : { field: undefined, message: 'Gecersiz ayar.' };
      return reply.code(400).send({ error: sorun.message, field: sorun.field });
    }

    const { values, notes } = ctx.config.update(govde.data);
    request.log.info({ notes }, 'Ayarlar guncellendi');
    return { values, fields: CONFIG_FIELDS, warnings: ctx.config.warnings(), notes };
  });
}

export const settingsModule: AppModule = {
  name: 'settings',
  description: 'Calisma ani ayarlari (/api/settings)',
  register,
};

/**
 * Servis durumu, ozet ve bakim uclari.
 *
 *   GET  /healthz                   koruma yok — container healthcheck kullanir
 *   GET  /api/stats                 ozet + uyarilar (oturum ister)
 *   GET  /api/maintenance/cleanup   neyin silinecegini sayar, SILMEZ (oturum ister)
 *   POST /api/maintenance/cleanup   temizligi elle calistirir (oturum ister)
 */
import type { FastifyInstance } from 'fastify';
import type { AppContainer } from '../../container.ts';
import type { AppModule } from '../../shared/module.types.ts';
import { guarded } from '../auth/auth.guard.ts';

async function register(app: FastifyInstance, ctx: AppContainer): Promise<void> {
  const guard = guarded(ctx);

  // Koruma YOK: docker healthcheck ve ters proxy bu ucu cagirir.
  app.get('/healthz', async () => ({ ok: true, uptime: Math.round(process.uptime()) }));

  app.get('/api/stats', guard, async () => {
    const s = ctx.builds.stats();
    return { ...s, warnings: ctx.config.warnings() };
  });

  // Ayni yol, farkli fiil: GET sorar, POST uygular. Panel once bunu cagirip
  // butonu "N surum, X silinecek" onayina cevirir.
  app.get('/api/maintenance/cleanup', guard, async () => ctx.cleanup.preview());

  app.post('/api/maintenance/cleanup', guard, async (request) => {
    const sonuc = await ctx.cleanup.runOnce();
    request.log.info(sonuc, 'Temizlik elle calistirildi');
    return sonuc;
  });
}

export const systemModule: AppModule = {
  name: 'system',
  description: 'Saglik, ozet ve bakim (/healthz, /api/stats)',
  register,
};

/**
 * Servis durumu, ozet ve bakim uclari.
 *
 *   GET  /healthz                   koruma yok — Dockerfile HEALTHCHECK kullanir; domain'den ULASILAMAZ (/api/* disinda)
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

  // Koruma YOK: Dockerfile HEALTHCHECK bu ucu 127.0.0.1 uzerinden cagirir.
  // Domain uzerinden ULASILAMAZ — ters proxy yalnizca /api/* tasir ve bu yol
  // onun disindadir; https://.../healthz'e cevap veren frontend nginx'in
  // sabit 200'udur (frontend/nginx.conf). Canlilik icin GET /api/settings
  // (401 beklenir) ya da dogrudan :3000/healthz kullanin.
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

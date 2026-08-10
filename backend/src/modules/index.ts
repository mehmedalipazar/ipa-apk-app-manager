/**
 * Modul kayit defteri — uygulamanin tek "montaj" noktasi.
 *
 * `server.ts` bu diziyi gezer ve her modulun register() fonksiyonunu cagirir.
 * Yeni bir ozellik eklemek icin modulu yazip buraya BIR SATIR eklemek yeterli;
 * server.ts'e dokunmak gerekmez.
 *
 * SIRA ONEMLIDIR: install modulu `${INSTALL_PATH_PREFIX}/:token` gibi
 * parametreli yollar kaydeder. Onekin /api/i yapildigi kurulumlarda bu yollar
 * /api/* alani ile ayni agacta yasar; Fastify statik yollari parametreli
 * yollardan once eslestirdigi icin catisma olmaz, ama yine de sabit yollari
 * (auth, builds, settings, system) once kaydediyoruz ki niyet acik olsun.
 */
import type { AppModule } from '../shared/module.types.ts';
import { systemModule } from './system/system.module.ts';
import { authModule } from './auth/auth.module.ts';
import { settingsModule } from './settings/settings.module.ts';
import { buildsModule } from './builds/builds.module.ts';
import { uploadsModule } from './uploads/uploads.module.ts';
import { installModule } from './install/install.module.ts';

export const MODULES: readonly AppModule[] = [
  systemModule,
  authModule,
  settingsModule,
  buildsModule,
  uploadsModule,
  installModule,
];

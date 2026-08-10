/**
 * Bagimlilik kabi (dependency container).
 *
 * Tum servisler burada BIR KEZ kurulur ve modullere parametre olarak gecer.
 * Global degisken, Fastify decorator ya da singleton import yok — testte
 * sahte bir kap vermek yeterlidir.
 */
import { getDb, type Db } from './db/client.ts';
import { BuildsRepository } from './db/repositories/builds.repository.ts';
import { SettingsRepository } from './db/repositories/settings.repository.ts';
import { ConfigService } from './config/settings.service.ts';
import { createStorage } from './domain/storage/local.ts';
import type { Storage } from './domain/storage/types.ts';
import { LinkService } from './domain/links/service.ts';
import { AuthService } from './modules/auth/auth.service.ts';
import { BuildService } from './modules/builds/build.service.ts';
import { CleanupJob } from './jobs/cleanup.job.ts';
import { env } from './config/env.ts';

export interface AppContainer {
  readonly db: Db;
  readonly settings: SettingsRepository;
  readonly config: ConfigService;
  readonly builds: BuildsRepository;
  readonly storage: Storage;
  readonly auth: AuthService;
  readonly links: LinkService;
  readonly buildService: BuildService;
  readonly cleanup: CleanupJob;
}

export function createContainer(log: (msg: string, extra?: unknown) => void): AppContainer {
  const db = getDb();
  const settings = new SettingsRepository(db);
  const config = new ConfigService(settings);
  const builds = new BuildsRepository(db);
  const storage = createStorage(env.DATA_DIR);
  const auth = new AuthService(settings, env.SESSION_SECRET);
  const links = new LinkService(config, env.SESSION_SECRET);
  const buildService = new BuildService(builds, storage, config);
  const cleanup = new CleanupJob(builds, storage, config, log);

  return { db, settings, config, builds, storage, auth, links, buildService, cleanup };
}

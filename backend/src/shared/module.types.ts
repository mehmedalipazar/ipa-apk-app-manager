/**
 * Modul sozlesmesi.
 *
 * Her ozellik (auth, builds, install, ...) kendi klasorunde bir `AppModule`
 * disari verir. `modules/index.ts` bunlari tek bir listede toplar ve
 * `server.ts` listeyi gezerek hepsini kaydeder.
 *
 * Yeni bir modul eklemek icin:
 *   1. modules/<ad>/ klasorunu ac, icinde <ad>.module.ts yaz,
 *   2. modules/index.ts icindeki diziye ekle.
 * Baska hicbir dosyaya dokunmak gerekmez.
 */
import type { FastifyInstance } from 'fastify';
import type { AppContainer } from '../container.ts';

export interface AppModule {
  /** Log ve hata ayiklama icin kisa ad. */
  readonly name: string;
  /**
   * Modulun kisa aciklamasi — acilista "kayitli moduller" logunda gorunur.
   */
  readonly description?: string;
  /** Rotalarini kaydeder. Sirasi `modules/index.ts` dizisindeki siradir. */
  register(app: FastifyInstance, ctx: AppContainer): Promise<void>;
}

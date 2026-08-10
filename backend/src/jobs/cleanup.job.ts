/**
 * Suresi dolan linklerin dosyalarini diskten siler.
 *
 * Kayit satiri SILINMEZ — istatistik ve denetim icin kalir; yalnizca
 * `files_deleted_at` isaretlenir. Boylece surum panelde "dosyalari silindi"
 * olarak gorunur, link ise kaybolmak yerine 410 doner.
 */
import type { BuildsRepository } from '../db/repositories/builds.repository.ts';
import type { Storage } from '../domain/storage/types.ts';
import type { ConfigService } from '../config/settings.service.ts';

export interface CleanupResult {
  readonly purged: number;
  readonly freedBytes: number;
}

export interface CleanupPreview {
  /** Su anda silinmeye aday surum sayisi. */
  readonly purgeable: number;
  /** Bosalacak toplam alan (bayt). */
  readonly bytes: number;
}

export class CleanupJob {
  private readonly builds: BuildsRepository;
  private readonly storage: Storage;
  private readonly config: ConfigService;
  private readonly log: (msg: string, extra?: unknown) => void;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    builds: BuildsRepository,
    storage: Storage,
    config: ConfigService,
    log: (msg: string, extra?: unknown) => void,
  ) {
    this.builds = builds;
    this.storage = storage;
    this.config = config;
    this.log = log;
  }

  /** Silinmeye aday kayitlar — `purgeAfterExpiryHours` ayarina gore. */
  private adaylar() {
    const gecikmeSaat = this.config.get().purgeAfterExpiryHours;
    return this.builds.findPurgeable(Date.now() - gecikmeSaat * 3_600_000);
  }

  /**
   * Hicbir seyi silmeden neyin silinecegini sayar.
   * Panel "Temizligi simdi calistir" butonunu onaya donusturmek icin kullanir:
   * geri alinamaz bir islemin oncesinde kapsami gostermek gerekir.
   */
  preview(): CleanupPreview {
    const adaylar = this.adaylar();
    return {
      purgeable: adaylar.length,
      bytes: adaylar.reduce((toplam, b) => toplam + b.sizeBytes, 0),
    };
  }

  async runOnce(): Promise<CleanupResult> {
    const adaylar = this.adaylar();
    let freedBytes = 0;
    let purged = 0;

    for (const build of adaylar) {
      try {
        await this.storage.removePrefix(build.id);
        this.builds.update(build.id, { filesDeletedAt: Date.now() });
        freedBytes += build.sizeBytes;
        purged++;
      } catch (e) {
        // Bir kayit silinemezse digerleri devam etmeli.
        this.log(`Temizlik hatasi (build ${build.id})`, e);
      }
    }

    if (purged > 0) {
      this.log(`Temizlik: ${purged} surumun dosyalari silindi (${freedBytes} bayt).`);
    }
    return { purged, freedBytes };
  }

  /** Periyodik calistirmayi baslatir. */
  start(intervalMs = 15 * 60 * 1000): void {
    if (this.timer) return;
    // Acilista bir kez calis, sonra periyodik.
    void this.runOnce().catch((e) => this.log('Temizlik gorevi basarisiz', e));
    this.timer = setInterval(() => {
      void this.runOnce().catch((e) => this.log('Temizlik gorevi basarisiz', e));
    }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/**
 * Yukleme akisinin butunu.
 *
 * Sira onemli: once dosyayi diske al, sonra cozumle. Boylece 1 GB'lik bir IPA
 * bellege alinmaz ve bozuk dosya erken yakalanir.
 *
 * IPA cozumleme, simge cikarma ve manifest icin gereken her sey bu servisin
 * arkasinda, backend icinde kalir; arayuz yalnizca sonucu gorur.
 */
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { BuildRecord, BuildsRepository } from '../../db/repositories/builds.repository.ts';
import type { Storage } from '../../domain/storage/types.ts';
import type { ConfigService } from '../../config/settings.service.ts';
import { parseIpa } from '../../domain/ipa/parser.ts';
import { IpaParseError } from '../../domain/ipa/types.ts';
import { generateToken } from '../../domain/links/token.ts';
import { getStatus } from '../../domain/links/service.ts';
import { UploadError } from '../../shared/errors.ts';
import { hashPassword } from '../auth/password.ts';

export interface UploadInput extends FinalizeOptions {
  readonly stream: Readable;
  readonly filename: string;
}

export interface FinalizeOptions {
  /** Link omru (saat). Verilmezse ayarlardaki varsayilan kullanilir. */
  readonly ttlHours?: number;
  readonly note?: string;
  /** Opsiyonel link sifresi. */
  readonly password?: string;
  readonly uploadedBy?: string;
}

/**
 * Diske alinmis ve cozumlenmis, ama henuz kaydedilmemis yukleme.
 *
 * Yukleme iki asamaya bolundu cunku multipart formlarda alanlar dosyadan
 * SONRA da gelebilir; dosya akisi ise beklemeden tuketilmek zorundadir.
 */
export interface IngestedUpload {
  readonly id: string;
  readonly ipaKey: string;
  readonly iconKey: string | null;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly filename: string;
  readonly meta: Awaited<ReturnType<typeof parseIpa>>;
}

/** Sure degistirilirken hangi anin uzerine eklenecegi. */
export type TtlBasis = 'upload' | 'now';

export interface UploadResult {
  readonly build: BuildRecord;
  /** Ayni uygulamanin otomatik iptal edilen onceki link sayisi. */
  readonly revokedPrevious: number;
}

export class BuildService {
  private readonly builds: BuildsRepository;
  private readonly storage: Storage;
  private readonly config: ConfigService;

  constructor(builds: BuildsRepository, storage: Storage, config: ConfigService) {
    this.builds = builds;
    this.storage = storage;
    this.config = config;
  }

  static ipaKey(id: string): string {
    return `${id}/app.ipa`;
  }

  static iconKey(id: string): string {
    return `${id}/icon.png`;
  }

  /**
   * 1. asama: akisi diske yaz, IPA'yi cozumle, simgeyi cikar.
   * Basarisiz olursa yarim dosyalari kendisi temizler.
   */
  async ingest(stream: Readable, filename: string): Promise<IngestedUpload> {
    const ayarlar = this.config.get();

    if (!/\.ipa$/i.test(filename)) {
      throw new UploadError('Yalnizca .ipa uzantili dosyalar yuklenebilir.');
    }

    const id = randomUUID();
    const ipaKey = BuildService.ipaKey(id);
    const maxBytes = ayarlar.maxUploadMb * 1024 * 1024;

    let sizeBytes: number;
    let sha256: string;

    try {
      const sonuc = await this.storage.saveStream(ipaKey, stream, maxBytes);
      sizeBytes = sonuc.bytes;
      sha256 = sonuc.sha256;
    } catch (e) {
      await this.storage.removePrefix(id);
      if (e instanceof Error && e.name === 'StorageLimitError') {
        throw new UploadError(
          `Dosya cok buyuk. En fazla ${ayarlar.maxUploadMb} MB yuklenebilir.`,
          413,
        );
      }
      throw e;
    }

    if (sizeBytes === 0) {
      await this.storage.removePrefix(id);
      throw new UploadError('Bos dosya yuklendi.');
    }

    let meta: Awaited<ReturnType<typeof parseIpa>>;
    try {
      meta = await this.storage.withLocalFile(ipaKey, (path) => parseIpa(path));
    } catch (e) {
      await this.storage.removePrefix(id); // Cozumlenemeyen dosyayi diskte tutma.
      if (e instanceof IpaParseError) throw new UploadError(e.message, 422);
      throw e;
    }

    let iconKey: string | null = null;
    if (meta.icon) {
      iconKey = BuildService.iconKey(id);
      await this.storage.saveBuffer(iconKey, meta.icon);
    }

    return { id, ipaKey, iconKey, sizeBytes, sha256, filename, meta };
  }

  /** 2. asama: link ayarlariyla birlikte kaydi olustur. */
  async finalize(ingested: IngestedUpload, options: FinalizeOptions): Promise<UploadResult> {
    const ayarlar = this.config.get();
    const ttlSaat = this.clampTtl(options.ttlHours);
    const simdi = Date.now();

    const passwordHash = options.password?.trim()
      ? await hashPassword(options.password.trim())
      : null;

    const build = this.builds.create({
      id: ingested.id,
      token: generateToken(),
      originalFilename: ingested.filename,
      ipaPath: ingested.ipaKey,
      iconPath: ingested.iconKey,
      sizeBytes: ingested.sizeBytes,
      sha256: ingested.sha256,
      bundleId: ingested.meta.bundleId,
      appName: ingested.meta.appName,
      version: ingested.meta.version,
      buildNumber: ingested.meta.buildNumber,
      minOsVersion: ingested.meta.minOsVersion,
      platforms: [...ingested.meta.platforms],
      createdAt: simdi,
      expiresAt: simdi + ttlSaat * 3_600_000,
      ttlHours: ttlSaat,
      passwordHash,
      note: options.note?.trim() || null,
      uploadedBy: options.uploadedBy ?? null,
    });

    let revokedPrevious = 0;
    if (ayarlar.revokePreviousOnUpload) {
      revokedPrevious = this.builds.revokeOthersByBundleId(
        ingested.meta.bundleId,
        ingested.id,
        simdi,
      );
    }

    return { build, revokedPrevious };
  }

  /** Iki asamayi tek cagrida yapar (alanlar dosyadan once biliniyorsa). */
  async createFromUpload(input: UploadInput): Promise<UploadResult> {
    const ingested = await this.ingest(input.stream, input.filename);
    try {
      return await this.finalize(ingested, input);
    } catch (e) {
      await this.storage.removePrefix(ingested.id);
      throw e;
    }
  }

  /** Kaydedilmemis bir yuklemenin dosyalarini siler. */
  async discard(ingested: IngestedUpload): Promise<void> {
    await this.storage.removePrefix(ingested.id);
  }

  /** Istenen sureyi ayarlardaki sinirlar icine cekerek dondurur. */
  clampTtl(ttlHours: number | undefined): number {
    const { defaultTtlHours, maxTtlHours } = this.config.get();
    if (ttlHours === undefined || !Number.isFinite(ttlHours)) return defaultTtlHours;
    return Math.min(Math.max(Math.round(ttlHours), 1), maxTtlHours);
  }

  /** Kaydi ve dosyalarini tamamen siler. */
  async destroy(id: string): Promise<void> {
    await this.storage.removePrefix(id);
    this.builds.delete(id);
  }

  /** Linki hemen kapatir; dosyalar temizlik gorevinde silinir. */
  revoke(id: string): BuildRecord | null {
    return this.builds.update(id, { revokedAt: Date.now() });
  }

  /** Linki yeniden acar (suresi hala doluysa yine aktif olmaz). */
  unrevoke(id: string): BuildRecord | null {
    return this.builds.update(id, { revokedAt: null });
  }

  /**
   * Linkin gecerlilik suresini degistirir ve secilen degeri kaydeder.
   *
   * `basis` sureyi neyin uzerine ekleyecegimizi soyler:
   *   'upload' — yukleme aninin uzerine. Yuklerken girilen ayarin duzeltilmesi
   *              budur; sonuc gecmiste kalirsa link dogal olarak gecersiz olur.
   *   'now'    — su anin uzerine. Suresi dolmus bir linki canlandirmak icin.
   *
   * Iptal durumuna DOKUNMAZ; onu revoke/unrevoke yonetir.
   */
  extend(id: string, ttlHours: number, basis: TtlBasis = 'now'): BuildRecord | null {
    const mevcut = this.builds.findById(id);
    if (!mevcut) return null;
    if (mevcut.filesDeletedAt !== null) {
      throw new UploadError('Bu surumun dosyalari silinmis; suresi degistirilemez.', 409);
    }
    const saat = this.clampTtl(ttlHours);
    const baslangic = basis === 'upload' ? mevcut.createdAt : Date.now();
    return this.builds.update(id, {
      expiresAt: baslangic + saat * 3_600_000,
      ttlHours: saat,
    });
  }

  status(build: BuildRecord): ReturnType<typeof getStatus> {
    return getStatus(build);
  }
}

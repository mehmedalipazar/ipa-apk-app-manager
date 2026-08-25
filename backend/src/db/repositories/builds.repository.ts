/**
 * Yuklenen IPA kayitlari.
 *
 * Tarih alanlari epoch milisaniye (INTEGER) olarak saklanir; zaman dilimi
 * belirsizligi olmasin diye TEXT tarih kullanilmiyor.
 */
import type { Db } from '../client.ts';

export interface BuildRecord {
  id: string;
  token: string;

  originalFilename: string;
  ipaPath: string;
  iconPath: string | null;
  sizeBytes: number;
  sha256: string;

  bundleId: string;
  appName: string;
  version: string;
  buildNumber: string;
  minOsVersion: string | null;
  platforms: string[];

  createdAt: number;
  expiresAt: number;
  /** Yukleme sirasinda secilen link omru (saat). Panelde duzenlenebilir. */
  ttlHours: number;
  revokedAt: number | null;
  filesDeletedAt: number | null;
  passwordHash: string | null;
  note: string | null;

  viewCount: number;
  installCount: number;
  downloadCount: number;
  uploadedBy: string | null;
}

export type NewBuild = Omit<
  BuildRecord,
  'viewCount' | 'installCount' | 'downloadCount' | 'revokedAt' | 'filesDeletedAt'
>;

export type BuildPatch = Partial<
  Pick<
    BuildRecord,
    'expiresAt' | 'ttlHours' | 'revokedAt' | 'passwordHash' | 'note' | 'filesDeletedAt'
  >
>;

export type CounterName = 'view_count' | 'install_count' | 'download_count';

interface BuildRow {
  id: string;
  token: string;
  original_filename: string;
  ipa_path: string;
  icon_path: string | null;
  size_bytes: number;
  sha256: string;
  bundle_id: string;
  app_name: string;
  version: string;
  build_number: string;
  min_os_version: string | null;
  platforms: string | null;
  created_at: number;
  expires_at: number;
  ttl_hours: number | null;
  revoked_at: number | null;
  files_deleted_at: number | null;
  password_hash: string | null;
  note: string | null;
  view_count: number;
  install_count: number;
  download_count: number;
  uploaded_by: string | null;
}

function toRecord(row: BuildRow): BuildRecord {
  let platforms: string[] = [];
  if (row.platforms) {
    try {
      const cozulen: unknown = JSON.parse(row.platforms);
      if (Array.isArray(cozulen)) platforms = cozulen.filter((x): x is string => typeof x === 'string');
    } catch {
      // Bozuk kayit — bos dizi ile devam.
    }
  }

  return {
    id: row.id,
    token: row.token,
    originalFilename: row.original_filename,
    ipaPath: row.ipa_path,
    iconPath: row.icon_path,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    bundleId: row.bundle_id,
    appName: row.app_name,
    version: row.version,
    buildNumber: row.build_number,
    minOsVersion: row.min_os_version,
    platforms,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    // Migration oncesi kayitlar icin sutun bos kalabilir; farktan turet.
    ttlHours: row.ttl_hours ?? Math.max(1, Math.round((row.expires_at - row.created_at) / 3_600_000)),
    revokedAt: row.revoked_at,
    filesDeletedAt: row.files_deleted_at,
    passwordHash: row.password_hash,
    note: row.note,
    viewCount: row.view_count,
    installCount: row.install_count,
    downloadCount: row.download_count,
    uploadedBy: row.uploaded_by,
  };
}

export interface ListOptions {
  limit?: number;
  offset?: number;
  /** true ise suresi dolmus/iptal edilmisler de gelir. Varsayilan: true */
  includeInactive?: boolean;
  /** Uygulama adi / bundle id / surum icinde arama */
  search?: string;
}

export class BuildsRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  create(build: NewBuild): BuildRecord {
    this.db
      .prepare(
        `INSERT INTO builds (
          id, token, original_filename, ipa_path, icon_path, size_bytes, sha256,
          bundle_id, app_name, version, build_number, min_os_version, platforms,
          created_at, expires_at, ttl_hours, password_hash, note, uploaded_by
        ) VALUES (
          @id, @token, @original_filename, @ipa_path, @icon_path, @size_bytes, @sha256,
          @bundle_id, @app_name, @version, @build_number, @min_os_version, @platforms,
          @created_at, @expires_at, @ttl_hours, @password_hash, @note, @uploaded_by
        )`,
      )
      .run({
        id: build.id,
        token: build.token,
        original_filename: build.originalFilename,
        ipa_path: build.ipaPath,
        icon_path: build.iconPath,
        size_bytes: build.sizeBytes,
        sha256: build.sha256,
        bundle_id: build.bundleId,
        app_name: build.appName,
        version: build.version,
        build_number: build.buildNumber,
        min_os_version: build.minOsVersion,
        platforms: JSON.stringify(build.platforms),
        created_at: build.createdAt,
        expires_at: build.expiresAt,
        ttl_hours: build.ttlHours,
        password_hash: build.passwordHash,
        note: build.note,
        uploaded_by: build.uploadedBy,
      });

    const olusan = this.findById(build.id);
    if (!olusan) throw new Error('Kayit olusturuldu ama geri okunamadi.');
    return olusan;
  }

  findById(id: string): BuildRecord | null {
    const row = this.db.prepare<[string], BuildRow>('SELECT * FROM builds WHERE id = ?').get(id);
    return row ? toRecord(row) : null;
  }

  findByToken(token: string): BuildRecord | null {
    const row = this.db.prepare<[string], BuildRow>('SELECT * FROM builds WHERE token = ?').get(token);
    return row ? toRecord(row) : null;
  }

  list(options: ListOptions = {}): { items: BuildRecord[]; total: number } {
    const { limit = 50, offset = 0, includeInactive = true, search } = options;

    const kosullar: string[] = [];
    const parametreler: unknown[] = [];

    if (!includeInactive) {
      // "Aktif" tanimi getStatus() ile birebir ayni olmali: suresi gecmemis,
      // iptal edilmemis VE dosyalari silinmemis.
      kosullar.push('expires_at > ? AND revoked_at IS NULL AND files_deleted_at IS NULL');
      parametreler.push(Date.now());
    }
    if (search?.trim()) {
      kosullar.push('(app_name LIKE ? OR bundle_id LIKE ? OR version LIKE ?)');
      const kalip = `%${search.trim()}%`;
      parametreler.push(kalip, kalip, kalip);
    }

    const where = kosullar.length ? `WHERE ${kosullar.join(' AND ')}` : '';

    const total = this.db
      .prepare<unknown[], { c: number }>(`SELECT COUNT(*) AS c FROM builds ${where}`)
      .get(...parametreler)!.c;

    const rows = this.db
      .prepare<unknown[], BuildRow>(
        `SELECT * FROM builds ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...parametreler, limit, offset);

    return { items: rows.map(toRecord), total };
  }

  update(id: string, patch: BuildPatch): BuildRecord | null {
    const alanlar: string[] = [];
    const degerler: unknown[] = [];

    const eslesme: Record<keyof BuildPatch, string> = {
      expiresAt: 'expires_at',
      ttlHours: 'ttl_hours',
      revokedAt: 'revoked_at',
      passwordHash: 'password_hash',
      note: 'note',
      filesDeletedAt: 'files_deleted_at',
    };

    for (const [key, sutun] of Object.entries(eslesme) as [keyof BuildPatch, string][]) {
      if (patch[key] !== undefined) {
        alanlar.push(`${sutun} = ?`);
        degerler.push(patch[key]);
      }
    }

    if (alanlar.length === 0) return this.findById(id);

    this.db.prepare(`UPDATE builds SET ${alanlar.join(', ')} WHERE id = ?`).run(...degerler, id);
    return this.findById(id);
  }

  increment(id: string, counter: CounterName): void {
    this.db.prepare(`UPDATE builds SET ${counter} = ${counter} + 1 WHERE id = ?`).run(id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM builds WHERE id = ?').run(id);
  }

  /** Ayni uygulamanin hala aktif olan diger linklerini iptal eder. */
  revokeOthersByBundleId(bundleId: string, exceptId: string, at: number): number {
    const sonuc = this.db
      .prepare(
        `UPDATE builds SET revoked_at = ?
         WHERE bundle_id = ? AND id != ? AND revoked_at IS NULL AND expires_at > ?`,
      )
      .run(at, bundleId, exceptId, at);
    return sonuc.changes;
  }

  /**
   * Dosyalari henuz silinmemis ve `cutoff` degerinden once SURESI DOLMUS
   * ya da IPTAL EDILMIS (`revoked_at <= cutoff`) kayitlari dondurur.
   * Iptal de temizlik saatini baslatir: gecikme sonunda dosya gider ve
   * unrevoke/extend 409 verir — bkz. jobs/cleanup.job.ts.
   */
  findPurgeable(cutoff: number): BuildRecord[] {
    const rows = this.db
      .prepare<[number, number], BuildRow>(
        `SELECT * FROM builds
         WHERE files_deleted_at IS NULL
           AND (expires_at <= ? OR (revoked_at IS NOT NULL AND revoked_at <= ?))`,
      )
      .all(cutoff, cutoff);
    return rows.map(toRecord);
  }

  stats(): { total: number; active: number; totalBytes: number; activeBytes: number } {
    const now = Date.now();
    const satir = this.db
      .prepare<[number, number], { total: number; active: number; totalBytes: number; activeBytes: number }>(
        `SELECT
           COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN expires_at > ? AND revoked_at IS NULL AND files_deleted_at IS NULL THEN 1 ELSE 0 END), 0) AS active,
           COALESCE(SUM(CASE WHEN files_deleted_at IS NULL THEN size_bytes ELSE 0 END), 0) AS totalBytes,
           COALESCE(SUM(CASE WHEN expires_at > ? AND revoked_at IS NULL AND files_deleted_at IS NULL THEN size_bytes ELSE 0 END), 0) AS activeBytes
         FROM builds`,
      )
      .get(now, now)!;
    return satir;
  }
}

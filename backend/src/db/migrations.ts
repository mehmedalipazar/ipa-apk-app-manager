/**
 * Ileriye dogru calisan basit migration sistemi.
 * Yeni surum eklerken diziye YENI eleman ekleyin, mevcutlari DEGISTIRMEYIN.
 */
import type { Db } from './client.ts';

type Migration = { readonly name: string; readonly up: string };

const MIGRATIONS: readonly Migration[] = [
  {
    name: '001_initial',
    up: `
      CREATE TABLE builds (
        id                TEXT PRIMARY KEY,
        token             TEXT NOT NULL UNIQUE,

        -- Dosya
        original_filename TEXT NOT NULL,
        ipa_path          TEXT NOT NULL,
        icon_path         TEXT,
        size_bytes        INTEGER NOT NULL,
        sha256            TEXT NOT NULL,

        -- IPA meta verisi
        bundle_id         TEXT NOT NULL,
        app_name          TEXT NOT NULL,
        version           TEXT NOT NULL,
        build_number      TEXT NOT NULL,
        min_os_version    TEXT,
        platforms         TEXT,

        -- Link davranisi
        created_at        INTEGER NOT NULL,
        expires_at        INTEGER NOT NULL,
        revoked_at        INTEGER,
        files_deleted_at  INTEGER,
        password_hash     TEXT,
        note              TEXT,

        -- Sayaclar
        view_count        INTEGER NOT NULL DEFAULT 0,
        install_count     INTEGER NOT NULL DEFAULT 0,
        download_count    INTEGER NOT NULL DEFAULT 0,

        uploaded_by       TEXT
      );

      CREATE INDEX idx_builds_expires_at ON builds (expires_at);
      CREATE INDEX idx_builds_created_at ON builds (created_at DESC);
      CREATE INDEX idx_builds_bundle_id  ON builds (bundle_id);

      CREATE TABLE settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
  {
    // Yukleme sirasinda secilen link omru (saat) artik saklaniyor: panelde
    // "bu link kac saatlik verilmisti" gorunsun ve duzenlenebilsin diye.
    // Eski kayitlar icin expires_at - created_at farkindan geri hesaplanir.
    name: '002_builds_ttl_hours',
    up: `
      ALTER TABLE builds ADD COLUMN ttl_hours INTEGER;

      UPDATE builds
         SET ttl_hours = MAX(1, CAST(ROUND((expires_at - created_at) / 3600000.0) AS INTEGER))
       WHERE ttl_hours IS NULL;
    `,
  },
  {
    // Android (.apk) destegi: her kayit bir platforma aittir; eski satirlar iOS.
    // ipa_path sutununun adi tarihsel kalir (migration'lar ileri yonlu) — TS
    // tarafinda BuildRecord.packagePath olarak okunur/yazilir.
    name: '003_builds_platform',
    up: `
      ALTER TABLE builds ADD COLUMN platform TEXT NOT NULL DEFAULT 'ios';
      CREATE INDEX idx_builds_platform_bundle_id ON builds (platform, bundle_id);
    `,
  },
];

export function runMigrations(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const uygulanmis = new Set(
    db.prepare<[], { name: string }>('SELECT name FROM _migrations').all().map((r) => r.name),
  );

  const kaydet = db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)');

  for (const migration of MIGRATIONS) {
    if (uygulanmis.has(migration.name)) continue;
    db.transaction(() => {
      db.exec(migration.up);
      kaydet.run(migration.name, Date.now());
    })();
  }
}

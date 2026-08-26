/**
 * SQLite baglantisi. Tek dosya, tek process — self-hosted kullanim icin yeterli.
 *
 * Dosya `DATA_DIR/ipa-apk.db` konumundadir. Gelistirmede DATA_DIR=./data
 * oldugu icin veritabani depo icinde durur ve sunucu KAPALIYKEN dogrudan
 * `sqlite3` ile acilabilir; uretimde /data'ya baglanan bind mount ayni dosyayi
 * host'ta gosterir — AMA container calisirken host'tan ACMAYIN: POSIX
 * kilitleri Docker Desktop bind mount'undan gecmez, host tarafi kendini yalniz
 * sanip WAL'i budar ve container'in commit'lerini siler (2026-08-10'da bir
 * kayit boyle kaybedildi). Once `docker compose stop api` (dbadmin acik ise
 * `npm run db:ui:down`).
 *
 * WAL modu kullanildigindan veriyi baska bir arac ile okurken `-wal` ve `-shm`
 * yan dosyalarini da hesaba katin: yalnizca `.db` dosyasini kopyalarsaniz
 * en son yazilan kayitlari GORMEZSINIZ.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { env } from '../config/env.ts';
import { runMigrations } from './migrations.ts';

export type Db = Database.Database;

export const DB_FILENAME = 'ipa-apk.db';

let instance: Db | null = null;

/** Veritabani dosyasinin tam yolu — loglarda ve tanilamada gosterilir. */
export function dbPath(): string {
  return join(env.DATA_DIR, DB_FILENAME);
}

export function getDb(): Db {
  if (instance) return instance;

  const file = dbPath();
  mkdirSync(dirname(file), { recursive: true });

  const db = new Database(file);
  // WAL: okuma ve yazma birbirini bloklamasin.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  runMigrations(db);
  instance = db;
  return db;
}

export function closeDb(): void {
  instance?.close();
  instance = null;
}

/**
 * Anahtar/deger ayar deposu. Degerler JSON olarak saklanir.
 */
import type { Db } from '../client.ts';

interface SettingRow {
  key: string;
  value: string;
}

export class SettingsRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  getAll(): Record<string, unknown> {
    const rows = this.db.prepare<[], SettingRow>('SELECT key, value FROM settings').all();
    const out: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        out[row.key] = JSON.parse(row.value);
      } catch {
        // Bozuk kayit varsayilana dusmeli, patlamamali.
      }
    }
    return out;
  }

  get<T = unknown>(key: string): T | undefined {
    const row = this.db
      .prepare<[string], SettingRow>('SELECT key, value FROM settings WHERE key = ?')
      .get(key);
    if (!row) return undefined;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return undefined;
    }
  }

  setMany(values: Record<string, unknown>): void {
    const stmt = this.db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    );
    const now = Date.now();
    this.db.transaction(() => {
      for (const [key, value] of Object.entries(values)) {
        stmt.run(key, JSON.stringify(value), now);
      }
    })();
  }

  set(key: string, value: unknown): void {
    this.setMany({ [key]: value });
  }
}

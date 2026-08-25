/**
 * Vite'in .env dosya sirasini pinler.
 *
 * Belgeler (CLAUDE.md, README, frontend/.env.*) 2026-08-25'e kadar sirayi
 * `.env -> .env.[mode] -> .env.local -> .env.[mode].local` diye yaziyordu.
 * Gercek sira (vite 6, getEnvFilesForMode):
 *     .env -> .env.local -> .env.[mode] -> .env.[mode].local
 * Yani `.env.local`, `.env.development`i ASLA ezemez; onu yalnizca
 * `.env.development.local` ezer. Bu test kurali gercek `loadEnv` ile gecici
 * bir dizinde dogrular — belge degil, olcum.
 */
// Node builtin'lerinin TIPLERI bu serviste yok: @types/node kurulu degil
// (yeni bagimlilik eklemiyoruz) ve tsconfig `types: ["vite/client"]` diyor.
// Moduller calisma zamaninda gercekten var (vitest Node uzerinde kosar);
// eksik olan yalnizca bildirim, o yuzden uc import ts-ignore ile gecilir.
// `vite` importunun tipleri normal cozulur.
// @ts-ignore 'node:fs' tip bildirimi yok (@types/node kurulu degil)
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// @ts-ignore 'node:os' tip bildirimi yok (@types/node kurulu degil)
import { tmpdir } from 'node:os';
// @ts-ignore 'node:path' tip bildirimi yok (@types/node kurulu degil)
import { join } from 'node:path';
import { loadEnv } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';

/** Kimsenin kabuk ortaminda bulunmayacak bir anahtar (loadEnv process.env'i de katar). */
const ANAHTAR = 'VITE_SIRA_TESTI';
let dizin = '';

afterEach(() => {
  if (dizin) rmSync(dizin, { recursive: true, force: true });
  dizin = '';
});

function dizinKur(dosyalar: Record<string, string>): string {
  dizin = mkdtempSync(join(tmpdir(), 'vite-env-sirasi-'));
  for (const [ad, deger] of Object.entries(dosyalar)) {
    writeFileSync(join(dizin, ad), `${ANAHTAR}=${deger}\n`);
  }
  return dizin;
}

describe('Vite .env yukleme sirasi', () => {
  it('.env.local, .env.[mode] dosyasini EZEMEZ (mode dosyasi sonra yuklenir)', () => {
    const d = dizinKur({ '.env': 'taban', '.env.local': 'local', '.env.development': 'mode' });
    expect(loadEnv('development', d)[ANAHTAR]).toBe('mode');
  });

  it('.env.[mode].local, .env.[mode] dosyasini ezer (yerel backend ezmesi buraya yazilir)', () => {
    const d = dizinKur({ '.env.development': 'mode', '.env.development.local': 'mode-local' });
    expect(loadEnv('development', d)[ANAHTAR]).toBe('mode-local');
  });

  it('.env.local yalnizca .env i ezer', () => {
    const d = dizinKur({ '.env': 'taban', '.env.local': 'local' });
    expect(loadEnv('development', d)[ANAHTAR]).toBe('local');
  });

  it('uretim: .env.production daki BOS deger .env.local i ezer (goreli yol korunur)', () => {
    const d = dizinKur({ '.env.local': 'http://localhost:3000', '.env.production': '' });
    expect(loadEnv('production', d)[ANAHTAR]).toBe('');
  });
});

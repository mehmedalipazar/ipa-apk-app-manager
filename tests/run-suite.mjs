#!/usr/bin/env node
/**
 * Uctan uca test kosucusu.
 *
 *   node tests/run-suite.mjs              # tum gruplar (A, B, C, D)
 *   node tests/run-suite.mjs A B          # yalnizca secilen gruplar
 *   node tests/run-suite.mjs C --taban http://localhost:3010   # C'nin canli blogu icin baska bir BACKEND
 *
 * Hangi grup neyi hedefler (esit olcude izole DEGILLER):
 *   A — her senaryo icin izole backend process'i (gecici DATA_DIR, bos port; .env okunmaz)
 *   B — sunucu baslatmaz: calisan backend compose yigini (`docker compose config/exec`,
 *       backend/ dizininden) + `ipa-ota-vartest` adli gecici compose projesi (:38080)
 *   C — C1/C2/C3/C5/C16 CANLI `--taban` ornegine gider (varsayilan http://localhost:3000;
 *       bu Mac'te o adres URETIM api container'idir, ayakta olmali). C3b web container'ini
 *       (frontend/.env WEB_PORT, varsayilan 5173) yoklar. D/F/G/H bloklari izole sunucu.
 *       `--taban` yalnizca canli blogu etkiler; 5173 VERILMEZ (o nginx'tir, C1 duser).
 *   D — izole sunucu baslatmaz, yayindaki HTTPS adresini hedefler: canli panele
 *       backend/.env'deki ADMIN_PASSWORD ile girer, gecici surumler yukler ve siler
 *       (URETIME DOKUNUR). Adresi backend/.env PUBLIC_BASE_URL'den okur; `--domain` ezer.
 *
 *   node tests/run-suite.mjs D
 *   node tests/run-suite.mjs D --domain https://baska.adres
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { sonuclar, ozet, KOK } from './lib/harness.mjs';

const argv = process.argv.slice(2);
const tabanIndex = argv.indexOf('--taban');
const TABAN = tabanIndex >= 0 ? argv[tabanIndex + 1] : 'http://localhost:3000';
const domainIndex = argv.indexOf('--domain');
const DOMAIN = domainIndex >= 0 ? argv[domainIndex + 1] : undefined;
const secilen = argv.filter((a) => /^[A-G]$/i.test(a)).map((a) => a.toUpperCase());
const calistirilsinMi = (g) => secilen.length === 0 || secilen.includes(g);

const suitler = [
  ['A', './suite-a-env.mjs'],
  ['B', './suite-b-docker.mjs'],
  ['C', './suite-c-api.mjs'],
  ['D', './suite-d-https.mjs'],
];

console.log(`\x1b[1mipa-ota-download — uctan uca test\x1b[0m`);
console.log(`  Canli hedef : ${TABAN}`);
console.log(`  Gruplar     : ${secilen.length ? secilen.join(', ') : 'hepsi'}`);

for (const [harf, yol] of suitler) {
  if (!calistirilsinMi(harf)) continue;
  const modul = await import(yol);
  await modul.calistir({ taban: TABAN, domain: DOMAIN });
}

const basarisiz = ozet();

mkdirSync(join(KOK, 'tests/reports'), { recursive: true });
const damga = new Date().toISOString().replace(/[:.]/g, '-');
const raporYolu = join(KOK, 'tests/reports', `rapor-${damga}.json`);
writeFileSync(raporYolu, JSON.stringify({ tarih: new Date().toISOString(), taban: TABAN, sonuclar }, null, 2));
console.log(`\nRapor: ${raporYolu}`);

process.exit(basarisiz > 0 ? 1 : 0);

#!/usr/bin/env node
/**
 * Uctan uca test kosucusu.
 *
 *   node tests/run-suite.mjs              # tum gruplar
 *   node tests/run-suite.mjs A B          # yalnizca secilen gruplar
 *   node tests/run-suite.mjs --taban http://localhost:5173   # baska bir ornegi hedefle
 *
 * Grup D digerlerinden ayridir: izole sunucu baslatmaz, yayindaki HTTPS
 * adresini hedefler. Adresi `.env`deki PUBLIC_BASE_URL'den okur; `--domain`
 * ile ezilebilir.
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

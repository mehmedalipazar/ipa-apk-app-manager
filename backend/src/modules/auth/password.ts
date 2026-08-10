/**
 * Sifre ozetleme — scrypt (node:crypto), harici bagimlilik yok.
 *
 * Bicim:  scrypt$<N>$<r>$<p>$<tuzHex>$<ozetHex>
 * Parametreler ozetin icinde saklandigi icin ileride guclendirilebilir;
 * eski ozetler dogrulanmaya devam eder.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem?: number },
) => Promise<Buffer>;

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

export const MIN_PASSWORD_LENGTH = 8;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(plain.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parcalar = stored.split('$');
  if (parcalar.length !== 6 || parcalar[0] !== 'scrypt') return false;

  const n = Number(parcalar[1]);
  const r = Number(parcalar[2]);
  const p = Number(parcalar[3]);
  const saltHex = parcalar[4]!;
  const hashHex = parcalar[5]!;

  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  let beklenen: Buffer;
  try {
    beklenen = Buffer.from(hashHex, 'hex');
    const hesaplanan = await scryptAsync(plain.normalize('NFKC'), Buffer.from(saltHex, 'hex'), beklenen.length, {
      N: n,
      r,
      p,
      maxmem: MAXMEM,
    });
    return hesaplanan.length === beklenen.length && timingSafeEqual(hesaplanan, beklenen);
  } catch {
    return false;
  }
}

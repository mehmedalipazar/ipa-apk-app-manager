/**
 * Yerel disk surucusu. Docker'da bu dizin bir volume'e baglanir.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform, type Readable } from 'node:stream';
import { StorageLimitError, type ByteRange, type SaveResult, type Storage } from './types.ts';

export class LocalStorage implements Storage {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  /** Anahtari kok dizin icine hapseder — ".." ile disari cikilamaz. */
  private resolve(key: string): string {
    const temiz = normalize(key).replace(/^([./\\])+/, '');
    const tam = join(this.root, temiz);
    if (!tam.startsWith(this.root + sep) && tam !== this.root) {
      throw new Error(`Gecersiz depolama anahtari: ${key}`);
    }
    return tam;
  }

  async saveStream(key: string, stream: Readable, maxBytes: number): Promise<SaveResult> {
    const hedef = this.resolve(key);
    await mkdir(dirname(hedef), { recursive: true });

    const hash = createHash('sha256');
    let bytes = 0;

    // Akis ilerledikce hem sayar hem ozetler; boylece dosya tekrar okunmaz.
    const olcer = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          cb(new StorageLimitError(`Dosya boyutu sinirini asti (en fazla ${maxBytes} bayt).`));
          return;
        }
        hash.update(chunk);
        cb(null, chunk);
      },
    });

    try {
      await pipeline(stream, olcer, createWriteStream(hedef));
    } catch (e) {
      await rm(hedef, { force: true }); // Yarim dosya birakma.
      throw e;
    }

    return { bytes, sha256: hash.digest('hex') };
  }

  async saveBuffer(key: string, data: Buffer): Promise<void> {
    const hedef = this.resolve(key);
    await mkdir(dirname(hedef), { recursive: true });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(hedef, data);
  }

  async createReadStream(key: string, range?: ByteRange): Promise<Readable | null> {
    const hedef = this.resolve(key);
    if (!(await this.exists(key))) return null;
    return range
      ? createReadStream(hedef, { start: range.start, end: range.end })
      : createReadStream(hedef);
  }

  async size(key: string): Promise<number | null> {
    try {
      const s = await stat(this.resolve(key));
      return s.isFile() ? s.size : null;
    } catch {
      return null;
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.size(key)) !== null;
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async removePrefix(prefix: string): Promise<void> {
    await rm(this.resolve(prefix), { force: true, recursive: true });
  }

  /** Yerel diskte zaten duruyor — kopyalamaya gerek yok. */
  async withLocalFile<T>(key: string, fn: (path: string) => Promise<T>): Promise<T> {
    return fn(this.resolve(key));
  }
}

export function createStorage(dataDir: string): Storage {
  return new LocalStorage(join(dataDir, 'uploads'));
}

/**
 * IPA = ZIP. Buradaki amac tum arsivi acmak degil, yalnizca ihtiyac duyulan
 * birkac kucuk dosyayi (Info.plist + simge) bellege okumak. 1 GB'lik bir IPA
 * icin bile disk kullanimi sifir kalir.
 */
import yauzl from 'yauzl';
import { IpaParseError } from './types.ts';

export interface ZipEntryInfo {
  readonly path: string;
  readonly size: number;
}

/** Bir girdinin okunup okunmayacagini ve okuma sirasini belirleyen secici. */
export type EntrySelector = (path: string) => boolean;

/**
 * Arsivi tek gecisde tarar; `select` true donen girdileri bellege alir.
 *
 * @param maxEntryBytes Tek bir girdinin bellege alinabilecek en buyuk boyutu.
 *                      Zip bomb'a karsi koruma saglar.
 */
export async function readZipEntries(
  filePath: string,
  select: EntrySelector,
  maxEntryBytes = 8 * 1024 * 1024,
): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(new IpaParseError('Dosya acilamadi — gecerli bir ZIP/IPA arsivi degil.', err));
        return;
      }

      const sonuc = new Map<string, Buffer>();
      let bitti = false;

      const basarisiz = (e: unknown, mesaj: string) => {
        if (bitti) return;
        bitti = true;
        zipfile.close();
        reject(e instanceof IpaParseError ? e : new IpaParseError(mesaj, e));
      };

      zipfile.on('error', (e) => basarisiz(e, 'Arsiv okunurken hata olustu.'));

      zipfile.on('entry', (entry: yauzl.Entry) => {
        const path = entry.fileName;

        // Klasor girdileri ve secilmeyenler atlanir.
        if (path.endsWith('/') || !select(path)) {
          zipfile.readEntry();
          return;
        }

        if (entry.uncompressedSize > maxEntryBytes) {
          zipfile.readEntry();
          return;
        }

        zipfile.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) {
            basarisiz(streamErr, `Arsiv icindeki "${path}" okunamadi.`);
            return;
          }

          const parcalar: Buffer[] = [];
          let toplam = 0;

          stream.on('data', (chunk: Buffer) => {
            toplam += chunk.length;
            if (toplam > maxEntryBytes) {
              // Girdi, merkezi dizinde beyan ettigi boyutu asiyor: dosya bozuk
              // ya da kasitli (zip bomb). Akisi kesip TUM cozumlemeyi durdur —
              // yalnizca stream.destroy() cagirmak okuma dongusunu bir sonraki
              // girdiye tasimadigi icin promise'i sonsuza dek asili birakirdi.
              stream.destroy();
              basarisiz(
                new IpaParseError(`Arsiv girdisi ("${path}") beyan edilen boyutunu asiyor — dosya bozuk olabilir.`),
                'Arsiv okunurken hata olustu.',
              );
              return;
            }
            parcalar.push(chunk);
          });
          stream.on('error', (e) => basarisiz(e, `"${path}" okunurken hata olustu.`));
          stream.on('end', () => {
            if (toplam <= maxEntryBytes) sonuc.set(path, Buffer.concat(parcalar));
            zipfile.readEntry();
          });
        });
      });

      zipfile.on('end', () => {
        if (bitti) return;
        bitti = true;
        resolve(sonuc);
      });

      zipfile.readEntry();
    });
  });
}

/** Arsivdeki girdi adlarini listeler (icerik okumadan). */
export async function listZipEntries(filePath: string): Promise<ZipEntryInfo[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(new IpaParseError('Dosya acilamadi — gecerli bir ZIP/IPA arsivi degil.', err));
        return;
      }
      const girdiler: ZipEntryInfo[] = [];
      zipfile.on('error', (e) => reject(new IpaParseError('Arsiv okunamadi.', e)));
      zipfile.on('entry', (entry: yauzl.Entry) => {
        girdiler.push({ path: entry.fileName, size: entry.uncompressedSize });
        zipfile.readEntry();
      });
      zipfile.on('end', () => resolve(girdiler));
      zipfile.readEntry();
    });
  });
}

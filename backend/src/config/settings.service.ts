/**
 * Calisma anindaki ayarlari yonetir.
 *
 * Oncelik sirasi:  veritabani  >  ortam degiskeni  >  sema varsayilani
 *
 * Degerler bellekte tutulur ve yalnizca `update()` ile tazelenir; her istekte
 * veritabanina gidilmez.
 */
import { env } from './env.ts';
import type { SettingsRepository } from '../db/repositories/settings.repository.ts';
import { ConfigError } from '../shared/errors.ts';
import {
  AppConfigSchema,
  AppConfigUpdateSchema,
  type AppConfig,
  type AppConfigUpdate,
} from './settings.schema.ts';

const SETTINGS_PREFIX = 'config.';

export interface ConfigUpdateResult {
  readonly values: AppConfig;
  /**
   * Istek disinda gerceklesen degisiklikler (orn. maxTtlHours dusurulunce
   * defaultTtlHours'un kirpilmasi). Panel bunlari kullaniciya gosterir.
   */
  readonly notes: string[];
}

export class ConfigService {
  private readonly repo: SettingsRepository;
  private cache: AppConfig;

  constructor(repo: SettingsRepository) {
    this.repo = repo;
    this.cache = this.load();
  }

  private load(): AppConfig {
    const stored = this.repo.getAll();
    const raw: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(stored)) {
      if (key.startsWith(SETTINGS_PREFIX)) raw[key.slice(SETTINGS_PREFIX.length)] = value;
    }

    // baseUrl panelden degistirilemez; kaynagi PUBLIC_BASE_URL'dir ve
    // veritabanindaki degeri EZER. Aksi halde gecmiste bir kez kaydedilmis
    // eski adres, .env guncellense bile sonsuza kadar yapisir.
    //
    // Ortam degiskeni bosken DB'deki eski deger korunur: bu ayari gecmiste
    // panelden girmis kurulumlar yukseltmede adressiz kalmasin.
    if (env.PUBLIC_BASE_URL) {
      raw['baseUrl'] = env.PUBLIC_BASE_URL.replace(/\/+$/, '');
    }

    const parsed = AppConfigSchema.safeParse(raw);
    if (parsed.success) return parsed.data;

    // Bozuk/eksik tek bir kayit tum servisi durdurmamali: alan alan kurtar.
    const kurtarilmis: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      const tek = AppConfigSchema.pick({ [key]: true } as never).safeParse({ [key]: value });
      if (tek.success) kurtarilmis[key] = value;
    }
    return AppConfigSchema.parse(kurtarilmis);
  }

  get(): AppConfig {
    return this.cache;
  }

  /**
   * Kismi guncelleme. Dogrulanmis yeni ayarlarin yaninda `notes` doner:
   * yoneticinin YAZMADIGI halde sunucunun degistirdigi degerler. Bunlar
   * bildirilmezse panelde bir alan sessizce baska bir degere kayar.
   */
  update(patch: AppConfigUpdate): ConfigUpdateResult {
    const temiz = AppConfigUpdateSchema.parse(patch);
    const notes: string[] = [];

    // maxTtlHours dusurulurse defaultTtlHours onu asmamali.
    const birlesik = AppConfigSchema.parse({ ...this.cache, ...temiz });
    if (birlesik.defaultTtlHours > birlesik.maxTtlHours) {
      notes.push(
        `Varsayilan link suresi (${birlesik.defaultTtlHours} saat) en uzun link suresinden ` +
          `buyuktu; ${birlesik.maxTtlHours} saate cekildi.`,
      );
      birlesik.defaultTtlHours = birlesik.maxTtlHours;
    }

    // baseUrl DB'ye YAZILMAZ — kaynagi PUBLIC_BASE_URL. Yazilsaydi ilk kayitta
    // ortam degiskeni golgelenir, sonraki .env degisiklikleri etkisiz kalirdi.
    const yazilacak: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(birlesik)) {
      if (key === 'baseUrl') continue;
      yazilacak[SETTINGS_PREFIX + key] = value;
    }
    this.repo.setMany(yazilacak);

    this.cache = birlesik;
    return { values: this.cache, notes };
  }

  /**
   * baseUrl yoksa manifest.plist uretilemez — iOS mutlak adres ister.
   * Istek basliklarindan tahmin etmek yerine acikca hata veriyoruz: yanlis
   * adresle uretilen bir manifest telefonda SESSIZCE basarisiz olur.
   */
  requireBaseUrl(): string {
    const { baseUrl } = this.cache;
    if (!baseUrl) {
      throw new ConfigError(
        'Genel adres (Base URL) ayarlanmamis. Sunucudaki ortam dosyasinda ' +
          'PUBLIC_BASE_URL degerini servisin https adresine ayarlayip yeniden baslatin.',
      );
    }
    return baseUrl;
  }

  /** iOS OTA yalnizca gecerli sertifikali HTTPS ister; Android APK indirmesi de https bekler. */
  isBaseUrlSecure(): boolean {
    return this.cache.baseUrl.startsWith('https://');
  }

  /**
   * Kurulumun calismasini engelleyebilecek yapilandirma sorunlari.
   * Arayuz bunlari uyari olarak gosterir; bastirmayin.
   */
  warnings(): string[] {
    const out: string[] = [];
    if (!this.cache.baseUrl) {
      out.push(
        'Genel adres (Base URL) bos. Kurulum linkleri uretilemez — sunucudaki ' +
          'ortam dosyasinda PUBLIC_BASE_URL degerini ayarlayin.',
      );
    } else if (!this.isBaseUrlSecure()) {
      // Adres metne yazilir: yoneticinin hangi degerin hatali oldugunu gormesi
      // teshisin yarisi. Panel bu diziyi oldugu gibi gosterir.
      out.push(
        `Genel adres (${this.cache.baseUrl}) https:// ile baslamiyor. iOS OTA kurulumu ` +
          'yalnizca gecerli sertifikali HTTPS uzerinden calisir; iOS linkleri telefonda ' +
          'calismaz. Android tarafinda APK indirmesi guvensiz sayilip tarayici tarafindan ' +
          'engellenebilir.',
      );
    }
    return out;
  }
}

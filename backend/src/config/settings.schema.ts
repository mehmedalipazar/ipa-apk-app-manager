/**
 * Admin panelden degistirilebilen ayarlarin semasi.
 *
 * TEK KAYNAK: buraya bir alan eklemek onu otomatik olarak hem API'ye
 * (GET/PUT /api/settings) hem de admin paneline tasir. Panel, alanlari
 * `CONFIG_FIELDS` listesinden okuyup kendisi cizer — arayuzde elle form
 * yazmak gerekmez.
 */
import { z } from 'zod';

/**
 * Bir linke verilebilecek mutlak ust sinir (saat).
 * 8760 saat = 365 gun. Ayarlardaki "En uzun link suresi" bu degere kadar
 * cikarilabilir; daha uzunu isteniyorsa burasi buyutulmeli.
 */
export const MAX_TTL_HOURS = 8760;

export const AppConfigSchema = z.object({
  /**
   * Disaridan gorunen adres — manifest.plist icindeki tum URL'lerin koku.
   *
   * PANELDE HIC GORUNMEZ. Tek kaynagi `PUBLIC_BASE_URL` ortam degiskenidir:
   * adres altyapiya aittir (DNS, sertifika, ters proxy ile birlikte degisir)
   * ve calisma aninda panelden degistirilirse uretilmis kurulum linkleri
   * sessizce kirilir. Bu yuzden ne CONFIG_FIELDS'te ne de update semasinda yer alir.
   */
  baseUrl: z
    .string()
    .trim()
    .refine((v) => v === '' || /^https?:\/\/[^\s/]+/.test(v), 'Gecerli bir URL girin')
    .refine((v) => !v.endsWith('/'), 'Adresin sonunda / olmamali')
    .default(''),

  /** Yeni linklerin varsayilan gecerlilik suresi (saat). */
  defaultTtlHours: z.number().int().min(1).max(MAX_TTL_HOURS).default(24),

  /** Bir linke verilebilecek en uzun sure (saat). Yuklemede asilamaz. */
  maxTtlHours: z.number().int().min(1).max(MAX_TTL_HOURS).default(720),

  /** Kabul edilen en buyuk IPA boyutu (MB). */
  maxUploadMb: z.number().int().min(1).max(8192).default(1024),

  /** Suresi dolan linklerin dosyalari kac saat sonra diskten silinsin? */
  purgeAfterExpiryHours: z.number().int().min(0).max(MAX_TTL_HOURS).default(24),

  /** Kurulum sayfasinda gosterilen baslik. */
  siteName: z.string().trim().max(80).default('IPA OTA Dagitim'),

  /** Kurulum sayfasinin altinda gosterilen serbest metin. */
  installNote: z.string().trim().max(500).default(''),

  /** Kurulum sayfasinda QR kod gosterilsin mi? */
  showQrCode: z.boolean().default(true),

  /** Ayni bundle-id icin yeni yukleme yapilinca eskisi iptal edilsin mi? */
  revokePreviousOnUpload: z.boolean().default(false),

  /** manifest.plist ve .ipa icin uretilen imzali linklerin omru (dakika). */
  signedUrlTtlMinutes: z.number().int().min(5).max(1440).default(120),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

/**
 * Yalnizca bu alanlar `PUT /api/settings` ile guncellenebilir.
 *
 * `baseUrl` disarida: zod bilinmeyen anahtarlari sessizce atar, yani govdede
 * gelse bile yok sayilir. Panel tum degerleri birlikte gonderdigi icin bu sart —
 * aksi halde her kayitta baseUrl de DB'ye yazilir ve PUBLIC_BASE_URL kalici
 * olarak golgelenirdi.
 */
export const AppConfigUpdateSchema = AppConfigSchema.omit({ baseUrl: true }).partial();
export type AppConfigUpdate = z.infer<typeof AppConfigUpdateSchema>;

export const DEFAULT_CONFIG: AppConfig = AppConfigSchema.parse({});

/** Panelde bir alanin nasil cizilecegini tarif eder. */
export type FieldKind = 'text' | 'number' | 'boolean' | 'textarea';

export interface FieldMeta {
  readonly key: keyof AppConfig;
  readonly label: string;
  readonly help: string;
  readonly kind: FieldKind;
  readonly unit?: string;
  /** Sayi alanlari icin kabul edilen aralik — panelde de ayni sinir gosterilir. */
  readonly min?: number;
  readonly max?: number;
  readonly group: 'link' | 'yukleme' | 'gorunum';
}

/**
 * Panelin cizecegi alanlar.
 *
 * `baseUrl` BU LISTEDE YOKTUR ve olmamalidir: adres yalnizca ortam
 * degiskeninden gelir, arayuzden ayarlanabilir olmasina gerek yoktur.
 */
export const CONFIG_FIELDS: readonly FieldMeta[] = [
  {
    key: 'siteName',
    label: 'Site adi',
    help: 'Kurulum sayfasinin altbilgisinde ve tarayici sekmesinde gorunur.',
    kind: 'text',
    group: 'gorunum',
  },
  {
    key: 'installNote',
    label: 'Kurulum notu',
    help: 'Kurulum sayfasinin altinda gosterilecek serbest metin. Bos birakilabilir.',
    kind: 'textarea',
    group: 'gorunum',
  },
  {
    key: 'showQrCode',
    label: 'QR kod goster',
    help: 'Yukleme sonuc ekraninda ve kurulum sayfasi iOS DISI bir cihazda acildiginda QR kod gosterilir. iPhone/iPad ile girildiginde QR yerine dogrudan kurulum butonu cikar.',
    kind: 'boolean',
    group: 'gorunum',
  },
  {
    key: 'defaultTtlHours',
    label: 'Varsayilan link suresi',
    help: 'Yeni olusturulan linkler varsayilan olarak bu sure sonunda gecersiz olur. 24 = 1 gun, 168 = 1 hafta, 720 = 30 gun.',
    kind: 'number',
    unit: 'saat',
    min: 1,
    max: MAX_TTL_HOURS,
    group: 'link',
  },
  {
    key: 'maxTtlHours',
    label: 'En uzun link suresi',
    help: `Bir linke verilebilecek ust sinir. Yukleme sirasinda bu degerin uzeri secilemez. En fazla ${MAX_TTL_HOURS} saat (1 yil).`,
    kind: 'number',
    unit: 'saat',
    min: 1,
    max: MAX_TTL_HOURS,
    group: 'link',
  },
  {
    key: 'purgeAfterExpiryHours',
    label: 'Silme gecikmesi',
    help: 'Suresi dolan linklerin IPA dosyalari bu sure sonunda diskten silinir. 0 = hemen sil.',
    kind: 'number',
    unit: 'saat',
    min: 0,
    max: MAX_TTL_HOURS,
    group: 'link',
  },
  {
    key: 'signedUrlTtlMinutes',
    label: 'Imzali link omru',
    help: 'manifest.plist ve .ipa adresleri icin uretilen imzanin gecerlilik suresi. Linkin toplam omruyle ilgisi yoktur; yavas baglantilarda indirme yarida kesilmesin diye yeterince uzun olmali.',
    kind: 'number',
    unit: 'dakika',
    min: 5,
    max: 1440,
    group: 'link',
  },
  {
    key: 'maxUploadMb',
    label: 'En buyuk dosya boyutu',
    help: 'Bundan buyuk IPA dosyalari reddedilir. Ters proxy kullaniyorsaniz orada da client_max_body_size degerini ayarlamayi unutmayin.',
    kind: 'number',
    unit: 'MB',
    min: 1,
    max: 8192,
    group: 'yukleme',
  },
  {
    key: 'revokePreviousOnUpload',
    label: 'Onceki surumu otomatik iptal et',
    help: 'Ayni bundle-id ile yeni bir IPA yuklendiginde, o uygulamanin onceki aktif linkleri kapatilir.',
    kind: 'boolean',
    group: 'yukleme',
  },
];

/* --- Dogrulama hatalarinin insan diline cevrilmesi ------------------------- */

export interface ConfigIssue {
  /** Hatanin ait oldugu alan. Panel bu girdiyi isaretleyip odaklar. */
  readonly field?: keyof AppConfig;
  /** Son kullaniciya gosterilecek mesaj. */
  readonly message: string;
}

/** zod'un ingilizce tip adlari -> arayuzde kullanilan karsiliklari. */
const TIP_ADLARI: Record<string, string> = {
  integer: 'tam sayi (ondalikli olamaz)',
  number: 'sayi',
  string: 'metin',
  boolean: 'acik/kapali degeri',
};

/**
 * Zod hatasini panelde gosterilebilir hale getirir.
 *
 * Ham zod mesaji ("maxTtlHours: Number must be greater than or equal to 1")
 * Turkce arayuzde hem dil hem de terim olarak yabanci kaliyordu. Alan adini
 * `CONFIG_FIELDS`ten okudugumuz icin etiketler tek kaynakta kalir; `field`
 * anahtari da arayuzun hatayi dogru girdinin altinda gostermesini saglar.
 */
export function describeConfigIssue(issue: z.ZodIssue): ConfigIssue {
  const yol = issue.path[0];
  const field = typeof yol === 'string' && yol in AppConfigSchema.shape
    ? (yol as keyof AppConfig)
    : undefined;
  const meta = CONFIG_FIELDS.find((f) => f.key === field);
  const ad = meta?.label ?? field ?? 'Ayar';

  // Sayi alanlarinda sinirin birimi vardir (saat/dakika/MB); metin alanlarinda
  // sinir karakter sayisidir.
  const birim = meta?.unit
    ? ` ${meta.unit}`
    : meta?.kind === 'text' || meta?.kind === 'textarea'
      ? ' karakter'
      : '';

  switch (issue.code) {
    case 'too_small':
      return { field, message: `${ad}: en az ${issue.minimum}${birim} olmali.` };
    case 'too_big':
      return { field, message: `${ad}: en fazla ${issue.maximum}${birim} olabilir.` };
    case 'invalid_type':
      return { field, message: `${ad}: ${TIP_ADLARI[issue.expected] ?? issue.expected} girin.` };
    default:
      return { field, message: `${ad}: gecersiz deger.` };
  }
}

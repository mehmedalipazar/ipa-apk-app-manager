/**
 * Altyapi ayarlari — process baslangicinda bir kez okunur ve dogrulanir.
 *
 * Bu degerler calisma aninda degistirilemez; container yeniden baslamadan
 * degismezler. Admin panelden degistirilebilen ayarlar icin
 * `config/settings.schema.ts` dosyasina bakin.
 *
 * YUKLEME SIRASI (package.json scriptleri belirler, sonraki oncekini ezer):
 *   .env.development | .env.production   ->  .env.local  ->  gercek ortam degiskeni
 *
 * Yani docker compose'un `environment:` bloguyla verdigi her deger, imaja
 * gomulu .env.production degerini ezer. Sirlar bu yuzden dosyaya degil
 * compose'a yazilir.
 */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

/** "true" / "1" disindaki her sey false. */
const mantiksal = (varsayilan: 'true' | 'false') =>
  z
    .string()
    .default(varsayilan)
    .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATA_DIR: z.string().default('./data'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  TRUST_PROXY: mantiksal('false'),

  /**
   * Disaridan gorunen HTTPS adresi — kurulum linklerinin ve manifest.plist
   * icindeki tum URL'lerin koku.
   *
   * Bu adres, arayuzun API'ye ulastigi adresle AYNI SEY DEGILDIR. Arayuz
   * uretimde goreli yol (relative path) kullanir; buradaki deger ise iOS'un
   * gordugu mutlak adrestir ve mutlaka https olmalidir.
   */
  PUBLIC_BASE_URL: z.string().default(''),

  /**
   * Kurulum uclarinin yol oneki (`/i/:token`, manifest.plist, app.ipa).
   *
   * Ters proxy yalnizca `/api/*` yolunu API'ye yonlendiriyorsa `/api/i` yapin.
   * Rota kayitlari ve uretilen linkler bu tek kaynaktan okunur.
   */
  INSTALL_PATH_PREFIX: z
    .string()
    .default('/i')
    .transform((v) => v.trim().replace(/\/+$/, ''))
    .refine((v) => /^(\/[A-Za-z0-9._~-]+)+$/.test(v), {
      message: "Bicim: /i ya da /api/i gibi — '/' ile baslamali, sonda '/' olmamali",
    }),

  /** Admin sifresi. Yalnizca ILK aciliste okunur ve ozetlenip DB'ye yazilir. */
  ADMIN_PASSWORD: z.string().default(''),

  /** true ise ADMIN_PASSWORD kayitli sifrenin uzerine yazilir (sifirlama). */
  ADMIN_PASSWORD_FORCE_RESET: mantiksal('false'),

  /** Oturum cerezi ve imzali link HMAC anahtari. Degisirse ikisi de duser. */
  SESSION_SECRET: z.string().default(''),

  /**
   * Admin arayuzunun origin'leri — virgulle ayrilir.
   *
   * BOS BIRAKIN: arayuz ile API ayni origin uzerinden (ters proxy ile)
   * sunuluyorsa dogru olan budur. Liste dolduran her deger, oturum cerezini
   * SameSite=None'a zorlar ve gereksiz yere zayiflatir.
   *
   * Yalnizca arayuz gercekten ayri bir adreste calisiyorsa doldurun
   * (orn. gelistirmede http://localhost:5173).
   */
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim().replace(/\/+$/, ''))
        .filter(Boolean),
    ),

  /**
   * Oturum cerezinin SameSite degeri. 'auto': CORS_ORIGINS doluysa 'none',
   * degilse 'lax'. Ayri origin + 'lax' => tarayici cerezi hic gondermez.
   */
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none', 'auto']).default('auto'),

  /**
   * Cerezin Secure bayragi. 'auto': SameSite=None ise ya da uretimde true.
   * SameSite=None + Secure=false kombinasyonunu tarayicilar reddeder.
   */
  COOKIE_SECURE: z.enum(['true', 'false', 'auto']).default('auto'),
});

export type Env = z.infer<typeof EnvSchema> & {
  SESSION_SECRET: string;
  /** 'auto' cozulmus hali — cerez yazarken bu kullanilir. */
  cookieSameSite: 'lax' | 'strict' | 'none';
  /** 'auto' cozulmus hali. */
  cookieSecure: boolean;
};

/** Origin bicimini dogrular: sema://host[:port], yol ve sorgu olmadan. */
function originGecerliMi(deger: string): boolean {
  try {
    const u = new URL(deger);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin === deger;
  } catch {
    return false;
  }
}

function load(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const detay = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Ortam degiskenleri gecersiz:\n${detay}`);
  }
  const env = parsed.data;

  if (!env.SESSION_SECRET) {
    if (env.NODE_ENV === 'production') {
      throw new Error(
        'SESSION_SECRET tanimli degil. Uretmek icin: openssl rand -hex 32\n' +
          'Bu deger olmadan oturumlar ve imzali indirme linkleri guvenli degildir.',
      );
    }
    // Gelistirmede her yeniden baslatmada yeni anahtar: oturumlar duser ama
    // servis .env olmadan da ayaga kalkar.
    env.SESSION_SECRET = randomBytes(32).toString('hex');
    console.warn('[env] SESSION_SECRET yok — gelistirme icin gecici anahtar uretildi.');
  }

  const hataliOrigin = env.CORS_ORIGINS.filter((o) => !originGecerliMi(o));
  if (hataliOrigin.length > 0) {
    throw new Error(
      `CORS_ORIGINS gecersiz deger iceriyor: ${hataliOrigin.join(', ')}\n` +
        'Bicim: sema://host[:port] — sonda / ve yol olmamali. Orn: https://admin.sirket.com',
    );
  }

  const capraz = env.CORS_ORIGINS.length > 0;
  const sameSite =
    env.COOKIE_SAMESITE === 'auto' ? (capraz ? 'none' : 'lax') : env.COOKIE_SAMESITE;
  const secure =
    env.COOKIE_SECURE === 'auto'
      ? sameSite === 'none' || env.NODE_ENV === 'production'
      : env.COOKIE_SECURE === 'true';

  // Tarayicilar SameSite=None cerezini Secure olmadan yok sayar. Sonuc
  // kullaniciya "giris yapilamiyor" olarak gorunur, o yuzden acilista patlat.
  if (sameSite === 'none' && !secure) {
    throw new Error(
      'COOKIE_SAMESITE=none ile COOKIE_SECURE=false birlikte kullanilamaz — ' +
        'tarayici bu cerezi yok sayar ve admin girisi calismaz.\n' +
        'HTTPS kullanin ya da arayuzu API ile ayni origin uzerine alip ' +
        'COOKIE_SAMESITE=lax yapin.',
    );
  }

  if (capraz && sameSite === 'lax') {
    console.warn(
      '[env] CORS_ORIGINS tanimli ama COOKIE_SAMESITE=lax — ' +
        'farkli origin`den yapilan admin girisi calismayacaktir.',
    );
  }

  return { ...env, cookieSameSite: sameSite, cookieSecure: secure } as Env;
}

export const env: Env = load();

export const isProd = env.NODE_ENV === 'production';

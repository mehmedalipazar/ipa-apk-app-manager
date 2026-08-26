/**
 * Genel (kimlik dogrulamasiz) kurulum rotalari.
 *
 * Bu dosyadaki adresler son kullaniciya ve iOS'un `installd` surecine acilir.
 *
 * ASLA CEREZ KOYMAYIN: iOS `itms-services://` adresini izlerken manifest.plist
 * ve .ipa dosyalarini Safari degil, isletim sisteminin `installd` sureci ceker
 * ve o surec Safari'nin cerezlerini paylasmaz. Cerez tabanli koruma OTA
 * kurulumunu tamamen bozar. Yetki bu yuzden URL icindeki kisa omurlu HMAC
 * imzasindadir (`domain/links/token.ts`) ve `token + purpose` ciftine baglidir
 * (amaclar: manifest | ipa | apk | icon). Android'de manifest yoktur: kurulum
 * sayfasindaki buton dogrudan imzali `app.apk` adresine gider.
 *
 * Yol oneki tek kaynaktan gelir: env.INSTALL_PATH_PREFIX. Hem rota kaydi hem
 * uretilen linkler ayni degeri okur — hicbir yere '/i' yazmayin.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import QRCode from 'qrcode';
import type { AppContainer } from '../../container.ts';
import type { AppModule } from '../../shared/module.types.ts';
import { env } from '../../config/env.ts';
import { ConfigError } from '../../shared/errors.ts';
import { getStatus } from '../../domain/links/service.ts';
import { verifyAccess, type AccessPurpose } from '../../domain/links/token.ts';
import type { Platform } from '../../domain/package/types.ts';
import { buildManifest } from '../../domain/ota/manifest.ts';
import {
  isAndroidUserAgent,
  isIosUserAgent,
  renderInstallPage,
  renderUnavailablePage,
} from '../../domain/ota/install-page.ts';
import { verifyPassword } from '../auth/password.ts';

interface TokenParams {
  token: string;
}

async function register(app: FastifyInstance, ctx: AppContainer): Promise<void> {
  /** Yol oneki — uretilen linklerle ayni kaynaktan gelir. */
  const P = env.INSTALL_PATH_PREFIX;

  const kaydiGetir = (token: string) => ctx.builds.findByToken(token);

  /* --- Kurulum sayfasi ---------------------------------------------------- */

  const sayfayiGoster = async (
    request: FastifyRequest<{ Params: TokenParams }>,
    reply: FastifyReply,
    girilenSifre: string | null,
  ): Promise<void> => {
    const ayarlar = ctx.config.get();
    const build = kaydiGetir(request.params.token);

    if (!build) {
      await reply
        .code(404)
        .type('text/html; charset=utf-8')
        .send(renderUnavailablePage(ayarlar.siteName, 'notfound'));
      return;
    }

    const durum = getStatus(build);
    if (durum !== 'active') {
      await reply
        .code(410)
        .type('text/html; charset=utf-8')
        .send(renderUnavailablePage(ayarlar.siteName, durum, build.appName, build.expiresAt));
      return;
    }

    // Link sifresi kontrolu
    let sifreGerekli = build.passwordHash !== null;
    let sifreHatasi: string | null = null;

    if (sifreGerekli && girilenSifre !== null) {
      if (await verifyPassword(girilenSifre, build.passwordHash!)) {
        sifreGerekli = false;
      } else {
        sifreHatasi = 'Sifre hatali. Tekrar deneyin.';
      }
    }

    // Yanlis sifre denemesi "goruntuleme" sayilmaz — sayac gercek erisimi olcer.
    if (sifreHatasi === null) ctx.builds.increment(build.id, 'view_count');

    let pageUrl: string;
    let installUrl: string | null = null;
    let iconUrl: string | null = null;

    try {
      pageUrl = ctx.links.publicUrl(build.token);
      if (!sifreGerekli) {
        // iOS: itms-services zinciri (manifest.plist). Android: tarayicinin
        // dogrudan indirdigi imzali .apk adresi — manifest kavrami yok.
        installUrl =
          build.platform === 'android'
            ? ctx.links.apkUrl(build.token)
            : ctx.links.itmsServicesUrl(build.token);
      }
      if (build.iconPath) iconUrl = ctx.links.iconUrl(build.token, build.iconPath);
    } catch (e) {
      if (e instanceof ConfigError) {
        // "Link bulunamadi" DEGIL: sorun kullanicinin adresi degil, sunucu
        // yapilandirmasi. Yanlis teshis gosterme (2026-08-20).
        await reply
          .code(503)
          .type('text/html; charset=utf-8')
          .send(renderUnavailablePage(ayarlar.siteName, 'yapilandirma'));
        request.log.error({ err: e }, 'Base URL ayarlanmamis — kurulum sayfasi uretilemedi.');
        return;
      }
      throw e;
    }

    const ua = request.headers['user-agent'];
    const html = renderInstallPage({
      siteName: ayarlar.siteName,
      build,
      status: durum,
      isIos: isIosUserAgent(ua),
      isAndroid: isAndroidUserAgent(ua),
      installUrl,
      iconUrl,
      pageUrl,
      showQrCode: ayarlar.showQrCode,
      installNote: ayarlar.installNote,
      needsPassword: sifreGerekli,
      passwordError: sifreHatasi,
    });

    await reply
      .type('text/html; charset=utf-8')
      // Sayfa kisa omurlu imzali adresler icerir; onbellege alinmamali.
      .header('cache-control', 'no-store, must-revalidate')
      .send(html);
  };

  app.get<{ Params: TokenParams }>(`${P}/:token`, async (request, reply) => {
    await sayfayiGoster(request, reply, null);
  });

  app.post<{ Params: TokenParams; Body: { password?: string } }>(
    `${P}/:token`,
    async (request, reply) => {
      const sifre = typeof request.body?.password === 'string' ? request.body.password : '';
      await sayfayiGoster(request, reply, sifre);
    },
  );

  /* --- manifest.plist ----------------------------------------------------- */
  // iOS'un okudugu XML. Uretimi tamamen backend'de: domain/ota/manifest.ts.

  app.get<{ Params: TokenParams; Querystring: { k?: string } }>(
    `${P}/:token/manifest.plist`,
    async (request, reply) => {
      const build = kaydiGetir(request.params.token);
      if (!build) return reply.code(404).send({ error: 'Bulunamadi' });
      // Android paketinin manifest.plist'i yoktur: bu kayit icin boyle bir kaynak yok.
      if (build.platform !== 'ios') return reply.code(404).send({ error: 'Bulunamadi' });
      if (getStatus(build) !== 'active') {
        return reply.code(410).send({ error: 'Bu linkin suresi dolmus.' });
      }
      if (!verifyAccess(env.SESSION_SECRET, build.token, 'manifest', request.query.k)) {
        return reply.code(403).send({ error: 'Erisim anahtari gecersiz ya da suresi dolmus.' });
      }

      const simgeUrl = build.iconPath ? ctx.links.iconUrl(build.token, build.iconPath) : null;
      const manifest = buildManifest({
        bundleId: build.bundleId,
        version: build.version,
        title: build.appName,
        ipaUrl: ctx.links.ipaUrl(build.token),
        displayImageUrl: simgeUrl,
        fullSizeImageUrl: simgeUrl,
      });

      ctx.builds.increment(build.id, 'install_count');

      return reply
        .type('application/xml; charset=utf-8')
        .header('cache-control', 'no-store')
        .send(manifest);
    },
  );

  /* --- Paket dosyasi: app.ipa / app.apk ----------------------------------- */
  // Iki rota ayni govdeyi paylasir; farklari platform, imza amaci, uzanti ve
  // content-type. Platform uyusmazligi (Android kaydinda app.ipa ya da tersi)
  // 404'tur — o kayit icin boyle bir kaynak yok — ve durum/imza kontrolunden
  // ONCE gelir. Imza amaci da ayridir: 'ipa' anahtari app.apk'yi acmaz.

  interface PaketSecenegi {
    readonly platform: Platform;
    readonly purpose: AccessPurpose;
    readonly uzanti: 'ipa' | 'apk';
    readonly contentType: string;
  }

  const paketiGonder = async (
    request: FastifyRequest<{ Params: TokenParams; Querystring: { k?: string } }>,
    reply: FastifyReply,
    secenek: PaketSecenegi,
  ) => {
    const build = kaydiGetir(request.params.token);
    if (!build) return reply.code(404).send({ error: 'Bulunamadi' });
    if (build.platform !== secenek.platform) return reply.code(404).send({ error: 'Bulunamadi' });
    if (getStatus(build) !== 'active') {
      return reply.code(410).send({ error: 'Bu linkin suresi dolmus.' });
    }
    if (!verifyAccess(env.SESSION_SECRET, build.token, secenek.purpose, request.query.k)) {
      return reply.code(403).send({ error: 'Erisim anahtari gecersiz ya da suresi dolmus.' });
    }

    const key = build.packagePath;
    const toplam = await ctx.storage.size(key);
    if (toplam === null) return reply.code(410).send({ error: 'Dosya sunucudan kaldirilmis.' });

    // Ad VE surum birlikte temizlenir: surumden gelebilecek tirnak/bosluk
    // Content-Disposition basligini bozmasin (2026-08-20).
    const dosyaAdi = `${`${build.appName}-${build.version}`.replace(/[^\w.-]+/g, '_')}.${secenek.uzanti}`;

    // Kismi indirme (Range) destegi — buyuk dosyalarda kopan indirmeler
    // bastan baslamasin diye.
    const range = parseRange(request.headers.range, toplam);
    if (range === 'karsilanamaz') {
      // RFC 9110 14.4: dosya disinda baslayan aralik 416 + bytes */size.
      return reply
        .code(416)
        .header('content-range', `bytes */${toplam}`)
        .send({ error: 'Istenen aralik dosya boyutunun disinda.' });
    }

    // Sayac "indirme"yi olcer: dosyanin BASINDAN baslayan govdeli istekler.
    // iOS installd buyuk dosyayi Range parcalariyla ceker; her parcayi ayri
    // indirme saymak sayaci anlamsizca sisiriyordu. HEAD hic sayilmaz (2026-08-20).
    const indirmeSayilir = request.method !== 'HEAD' && (range === null || range.start === 0);

    if (range) {
      const stream = await ctx.storage.createReadStream(key, range);
      if (!stream) return reply.code(410).send({ error: 'Dosya bulunamadi.' });
      if (indirmeSayilir) ctx.builds.increment(build.id, 'download_count');
      return reply
        .code(206)
        .type(secenek.contentType)
        .header('content-range', `bytes ${range.start}-${range.end}/${toplam}`)
        .header('content-length', String(range.end - range.start + 1))
        .header('accept-ranges', 'bytes')
        .header('content-disposition', `attachment; filename="${dosyaAdi}"`)
        .send(stream);
    }

    const stream = await ctx.storage.createReadStream(key);
    if (!stream) return reply.code(410).send({ error: 'Dosya bulunamadi.' });

    if (indirmeSayilir) ctx.builds.increment(build.id, 'download_count');
    return reply
      .type(secenek.contentType)
      .header('content-length', String(toplam))
      .header('accept-ranges', 'bytes')
      .header('content-disposition', `attachment; filename="${dosyaAdi}"`)
      .send(stream);
  };

  app.get<{ Params: TokenParams; Querystring: { k?: string } }>(
    `${P}/:token/app.ipa`,
    (request, reply) =>
      paketiGonder(request, reply, {
        platform: 'ios',
        purpose: 'ipa',
        uzanti: 'ipa',
        contentType: 'application/octet-stream',
      }),
  );

  app.get<{ Params: TokenParams; Querystring: { k?: string } }>(
    `${P}/:token/app.apk`,
    (request, reply) =>
      paketiGonder(request, reply, {
        platform: 'android',
        purpose: 'apk',
        uzanti: 'apk',
        // Android'in paket yukleyicisini tetikleyen resmi tur.
        contentType: 'application/vnd.android.package-archive',
      }),
  );

  /* --- Simge -------------------------------------------------------------- */
  // iOS simgesi hep PNG'dir (CgBI donusumu); Android'de PNG ya da WebP olabilir.
  // Dosya adi kayittaki iconPath'ten gelir; istenen ad onunla eslesmiyorsa 404.

  const SIMGE_TURLERI = [
    ['icon.png', 'image/png'],
    ['icon.webp', 'image/webp'],
  ] as const;

  for (const [dosya, mime] of SIMGE_TURLERI) {
    app.get<{ Params: TokenParams; Querystring: { k?: string } }>(
      `${P}/:token/${dosya}`,
      async (request, reply) => {
        const build = kaydiGetir(request.params.token);
        if (!build?.iconPath || !build.iconPath.endsWith(`/${dosya}`)) {
          return reply.code(404).send({ error: 'Simge yok' });
        }
        if (getStatus(build) !== 'active') return reply.code(410).send({ error: 'Suresi dolmus.' });
        if (!verifyAccess(env.SESSION_SECRET, build.token, 'icon', request.query.k)) {
          return reply.code(403).send({ error: 'Erisim anahtari gecersiz.' });
        }

        const stream = await ctx.storage.createReadStream(build.iconPath);
        if (!stream) return reply.code(404).send({ error: 'Simge bulunamadi' });

        return reply.type(mime).header('cache-control', 'private, max-age=600').send(stream);
      },
    );
  }

  /* --- QR kod ------------------------------------------------------------- */
  // Bilerek imzasiz: QR yalnizca kurulum sayfasinin kendi adresini kodlar,
  // yani token'i zaten bilen birine yeni bir sey vermez. Durum kontrolu de
  // yok — suresi dolmus bir linkin QR'i uretilir, ama acildiginda 410 alir.

  app.get<{ Params: TokenParams }>(`${P}/:token/qr.svg`, async (request, reply) => {
    const build = kaydiGetir(request.params.token);
    if (!build) return reply.code(404).send({ error: 'Bulunamadi' });

    const svg = await QRCode.toString(ctx.links.publicUrl(build.token), {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    });

    return reply
      .type('image/svg+xml')
      .header('cache-control', 'private, max-age=600')
      .send(svg);
  });
}

/**
 * `Range: bytes=0-1023` basligini RFC 9110'a gore cozer.
 *
 *   null            -> baslik yok ya da bicimi bozuk: baslik YOK SAYILIR, tam govde (200).
 *   'karsilanamaz'  -> aralik dosyanin disinda: 416 + `Content-Range: bytes *\/size`.
 *   {start, end}    -> gecerli aralik; son bayti asan istek size-1'e KIRPILIR
 *                      (eskiden 200 tam govdeye dusuluyordu — 2026-08-20).
 */
function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | 'karsilanamaz' | null {
  if (!header) return null;
  const eslesme = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!eslesme) return null;

  const [, startStr, endStr] = eslesme;

  if (startStr) {
    const start = Number(startStr);
    if (!Number.isFinite(start)) return null;
    if (start >= size) return 'karsilanamaz';
    const end = endStr ? Math.min(Number(endStr), size - 1) : size - 1;
    if (!Number.isFinite(end) || start > end) return null; // sozdizimsel sacmalik: yok say
    return { start, end };
  }

  if (endStr) {
    // "bytes=-500" => son 500 bayt. "-0" karsilanamaz; dosyadan buyuk N tum dosyadir.
    const n = Number(endStr);
    if (!Number.isFinite(n)) return null;
    if (n === 0) return 'karsilanamaz';
    return { start: Math.max(0, size - n), end: size - 1 };
  }

  return null;
}

export const installModule: AppModule = {
  name: 'install',
  description: `OTA kurulum uclari (${env.INSTALL_PATH_PREFIX}/:token) — imzali, cerezsiz`,
  register,
};

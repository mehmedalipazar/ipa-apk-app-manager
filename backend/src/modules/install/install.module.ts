/**
 * Genel (kimlik dogrulamasiz) kurulum rotalari.
 *
 * Bu dosyadaki adresler son kullaniciya ve iOS'un `installd` surecine acilir.
 *
 * ASLA CEREZ KOYMAYIN: iOS `itms-services://` adresini izlerken manifest.plist
 * ve .ipa dosyalarini Safari degil, isletim sisteminin `installd` sureci ceker
 * ve o surec Safari'nin cerezlerini paylasmaz. Cerez tabanli koruma OTA
 * kurulumunu tamamen bozar. Yetki bu yuzden URL icindeki kisa omurlu HMAC
 * imzasindadir (`domain/links/token.ts`) ve `token + purpose` ciftine baglidir.
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
import { verifyAccess } from '../../domain/links/token.ts';
import { buildManifest } from '../../domain/ota/manifest.ts';
import {
  isIosUserAgent,
  renderInstallPage,
  renderUnavailablePage,
} from '../../domain/ota/install-page.ts';
import { verifyPassword } from '../auth/password.ts';
import { BuildService } from '../builds/build.service.ts';

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

    ctx.builds.increment(build.id, 'view_count');

    let pageUrl: string;
    let installUrl: string | null = null;
    let iconUrl: string | null = null;

    try {
      pageUrl = ctx.links.publicUrl(build.token);
      if (!sifreGerekli) installUrl = ctx.links.itmsServicesUrl(build.token);
      if (build.iconPath) iconUrl = ctx.links.iconUrl(build.token);
    } catch (e) {
      if (e instanceof ConfigError) {
        await reply
          .code(503)
          .type('text/html; charset=utf-8')
          .send(renderUnavailablePage(ayarlar.siteName, 'notfound'));
        request.log.error({ err: e }, 'Base URL ayarlanmamis — kurulum sayfasi uretilemedi.');
        return;
      }
      throw e;
    }

    const html = renderInstallPage({
      siteName: ayarlar.siteName,
      build,
      status: durum,
      isIos: isIosUserAgent(request.headers['user-agent']),
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
      if (getStatus(build) !== 'active') {
        return reply.code(410).send({ error: 'Bu linkin suresi dolmus.' });
      }
      if (!verifyAccess(env.SESSION_SECRET, build.token, 'manifest', request.query.k)) {
        return reply.code(403).send({ error: 'Erisim anahtari gecersiz ya da suresi dolmus.' });
      }

      const manifest = buildManifest({
        bundleId: build.bundleId,
        version: build.version,
        title: build.appName,
        ipaUrl: ctx.links.ipaUrl(build.token),
        displayImageUrl: build.iconPath ? ctx.links.iconUrl(build.token) : null,
        fullSizeImageUrl: build.iconPath ? ctx.links.iconUrl(build.token) : null,
      });

      ctx.builds.increment(build.id, 'install_count');

      return reply
        .type('application/xml; charset=utf-8')
        .header('cache-control', 'no-store')
        .send(manifest);
    },
  );

  /* --- .ipa dosyasi ------------------------------------------------------- */

  app.get<{ Params: TokenParams; Querystring: { k?: string } }>(
    `${P}/:token/app.ipa`,
    async (request, reply) => {
      const build = kaydiGetir(request.params.token);
      if (!build) return reply.code(404).send({ error: 'Bulunamadi' });
      if (getStatus(build) !== 'active') {
        return reply.code(410).send({ error: 'Bu linkin suresi dolmus.' });
      }
      if (!verifyAccess(env.SESSION_SECRET, build.token, 'ipa', request.query.k)) {
        return reply.code(403).send({ error: 'Erisim anahtari gecersiz ya da suresi dolmus.' });
      }

      const key = BuildService.ipaKey(build.id);
      const toplam = await ctx.storage.size(key);
      if (toplam === null) return reply.code(410).send({ error: 'Dosya sunucudan kaldirilmis.' });

      const dosyaAdi = `${build.appName.replace(/[^\w.-]+/g, '_')}-${build.version}.ipa`;

      // Kismi indirme (Range) destegi — buyuk dosyalarda kopan indirmeler
      // bastan baslamasin diye.
      const range = parseRange(request.headers.range, toplam);
      if (range) {
        const stream = await ctx.storage.createReadStream(key, range);
        if (!stream) return reply.code(410).send({ error: 'Dosya bulunamadi.' });
        ctx.builds.increment(build.id, 'download_count');
        return reply
          .code(206)
          .type('application/octet-stream')
          .header('content-range', `bytes ${range.start}-${range.end}/${toplam}`)
          .header('content-length', String(range.end - range.start + 1))
          .header('accept-ranges', 'bytes')
          .header('content-disposition', `attachment; filename="${dosyaAdi}"`)
          .send(stream);
      }

      const stream = await ctx.storage.createReadStream(key);
      if (!stream) return reply.code(410).send({ error: 'Dosya bulunamadi.' });

      ctx.builds.increment(build.id, 'download_count');
      return reply
        .type('application/octet-stream')
        .header('content-length', String(toplam))
        .header('accept-ranges', 'bytes')
        .header('content-disposition', `attachment; filename="${dosyaAdi}"`)
        .send(stream);
    },
  );

  /* --- Simge -------------------------------------------------------------- */

  app.get<{ Params: TokenParams; Querystring: { k?: string } }>(
    `${P}/:token/icon.png`,
    async (request, reply) => {
      const build = kaydiGetir(request.params.token);
      if (!build?.iconPath) return reply.code(404).send({ error: 'Simge yok' });
      if (getStatus(build) !== 'active') return reply.code(410).send({ error: 'Suresi dolmus.' });
      if (!verifyAccess(env.SESSION_SECRET, build.token, 'icon', request.query.k)) {
        return reply.code(403).send({ error: 'Erisim anahtari gecersiz.' });
      }

      const stream = await ctx.storage.createReadStream(BuildService.iconKey(build.id));
      if (!stream) return reply.code(404).send({ error: 'Simge bulunamadi' });

      return reply.type('image/png').header('cache-control', 'private, max-age=600').send(stream);
    },
  );

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

/** `Range: bytes=0-1023` basligini cozer. Gecersizse null. */
function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (!header) return null;
  const eslesme = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!eslesme) return null;

  const [, startStr, endStr] = eslesme;
  let start: number;
  let end: number;

  if (startStr) {
    start = Number(startStr);
    end = endStr ? Number(endStr) : size - 1;
  } else if (endStr) {
    // "bytes=-500" => son 500 bayt
    start = Math.max(0, size - Number(endStr));
    end = size - 1;
  } else {
    return null;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end >= size || start > end) return null;
  return { start, end };
}

export const installModule: AppModule = {
  name: 'install',
  description: `OTA kurulum uclari (${env.INSTALL_PATH_PREFIX}/:token) — imzali, cerezsiz`,
  register,
};

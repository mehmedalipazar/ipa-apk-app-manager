# ipa-ota-download — Uctan Uca Test Senaryolari

Kapsam: ortam degiskeni (env) okuma zinciri, docker compose degisken aktarimi,
backend↔frontend haberlesme sozlesmesi, admin ayarlar panelinin her alani ve
"Kaydet" dugmesinin her senaryosu, ve tam OTA dagitim akisi.

## 0. Sistem haritasi — degisken nereden nereye akar

```
                 ONCELIK:  veritabani  >  ortam degiskeni  >  sema varsayilani
                           (settings)     (.env.* dosyalari)  (config/settings.schema.ts)
                           TEK ISTISNA baseUrl: ortam degiskeni > DB (asagida)

  --- BACKEND (Node; dotenv yok, backend/package.json --env-file-if-exists zinciri) ---
  .env.development (dev) | .env.production (prod, imaja gomulu)  ─┐
  .env.local  (sirlar, gitignore)                                  ├─→ process.env ─→ config/env.ts (zod) ─→ env
  kabuk / compose `environment:`  (en yuksek oncelik)             ─┘         │
      ${VAR} degerleri backend/.env'den cozulur; o dosyayi YALNIZCA          ├─→ PORT/HOST            → app.listen()
      docker compose okur, Node hic okumaz                                    ├─→ DATA_DIR             → db/client.ts, storage/local.ts
                                                                              ├─→ LOG_LEVEL            → Fastify logger
                                                                              ├─→ TRUST_PROXY          → Fastify trustProxy
                                                                              ├─→ CORS_ORIGINS         → server.ts (cors + Origin kapisi), cerez SameSite
                                                                              ├─→ INSTALL_PATH_PREFIX  → kurulum rotalari + uretilen linkler
                                                                              ├─→ SESSION_SECRET       → oturum cerezi + imzali URL HMAC
                                                                              ├─→ ADMIN_PASSWORD       → auth.bootstrap (SADECE ilk acilis / FORCE_RESET)
                                                                              └─→ PUBLIC_BASE_URL      → ConfigService.load()
                                                                                     │ (bos degilse DB'deki degeri HER ACILISTA EZER; DB'ye hic yazilmaz)
                                                                                     ▼
                                                                          settings tablosu (config.*)
                                                                                     │
                                                          GET /api/settings  {values, fields, warnings}
                                                                                     ▼
                                                            frontend/src/pages/SettingsPage.tsx
                                                            (alanlar `fields`ten uretilir; baseUrl fields'ta YOK)
                                                                                     │
                                                          PUT /api/settings  (tum values govdede; baseUrl sema tarafindan ATILIR)
                                                                                     ▼
                                                            ConfigService.update() → cache + DB

  --- FRONTEND (Vite; derleme zamani, yalnizca VITE_ onekli anahtarlar pakete girer) ---
  .env → .env.local → .env.[mode] → .env.[mode].local ─→ import.meta.env.VITE_API_BASE_URL ─→ src/api.ts API_BASE
      uretim: bos = goreli /api yolu | dev: canli API | makineye ozel ezme: .env.development.local
```

Kritik davranis kurallari (testler bunlari dogrular):

| Kural | Kaynak |
|---|---|
| `PUBLIC_BASE_URL` bos degilse DB'deki `config.baseUrl`i **her aciliste ezer**; DB'ye hic yazilmaz (panelin PUT'undaki baseUrl sema tarafindan atilir) | `backend/src/config/settings.service.ts` (`load()` / `update()`), `settings.schema.ts` (`AppConfigUpdateSchema.omit({ baseUrl })`) |
| `ADMIN_PASSWORD` yalnizca DB'de hash **yokken** (veya `ADMIN_PASSWORD_FORCE_RESET=true`) okunur | `backend/src/modules/auth/auth.service.ts` (`bootstrap()`) |
| `SESSION_SECRET` degisirse tum oturumlar + imzali linkler gecersiz olur; sifre degisimi de oturumlari dusurur (cerez `SESSION_SECRET + sifre hash'i` ile imzalanir) ama linkleri DUSURMEZ | `backend/src/domain/links/token.ts`, `backend/src/modules/auth/session.ts` |
| `NODE_ENV=production` iken `SESSION_SECRET` zorunlu, `ADMIN_PASSWORD` en az 8 karakter; her yapilandirma hatasi `Yapilandirma hatasi: ...` + exit 1, stack trace yok | `backend/src/config/env.ts` (`yukleYaDaCik()`), `auth.service.ts`, `backend/src/index.ts` |
| Ayarlar bellekte cache'lenir; `update()` disinda tazelenmez | `backend/src/config/settings.service.ts` |
| Frontend tipleri (`frontend/src/api.ts`) sunucu semasiyla **elle** senkronlanir; C10/C10b yalnizca alan ADLARINI karsilastirir | `frontend/src/api.ts:1-7`, `backend/src/modules/builds/build.dto.ts` |
| Proxy YOK (depoda): dev'de arayuz (5173) → API cross-origin gider; uretimde ayrimi ONDEKI ters proxy yapar (`/api/*` → api) | `frontend/vite.config.ts`, `frontend/nginx.conf` |
| API adresi **derleme aninda** `VITE_API_BASE_URL` ile gomulur (uretim: bos = goreli yol); calisma zamani `config.js` mekanizmasi KALDIRILDI (C3b, D2.4 geri gelmedigini savunur) | `frontend/src/api.ts` (`API_BASE`), `frontend/.env.production` |
| Vite dosya sirasi `.env` → `.env.local` → `.env.[mode]` → `.env.[mode].local`; `.env.local` mode dosyasini EZEMEZ, makineye ozel ezme `.env.development.local` | `frontend/src/env-order.test.ts` |
| Kimlik: `credentials: 'include'` cerez (`SameSite=None; Secure` — CORS acik); OTA indirmeleri **imzali URL**, cerez degil | `frontend/src/api.ts` (`request()`), `backend/src/domain/links/token.ts` |
| `CORS_ORIGINS` doluyken durum degistiren isteklerde yabanci `Origin` 403 (CSRF kapisi) | `backend/src/server.ts` |
| Platform dosya uzantisindan belirlenir (`platformFromFilename`: .ipa → ios, .apk → android); `builds.platform` sutunu (migration 003, eski satirlar ios); `revokePreviousOnUpload` yalnizca **ayni platform + ayni bundle_id** icin; imza amaclari `manifest \| ipa \| apk \| icon` birbirinden izole; Android kaydinda `manifest.plist`/`app.ipa`, iOS kaydinda `app.apk` 404 | `backend/src/domain/package/index.ts`, `db/migrations.ts`, `db/repositories/builds.repository.ts`, `domain/links/token.ts`, `modules/install/install.module.ts` |

---

## A. Ortam degiskeni okuma testleri

Amac: her degiskenin gercekten okunup okunmadigini, gozlemlenebilir bir etki
uzerinden kanitlamak. "Deger set edildi" yeterli degil — davranis degismeli.

| # | Senaryo | Yontem | Beklenen |
|---|---|---|---|
| A1 | Yukleme sirasi (Node `--env-file-if-exists`): mode dosyasi → `.env.local` → shell | Ayni anahtari uc yerde farkli deger yap; `backend/package.json` dev/start scriptlerinde `.env.local`in mode dosyasindan SONRA geldigini de kontrol et | Shell kazanir; `.env.local` mode dosyasini ezer |
| A2 | `PORT` okunuyor mu | `PORT=3999` ile baslat | `:3999/healthz` 200, `:3000` kapali |
| A3 | `HOST` okunuyor mu | `HOST=127.0.0.1` | Yalnizca loopback'te dinler |
| A4 | `DATA_DIR` okunuyor mu | `DATA_DIR=./tmp-veri` | O dizinde `ipa-ota.db` + `uploads/` olusur |
| A5 | `LOG_LEVEL` okunuyor mu | `LOG_LEVEL=fatal` vs `debug` | debug'da istek loglari cikar, fatal'de cikmaz |
| A6 | `TRUST_PROXY` okunuyor mu | `true`/`false` + `X-Forwarded-For` gonder | true iken log'daki `remoteAddress`/`req.ip` basliktaki IP olur |
| A7 | `PUBLIC_BASE_URL` **DB bosken** okunuyor mu | Temiz DB + `PUBLIC_BASE_URL=https://a.test` | `GET /api/settings.values.baseUrl == https://a.test` |
| A8 | `PUBLIC_BASE_URL` **DB doluyken de kazaniyor mu** | Panelden baseUrl PUT et (yok sayilmali) → env'i degistir + restart | Env degeri gecerli, panel PUT'u etkisiz (bilincli asimetri: env > DB, DB'ye yazilmaz) |
| A9 | `PUBLIC_BASE_URL` sondaki `/` kirpiliyor mu | `https://a.test///` | `https://a.test` olarak kaydedilir |
| A10 | `ADMIN_PASSWORD` ilk acilista okunuyor mu | Temiz DB + sifre | O sifreyle giris yapilir |
| A11 | `ADMIN_PASSWORD` sonraki aciliste yok sayiliyor mu | Sifreyi degistir, env'i eski birak, restart | Yeni sifre gecerli kalir |
| A12 | `ADMIN_PASSWORD_FORCE_RESET=true` | Restart | Env'deki sifre DB'yi ezer |
| A13 | `ADMIN_PASSWORD` < 8 karakter (prod; `MIN_PASSWORD_LENGTH`) | Temiz DB, kisa sifre | Acilista `AuthError`, exit 1 |
| A14 | `SESSION_SECRET` degisimi oturumu dusurur mu | Giris yap → secret degistir → restart → `/api/auth/me` | `authenticated:false` |
| A15 | `SESSION_SECRET` degisimi imzali linki bozar mi | Link uret → secret degistir → restart → manifest cek | 403 |
| A16 | `SESSION_SECRET` yokken prod | `NODE_ENV=production`, secret bos | Acilista hata, exit 1 |
| A17 | `SESSION_SECRET` yokken dev | `NODE_ENV=development`, secret bos | Uyari + gecici anahtar, ayakta kalir |
| A18 | Gecersiz `LOG_LEVEL` | `LOG_LEVEL=verbose` | zod hatasi, "Ortam degiskenleri gecersiz" |
| A19 | Gecersiz `PORT` | `PORT=abc` / `PORT=99999` | zod hatasi |
| A20 | `NODE_ENV` prod/dev farki | Her ikisi | dev'de pino-pretty, prod'da JSON log |
| A21 | `CORS_ORIGINS` okunuyor mu | Izinli/izinsiz origin ile istek at | Izinliye ACAO + credentials, izinsize baslik yok |
| A21b | Gecersiz `CORS_ORIGINS` | Yol iceren adres ver | Acilista hata, sunucu kalkmaz |
| A21c | Ayri origin cerez politikasi | `CORS_ORIGINS` dolu iken giris yap | Cerez `HttpOnly; Secure; SameSite=None` |
| A22 | Bilinmeyen degisken | `SACMA_DEGISKEN=1` | Yok sayilir, sunucu kalkar |
| A18b | Gecersiz `NODE_ENV` | `NODE_ENV=staging` | zod hatasi, exit 1 (prod korumalari sessizce kapanmaz) |
| A23 | `COOKIE_SAMESITE=none` + `COOKIE_SECURE=false` | Ikisini birlikte ver | Acilista hata, exit 1 (tarayici cerezi yok sayardi) |
| A24 | `DATA_DIR` yazilamiyor | Ust dizin `chmod 500` | "Yapilandirma hatasi: DATA_DIR yazilabilir degil (..., EACCES)", stack trace yok |
| A25 | `ADMIN_PASSWORD` yok (dev) | Sifresiz baslat | Kalkar; `/api/auth/me` `configured:false`; login **503** + mesajda `ADMIN_PASSWORD`; korunan uclar yine 401 |

Acilis hatasi beklenen her senaryo (`acilisHatasi()` yardimcisi, 2026-08-25) ortak sozlesmeyi de
sinar: **exit kodu 1**, mesaj tek bicimde `Yapilandirma hatasi: ...`, ciktida Node stack trace
yok. Oncesinde `SESSION_SECRET`/zod/`DATA_DIR` hatalari dogru mesaji stack trace arasinda basiyordu.

## B. Docker Compose degisken aktarimi

| # | Senaryo | Yontem | Beklenen |
|---|---|---|---|
| B1 | `${VAR}` host `.env`den cozuluyor mu | `docker compose config` | Degerler yerine gecmis gorunur |
| B2 | Varsayilanli `${VAR:-default}` | `LOG_LEVEL`i `.env`den kaldir | `info` varsayilani uygulanir |
| B3 | Zorunlu degisken bos | `ADMIN_PASSWORD`u bosalt | compose uyarisi + container acilista hata |
| B4 | Compose degeri container icine gecti mi | `docker exec ... env` | `.env` ile birebir esit |
| B5 | Compose'da sabitlenen degerler ezilemez mi | `.env`de `NODE_ENV=development` yaz | Container'da yine `production` (compose sabit) |
| B6 | `.env` degisikligi restart olmadan etkisiz | Degistir, restart yok | Eski deger gecerli |
| B7 | `.env` degisikligi `up -d` sonrasi etkili | `docker compose up -d` | Yeni deger container'da |
| B8 | `PUBLIC_BASE_URL` degisimi + dolu DB | B7 sonrasi | Env kazanir: panelden hic kaydedilmemisken her aciliste env okunur (B8); panelden kaydetmek de golgeleyemez, yeniden olusturmada env yine kazanir (B8b) |
| B9 | Port host'a yayinlaniyor mu | `docker compose ps` | `0.0.0.0:3000->3000/tcp` gorunur |
| B10 | Yayinlanan porttan erisim | `curl localhost:$HOST_PORT/healthz` | 200 doner |
| B11 | Volume kaliciligi | `down` → `up` (volume silmeden) | DB ve IPA'lar korunur |
| B12 | Healthcheck `PORT`u okuyor mu | `PORT` degistir | Healthcheck yine gecer |

## C. Backend ↔ Frontend haberlesme

| # | Senaryo | Yontem | Beklenen |
|---|---|---|---|
| C1 | `/api/auth/me` sozlesmesi | Arka uca dogrudan istek | 200 + JSON |
| C2 | `/i` ve `/healthz` | Arka uca dogrudan istek | HTML / 200 |
| C3 | Arka uc statik dosya sunmuyor | API'ye `/admin/*` iste | JSON 404 (SPA fallback yok) |
| C3b | Arayuz servisi SPA fallback | web servisine (`frontend/.env` WEB_PORT) `/admin/*` iste | `index.html` doner ve icinde `/config.js` referansi YOK (kaldirilan mekanizma geri gelmemis) |
| C4 | Uretimde SPA fallback | `/admin/ayarlar` derin link | `index.html` doner (`frontend/nginx.conf` `try_files ... /index.html`) |
| C5 | `/api/*` 404 JSON doner | Olmayan API yolu | `{"error":"Bulunamadi"}`, HTML degil |
| C6 | Oturum cerezi gonderiliyor mu | `credentials: 'include'` | Istek basliginda `Cookie:` var (cross-origin dev akisinda da) |
| C7 | 401 akisi | Cerezi sil → `/api/settings` | 401 + arayuz giris ekranina duser |
| C8 | Hata mesaji ustten alta tasiniyor mu | Gecersiz ayar PUT et | Sunucu mesaji arayuzde birebir gorunur |
| C9 | `fields` sozlesmesi | `GET /api/settings` | `values` 10 alan, `fields` 9 tanim (baseUrl cizilmez — C9b); her biri panelde render edilir |
| C10 | DTO drift (AppConfig) | `api.ts` AppConfig ↔ `BEKLENEN_ALANLAR` | Alan adlari/sayisi birebir (tipler degil) |
| C10b | DTO drift (BuildDto) | `build.dto.ts` ↔ `api.ts` `export interface BuildDto` bloklari, ayni regex | Alan adi kumeleri birebir (sira onemsiz; eksik/fazla iki yonde raporlanir) |
| C11 | XHR yukleme ilerlemesi | Buyuk dosya yukle | `progress` olaylari, yuzde artar |
| C12 | Yukleme iptali | Iptal dugmesi | `abort` → 'Yukleme iptal edildi' |
| C13 | `warnings` dizisi tasinmasi | baseUrl'i http yap | Uyari hem settings hem upload yanitinda |
| C14 | Tasima katmani (backend kapali) | `frontend/src/api.test.ts` — vitest, `fetch` taklidi; suite C icinden kosulur | nginx 502/503/504 **HTML** → "Sunucuya ulasilamiyor (HTTP n)"; `TypeError` → "Sunucuya baglanilamadi"; JSON `{error}` tasiyan 4xx/5xx (orn. login 503 `ADMIN_PASSWORD`) → mesaj birebir, **ulasilamama sayilmaz** |
| C15 | `content-type` gonderimi | Govdeli istekler | `application/json` |
| C16 | Onbellek disi kurulum sayfasi | `/i/:token` | `cache-control: no-store` |

## D. Admin Ayarlar — her alan

> ID cakismasi (tarihsel, yeniden adlandirilmadi): bu plan-D'si suite C icindeki
> `D — Ayar alanlari` blogudur (izole sunucu). `node tests/run-suite.mjs D` ise
> `suite-d-https.mjs` — yayindaki HTTPS zinciri, canli panele gercek sifreyle girer,
> surum yukler/siler.

Her alan icin: **gecerli deger**, **sinir alti**, **sinir ustu**, **kalicilik (F5)**,
**davranissal etki** (ayarin gercekten bir seyi degistirdigi kanit).

| # | Alan | Gecerli | Sinir alti | Sinir ustu | Davranissal etki testi |
|---|---|---|---|---|---|
| D1 | `baseUrl` | `https://ota.test` | `""` (izinli, uyari verir) | — | Uretilen `installUrl` bu koke sahip olur |
| D1b | `baseUrl` gecersiz | `ftp://x` / `sadece-metin` | | | 400 "Gecerli bir URL girin" |
| D1c | `baseUrl` sonda `/` | `https://a.test/` | | | 400 "Adresin sonunda / olmamali" |
| D1d | `baseUrl` http | `http://a.test` | | | Kabul + "https degil" uyarisi |
| D2 | `siteName` | `AnkaGeo OTA` | `""` | 81 karakter → 400 | Kurulum sayfasi `<title>` ve baslik degisir |
| D3 | `installNote` | serbest metin | `""` | 501 karakter → 400 | Kurulum sayfasi altinda gorunur |
| D4 | `showQrCode` | true/false | — | — | Kurulum sayfasinda QR var/yok |
| D5 | `defaultTtlHours` | 24 | 0 → 400 | 8761 → 400 | Yukleme formu bu degerle acilir |
| D6 | `maxTtlHours` | 720 | 0 → 400 | 8761 → 400 | Yuklemede daha uzunu kirpilir |
| D6b | `maxTtlHours` < `defaultTtlHours` | 12 iken default 24 | | | `defaultTtlHours` otomatik 12'ye ceker |
| D7 | `purgeAfterExpiryHours` | 24 | -1 → 400 | 8761 → 400 | 0 iken temizlik hemen siler |
| D8 | `signedUrlTtlMinutes` | 120 | 4 → 400 | 1441 → 400 | Imzali linkin `exp` degeri degisir |
| D9 | `maxUploadMb` | 1024 | 0 → 400 | 8193 → 400 | Buyuk dosya 413 ile reddedilir |
| D10 | `revokePreviousOnUpload` | true/false | — | — | Ayni bundle-id'nin eskisi iptal olur |

## E. "Kaydet" dugmesi — her senaryo

| # | Senaryo | Beklenen |
|---|---|---|
| E1 | Sayfa acildi, degisiklik yok | Kaydet **pasif** (`disabled={!degisti}`) |
| E2 | Bir alan degisti | Kaydet **aktif** + "Kaydedilmemis degisiklik var" |
| E3 | Degistirip eski degere geri don | Kaydet **hala aktif** (dirty bayragi geri alinmaz) |
| E4 | Basarili kaydet | Spinner → toast "Ayarlar kaydedildi" → dugme pasif, uyari yazisi kaybolur |
| E5 | Kaydet sirasinda dugme | `disabled` + "Kaydediliyor" + spinner |
| E6 | Gecersiz deger ile kaydet | 400 → kirmizi `Alert`, `degisti` **true kalir**, toast **yok** |
| E7 | Hata sonrasi duzeltip kaydet | Onceki hata temizlenir, basarili olur |
| E8 | Kaydet sonrasi sunucu yanitini uygular mi | Sunucunun normalize ettigi deger forma yansir (orn. D6b clamp) |
| E9 | Uyari listesi tazelenir mi | baseUrl'i http yap → kaydet → uyari **aninda** cikar |
| E10 | Oturum dusmus iken kaydet | 401 → hata mesaji |
| E11 | Backend kapali iken kaydet | 'Kaydedilemedi.' / ag hatasi |
| E12 | Kaydet → F5 | Degerler kalici (DB'den gelir) |
| E13 | Kismi degil tam govde gonderimi | PUT govdesinde **tum** alanlar var (`putSettings(values)`) |
| E14 | Es zamanli iki sekme | Ikincisi ilkini ezer (last-write-wins, kilit yok) |
| E15 | Bakim > "Temizligi simdi calistir" | Toast: silinen adet veya "Silinecek dosya yok" |
| E16 | Sifre karti — eslesmeyen sifreler | "Yeni sifreler eslesmiyor.", istek atilmaz |
| E17 | Sifre karti — yanlis mevcut sifre | "Mevcut sifre hatali." |
| E18 | Sifre karti — kisa yeni sifre | "Yeni sifre en az 8 karakter olmali." |
| E19 | Sifre karti — basarili | Toast "Sifre degistirildi", alanlar temizlenir |
| E20 | Sifre karti — bos alanlar | Gonder dugmesi pasif |

## F. Uctan uca OTA akisi

| # | Senaryo | Beklenen |
|---|---|---|
| F1 | Giris → yukleme sayfasi | Oturum cerezi kurulur |
| F2 | Gecerli IPA yukle | 201, meta veri (isim/surum/bundle/boyut/sha256) dogru |
| F3 | Simge cikarildi mi | `iconUrl` doludur, `/i/:t/icon.png?k=` 200 PNG |
| F4 | Kurulum linki uretimi | `itms-services://?action=download-manifest&url=<imzali manifest>` |
| F5 | Kurulum sayfasi `/i/:token` | 200 HTML, siteName + installNote + QR (ayara gore) |
| F6 | `manifest.plist` imzali | `?k=` ile 200 XML; `k` olmadan 403; bozuk `k` ile 403 |
| F7 | `app.ipa` indirme | `?k=` ile 200, `content-disposition` dogru |
| F8 | Range destegi | `Range: bytes=0-1023` → 206 + `content-range` |
| F9 | Sayaclar | view/install/download sayaci artar |
| F10 | Sifreli link | Sifresiz sayfada form, dogru sifrede `installUrl` cikar |
| F11 | Iptal (revoke) | Sayfa 410, manifest 410 |
| F12 | Yeniden ac | Tekrar aktif |
| F13 | Suresi dolmus link | 410 |
| F14 | Temizlik sonrasi (purged) | Kayit durur, dosya yok, 410 |
| F15 | Kalici silme | Kayit + dosya gider, 404 |
| F16 | `revokePreviousOnUpload` | Ayni bundle-id yeniden yukle → `revokedPrevious > 0` |
| F17 | baseUrl bosken yukleme | 201 ama `installUrl: null` + uyari |
| F18 | Bozuk IPA | 422 "Payload/<uygulama>.app klasoru bulunamadi" |
| F19 | Bos dosya | 400 "Bos dosya yuklendi." |
| F20 | Yanlis uzanti | 400 ".ipa veya .apk uzantili dosyalar" (I15b `.apk`'yi de pinler) |
| F21 | Boyut siniri asimi | 413 |
| F22 | Yetkisiz yukleme | 401, govde okunmadan |

## G. Kimlik dogrulama

| # | Senaryo | Beklenen |
|---|---|---|
| G1 | Dogru sifre ile giris | 200 + `Set-Cookie` (HttpOnly) |
| G2 | Yanlis sifre | 401 |
| G3 | `/api/auth/me` oturumsuz | `authenticated:false, configured:true` |
| G4 | Cikis | Cerez silinir, korunan uc 401 |
| G5 | Korunan uclar oturumsuz | `/api/builds`, `/api/settings`, `/api/stats`, `/api/uploads`, `/api/maintenance/cleanup` → 401 |
| G6 | Kurcalanmis cerez | 401 |
| G7 | Sifre degisimi sonrasi eski sifre | 401 |
| G8 | Oturum TTL | 12 saat |

---

## I. Android APK (suite C icinde, H8'den sonra)

Fiksturler `tests/fixtures/*.apk` (`make-apk.mjs`, uretim icin Android SDK build-tools + Java gerekir;
ikililer depoda). `demo-a.apk`, `demo-a.ipa` ile **ayni paket kimligini** tasir (I12). Imza anahtarlari
harness'in sabit `SESSION_SECRET`i ile testte turetilir (I8/I9/I11).

| # | Senaryo | Beklenen |
|---|---|---|
| I1 | `demo-android.apk` yukle | 201; `platform:'android'`, paket/etiket (arsc, varsayilan config)/versionName/versionCode/minSdk/`platforms:['Android']`, `iconUrl` `icon.png?k=` |
| I2 | Simge secimi | 200 `image/png`, 144px (xxhdpi; mdpi ve adaptive XML elenir) |
| I3 | Android UA sayfasi | `app.apk?k=` butonu, Android adimlari, `En az Android 7.0 (API 24)`; `itms-services`/`qr.svg`/`Safari`/`ipad-kurulum` YOK |
| I4 / I4b | Masaustu ve iPhone UA | `id="android-uyari"` + QR + buton; itms yok |
| I5 | iOS kaydi Android UA ile | Eski iOS-disi sayfa (`ipad-kurulum`, "iPhone ve iPad"); `app.apk` yok |
| I6 | `app.apk` indirme | 200, `application/vnd.android.package-archive`, `attachment; filename="Demo_Android-1.2.0.apk"`, content-length, `PK` imzasi |
| I7 | Range / HEAD / 416 + sayac | 206 / 206 / 416 `bytes */size` / HEAD 200; `downloadCount` = 2 |
| I8 | Imza amaci izolasyonu | ipa/icon anahtari → 403, apk anahtari → 200, anahtarsiz/bozuk → 403 |
| I9 | Capraz platform rotalari | Android kaydinda `manifest.plist`/`app.ipa`/`icon.webp` 404; iOS kaydinda `app.apk` 404 |
| I10 | Iptal / yeniden ac | Sayfa 410 (linksiz), `app.apk` 410, `iconUrl:null`; unrevoke → 200 |
| I11 | Temizlik (purged) | `purged`, sayfa 410, `app.apk` 410, `uploads/<id>` yok |
| I12 | `revokePreviousOnUpload` platforma ozel | APK, IPA'yi iptal etmez (ve tersi); ayni platformda eskisi iptal |
| I13 | Liste filtresi | `?platform=android|ios` saf; `?platform=windows` 400; `search` platformlar arasi |
| I14 / I15 / I15b | Bozuk dosyalar | ZIP degil 422; AndroidManifest.xml yok 422; yanlis uzanti mesaji `.ipa` ve `.apk` |
| I16 | `demo-a.apk` (literal etiket, simgesiz, arsc yok) | `appName` literal, `iconUrl:null`, `minOsVersion '21'`, sayfada yer tutucu + `5.0 (API 21)` |
| I17 | `demo-webp.apk` | `iconUrl` `icon.webp?k=`, 200 `image/webp`; `icon.png` 404 (fikstur yoksa skip) |
| I18 | Sifreli APK linki | Form; yanlis sifre "hatali"; dogru sifrede `app.apk?k=` |
| I19 | Kalici silme | 404 + `uploads/<id>` yok |

## Calistirma

```bash
# Otomatik API + env + docker suiti
node tests/run-suite.mjs                 # A, B, C, D — C'nin canli blogu :3000'e, D yayindaki domain'e gider (URETIM)
node tests/run-suite.mjs A C             # A ve C'nin D/F/G/H bloklari izole sunucu; C1-C16 canli --taban (varsayilan :3000; C14 frontend vitest'ini de kosar)
node tests/run-suite.mjs C --taban http://localhost:3010   # canli blok icin baska bir backend (5173 degil — o nginx'tir)

# Yalnizca frontend (fetch taklidi + Vite .env sirasi, < 1 sn)
cd frontend && npm test

# Tarayici (Chrome DevTools MCP) senaryolari: C, D, E, F gorsel adimlari
```

### Hata hangi katmanda dogdu? — uc katman, uc teknik

| Katman | Nerede | Gozlemlenebilir cikti | Teknik | Suite |
|---|---|---|---|---|
| Acilis (env) | `config/env.ts` zod, `auth.bootstrap`, `DATA_DIR` | exit 1 + `Yapilandirma hatasi: ...`; `/healthz` hic kalkmaz | izole process spawn, `cikisKodu` + `cikti` | A (`acilisHatasi()`) |
| Calisma zamani (API) | route `reply.code(4xx/5xx).send({error})` / `AppError` | HTTP durum + `{error, field?}` JSON | HTTP istek, status + mesaj metni pinlenir | C (D/F/G/H) |
| Tasima (ulasilamama) | fetch'in kendisi (ag/DNS/CORS) ya da ters proxy 502/503/504 HTML | `TypeError` ya da JSON olmayan 5xx — **backend bunu hic gormez** | `fetch` taklidi ile frontend eslemesi | C14 → `frontend/src/api.test.ts` |

Elle deneme (dosya okumadan, ortam sifirdan):

```bash
cd backend && env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production PORT=3911 DATA_DIR=/tmp/deneme \
  node --experimental-strip-types --no-warnings src/index.ts; echo "exit=$?"
cd backend && ADMIN_PASSWORD= docker compose --env-file /dev/null config   # compose zorunlu degisken
```

Sonuc raporu: `tests/reports/`

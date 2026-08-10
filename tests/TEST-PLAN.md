# ipa-ota-download — Uctan Uca Test Senaryolari

Kapsam: ortam degiskeni (env) okuma zinciri, docker compose degisken aktarimi,
backend↔frontend haberlesme sozlesmesi, admin ayarlar panelinin her alani ve
"Kaydet" dugmesinin her senaryosu, ve tam OTA dagitim akisi.

## 0. Sistem haritasi — degisken nereden nereye akar

```
                    ONCELIK:  veritabani  >  ortam degiskeni  >  sema varsayilani
                              (settings)     (.env/.env.local)   (config/schema.ts)

  .env ──┐
         ├─→ node --env-file-if-exists ──→ process.env ──→ env.ts (zod) ──→ env objesi
  .env.local ─┘        (server/package.json dev|start)          │
         │                                                       ├─→ PORT/HOST     → app.listen()
  shell ─┘  (en yuksek oncelik)                                  ├─→ DATA_DIR      → storage/local.ts
                                                                 ├─→ LOG_LEVEL     → Fastify logger
  docker-compose.yml `environment:` ──→ container env            ├─→ TRUST_PROXY   → Fastify trustProxy
         ${VAR} host .env dosyasindan cozulur                    ├─→ SESSION_SECRET→ oturum + imzali URL HMAC
                                                                 ├─→ ADMIN_PASSWORD→ auth.bootstrap (SADECE ilk acilis)
                                                                 └─→ PUBLIC_BASE_URL → ConfigService.load()
                                                                        │  (SADECE DB'de config.baseUrl yoksa)
                                                                        ▼
                                                             settings tablosu (config.*)
                                                                        │
                                              GET /api/settings  {values, fields, warnings}
                                                                        ▼
                                                    web/src/pages/SettingsPage.tsx
                                                    (alanlar `fields`den uretilir)
                                                                        │
                                              PUT /api/settings  (tum values govdede)
                                                                        ▼
                                                    ConfigService.update() → cache + DB
```

Kritik davranis kurallari (testler bunlari dogrular):

| Kural | Kaynak |
|---|---|
| `PUBLIC_BASE_URL` yalnizca DB'de `config.baseUrl` **yokken** okunur | `config/service.ts:32` |
| `ADMIN_PASSWORD` yalnizca DB'de hash **yokken** (veya FORCE_RESET) okunur | `auth/service.ts:36` |
| `SESSION_SECRET` degisirse tum oturumlar + imzali linkler gecersiz olur | `links/token.ts`, `auth/session.ts` |
| `NODE_ENV=production` iken `SESSION_SECRET`/`ADMIN_PASSWORD` zorunlu | `env.ts:49`, `auth/service.ts:39` |
| Ayarlar bellekte cache'lenir; `update()` disinda tazelenmez | `config/service.ts:21` |
| Frontend tipleri (`web/src/api.ts`) sunucu semasiyla **elle** senkronlanir | `web/src/api.ts:5` |
| Proxy YOK: dev'de de arayuz (5173) → API (3000) cross-origin gider | `web/vite.config.ts` |
| API adresi calisma aninda `public/config.js`ten okunur, pakete gomulmez | `web/src/api.ts:26` |
| Kimlik: `credentials: 'include'` cerez; OTA indirmeleri **imzali URL** | `web/src/api.ts`, `links/token.ts:1` |

---

## A. Ortam degiskeni okuma testleri

Amac: her degiskenin gercekten okunup okunmadigini, gozlemlenebilir bir etki
uzerinden kanitlamak. "Deger set edildi" yeterli degil — davranis degismeli.

| # | Senaryo | Yontem | Beklenen |
|---|---|---|---|
| A1 | Yukleme sirasi `.env` → `.env.local` → shell | Ayni anahtari uc yerde farkli deger yap, sunucuyu baslat | Shell kazanir; `.env.local` `.env`i ezer |
| A2 | `PORT` okunuyor mu | `PORT=3999` ile baslat | `:3999/healthz` 200, `:3000` kapali |
| A3 | `HOST` okunuyor mu | `HOST=127.0.0.1` | Yalnizca loopback'te dinler |
| A4 | `DATA_DIR` okunuyor mu | `DATA_DIR=./tmp-veri` | O dizinde `ipa-ota.db` + `uploads/` olusur |
| A5 | `LOG_LEVEL` okunuyor mu | `LOG_LEVEL=fatal` vs `debug` | debug'da istek loglari cikar, fatal'de cikmaz |
| A6 | `TRUST_PROXY` okunuyor mu | `true`/`false` + `X-Forwarded-For` gonder | true iken log'daki `remoteAddress`/`req.ip` basliktaki IP olur |
| A7 | `PUBLIC_BASE_URL` **DB bosken** okunuyor mu | Temiz DB + `PUBLIC_BASE_URL=https://a.test` | `GET /api/settings.values.baseUrl == https://a.test` |
| A8 | `PUBLIC_BASE_URL` **DB doluyken yok sayiliyor mu** | DB'de baseUrl varken env'i degistir + restart | DB degeri korunur (bilincli davranis) |
| A9 | `PUBLIC_BASE_URL` sondaki `/` kirpiliyor mu | `https://a.test///` | `https://a.test` olarak kaydedilir |
| A10 | `ADMIN_PASSWORD` ilk acilista okunuyor mu | Temiz DB + sifre | O sifreyle giris yapilir |
| A11 | `ADMIN_PASSWORD` sonraki aciliste yok sayiliyor mu | Sifreyi degistir, env'i eski birak, restart | Yeni sifre gecerli kalir |
| A12 | `ADMIN_PASSWORD_FORCE_RESET=true` | Restart | Env'deki sifre DB'yi ezer |
| A13 | `ADMIN_PASSWORD` < 12 karakter (prod) | Temiz DB, kisa sifre | Acilista `AuthError`, exit 1 |
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
| B8 | `PUBLIC_BASE_URL` degisimi + dolu DB | B7 sonrasi | DB kazanir (A8 ile ayni kural, container'da) |
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
| C3b | Arayuz servisi SPA fallback | web servisine `/admin/*` iste | `index.html` + `/config.js` doner |
| C4 | Uretimde SPA fallback | `/admin/ayarlar` derin link | `index.html` doner (`app.ts:65`) |
| C5 | `/api/*` 404 JSON doner | Olmayan API yolu | `{"error":"Bulunamadi"}`, HTML degil |
| C6 | Oturum cerezi gonderiliyor mu | `credentials: 'same-origin'` | Istek basliginda `Cookie:` var |
| C7 | 401 akisi | Cerezi sil → `/api/settings` | 401 + arayuz giris ekranina duser |
| C8 | Hata mesaji ustten alta tasiniyor mu | Gecersiz ayar PUT et | Sunucu mesaji arayuzde birebir gorunur |
| C9 | `fields` sozlesmesi | `GET /api/settings` | 10 alan; her biri panelde render edilir |
| C10 | DTO drift | `api.ts` AppConfig ↔ sunucu semasi | Alan adlari/sayisi birebir |
| C11 | XHR yukleme ilerlemesi | Buyuk dosya yukle | `progress` olaylari, yuzde artar |
| C12 | Yukleme iptali | Iptal dugmesi | `abort` → 'Yukleme iptal edildi' |
| C13 | `warnings` dizisi tasinmasi | baseUrl'i http yap | Uyari hem settings hem upload yanitinda |
| C14 | Ag kopmasi | Backend'i durdur → istek | 'Sunucuya baglanilamadi' |
| C15 | `content-type` gonderimi | Govdeli istekler | `application/json` |
| C16 | Onbellek disi kurulum sayfasi | `/i/:token` | `cache-control: no-store` |

## D. Admin Ayarlar — her alan

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
| F20 | Yanlis uzanti | 400 ".ipa uzantili dosyalar" |
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

## Calistirma

```bash
# Otomatik API + env + docker suiti
node tests/run-suite.mjs                 # arka uc 3000, arayuz 5173
node tests/run-suite.mjs --docker        # docker container'a karsi

# Tarayici (Chrome DevTools MCP) senaryolari: C, D, E, F gorsel adimlari
```

Sonuc raporu: `tests/reports/`

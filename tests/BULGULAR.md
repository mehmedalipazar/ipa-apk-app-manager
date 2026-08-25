# Uctan Uca Test — Bulgular

> **TARIHSEL KAYIT — 2026-08-05 kosumu, v1 agaci.** Bu dosya o gunku yapiyi anlatir:
> `server/` + `web/` klasorleri, kok `.env` / `docker-compose.yml`, `caddy` profili, o gunun
> grup harfleri ve CORS/cerez durusu. 2026-08-07'de v2'ye (`backend/` + `frontend/`),
> 2026-08-13'te tam servis ayrimina gecildi; buradaki dosya yollari ve satir numaralari
> artik gecerli degildir. Guncel gercek: `CLAUDE.md` + `tests/TEST-PLAN.md`; kanit gecmisi
> `tests/BULGULAR-HTTPS.md`. DIKKAT: bugun `node tests/run-suite.mjs D` asagidaki
> "D — Ayar alanlari" degil, `suite-d-https.mjs`tir — yayindaki domain'e gercek admin
> sifresiyle girer, gecici surumler yukler ve siler (URETIME dokunur). Asagidaki "D" grubu
> bugun suite C'nin icinde (`D — Ayar alanlari`) yasar.

Kosum tarihi: 2026-08-05
Kapsam: 103 otomatik test (A/B/C/D/F/G) + 38 tarayici senaryosu (E + UI akislari)
Arac: Node test kosucusu (`tests/run-suite.mjs`) + Chrome DevTools MCP

| Grup | Konu | Sonuc |
|---|---|---|
| A | Ortam degiskeni okuma | 22 / 22 ✅ |
| B | Docker Compose degisken aktarimi | 11 / 14 (3 gercek hata) |
| C | Backend ↔ Frontend haberlesme | 11 / 11 ✅ |
| D | Ayar alanlari (10 alan) — *o gunun D'si; bugun suite C icinde, bugunku `D` = canli HTTPS suiti* | 18 / 18 ✅ |
| F | Uctan uca OTA akisi | 27 / 27 ✅ |
| G | Kimlik dogrulama | 11 / 11 ✅ |
| E | "Kaydet" senaryolari (tarayici) | 20 / 20 ✅ |
| UI | Yukleme / surumler / kurulum sayfasi | 18 / 18 ✅ |

**Toplam: 141 senaryo — 138 gecti, 3 gercek hata, ayrica 5 iyilestirme notu.**

---

## Ozet: env okunuyor mu?

**Evet, hepsi okunuyor ve gozlemlenebilir etkisi var.** 15 degisken tek tek,
izole sunucu ornekleriyle davranissal olarak dogrulandi:

| Degisken | Kanit |
|---|---|
| `PORT` | Belirtilen portta dinliyor, 3000 kapali |
| `HOST` | `127.0.0.1` iken LAN adresinden erisilemiyor |
| `DATA_DIR` | DB + uploads o dizinde olusuyor |
| `LOG_LEVEL` | `debug`=1160 B cikti, `fatal`=0 B |
| `TRUST_PROXY` | `true` iken `X-Forwarded-For` IP'si loglaniyor, `false` iken hayir |
| `PUBLIC_BASE_URL` | Temiz DB'de `config.baseUrl`a geciyor; sondaki `/` kirpiliyor |
| `ADMIN_PASSWORD` | Ilk aciliste giris sagliyor; sonraki aciliste yok sayiliyor |
| `ADMIN_PASSWORD_FORCE_RESET` | `true` ile env sifresi DB'yi eziyor |
| `SESSION_SECRET` | Degisince oturumlar dusuyor, imzali linkler 403 |
| `NODE_ENV` | prod=JSON log + zorunlu sir kontrolu, dev=pretty + gecici anahtar |
| `CORS_ORIGINS` | Izinli origin ACAO + credentials aliyor, izinsiz almiyor; gecersiz bicim acilista reddediliyor |
| `COOKIE_SAMESITE` / `COOKIE_SECURE` | `auto`: ayri origin varsa `SameSite=None; Secure`, yoksa `lax` |
| Gecersiz degerler | `LOG_LEVEL=verbose`, `PORT=99999`, kisa sifre → acilista reddediliyor |
| Yukleme sirasi | `.env` → `.env.local` → shell; sonuncu kaziniyor (deneysel kanit) |

---

# 🔴 Gercek hatalar

## H1 — Caddy container'i surekli yeniden basliyor (ACME_EMAIL bos) — ✅ COZULDU

**Durum:** Kapandi (2026-08-05). Caddy servisi yigindan tamamen kaldirildi:
`docker-compose.yml`'deki `caddy` servisi, `deploy/Caddyfile`, caddy volume'leri ve
`.env`'deki `DOMAIN`/`ACME_EMAIL` degiskenleri silindi. Uygulama artik 3000 portunu
dogrudan host'a yayinliyor; TLS gerektiginde onune kullanicinin kendi ters proxy'si
konuyor. Yerini alan testler: **B9** (port yayinlanmis mi), **B10** (host portundan
`/healthz` 200 mu).

Asagisi tarihsel kayittir.

**Test (kaldirilan):** B10, B9b

`.env` icinde `ACME_EMAIL` yorum satirinda (`#ACME_EMAIL=...`). Compose bunu bos
dize olarak gonderiyor, Caddyfile'daki `email {$ACME_EMAIL}` direktifi argumansiz
kaliyor ve yapilandirma **parse edilemiyor**:

```
Error: adapting config using caddyfile: parsing caddyfile tokens for 'email':
wrong argument count or unexpected line ending after 'email', at /etc/caddy/Caddyfile:14
```

**Etki:** `--profile caddy` ile kurulum yapan herkes TLS olmadan kalir. iOS OTA
gecerli sertifikali HTTPS zorunlu kildigi icin **urun bu haliyle calismaz**, ve
hata mesaji `.env`'i degil Caddyfile'i isaret ettigi icin teshis zor.

**Cozum:** [deploy/Caddyfile:13-15](deploy/Caddyfile#L13-L15) — `email`i kosullu yap
ya da `.env.example`'da `ACME_EMAIL`i yorumdan cikarip zorunlu kil:

```caddyfile
{
	email {$ACME_EMAIL:admin@localhost}
}
```

`DOMAIN` + `ACME_EMAIL` dolu iken yapilandirma gecerli (test B9 ✅) — sorun yalnizca
bos deger durumunda.

---

## H2 — Sifre korumali kurulum sayfasinin formu mutlak adrese gonderiyor

**Test:** Tarayici senaryosu; [server/src/ota/install-page.ts:157](server/src/ota/install-page.ts#L157)

```ts
<form method="POST" action="${escapeHtml(input.pageUrl)}">
```

`pageUrl`, `baseUrl` ayarindan uretiliyor. Kullanici kurulum sayfasina **baseUrl
disinda bir adresten** ulastiysa, sifreyi girip "Devam Et"e bastiginda tarayici
baska bir host'a gidiyor.

**Yeniden uretim (dogrulandi):**
1. `baseUrl = https://ota.ankageo.com` olarak ayarla
2. Sayfayi `http://localhost:5173/i/<token>` uzerinden ac → sifre formu cikar
3. Sifreyi gir → `DNS_PROBE_FINISHED_NXDOMAIN`, kurulum tamamlanamaz
4. `baseUrl`i `http://localhost:5173` yap → ayni akis sorunsuz calisir (kok neden izole edildi)

**Etki:** `baseUrl` yanlis/eski/yazim hatali oldugunda ya da servise alternatif bir
host adindan (IP, ic DNS, staging alias, gecici tunel) erisildiginde sifre korumali
linkler tamamen kirilir. Kullanici hicbir aciklayici hata gormez.

**Cozum:** Form goreli adrese gonderilsin — `action="/i/${build.token}"` ya da
`action=""`. Ayni sey QR `<img src>` icin de gecerli
([install-page.ts:173](server/src/ota/install-page.ts#L173)).

---

## H3 — 410/404 kurulum sayfalari onbelleklenebilir; iptal geri alininca eski sayfa kaliyor

**Test:** Tarayici senaryosu R2; [server/src/http/routes/install.ts:98-101](server/src/http/routes/install.ts#L98-L101)

Yalnizca **200** yolunda `cache-control` ayarlaniyor:

| Yanit | `cache-control` |
|---|---|
| 200 (aktif) | `no-store, must-revalidate` ✅ |
| 410 (iptal / suresi dolmus / silinmis) | **yok** ❌ |
| 404 (bulunamadi) | **yok** ❌ |

**Yeniden uretim (dogrulandi):** Linki iptal et → ziyaretci sayfayi acar (410) →
yonetici "Yeniden ac" der → DTO `active` doner **ama ziyaretcinin tarayicisi
onbellekteki 410'u gostermeye devam eder**. `cache: 'no-store'` ile istendiginde
ayni adres 200 donuyor — teshis bu sekilde kesinlesti.

**Etki:** Iptali geri alinan ya da suresi uzatilan linkler, ziyaretci sert yenileme
yapana kadar "gecersiz" gorunmeye devam eder. Destek yuku yaratir.

**Cozum:** `cache-control: no-store` basligini `renderUnavailablePage` donen tum
yollara tasi.

---

# 🟡 Iyilestirme notlari

## N1 — Ayar dogrulama hatalari Turkce arayuzde Ingilizce cikiyor

Panelin tamami Turkce, ama 10 alanin 9'unda zod'un varsayilan Ingilizce mesaji
kullaniciya oldugu gibi gosteriliyor — ustelik alan etiketi yerine ham sema anahtariyla:

| Alan (panelde gorunen) | Kullaniciya gosterilen hata |
|---|---|
| Varsayilan link suresi | `defaultTtlHours: Number must be less than or equal to 8760` |
| En uzun link suresi | `maxTtlHours: Number must be greater than or equal to 1` |
| Silme gecikmesi | `purgeAfterExpiryHours: Number must be greater than or equal to 0` |
| Imzali link omru | `signedUrlTtlMinutes: Number must be greater than or equal to 5` |
| En buyuk dosya boyutu | `maxUploadMb: Number must be less than or equal to 8192` |
| Site adi | `siteName: String must contain at most 80 character(s)` |
| Kurulum notu | `installNote: String must contain at most 500 character(s)` |

Yalnizca `baseUrl` dogru davraniyor ("Gecerli bir URL girin", "Adresin sonunda /
olmamali") cunku semada elle Turkce mesaj tanimli.

**Cozum:** `config/schema.ts`'de sayisal/metin kisitlarina Turkce mesaj ekle ve
`admin.ts`'deki hata bicimlendirmesinde ham anahtar yerine `CONFIG_FIELDS`
icindeki `label`i kullan.

## N2 — Coklu gecersiz alanda yalnizca ilk hata gosteriliyor

[admin.ts:126](server/src/http/routes/admin.ts#L126) `issues[0]`i donuyor. Uc alani
birden bozup kaydedince kullanici hatalari tek tek, uc kaydet denemesiyle gorur.
`issues`in tamamini dondurup panelde liste halinde gostermek daha iyi olur.

## N3 — Panelin kendi gorselleri mutlak `baseUrl` kullaniyor

Yukleme sonucu ekranindaki QR ve ikon `<img src>`leri `baseUrl` uzerinden gidiyor.
`baseUrl`, panelin acildigi host'tan farkliysa gorseller yuklenmiyor (dogrulandi:
`naturalWidth = 0`). Ikonun harf-bas yedegi var, **QR'in yok** — bos kutu kalir.
H2 ile ayni kok neden.

## N4 — Ayarlar sayfasi acilirken `/api/settings` uc kez cagriliyor

Tek sayfa yuklemesinde 3 ayni istek gozlendi (reqid 29/30/31). Islevsel sorun degil,
ama gereksiz.

## N5 — `BuildsPage.kaydet` icindeki "Degisiklik yok" dali olu kod

[BuildsPage.tsx:93-97](web/src/pages/BuildsPage.tsx#L93-L97) — `kaydedilebilir`
false iken dugme zaten pasif oldugu icin bos `patch` ile buraya girilemiyor.

---

# ⚪ Yapilandirma durumu (hata degil, dikkat)

## D1 — Calisan container `.env` ile senkron degil

**Test:** B4

| | Deger |
|---|---|
| Container icindeki `PUBLIC_BASE_URL` | `https://localhost` |
| Host `.env` dosyasindaki deger | `http://localhost:5173` |

`.env` degistirildi ama `docker compose up -d` calistirilmadi. B6 bunun beklenen
davranis oldugunu dogruluyor (container yeniden olusturulmadan env degismez);
yine de mevcut yigin guncel degil.

## D2 — `PUBLIC_BASE_URL`, panelden bir kez kaydedilene kadar "canli"

**Test:** A7, A8, B8, B8b

`ConfigService.load()` env'i yalnizca **okur, DB'ye yazmaz**. Sonuc:

- Panelden hic "Kaydet" denmemisse → `PUBLIC_BASE_URL` **her aciliste yeniden okunur**
- Panelden bir kez kaydedilmisse → DB kilitlenir, env artik yok sayilir

Bu tutarli ve savunulabilir bir tasarim, ancak README'deki "veritabani > ortam
degiskeni" ifadesi ilk kayittan onceki asamayi kapsamadigi icin yaniltici olabilir.
Ayni kural `ADMIN_PASSWORD` icin de gecerli (A11) — orada acikca belgelenmis.

---

# ✅ Dogrulanan davranislar (secmeler)

**Backend ↔ Frontend haberlesme**
- Proxy yok: arayuz (5173) API'ye (3000) dogrudan cross-origin baglaniyor; `/admin/*` SPA'da kaliyor
- `GET /api/settings` sozlesmesi: `values` (10 alan) + `fields` (10 tanim) + `warnings`
- Panel alanlari tamamen sunucudan gelen `fields`ten uretiliyor — gizli ayar yok
- `web/src/api.ts` AppConfig tipi sunucu semasiyla birebir (drift yok)
- `PUT /api/settings` govdesinde 10 alanin tamami gidiyor
- Sunucu hata mesajlari arayuze birebir tasiniyor
- 401'de korunan 6 ucun hepsi kapali; oturum cerezi HttpOnly + SameSite

**Ayar → davranis zinciri (ayar gercekten bir sey degistiriyor mu?)**
- `maxTtlHours=12` → yukleme formunda ust sinir 12, on ayarlar filtrelendi, `9999` girisi 48'e kirpildi
- `maxTtlHours < defaultTtlHours` → sunucu `defaultTtlHours`u otomatik kirpiyor, **forma yansiyor** (24→12)
- `maxUploadMb=1` → 3 MB dosya 413 "Dosya cok buyuk. En fazla 1 MB"
- `signedUrlTtlMinutes` 5→1440 → imzali linkin `exp` degeri ~1435 dk fark ediyor
- `siteName` / `installNote` / `showQrCode` → kurulum sayfasina aninda yansiyor
- `purgeAfterExpiryHours=0` → temizlik dosyalari hemen siliyor
- `revokePreviousOnUpload` → iki yonde de calisiyor
- `baseUrl` bos → yukleme 201 ama `installUrl: null` + uyari, kurulum sayfasi 503

**OTA akisi**
- IPA meta verisi (bundle/isim/surum/build/minOS/platform/sha256) dogru cikariliyor
- Simge cikarilip imzali adresten PNG olarak sunuluyor
- `manifest.plist`: imzali 200, imzasiz 403, kurcalanmis imza 403
- `.ipa`: dogru `content-disposition`, Range destegi 206 + `content-range`, sondan okuma
- Sayaclar (goruntuleme / kurulum / indirme) artiyor
- Sifreli link: sifresiz sayfada kurulum linki **sizmiyor**, yanlis sifrede hata, dogru sifrede link cikiyor
- iptal → 410, yeniden ac → 200, sure dolumu → 410, temizlik → purged, silme → 404
- Bozuk/bos/yanlis uzantili dosyalar dogru kodlarla reddediliyor (422/400/400)
- Kurulum sayfasi User-Agent'a gore ikiye ayriliyor: iOS'ta kurulum dugmesi,
  masaustunde QR + "yalnizca iPhone/iPad" uyarisi — **iOS disi istemciye
  itms-services linki sizmiyor**

**"Kaydet" senaryolari (20/20)**
- Degisiklik yokken pasif; degisiklikte aktif + "Kaydedilmemis degisiklik var"
- Eski degere geri donuldugunde dirty bayragi korunuyor (bilincli)
- Gecersiz degerde: hata gosteriliyor, dirty korunuyor, **yanlis basari toast'i yok**
- Basarili kayitta: spinner → toast → dugme pasif → uyari yazisi kalkiyor
- Sunucunun normalize ettigi deger forma geri yansiyor
- Uyari listesi aninda tazeleniyor (http→https gecisinde uyari kayboluyor)
- F5 sonrasi degerler kalici; oturum dusmusse dogru 401 mesaji
- Es zamanli iki sekme: son yazan kazanir (kilit yok — tek yoneticili arac icin kabul edilebilir)
- Sifre karti: eslesmeyen sifrede istek **atilmiyor**, yanlis mevcut sifre, kisa sifre,
  basarili degisim (alanlar temizleniyor, eski sifre gecersiz kaliyor)
- Bakim > temizlik: "Silinecek dosya yok" / "N surumun dosyasi silindi"
- Surum duzenleme panelindeki ikinci "Kaydet" de ayni kurallara uyuyor

---

## Test verisi ve ortam (2026-08-05 itibariyla)

Tum tarayici testleri kullanicinin gelistirme veritabani uzerinde calisti;
**baslangic ayarlari ve yonetici sifresi test sonunda geri yuklendi**, olusturulan
test surumu silindi (`0 surum` dogrulandi). O gunku A/B/C/D/F/G gruplari izole sunucu
ornekleri ve gecici dizinlerde calisti, kullanicinin verisine dokunmadi.

> Bugun (2026-08-25) bu cumle oldugu gibi dogru DEGILDIR: yalnizca A ile C'nin D/F/G/H
> bloklari izoledir; C1-C16 canli `:3000`'e gider, B calisan compose yiginini surer,
> `D` ise yayindaki domain'e gercek sifreyle girip surum yukler/siler. Ayrintisi
> `CLAUDE.md` ("Tests") ve `tests/run-suite.mjs` basligindadir.

Kosum (o gunku komutlar; sozdizimi bugun de ayni, gruplarin anlami yukaridaki gibi degisti):
```bash
node tests/run-suite.mjs          # tum gruplar (A, B, C, D)
node tests/run-suite.mjs A C      # secili gruplar
```

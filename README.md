# ipa-ota-download

Self-hosted iOS **OTA (over-the-air)** dağıtım servisi. IPA dosyasını sürükle-bırak ile
yükleyin, süresi dolan paylaşılabilir bir kurulum linki alın. Alıcı linki iPhone'da
Safari ile açıp tek dokunuşla uygulamayı kurar — App Store, TestFlight ya da kablo yok.

Diawi / InstallOnAir gibi servislerin yaptığı işi kendi sunucunuzda yapar: IPA dosyanız
üçüncü taraf bir sunucuya çıkmaz.

---

## Neler var

- **Sürükle-bırak yükleme** — ilerleme çubuğuyla, büyük dosyalar akış olarak diske yazılır
- **Otomatik IPA çözümleme** — paket adı, sürüm, minimum iOS, uygulama simgesi
- **Süreli linkler** — varsayılan 1 gün, yükleme başına ayarlanabilir (1 saat … 1 yıl)
- **Düzenlenebilir link ayarları** — yüklemede girilen süre / not / şifre saklanır, panelden sonradan değiştirilir
- **Net rol ayrımı** — yükleme ve link yönetimi yalnızca yöneticide; kullanıcı sadece kendi linkinden kurar
- **Link şifresi** — isteğe bağlı, kurulum sayfası açılmadan önce sorulur
- **QR kod** — masaüstünden telefona hızlı aktarım
- **Admin panel** — sürüm listesi, süre/iptal/silme, tüm ayarlar, sayaçlar
- **Otomatik temizlik** — süresi dolan IPA dosyaları diskten silinir
- **Docker ile tek komut kurulum** — `docker compose up -d`
- Uçtan uca **TypeScript**, modüler yapı

---

## ⚠️ Önce bunu okuyun: HTTPS zorunludur

iOS, OTA kurulumunu **yalnızca geçerli sertifikalı HTTPS** üzerinden yapar. Bu bir
tercih değil, işletim sistemi kuralıdır:

- `http://` adres → kurulum başlamaz
- Self-signed (kendinden imzalı) sertifika → kurulum **hiçbir hata mesajı vermeden** başarısız olur
- Sertifika zinciri eksikse → aynı sessiz başarısızlık

Uygulama TLS sonlandırmaz; düz HTTP yayın yapar. Gerçek cihaza kurulum yapacaksanız
önüne bir ters proxy (nginx, traefik, F5, Cloudflare Tunnel…) koyup geçerli sertifikayı
orada sonlandırın ve `PUBLIC_BASE_URL`'i o `https://` adrese ayarlayın.
`http://localhost:3000` yalnızca arayüzü ve yükleme akışını test etmek içindir — o
adresle cihaza kurulum yapılamaz.

HTTPS ikinci bir nedenle daha gerekli: oturum çerezi `Secure` işaretlidir ve tarayıcılar
bu çerezi yalnızca güvenli bağlamda saklar. (Tarayıcılar `localhost`'u güvenli saydığından
yerel geliştirme HTTP ile çalışır.)

Arayüz ile API üretimde **aynı alan adı** altında sunulduğu için çerez `SameSite=Lax`
kalabilir — eskiden gerekli olan `SameSite=None` artık gerekmiyor.

Ayrıca **Enterprise (In-House) imzalı** IPA'lar herhangi bir cihaza kurulabilirken,
**Ad-Hoc** imzalı IPA'lar yalnızca provisioning profile'a UDID'si eklenmiş cihazlara
kurulur. Bu servis imzalamaya karışmaz — IPA'yı olduğu gibi dağıtır.

---

## Hızlı kurulum (Docker)

```bash
cd ipa-ota-download

cp .env.example .env
openssl rand -hex 32      # SESSION_SECRET için
```

Kök `.env` dosyası **yalnızca sırları ve makineye özel değerleri** taşır — üretim
varsayılanları `backend/.env.production` içinde durur ve imaja gömülür:

```ini
ADMIN_PASSWORD=guclu-bir-sifre-yazin
SESSION_SECRET=<openssl çıktısı>
PUBLIC_BASE_URL=https://ipa-ios.simurgbilisim.com
INSTALL_PATH_PREFIX=/api/i
CORS_ORIGINS=                 # BOŞ BIRAKIN — aşağıya bakın
```

`ADMIN_PASSWORD` veya `SESSION_SECRET` boşsa **compose başlamaz** (`${VAR:?}` biçimi);
şifresiz bir panelin sessizce ayağa kalkması yerine hata almayı tercih ediyoruz.

```bash
docker compose up -d --build
```

Arayüz **`http://localhost:5173`**, API **`http://localhost:3000`**. Port çakışıyorsa
`.env` içinde `API_PORT` / `WEB_PORT` değiştirin; container içi portlar (3000, 8080) sabit.

### Verileriniz nerede — SQLite'ı doğrudan açmak

`docker-compose.yml`, adlandırılmış volume yerine **bind mount** kullanır
(`./data-docker:/data`). Adlandırılmış volume, Docker Desktop'ın Linux sanal makinesinin
içinde durur ve macOS'tan açılamaz; bind mount ile veritabanı host'ta, elinizin altındadır:

```bash
sqlite3 data-docker/ipa-ota.db "select app_name, version, expires_at from builds;"
sqlite3 data-docker/ipa-ota.db ".tables"
```

Yerel geliştirmede aynı dosya `backend/data/ipa-ota.db` konumundadır. Sunucu her açılışta
veritabanının tam yolunu loga yazar.

> **WAL uyarısı.** SQLite WAL modunda çalışır. Veritabanını başka bir yere kopyalarsanız
> `ipa-ota.db-wal` ve `ipa-ota.db-shm` dosyalarını da alın — yalnızca `.db` dosyası en son
> yazılan kayıtları İÇERMEZ.

**Yedeklenecek dizin: `./data-docker/`** (SQLite + yüklenen IPA dosyaları).

### İki servis, iki imaj

| Servis | İmaj | Host portu | Container portu | Ne sunar |
|---|---|---|---|---|
| `api` | `ipa-ota-api` (`backend/Dockerfile`) | 3000 | 3000 | `/api/*`, kurulum yolları (`INSTALL_PATH_PREFIX`), `/healthz` |
| `web` | `ipa-ota-web` (`frontend/Dockerfile`) | 5173 | 8080 | Admin arayüzü (nginx + statik SPA) |

Aralarında container-içi trafik yoktur; ayrı ayrı derlenip dağıtılabilirler.

**API adresi imaja gömülmez ve çalışma anında da ayarlanmaz.** Arayüz üretimde *göreli yol*
kullanır (`/api/...`), yani hangi alan adı altında sunulduğu fark etmez. Eski `/config.js` +
`API_BASE_URL` mekanizması kaldırıldı.

### Yayına alırken: ters proxy (devops)

Arayüz göreli yol kullandığı için **tek alan adı** altında birleştirme artık zorunludur.
Ters proxy bu depoda yoktur; aşağıdaki iki kuralı kurmanız yeterli:

```
https://ipa-ios.simurgbilisim.com/        ->  web:8080   (SPA)
https://ipa-ios.simurgbilisim.com/api/*   ->  api:3000   (API + OTA kurulum)
```

`INSTALL_PATH_PREFIX=/api/i` tam da bunun için: kurulum yolları da mevcut `/api/*`
kuralından geçer, ikinci bir proxy kuralı gerekmez.

Örnek nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name ipa-ios.simurgbilisim.com;

    ssl_certificate     /etc/letsencrypt/live/ipa-ios.simurgbilisim.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ipa-ios.simurgbilisim.com/privkey.pem;

    # --- API + OTA kurulum yollari ---
    location ^~ /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Buyuk IPA yuklemeleri ve indirmeleri
        client_max_body_size 0;      # sinir uygulamada (maxUploadMb)
        proxy_buffering      off;    # .ipa diske tamponlanmasin
        proxy_request_buffering off;
        proxy_read_timeout   300s;
        proxy_send_timeout   300s;
    }

    # --- Admin arayuzu (SPA) ---
    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Dikkat edilecekler:

- **`CORS_ORIGINS` boş kalmalı.** Arayüz ile API aynı origin'de olduğu için CORS gereksizdir.
  Doldurursanız oturum çerezi gereksiz yere `SameSite=None`'a düşer ve koruma zayıflar.
  Boşken çerez `SameSite=Lax; Secure` olur.
- `TRUST_PROXY=true` (compose varsayılanı) — proxy arkasında olmadığınız bir kurulumda
  `false` yapın, aksi halde istemci kendi IP'sini uydurabilir.
- Sertifika **geçerli ve tam zincirli** olmalı; self-signed sertifikayla iOS kurulumu
  hiçbir hata mesajı vermeden başarısız olur.
- Proxy tarafında yükleme boyutu sınırını ve zaman aşımlarını yükseltmeyi unutmayın.

---

## Roller

İki rol vardır ve aralarındaki sınır kodla zorlanır — ayarla gevşetilemez.

| | **Yönetici** | **Kullanıcı (link sahibi)** |
|---|---|---|
| Nasıl tanınır | `ADMIN_PASSWORD` ile giriş, imzalı oturum çerezi (12 saat) | Hesabı yok; elindeki `/i/:token` linki yeter |
| IPA yükleyebilir mi | ✅ | ❌ `POST /api/uploads` → **401** |
| Link oluşturur / uzatır / iptal eder | ✅ | ❌ tüm `/api/*` uçları → **401** |
| Sürüm listesini görür | ✅ | ❌ |
| Ayarları değiştirir | ✅ | ❌ |
| Uygulama kurar | ✅ | ✅ **yalnızca kendi linkindeki IPA'yı** |

Nasıl uygulanıyor:

- `POST /api/uploads` `requireAuth` ön işleyicisiyle korunur — oturum yoksa dosya
  gövdesi okunmadan 401 döner. Bunu kapatan bir ayar **yoktur**.
- `/api/builds`, `/api/settings`, `/api/stats`, `/api/maintenance/*` zaten oturum ister.
- Web arayüzünün tamamı (`/`, `/admin/*`) yönetici panelidir; oturum yoksa giriş ekranı
  gösterilir. Son kullanıcı bu arayüzü hiç görmez.
- Son kullanıcının erişebildiği tek adres `/i/:token`'dır. Belirteç sürüme özeldir
  (22 karakter, `crypto.randomBytes`), listelenemez ve tahmin edilemez. `manifest.plist`
  ve `app.ipa` adreslerindeki HMAC imzası `token + amaç` çiftine bağlıdır: A sürümünün
  linkine sahip biri B sürümünün dosyasına erişemez, imzayı da kendisi üretemez.
- İsteğe bağlı **link şifresi** ile aynı link ikinci bir katmanla korunabilir; şifre
  doğrulanmadan imzalı adresler sayfaya hiç yazılmaz.

> Not: Bu "kullanıcı" rolü bir hesap değil, bilgi sahipliğidir — linki elde eden herkes
> o IPA'yı kurabilir. Kişi bazlı kimlik gerekiyorsa link şifresi kullanın ya da servisi
> VPN/SSO arkasına alın.

---

## Kullanım

**Link oluşturma:** Panele giriş yapın, ana sayfada IPA'yı sürükleyip bırakın →
süre / not / şifre seçin → **Yükle ve link oluştur**. Çıkan adresi paylaşın.

**Kurulum (alıcı tarafı):** Linki iPhone'da **Safari** ile açar, **Uygulamayı Yükle**'ye
dokunur. Enterprise imzalı uygulamalarda ilk açılışta
*Ayarlar › Genel › VPN ve Aygıt Yönetimi* yolundan geliştiriciye **Güven** demesi gerekir —
kurulum sayfası bunu zaten anlatıyor.

**Yönetim:** *Sürümler* ekranından iptal, silme; görüntüleme ve indirme sayaçları.
*Ayarlar* ekranından tüm yapılandırma.

### Link ayarlarını sonradan değiştirme

Yükleme sırasında girilen üç ayar (**süre**, **not**, **link şifresi**) kayıtta saklanır ve
*Sürümler › Düzenle* panelinden değiştirilebilir. Panel yalnızca dokunduğunuz alanı
gönderir — notu düzenlemek süreyi ya da şifreyi etkilemez.

- **Geçerlilik süresi** — saat kutusu + hazır düğmeler. Sürenin nereden sayılacağı seçilir:
  - *Yükleme anından* (varsayılan) — "bu link 30 gün ömürlü olsun" demek. Yüklemede girilen
    ayarın düzeltilmesidir; sonuç geçmişte kalırsa link geçersiz olur (panel önceden uyarır).
  - *Şimdiden* — süresi dolmuş bir linki yeniden canlandırmak için.

  Yeni bitiş tarihi kaydetmeden önce canlı olarak gösterilir.
- **Not** — yalnızca panelde görünür, boş bırakılabilir.
- **Link şifresi** — mevcut şifre geri okunamaz (yalnızca özeti saklanır); *değiştirme* /
  *yeni şifre belirle* / *şifreyi kaldır* seçenekleri vardır.

İptal durumu bu panelden bağımsızdır: ayar düzenlemek iptal edilmiş bir linki sessizce
açmaz. **İptal et** / **Yeniden aç** düğmeleri bunu ayrıca yönetir; "Yeniden aç", linkin
süresi de dolmuşsa saklanan süreyi şimdiden itibaren yeniden verir.

---

## Ayarlar

Hepsi admin panelden değiştirilebilir, anında geçerli olur.

| Ayar | Varsayılan | Açıklama |
|---|---|---|
| Genel adres (Base URL) | `PUBLIC_BASE_URL` | manifest.plist içindeki adreslerin kökü. **https olmalı.** |
| Varsayılan link süresi | 24 saat | Yeni linklerin ömrü |
| En uzun link süresi | 720 saat | Verilebilecek üst sınır. **En fazla 8760 saat (1 yıl)** girilebilir |
| Silme gecikmesi | 24 saat | Süresi dolan IPA'nın diskten silinme gecikmesi |
| İmzalı link ömrü | 120 dakika | manifest/.ipa adreslerindeki imzanın geçerliliği (linkin toplam ömrüyle ilgisi yok) |
| En büyük dosya boyutu | 1024 MB | Kabul edilen en büyük IPA |
| Önceki sürümü otomatik iptal et | kapalı | Aynı bundle-id yüklenince eskisini kapat |
| Site adı / Kurulum notu / QR kod | — | Kurulum sayfasının görünümü |

### Link süresi nasıl belirleniyor

Üç ayrı kademe var, karıştırılmamalı:

1. **Kod sınırı** — `MAX_TTL_HOURS = 8760` (`backend/src/config/settings.schema.ts`). Mutlak tavan;
   ayarlardan aşılamaz. Daha uzunu gerekiyorsa yalnızca burası büyütülür.
2. **En uzun link süresi** (`maxTtlHours`, varsayılan 720 = 30 gün) — admin panelden
   1…8760 arası ayarlanır. Yükleme sırasında ve süre uzatmada `clampTtl()` bu değere kırpar.
3. **Linkin kendi süresi** (`ttlHours`) — yükleme formundaki alan. 1 yıllık link için önce
   *Ayarlar › En uzun link süresi* = `8760` yapılır, sonra formda **1 yıl** seçilir.

Yükleme formundaki hızlı seçim düğmeleri (6 saat … 1 yıl) `maxTtlHours` değerine göre
filtrelenir; sınırın üzerindeki düğmeler görünmez. Süre bitince link `410` döner ve IPA
dosyası *Silme gecikmesi* kadar sonra diskten silinir — uzun ömürlü linkler diskte
o kadar süre yer kaplar.

---

## Mimari

İki bağımsız dağıtım birimi. Aralarındaki tek bağ HTTP'dir — `frontend` hiçbir şeyi
`backend`'den import etmez, tipler `frontend/src/api.ts` içinde **elle** senkron tutulur
(kayma testi: C10).

```
frontend/             React + Vite arayüz (yükleme + admin panel)
  Dockerfile          nginx imajı — statik SPA sunar
  nginx.conf          SPA fallback + önbellek politikası
  .env.development    VITE_API_BASE_URL — üretim API'si
  .env.production     VITE_API_BASE_URL boş — göreli yol
backend/
  Dockerfile          Fastify API imajı
  .env.development    Geliştirme varsayılanları (sırsız)
  .env.production     Üretim varsayılanları (sırsız, imaja gömülür)
  src/
    index.ts          Giriş noktası
    server.ts         Fastify montajı — modül kayıt defterini gezer
    container.ts      Bağımlılık kabı (tüm servisler burada kurulur)
    config/
      env.ts                Altyapı ayarları (zod ile doğrulanır)
      settings.schema.ts    Çalışma anı ayarları — TEK KAYNAK
      settings.service.ts   DB > env > varsayılan önceliği
    db/               SQLite istemcisi, ileriye dönük migration, repository'ler
    domain/
      ipa/            IPA çözümleme: zip, plist, CgBI→PNG simge dönüştürme
      links/          Belirteç üretimi, imzalı adresler, link durumu
      ota/            manifest.plist üretimi + sunucu-render kurulum sayfası
      storage/        Dosya deposu arayüzü + yerel disk sürücüsü
    modules/          Her biri bir AppModule: auth, settings, builds,
      index.ts        uploads, install, system — kayıt defteri burada
    jobs/             Süresi dolanları temizleme görevi
    shared/           Tipli hatalar, biçimlendirme, modül sözleşmesi
```

**Modülerlik nasıl çalışıyor.** Her modül klasörü bir `AppModule` dışa verir
(`{ name, description, register }`). `modules/index.ts` bunları tek dizide toplar,
`server.ts` diziyi gezip hepsini kaydeder. Yeni özellik = yeni klasör + bir satır.
Rotalar asla `server.ts` içine yazılmaz.

**Hata yönetimi.** Tüm tipli hatalar `AppError`'dan türer ve bir `statusCode` taşır.
Fastify hata yakalayıcısı 4xx için mesajı olduğu gibi, 5xx için genel bir metin döner —
yeni bir hata türü HTTP katmanında ek iş gerektirmez.

### Neden imzalı URL, neden çerez değil?

`itms-services://` linkine dokunulduğunda `manifest.plist` ve `.ipa` dosyalarını Safari
değil, işletim sisteminin **`installd`** süreci indirir. Bu süreç Safari'nin çerezlerini
paylaşmaz. Dolayısıyla çerez tabanlı bir koruma OTA kurulumunu tamamen bozar.

Bu yüzden yetkilendirme URL'nin içine, kısa ömürlü bir HMAC imzası olarak konur. Şifre
korumalı linklerde de imzalı adresler ancak doğru şifre girildikten sonra sayfaya yazılır.

### CgBI simgeleri

Xcode, uygulama simgelerini Apple'a özgü **CgBI** biçimine çevirir. `.png` uzantılı
olmalarına rağmen standart PNG değildirler; tarayıcılar açamaz. `ipa/cgbi.ts` bu üç farkı
geri alır: ham deflate açma, BGRA→RGBA takası, alfa çarpımını geri alma. Dönüştürülemeyen
bir varyantla karşılaşılırsa simge atlanır — kurulum etkilenmez.

---

## Geliştirme

```bash
npm install

cp backend/.env.local.example  backend/.env.local     # ADMIN_PASSWORD + SESSION_SECRET
cp frontend/.env.local.example frontend/.env.local    # yerel backend'e baglan

# 1. terminal — API (3000)
npm run dev:backend

# 2. terminal — arayüz (5173)
npm run dev:frontend
```

Panele `http://localhost:5173` adresinden girin. Yüklediğiniz her şey
**`backend/data/ipa-ota.db`** içine yazılır ve doğrudan açılabilir:

```bash
sqlite3 backend/data/ipa-ota.db "select app_name, version, status from builds;"
```

### Arayüz hangi backend'e bağlanıyor?

Tek kaynak var: derleme anındaki `VITE_API_BASE_URL`.

| Dosya | Değer | Sonuç |
|---|---|---|
| `frontend/.env.production` | *boş* | **göreli yol** — üretim; aynı origin, CORS yok |
| `frontend/.env.development` | `https://ipa-ios.simurgbilisim.com` | üretim API'sine bağlanır (gerçek cihaz testi) |
| `frontend/.env.local` | `http://localhost:3000` | **yerel backend** — veriler `backend/data/` içine düşer |

`.env.local` diğerlerini ezer. Yerelde çalışırken bu satır açık olsun; üretim API'siyle
test etmek istediğinizde satırı yorumlayın.

**Vite proxy'si yok.** Geliştirmede arayüz 5173'te, API 3000'de ayrı origin'lerde çalışır;
bu yüzden `backend/.env.development` içinde `CORS_ORIGINS=http://localhost:5173` tanımlıdır.
Üretimde ise tek alan adı kullanıldığı için `CORS_ORIGINS` **boştur**.

Vite `strictPort: true` ile çalışır — 5173 doluysa sessizce başka porta kaymak yerine hata
verir, çünkü kayan port `CORS_ORIGINS` ile eşleşmez ve giriş bozulur.

> **Port 3000 çakışması macOS'ta sessizdir.** Hem `npm run dev:backend` hem de api
> container'ı aynı anda dinliyor görünebilir (IPv4/IPv6) ve istekler hangisine gittiği
> belli olmaz. Önce şunu çalıştırın:
> `lsof -nP -iTCP:3000 -sTCP:LISTEN` — sonra `docker compose stop api`.

### Ortam değişkenleri nasıl okunur

Projede `dotenv` yok; dosyaları Node'un kendi `--env-file` desteği yükler.
**Sonraki dosya öncekini ezer, gerçek ortam değişkeni hepsini ezer.**

| Ne çalışıyor | Yükleme sırası |
|---|---|
| `npm run dev:backend` | `backend/.env.development` → `backend/.env.local` → kabuk |
| `npm start` / container | `backend/.env.production` → `backend/.env.local` → kabuk |
| Vite (frontend) | `.env.development` \| `.env.production` → `.env.local` |

Bölüşüm:

| Dosya | İçerik | Git'e girer mi |
|---|---|---|
| `backend/.env.development` | Geliştirme varsayılanları, **sır yok** | ✅ Evet |
| `backend/.env.production` | Üretim varsayılanları, **sır yok** — imaja gömülür | ✅ Evet |
| `backend/.env.local` | `ADMIN_PASSWORD`, `SESSION_SECRET`, makineye özel ezmeler | ❌ Hayır |
| `frontend/.env.development` / `.env.production` | `VITE_API_BASE_URL` | ✅ Evet |
| `frontend/.env.local` | Yerel backend'e yönlendirme | ❌ Hayır |
| **kök `.env`** | **yalnızca docker compose** — sırlar ve port eşlemeleri | ❌ Hayır |

Sırlar imaja gömülmez: `backend/.env.production` sırsızdır, `ADMIN_PASSWORD` ve
`SESSION_SECRET` compose'un `environment:` bloğundan gelir ve gerçek ortam değişkeni
olduğu için dosyadaki her değeri ezer.

`NODE_ENV`, `PORT` ve `DATA_DIR` compose'ta **bilerek listelenmez** — tek kaynakları imaja
gömülü `.env.production`. Böylece kök `.env` dosyasına yanlışlıkla yazılan bir
`NODE_ENV=development` container'a ulaşamaz.

`ADMIN_PASSWORD` **yalnızca ilk açılışta** veritabanına yazılır — panelden değiştirdiğiniz
şifre yeniden başlatmada geri gelmesin diye. Sıfırlamak için
`ADMIN_PASSWORD_FORCE_RESET=true` ile bir kez başlatın ya da veritabanını silin.

> `docker compose` **yalnızca kök `.env`** dosyasını okur; `backend/.env.local` onu
> ilgilendirmez.

```bash
npm run typecheck    # her iki paket
npm run build        # üretim derlemesi
```

### Testler

`npm test` **yoktur**. Gerçek paket `tests/` altında, çerçevesiz `.mjs` betikleridir:

```bash
docker compose up -d          # B grubu calisan yigini kullanir
node tests/run-suite.mjs A B C
```

Şu an **106/106 geçiyor**. A ve C grupları izole sunucu örnekleri açar (geçici veri dizini,
boş port); B grubu compose değişken aktarımını ve çalışan container'ları denetler.

Kaynak kodda import yolları `.ts` uzantısıyla yazılır: Node dosyaları derlemeden
çalıştırabilir (`--experimental-strip-types`), `tsc` derlemede uzantıları `.js`'e çevirir.
Bu yüzden **parametre özelliği** (`constructor(private x: T)`) sözdizimi kullanılmaz —
Node'un tip sıyırma modu desteklemez.

### Yeni bir modül eklemek

Backend modüler bir kayıt defteri kullanır. Yeni bir özellik için:

```
backend/src/modules/<ad>/<ad>.module.ts     ->  export const <ad>Module: AppModule = {...}
backend/src/modules/index.ts                ->  diziye BIR SATIR ekle
```

`server.ts` diziyi gezip hepsini kaydeder; ona dokunmanız gerekmez.

---

## Bakım

**Yedekleme.** Her şey **`./data-docker/`** dizininde: SQLite veritabanı + IPA dosyaları.
Adlandırılmış volume değil, bind mount — yani sıradan bir dizin gibi yedeklenir:

```bash
# En temizi: servisi durdurup al (WAL dosyalari tutarli olsun)
docker compose stop api
tar czf ipa-ota-yedek-$(date +%F).tar.gz data-docker/
docker compose start api
```

Servisi durduramıyorsanız SQLite'ın kendi tutarlı yedek komutunu kullanın —
`.db` dosyasını canlıyken kopyalamak WAL nedeniyle eksik veri verir:

```bash
sqlite3 data-docker/ipa-ota.db ".backup 'yedek-$(date +%F).db'"
tar czf ipa-dosyalari-$(date +%F).tar.gz data-docker/uploads/
```

**Şifre sıfırlama.** `ADMIN_PASSWORD` yalnızca ilk açılışta okunur (panelden değiştirilen
şifre yeniden başlatmada geri dönmesin diye). Unutursanız:

```bash
# .env içinde yeni şifreyi yazın, sonra:
ADMIN_PASSWORD_FORCE_RESET=true docker compose up -d
# çalıştıktan sonra bu değişkeni kaldırın
```

**Log:** `docker compose logs -f api` (arayüz için `web`)

**Sağlık kontrolü:** her iki serviste de `GET /healthz` — API'de `3000`, arayüzde `5173`.

---

## Güvenlik notları

- `SESSION_SECRET` değişirse tüm oturumlar ve aktif imzalı linkler geçersiz olur.
- Şifreler `scrypt` ile özetlenir (harici bağımlılık yok).
- Kurulum sayfaları `noindex` etiketlidir ve belirteçler tahmin edilemez (22 karakter).
- `.ipa` ve `manifest.plist` adresleri imzasız erişimde **403** döner.
- Yükleme **her zaman** yönetici oturumu ister; bunu kapatan bir ayar yoktur (bkz. Roller).
- Enterprise (In-House) dağıtım, Apple'ın program sözleşmesi gereği kurum çalışanlarına
  yöneliktir. Kurum dışına dağıtım sertifikanın iptal edilmesi riskini doğurur — iptal
  edilirse aynı sertifikayla imzalı **tüm** kurulumlar açılmaz hale gelir.

---

## Lisans

Dahili kullanım.
